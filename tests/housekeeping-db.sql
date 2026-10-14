-- Synthetic data only. Run in the disposable, network-disabled container.
begin;
create function pg_temp.assert(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %', label; end if;
raise notice 'PASS: %', label; end $$;
create function pg_temp.reject(command text, label text) returns void language plpgsql as $$
begin
  begin execute command; exception when others then raise notice 'PASS: %', label; return; end;
  raise exception 'FAIL (operation unexpectedly succeeded): %', label;
end $$;
select pg_temp.assert(not exists(select * from test_legacy_reservations except select id,check_out_time from reservations),'migration leaves all existing checkout times unchanged');
select pg_temp.assert(not exists(select * from test_legacy_tasks except select id,room_id,reservation_id,status,assignee_id,scheduled_for,completed_at,updated_at from tasks),'migration leaves all existing task contents unchanged');
insert into properties(id, code, name) values
 ('10000000-0000-0000-0000-000000000001','TEST-HK','Test hotel'),
 ('10000000-0000-0000-0000-000000000002','TEST-HK-OTHER','Other hotel');
insert into rooms(id,property_id,room_number,room_type) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','TEST-A','standard'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','TEST-B','standard');
insert into auth.users(id,email,raw_user_meta_data) values
 ('30000000-0000-0000-0000-000000000001','admin@test.invalid','{}'),
 ('30000000-0000-0000-0000-000000000002','staff@test.invalid','{}'),
 ('30000000-0000-0000-0000-000000000003','other@test.invalid','{}');
update staff set role='admin' where id='30000000-0000-0000-0000-000000000001';
update staff set assigned_property_ids=array['10000000-0000-0000-0000-000000000001'::uuid] where id='30000000-0000-0000-0000-000000000002';
update staff set assigned_property_ids=array['10000000-0000-0000-0000-000000000002'::uuid] where id='30000000-0000-0000-0000-000000000003';
set request.jwt.claim.sub='30000000-0000-0000-0000-000000000001';
set timezone='America/Los_Angeles';
insert into reservations(id,room_id,guest_name,check_in_date,check_out_date) values
 ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Synthetic guest','2030-01-01','2030-01-04');
select pg_temp.assert((select check_out_time='10:00' from reservations where id='40000000-0000-0000-0000-000000000001'),'DB new default 10:00');
select pg_temp.assert((select count(*)=3 from tasks where reservation_id='40000000-0000-0000-0000-000000000001' and type='cleaning'),'3 nights: 2 middle days and 1 departure, no arrival cleaning');
select pg_temp.assert((select count(*)=2 from tasks where reservation_id='40000000-0000-0000-0000-000000000001' and cleaning_requirement='unconfirmed'),'middle days unconfirmed');
select pg_temp.assert((select scheduled_for='2030-01-04T01:00:00Z'::timestamptz from tasks where reservation_id='40000000-0000-0000-0000-000000000001' and cleaning_origin='checkout'),'JST checkout independent of DB session timezone');
create temp table original_tasks as select * from tasks where reservation_id='40000000-0000-0000-0000-000000000001';
update reservations set check_out_date=check_out_date,room_id=room_id where id='40000000-0000-0000-0000-000000000001';
select pg_temp.assert((select count(*)=3 from tasks where reservation_id='40000000-0000-0000-0000-000000000001' and type='cleaning'),'repeated synchronization does not duplicate');
-- Same-day turnover (same guest name deliberately).
insert into reservations(id,room_id,guest_name,check_in_date,check_out_date) values
 ('40000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','Synthetic guest','2030-01-04','2030-01-05');
