-- No existing reservation times or tasks are rewritten by this migration.
alter table public.reservations alter column check_out_time set default '10:00';

-- NULL provenance denotes legacy/unclassified or manual tasks; never infer from note text.
alter table public.tasks
  add column cleaning_origin text check (cleaning_origin in ('checkout', 'stay')),
  add column cleaning_date date,
  add column cleaning_requirement text not null default 'required'
    check (cleaning_requirement in ('unconfirmed', 'required', 'not_required')),
  add column superseded_at timestamptz,
  add constraint tasks_cleaning_origin_shape check (
    cleaning_origin is null or
    (type = 'cleaning' and reservation_id is not null and cleaning_date is not null)
  );

create unique index tasks_generated_checkout_unique on public.tasks (reservation_id)
  where cleaning_origin = 'checkout' and status <> 'done';
create unique index tasks_generated_stay_unique on public.tasks (reservation_id, cleaning_date)
  where cleaning_origin = 'stay';

create or replace function public.generate_tasks_for_reservation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_check_in_ts  timestamptz;
  v_special      text;
  v_should_run   boolean := false;
begin
  -- INSERT: 部屋が決まっていればタスク生成
  if TG_OP = 'INSERT' then
    if new.room_id is not null then
      v_should_run := true;
    end if;
  -- UPDATE: 部屋が「未割当 → 割当」に変化したらタスク生成
  elsif TG_OP = 'UPDATE' then
    if old.room_id is null and new.room_id is not null then
      v_should_run := true;
    end if;
  end if;

  if new.status in ('cancelled', 'blocked') then return new; end if;
  if not v_should_run then
    return new;
  end if;

  v_check_in_ts  := (new.check_in_date + new.check_in_time) at time zone 'Asia/Tokyo';

  -- Cleaning is reconciled separately with explicit provenance.

  -- 部屋準備 (チェックイン2時間前)
  insert into public.tasks (reservation_id, room_id, type, scheduled_for, priority, note)
  values (new.id, new.room_id, 'prep', v_check_in_ts - interval '2 hours', 2, '部屋準備');

  -- 鍵準備 (チェックイン3時間前)
  insert into public.tasks (reservation_id, room_id, type, scheduled_for, priority, note)
  values (new.id, new.room_id, 'key_setup', v_check_in_ts - interval '3 hours', 1,
          'スマートキー番号: ' || coalesce(new.smart_key_code, '(未設定)'));

  -- 特記事項 (現地決済 or 特記事項あり の場合のみ)
  if new.payment_method = 'onsite' or (new.special_notes is not null and length(trim(new.special_notes)) > 0) then
    v_special := '';
    if new.payment_method = 'onsite' then
      v_special := v_special || '【現地決済】 ';
    end if;
    if new.special_notes is not null and length(trim(new.special_notes)) > 0 then
      v_special := v_special || new.special_notes;
    end if;
    insert into public.tasks (reservation_id, room_id, type, scheduled_for, priority, note)
    values (new.id, new.room_id, 'special_check', v_check_in_ts - interval '1 hour', 1, v_special);
  end if;

  return new;
end;
$$;


