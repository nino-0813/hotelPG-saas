-- Keep generated operational tasks aligned with reservation changes.
create or replace function public.generate_tasks_for_reservation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_check_in_ts  timestamptz;
  v_check_out_ts timestamptz;
  v_special      text := '';
begin
  if new.room_id is null or new.status in ('cancelled', 'blocked') then
    delete from public.tasks
      where reservation_id = new.id
        and type in ('cleaning', 'prep', 'key_setup', 'special_check');
    return new;
  end if;

  v_check_in_ts := (new.check_in_date + new.check_in_time)::timestamptz;
  v_check_out_ts := (new.check_out_date + new.check_out_time)::timestamptz;

  update public.tasks set room_id = new.room_id, scheduled_for = v_check_out_ts, note = 'チェックアウト後の清掃'
    where reservation_id = new.id and type = 'cleaning';
  if not found then
    insert into public.tasks (reservation_id, room_id, type, scheduled_for, priority, note)
    values (new.id, new.room_id, 'cleaning', v_check_out_ts, 2, 'チェックアウト後の清掃');
  end if;

  update public.tasks set room_id = new.room_id, scheduled_for = v_check_in_ts - interval '2 hours', note = '部屋準備'
    where reservation_id = new.id and type = 'prep';
  if not found then
    insert into public.tasks (reservation_id, room_id, type, scheduled_for, priority, note)
    values (new.id, new.room_id, 'prep', v_check_in_ts - interval '2 hours', 2, '部屋準備');
  end if;

  update public.tasks set room_id = new.room_id, scheduled_for = v_check_in_ts - interval '3 hours', note = 'スマートキー番号: ' || coalesce(new.smart_key_code, '(未設定)')
    where reservation_id = new.id and type = 'key_setup';
  if not found then
    insert into public.tasks (reservation_id, room_id, type, scheduled_for, priority, note)
    values (new.id, new.room_id, 'key_setup', v_check_in_ts - interval '3 hours', 1, 'スマートキー番号: ' || coalesce(new.smart_key_code, '(未設定)'));
  end if;

  if new.payment_method in ('onsite', 'accounts_receivable') or nullif(trim(new.special_notes), '') is not null then
    if new.payment_method = 'onsite' then v_special := '【現地決済】 '; end if;
    if new.payment_method = 'accounts_receivable' then v_special := '【売掛】 '; end if;
    v_special := v_special || coalesce(new.special_notes, '');
    update public.tasks set room_id = new.room_id, scheduled_for = v_check_in_ts - interval '1 hour', note = v_special
      where reservation_id = new.id and type = 'special_check';
    if not found then
      insert into public.tasks (reservation_id, room_id, type, scheduled_for, priority, note)
      values (new.id, new.room_id, 'special_check', v_check_in_ts - interval '1 hour', 1, v_special);
    end if;
  else
    delete from public.tasks where reservation_id = new.id and type = 'special_check';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_reservations_generate_tasks on public.reservations;
drop trigger if exists trg_reservations_generate_tasks_on_assign on public.reservations;
drop trigger if exists trg_reservations_sync_tasks on public.reservations;

create trigger trg_reservations_generate_tasks
  after insert on public.reservations
  for each row execute function public.generate_tasks_for_reservation();

create trigger trg_reservations_sync_tasks
  after update of room_id, check_in_date, check_in_time, check_out_date, check_out_time, payment_method, smart_key_code, special_notes, status
  on public.reservations
  for each row execute function public.generate_tasks_for_reservation();

alter table public.reservations
  drop constraint if exists reservations_payment_method_check;
alter table public.reservations
  add constraint reservations_payment_method_check
  check (payment_method in ('online', 'onsite', 'accounts_receivable'));

-- Imported reservations use the hotel's standard 10:00 checkout.
update public.reservations
set check_out_time = '10:00'
where external_uid is not null
  and check_out_time = '11:00';

-- Recalculate upcoming tasks, including reservations whose stay dates were edited
-- before this trigger existed. Updating the same value intentionally fires it.
update public.reservations
set check_out_time = check_out_time
where room_id is not null
  and status not in ('cancelled', 'blocked')
  and check_out_date >= current_date;

-- Remove generated work for already-cancelled or blocked reservations.
delete from public.tasks t
using public.reservations r
where t.reservation_id = r.id
  and r.status in ('cancelled', 'blocked')
  and t.type in ('cleaning', 'prep', 'key_setup', 'special_check');