select pg_temp.assert((select count(*)=2 from reservations where room_id='20000000-0000-0000-0000-000000000001' and '2030-01-04' between check_in_date and check_out_date),'same-day turnover retains separate reservation IDs');
-- Extend after moving the following stay away.
update reservations set room_id='20000000-0000-0000-0000-000000000002' where id='40000000-0000-0000-0000-000000000002';
update tasks set assignee_id='30000000-0000-0000-0000-000000000002' where reservation_id='40000000-0000-0000-0000-000000000001' and cleaning_origin='checkout';
update reservations set check_out_date='2030-01-06',check_out_time='12:30' where id='40000000-0000-0000-0000-000000000001';
select pg_temp.assert((select scheduled_for='2030-01-06T03:30:00Z'::timestamptz and assignee_id='30000000-0000-0000-0000-000000000002' and id in (select id from original_tasks) from tasks where reservation_id='40000000-0000-0000-0000-000000000001' and cleaning_origin='checkout'),'extension and time change preserve checkout ID and assignee');
select pg_temp.assert((select count(*)=4 from tasks where reservation_id='40000000-0000-0000-0000-000000000001' and cleaning_origin='stay'),'extension adds middle days');
set role authenticated;
set request.jwt.claim.sub='30000000-0000-0000-0000-000000000002';
select set_stay_cleaning_requirement('40000000-0000-0000-0000-000000000001','2030-01-02','required');
select pg_temp.assert((select cleaning_requirement='required' from tasks where reservation_id='40000000-0000-0000-0000-000000000001' and cleaning_date='2030-01-02'),'authorized staff saves required');
select set_stay_cleaning_requirement('40000000-0000-0000-0000-000000000001','2030-01-02','not_required');
select pg_temp.assert((select cleaning_requirement='not_required' from tasks where reservation_id='40000000-0000-0000-0000-000000000001' and cleaning_date='2030-01-02'),'reload/change to not required');
select pg_temp.reject($q$update tasks set status='done' where reservation_id='40000000-0000-0000-0000-000000000001' and cleaning_date='2030-01-02'$q$,'cannot complete unnecessary cleaning');
select set_stay_cleaning_requirement('40000000-0000-0000-0000-000000000001','2030-01-02','unconfirmed');
select pg_temp.reject($q$update tasks set status='in_progress' where reservation_id='40000000-0000-0000-0000-000000000001' and cleaning_date='2030-01-02'$q$,'cannot start unconfirmed cleaning');
select set_stay_cleaning_requirement('40000000-0000-0000-0000-000000000001','2030-01-02','required');
update tasks set status='done', assignee_id='30000000-0000-0000-0000-000000000002' where reservation_id='40000000-0000-0000-0000-000000000001' and cleaning_date='2030-01-02';
select pg_temp.reject($q$select set_stay_cleaning_requirement('40000000-0000-0000-0000-000000000001','2030-01-02','not_required')$q$,'completed decision protected');
set request.jwt.claim.sub='30000000-0000-0000-0000-000000000003';
select pg_temp.reject($q$select set_stay_cleaning_requirement('40000000-0000-0000-0000-000000000001','2030-01-03','required')$q$,'other property staff denied');
reset role;
set request.jwt.claim.sub='30000000-0000-0000-0000-000000000001';
create temp table completed_snapshot as select * from tasks where reservation_id='40000000-0000-0000-0000-000000000001' and status='done';
insert into tasks(reservation_id,room_id,type,scheduled_for,note) values
 ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','cleaning','2030-01-03T03:00:00Z','Manual work');
create temp table manual_snapshot as select * from tasks where note='Manual work';
update reservations set check_out_date='2030-01-03',room_id='20000000-0000-0000-0000-000000000002' where id='40000000-0000-0000-0000-000000000001';
select pg_temp.assert((select count(*)=3 from tasks where reservation_id='40000000-0000-0000-0000-000000000001' and superseded_at is not null),'shortening retires obsolete unfinished middle days');
select pg_temp.assert((select room_id='20000000-0000-0000-0000-000000000002' and scheduled_for='2030-01-03T03:30:00Z' from tasks where reservation_id='40000000-0000-0000-0000-000000000001' and cleaning_origin='checkout'),'room move and shortening update generated checkout');
select pg_temp.assert(not exists(select * from completed_snapshot except select * from tasks),'completed history untouched');
select pg_temp.assert(not exists(select * from manual_snapshot except select * from tasks),'manual task untouched');
select pg_temp.assert((select count(*)>=1 from task_status_log where task_id in (select id from completed_snapshot)),'completion audit retained');
update reservations set status='cancelled' where id='40000000-0000-0000-0000-000000000001';
select pg_temp.assert(not exists(select 1 from tasks where reservation_id='40000000-0000-0000-0000-000000000001' and cleaning_origin is not null and status<>'done' and superseded_at is null),'manual cancellation retires generated active cleaning');
select pg_temp.assert(not exists(select * from completed_snapshot except select * from tasks),'cancellation keeps completion history');
select pg_temp.reject($q$select set_stay_cleaning_requirement('40000000-0000-0000-0000-000000000001','2030-01-02','required')$q$,'stale page cannot save cancelled stay');
-- Guest-link cancellation uses the same reservation update and records its timestamp.
update reservations set status='cancelled',guest_cancelled_at=now() where id='40000000-0000-0000-0000-000000000002';
select pg_temp.assert((select superseded_at is not null from tasks where reservation_id='40000000-0000-0000-0000-000000000002' and cleaning_origin='checkout'),'guest cancellation retires cleaning');
-- Unassigned reservations generate only when assigned.
insert into reservations(id,guest_name,check_in_date,check_out_date) values
 ('40000000-0000-0000-0000-000000000003','Unassigned','2030-02-01','2030-02-04');
