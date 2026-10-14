"""Real competing Postgres transactions; ONLY invoked inside our disposable Docker test DB."""
import subprocess
import sys
import time

container = sys.argv[1]
assert container.startswith('hotelpg-housekeeping-test-'), 'Disposable test container required'
expect_deadlock = '--expect-deadlock' in sys.argv
command = ['docker', 'exec', '-i', container, 'psql', '-U', 'postgres', '-Atq', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']


def query(sql):
    result = subprocess.run(command, input=sql, text=True, capture_output=True, timeout=20)
    if result.returncode:
        raise AssertionError(result.stderr)
    return result.stdout.strip()


for scenario in ['cancel', 'shorten', 'move', 'requirement']:
    prop = query("insert into properties(code,name) values ('CONCURRENT-' || gen_random_uuid(),'Synthetic concurrency') returning id;")
    room = query(f"insert into rooms(property_id,room_number,room_type) values ('{prop}','A','standard') returning id;")
    other_room = query(f"insert into rooms(property_id,room_number,room_type) values ('{prop}','B','standard') returning id;")
    reservation = query(f"insert into reservations(room_id,guest_name,check_in_date,check_out_date) values ('{room}','Synthetic','2035-01-01','2035-01-04') returning id;")
    task = query(f"select id from tasks where reservation_id='{reservation}' and cleaning_origin='stay' and cleaning_date='2035-01-02';")
    if expect_deadlock and scenario == 'cancel':
        actor = query("insert into auth.users(id,email,raw_user_meta_data) values (gen_random_uuid(),'staff@test.invalid','{}') returning id;")
        query(f"set role authenticated; set request.jwt.claim.sub='{actor}'; update tasks set cleaning_origin=null where id='{task}'; update tasks set status='in_progress' where id='{task}';")
        assert query(f"select cleaning_requirement || ':' || status from tasks where id='{task}';") == 'unconfirmed:in_progress'
        print('REPRODUCED: authenticated staff removes origin and starts unconfirmed work', flush=True)
        query(f"update tasks set status='todo',cleaning_origin='stay' where id='{task}';")
    query(f"update tasks set cleaning_requirement='required' where id='{task}';")
    admin = query("insert into auth.users(id,email,raw_user_meta_data) values (gen_random_uuid(),'concurrency@test.invalid','{}') returning id;")
    query(f"update staff set role='admin' where id='{admin}';")

    worker = query("insert into auth.users(id,email,raw_user_meta_data) values (gen_random_uuid(),'worker@test.invalid','{}') returning id;")
    query(f"update staff set role='staff',assigned_property_ids=array['{prop}'::uuid] where id='{worker}';")

    # B takes the reservation lock first, as reconciliation and the scoped RPC do.
    b = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    b.stdin.write(f"begin; set local statement_timeout='8s'; select id from reservations where id='{reservation}' for update;\n\\echo reservation_locked\n")
    b.stdin.flush()
    while b.stdout.readline().strip() != 'reservation_locked':
        if b.poll() is not None:
            raise AssertionError(b.stderr.read())

    # A acquires the task lock automatically before its BEFORE UPDATE trigger.
    a = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    a.stdin.write(f"set application_name='hk-concurrent-status'; set statement_timeout='8s'; set role authenticated; set request.jwt.claim.sub='{worker}'; update tasks set status='in_progress' where id='{task}';\n")
    a.stdin.close()
    a.stdin = None
    # Wait for either success (fixed guard) or the reservation-lock wait (old guard).
    for _ in range(50):
        if a.poll() is not None:
            break
        if query("select count(*) from pg_stat_activity where application_name='hk-concurrent-status' and wait_event_type='Lock';") != '0':
            break
        time.sleep(0.02)
    else:
        raise AssertionError('Status transaction did not reach expected synchronization point')

    if scenario == 'requirement':
        operation = f"set local request.jwt.claim.sub='{admin}'; select set_stay_cleaning_requirement('{reservation}','2035-01-02','not_required');"
    else:
        assignment = {'cancel': "status='cancelled'", 'shorten': "check_out_date='2035-01-02'", 'move': f"room_id='{other_room}'"}[scenario]
        operation = f"update reservations set {assignment} where id='{reservation}';"
    b.stdin.write(operation + '\ncommit;\n')
    b.stdin.close()
    b.stdin = None
    a_out, a_err = a.communicate(timeout=15)
    b_out, b_err = b.communicate(timeout=15)
    deadlock = '40P01' in a_err + b_err
    if expect_deadlock:
        assert deadlock, (scenario, a_err, b_err)
        print(f'REPRODUCED: {scenario}: SQLSTATE 40P01 (old FOR SHARE guard)', flush=True)
        continue
    assert not deadlock, (scenario, a_err, b_err)
    assert a.returncode == 0, (scenario, a_err)
    if scenario == 'requirement':
        assert b.returncode != 0 and 'already started' in b_err, b_err
        assert query(f"select cleaning_requirement || ':' || status from tasks where id='{task}';") == 'required:in_progress'
        print('PASS concurrency: competing requirement edit rejects started work, no deadlock', flush=True)
    else:
        assert b.returncode == 0, (scenario, b_err)
        if scenario in ['cancel', 'shorten']:
            assert query(f"select superseded_at is not null from tasks where id='{task}';") == 't'
        else:
            assert query(f"select room_id from tasks where id='{task}';") == other_room
        print(f'PASS concurrency: {scenario} reconciles after status commit, no deadlock', flush=True)