-- Reservation row updates serialize this reconciliation. Preserve task IDs, assignees,
-- requirement decisions and completion/log history; retire obsolete work without deleting it.
create or replace function public.reconcile_reservation_cleaning()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_day date;
begin
  update public.tasks set superseded_at = coalesce(superseded_at, now())
  where reservation_id = new.id and cleaning_origin is not null and status <> 'done'
    and (new.status in ('cancelled', 'blocked') or new.room_id is null
      or (cleaning_origin = 'checkout' and cleaning_date <> new.check_out_date)
      or (cleaning_origin = 'stay' and
        (cleaning_date <= new.check_in_date or cleaning_date >= new.check_out_date)));

  if new.status in ('cancelled', 'blocked') or new.room_id is null then return new; end if;

  -- Until legacy tasks have been explicitly reviewed, do not create a second checkout.
  -- Deployment runbook covers adoption of verified automatic tasks.
  if (exists (select 1 from public.tasks where reservation_id = new.id and cleaning_origin = 'checkout')
    or not exists (select 1 from public.tasks where reservation_id = new.id
      and type = 'cleaning' and cleaning_origin is null))
    and not exists (select 1 from public.tasks where reservation_id = new.id
      and cleaning_origin = 'checkout' and status = 'done' and cleaning_date = new.check_out_date) then
    insert into public.tasks (reservation_id, room_id, type, scheduled_for, priority, note,
      cleaning_origin, cleaning_date, cleaning_requirement)
    values (new.id, new.room_id, 'cleaning',
      (new.check_out_date + new.check_out_time) at time zone 'Asia/Tokyo',
      2, 'チェックアウト後の清掃', 'checkout', new.check_out_date, 'required')
    on conflict (reservation_id) where cleaning_origin = 'checkout' and status <> 'done'
    do update set room_id = excluded.room_id, scheduled_for = excluded.scheduled_for,
      cleaning_date = excluded.cleaning_date, superseded_at = null
    where tasks.status <> 'done';
  else
    -- An adopted checkout may coexist with legitimate manual cleaning tasks.
    update public.tasks set room_id = new.room_id,
      scheduled_for = (new.check_out_date + new.check_out_time) at time zone 'Asia/Tokyo',
      cleaning_date = new.check_out_date, superseded_at = null
    where reservation_id = new.id and cleaning_origin = 'checkout' and status <> 'done'
      and not exists (select 1 from public.tasks completed where completed.reservation_id = new.id
        and completed.cleaning_origin = 'checkout' and completed.status = 'done'
        and completed.cleaning_date = new.check_out_date);
  end if;

  for v_day in select new.check_in_date + n from
    generate_series(1, new.check_out_date - new.check_in_date - 1) n loop
    insert into public.tasks (reservation_id, room_id, type, scheduled_for, note,
      cleaning_origin, cleaning_date, cleaning_requirement)
    values (new.id, new.room_id, 'cleaning',
      (v_day + time '10:00') at time zone 'Asia/Tokyo',
      '滞在中の清掃（要確認）', 'stay', v_day, 'unconfirmed')
    on conflict (reservation_id, cleaning_date) where cleaning_origin = 'stay'
    do update set room_id = excluded.room_id, scheduled_for = excluded.scheduled_for,
      superseded_at = null
    where tasks.status <> 'done';
  end loop;
  return new;
end;
$$;

create trigger trg_reservations_reconcile_cleaning
  after insert or update of room_id, check_in_date, check_out_date, check_out_time, status
  on public.reservations for each row execute function public.reconcile_reservation_cleaning();