select pg_temp.assert(not exists(select 1 from tasks where reservation_id='40000000-0000-0000-0000-000000000003'),'unassigned has no physical tasks');
update reservations set room_id='20000000-0000-0000-0000-000000000001' where id='40000000-0000-0000-0000-000000000003';
select pg_temp.assert((select count(*)=3 from tasks where reservation_id='40000000-0000-0000-0000-000000000003' and type='cleaning'),'assignment creates cleaning');
update reservations set check_out_time='00:30' where id='40000000-0000-0000-0000-000000000003';
select pg_temp.assert((select scheduled_for='2030-02-03T15:30:00Z' from tasks where reservation_id='40000000-0000-0000-0000-000000000003' and cleaning_origin='checkout'),'JST midnight boundary');
update reservations set room_id=null where id='40000000-0000-0000-0000-000000000003';
update reservations set room_id='20000000-0000-0000-0000-000000000002' where id='40000000-0000-0000-0000-000000000003';
select pg_temp.assert((select count(*)=3 and bool_and(superseded_at is null and room_id='20000000-0000-0000-0000-000000000002') from tasks where reservation_id='40000000-0000-0000-0000-000000000003' and type='cleaning'),'unassign/reassign restores same cleaning without duplication');
-- Completed checkout remains at its original room/time even on extension.
update tasks set status='done' where reservation_id='40000000-0000-0000-0000-000000000003' and cleaning_origin='checkout';
create temp table checkout_snapshot as select * from tasks where reservation_id='40000000-0000-0000-0000-000000000003' and cleaning_origin='checkout';
update reservations set check_out_date='2030-02-05',room_id='20000000-0000-0000-0000-000000000001' where id='40000000-0000-0000-0000-000000000003';
select pg_temp.assert(not exists(select * from checkout_snapshot except select * from tasks),'completed checkout preserved while extension creates new departure work');
select pg_temp.assert((select count(*)=1 from tasks where reservation_id='40000000-0000-0000-0000-000000000003' and cleaning_origin='checkout' and status<>'done' and cleaning_date='2030-02-05'),'one new checkout after completed historical checkout');
select pg_temp.reject($q$select set_stay_cleaning_requirement('40000000-0000-0000-0000-000000000003','2030-02-01','required')$q$,'arrival is not a middle day');
select pg_temp.reject($q$select set_stay_cleaning_requirement('40000000-0000-0000-0000-000000000003','2030-02-05','required')$q$,'departure is not a middle day');
select pg_temp.reject($q$select set_stay_cleaning_requirement('40000000-0000-0000-0000-000000000003','2030-02-02','invalid')$q$,'invalid requirement denied');
set role anon;
select pg_temp.reject($q$select public.set_stay_cleaning_requirement('40000000-0000-0000-0000-000000000003','2030-02-02','required')$q$,'anonymous RPC denied');
reset role;
-- Legacy provenance cannot be inferred; preserve it until separately reviewed.
alter table reservations disable trigger trg_reservations_reconcile_cleaning;
insert into reservations(id,room_id,guest_name,check_in_date,check_out_date,check_out_time) values
 ('40000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000002','Legacy','2030-03-01','2030-03-04','11:00');
alter table reservations enable trigger trg_reservations_reconcile_cleaning;
insert into tasks(reservation_id,room_id,type,scheduled_for,note) values
 ('40000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000002','cleaning','2030-03-04T02:00:00Z','チェックアウト後の清掃');
update reservations set check_out_date='2030-03-05' where id='40000000-0000-0000-0000-000000000004';
select pg_temp.assert(not exists(select 1 from tasks where reservation_id='40000000-0000-0000-0000-000000000004' and cleaning_origin='checkout'),'legacy task blocks duplicate checkout pending explicit adoption');
select pg_temp.assert((select scheduled_for='2030-03-04T02:00:00Z' from tasks where reservation_id='40000000-0000-0000-0000-000000000004' and cleaning_origin is null and type='cleaning'),'legacy task not guessed from its note or rewritten');
update tasks set assignee_id='30000000-0000-0000-0000-000000000001' where reservation_id='40000000-0000-0000-0000-000000000004' and cleaning_date='2030-03-02';
set role authenticated;
set request.jwt.claim.sub='30000000-0000-0000-0000-000000000002';
select pg_temp.reject($q$select set_stay_cleaning_requirement('40000000-0000-0000-0000-000000000004','2030-03-02','required')$q$,'same-property staff cannot change another assignee decision');
reset role;
-- Simulate an untouched legacy stay without intermediate tasks: the scoped RPC creates it lazily.
delete from tasks where reservation_id='40000000-0000-0000-0000-000000000004' and cleaning_origin='stay';
set role authenticated;
select set_stay_cleaning_requirement('40000000-0000-0000-0000-000000000004','2030-03-03','required');
select pg_temp.assert((select count(*)=1 from tasks where reservation_id='40000000-0000-0000-0000-000000000004' and cleaning_origin='stay'),'authorized staff can choose cleaning for an untouched legacy stay');
reset role;
set timezone='UTC';
update reservations set check_out_time='00:30' where id='40000000-0000-0000-0000-000000000004';
select pg_temp.assert((select scheduled_for='2030-03-02T01:00:00Z' from tasks where reservation_id='40000000-0000-0000-0000-000000000004' and cleaning_date='2030-03-02'),'UTC session also generates JST middle-day times');
-- Physical deletion remains distinct from cancellation.
delete from reservations where id='40000000-0000-0000-0000-000000000003';
select pg_temp.assert(not exists(select 1 from tasks where reservation_id='40000000-0000-0000-0000-000000000003'),'physical deletion still cascades');
rollback;
