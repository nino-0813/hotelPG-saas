-- Real authenticated RLS; privileged trigger owners may manage generated metadata.
begin;
create function pg_temp.check_metadata(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if;
raise notice 'PASS metadata: %',label; end $$;
create function pg_temp.reject_metadata(command text,label text) returns void language plpgsql as $$
begin
 begin execute command; exception when others then raise notice 'PASS metadata: %',label; return; end;
 raise exception 'FAIL (unexpectedly allowed): %',label;
end $$;
insert into properties(id,code,name) values
 ('a0000000-0000-0000-0000-000000000001','META-A','Synthetic'),
 ('a0000000-0000-0000-0000-000000000002','META-B','Other synthetic');
insert into rooms(id,property_id,room_number,room_type) values
 ('b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','A','standard'),
 ('b0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000002','B','standard');
insert into auth.users(id,email,raw_user_meta_data) values
 ('c0000000-0000-0000-0000-000000000001','staff@test.invalid','{}'),
 ('c0000000-0000-0000-0000-000000000002','admin@test.invalid','{}');
update staff set role='staff',assigned_property_ids=array['a0000000-0000-0000-0000-000000000001'::uuid] where id='c0000000-0000-0000-0000-000000000001';
update staff set role='admin' where id='c0000000-0000-0000-0000-000000000002';
insert into reservations(id,room_id,guest_name,check_in_date,check_out_date) values
 ('d0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','Synthetic','2036-01-01','2036-01-04');
insert into tasks(id,room_id,type,scheduled_for,note) values
 ('e0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','cleaning','2036-01-03T01:00:00Z','Manual');
set role authenticated;
set request.jwt.claim.sub='c0000000-0000-0000-0000-000000000001';
select pg_temp.reject_metadata($q$update tasks set cleaning_origin=null where reservation_id='d0000000-0000-0000-0000-000000000001' and cleaning_origin='stay'$q$,'staff cannot remove origin');
select pg_temp.reject_metadata($q$update tasks set cleaning_origin=null,status='in_progress' where reservation_id='d0000000-0000-0000-0000-000000000001' and cleaning_origin='stay'$q$,'combined origin/status bypass denied');
select pg_temp.reject_metadata($q$update tasks set type='prep' where reservation_id='d0000000-0000-0000-0000-000000000001' and cleaning_origin='stay'$q$,'staff cannot disguise generated task type');
select pg_temp.reject_metadata($q$update tasks set reservation_id=null,cleaning_origin=null where reservation_id='d0000000-0000-0000-0000-000000000001'$q$,'staff cannot detach reservation');
select pg_temp.reject_metadata($q$update tasks set cleaning_date='2036-01-03' where reservation_id='d0000000-0000-0000-0000-000000000001' and cleaning_date='2036-01-02'$q$,'staff cannot rewrite generated date');
select pg_temp.reject_metadata($q$update tasks set scheduled_for='2036-01-03T09:00:00Z' where reservation_id='d0000000-0000-0000-0000-000000000001'$q$,'staff cannot rewrite generated schedule');
select pg_temp.reject_metadata($q$update tasks set superseded_at=now() where reservation_id='d0000000-0000-0000-0000-000000000001'$q$,'staff cannot forge retirement metadata');
select pg_temp.reject_metadata($q$update tasks set room_id='b0000000-0000-0000-0000-000000000002' where id='e0000000-0000-0000-0000-000000000001'$q$,'staff cannot move manual task outside property');
select pg_temp.reject_metadata($q$update tasks set status='in_progress' where reservation_id='d0000000-0000-0000-0000-000000000001' and cleaning_date='2036-01-02'$q$,'unconfirmed work still cannot start after failed bypass');
select set_stay_cleaning_requirement('d0000000-0000-0000-0000-000000000001','2036-01-02','required');
update tasks set status='done',assignee_id=auth.uid() where reservation_id='d0000000-0000-0000-0000-000000000001' and cleaning_date='2036-01-02';
select pg_temp.check_metadata((select completed_at is not null from tasks where reservation_id='d0000000-0000-0000-0000-000000000001' and cleaning_date='2036-01-02'),'authorized RPC/start-complete route remains valid');
select pg_temp.reject_metadata($q$update tasks set completed_at='2000-01-01' where reservation_id='d0000000-0000-0000-0000-000000000001' and cleaning_date='2036-01-02'$q$,'staff cannot rewrite completion history');
set request.jwt.claim.sub='c0000000-0000-0000-0000-000000000002';
select pg_temp.reject_metadata($q$update tasks set cleaning_origin=null where reservation_id='d0000000-0000-0000-0000-000000000001'$q$,'app admin also cannot erase new generated provenance');
update tasks set room_id='b0000000-0000-0000-0000-000000000002',scheduled_for='2036-01-04T02:00:00Z',note='Edited manually',priority=1 where id='e0000000-0000-0000-0000-000000000001';
select pg_temp.check_metadata((select note='Edited manually' and room_id='b0000000-0000-0000-0000-000000000002' from tasks where id='e0000000-0000-0000-0000-000000000001'),'existing admin manual task editing preserved');
select pg_temp.reject_metadata($q$insert into tasks(room_id,reservation_id,type,scheduled_for,cleaning_origin,cleaning_date) values ('b0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','cleaning',now(),'stay','2036-01-05')$q$,'app admin cannot forge system-generated insert');
-- Authenticated admin updates reservation; nested SECURITY DEFINER reconciliation must still work.
update reservations set check_out_date='2036-01-05' where id='d0000000-0000-0000-0000-000000000001';
select pg_temp.check_metadata((select count(*)=3 from tasks where reservation_id='d0000000-0000-0000-0000-000000000001' and cleaning_origin='stay'),'nested reconciliation may maintain metadata');
reset role;
rollback;