-- Staff use the existing tasks RLS: property scope and unassigned/self-assigned work only.
-- The narrowly scoped definer explicitly enforces those policies (staff cannot insert tasks).
-- A reservation lock makes decisions atomic with cancellation, date changes and room moves.
create function public.set_stay_cleaning_requirement(p_reservation_id uuid, p_date date, p_requirement text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_res public.reservations;
  v_task public.tasks;
  v_property uuid;
begin
  if p_requirement not in ('unconfirmed', 'required', 'not_required') or p_requirement is null then
    raise exception 'Invalid cleaning requirement';
  end if;
  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found or v_res.room_id is null or v_res.status in ('cancelled', 'blocked')
    or p_date <= v_res.check_in_date or p_date >= v_res.check_out_date then
    raise exception 'Stay is no longer active on this date';
  end if;
  select property_id into v_property from public.rooms where id = v_res.room_id;
  if not coalesce(public.staff_can_access_property(v_property), false) then
    raise exception 'Not permitted';
  end if;
  select * into v_task from public.tasks where reservation_id = p_reservation_id
    and cleaning_origin = 'stay' and cleaning_date = p_date for update;
  if found and (v_task.status <> 'todo' or
    (public.current_staff_role() <> 'admin' and v_task.assignee_id is not null and v_task.assignee_id <> auth.uid())) then
    raise exception 'Task is assigned to another staff member or already started';
  end if;
  -- Lazy creation also supports existing reservations without touching legacy tasks.
  insert into public.tasks (reservation_id, room_id, type, scheduled_for, note,
    cleaning_origin, cleaning_date, cleaning_requirement)
  values (v_res.id, v_res.room_id, 'cleaning', (p_date + time '10:00') at time zone 'Asia/Tokyo',
    '滞在中の清掃（要確認）', 'stay', p_date, p_requirement)
  on conflict (reservation_id, cleaning_date) where cleaning_origin = 'stay'
  do update set cleaning_requirement = excluded.cleaning_requirement, superseded_at = null;
end;
$$;
revoke all on function public.set_stay_cleaning_requirement(uuid, date, text) from public;
grant execute on function public.set_stay_cleaning_requirement(uuid, date, text) to authenticated;

-- Enforce the decision even through other task screens or direct authenticated API calls.
create function public.guard_cleaning_work_state()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_res public.reservations;
begin
  if new.type <> 'cleaning' or (new.status is not distinct from old.status
    and new.cleaning_requirement is not distinct from old.cleaning_requirement) then return new; end if;
  if new.reservation_id is not null then
    -- A task UPDATE already holds the task row lock. Taking a reservation lock
    -- here reverses reconciliation/RPC's reservation -> task order and deadlocks.
    -- Read committed reservation state without locking. An overlapping reservation
    -- writer reconciles the locked task after this statement completes; its final
    -- cancellation/date/room state controls active work and history is preserved.
    select * into v_res from public.reservations where id = new.reservation_id;
    if v_res.status in ('cancelled', 'blocked') then raise exception 'Reservation is not active'; end if;
  end if;
  if new.superseded_at is not null then raise exception 'Cleaning is no longer scheduled'; end if;
  if new.cleaning_origin = 'stay' then
    if new.cleaning_date <= v_res.check_in_date or new.cleaning_date >= v_res.check_out_date
      or new.room_id is distinct from v_res.room_id then raise exception 'Stay has changed'; end if;
    if new.status <> 'todo' and new.cleaning_requirement <> 'required' then
      raise exception 'Confirm cleaning is required before starting';
    end if;
    if new.cleaning_requirement is distinct from old.cleaning_requirement and old.status <> 'todo' then
      raise exception 'Return work to todo before changing its requirement';
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_tasks_guard_cleaning_state before update of status, cleaning_requirement on public.tasks
  for each row execute function public.guard_cleaning_work_state();

-- SECURITY INVOKER is deliberate: direct PostgREST callers remain authenticated /
-- service_role, while nested reconciliation and the scoped RPC run as their owner.
-- App roles may edit work state, not forge the metadata those guards trust.
create function public.protect_generated_cleaning_metadata()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon', 'service_role') then return new; end if;
  if TG_OP = 'INSERT' then
    if new.cleaning_origin is not null or new.cleaning_date is not null or new.superseded_at is not null then
      raise exception 'Generated cleaning metadata is managed by reservation operations';
    end if;
    return new;
  end if;
  if new.cleaning_origin is distinct from old.cleaning_origin
    or new.cleaning_date is distinct from old.cleaning_date
    or new.superseded_at is distinct from old.superseded_at then
    raise exception 'Generated cleaning metadata is immutable for app roles';
  end if;
  if (old.cleaning_origin is not null or public.current_staff_role() = 'staff') and
    (new.id is distinct from old.id or new.reservation_id is distinct from old.reservation_id
      or new.room_id is distinct from old.room_id or new.type is distinct from old.type) then
    raise exception 'Task identity and property must be changed through reservation operations';
  end if;
  if old.cleaning_origin is not null and new.scheduled_for is distinct from old.scheduled_for then
    raise exception 'Generated cleaning schedule is managed by the reservation';
  end if;
  if old.cleaning_origin is not null and new.status is not distinct from old.status
    and new.completed_at is distinct from old.completed_at then
    raise exception 'Completion history is managed by task status changes';
  end if;
  return new;
end;
$$;
create trigger trg_tasks_protect_generated_metadata before insert or update on public.tasks
  for each row execute function public.protect_generated_cleaning_metadata();
