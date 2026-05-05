-- ============================================================
-- HotelPG SaaS: Functions & Triggers
-- ============================================================

-- ------------------------------------------------------------
-- updated_at 自動更新
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_reservations_updated_at
  before update on public.reservations
  for each row execute function public.set_updated_at();

create trigger trg_tasks_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 部屋追加時に room_status を初期化
-- ------------------------------------------------------------
create or replace function public.init_room_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.room_status (room_id, status)
  values (new.id, 'ready')
  on conflict (room_id) do nothing;
  return new;
end;
$$;

create trigger trg_rooms_init_status
  after insert on public.rooms
  for each row execute function public.init_room_status();

-- ------------------------------------------------------------
-- 予約作成時にタスクを自動生成
--   cleaning      : チェックアウト時刻
--   prep          : チェックイン時刻 - 2h
--   key_setup     : チェックイン時刻 - 3h
--   special_check : 現地決済 or 特記事項あり の場合のみ
-- ------------------------------------------------------------
create or replace function public.generate_tasks_for_reservation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_check_in_ts  timestamptz;
  v_check_out_ts timestamptz;
  v_special      text;
begin
  v_check_in_ts  := (new.check_in_date  + new.check_in_time)::timestamptz;
  v_check_out_ts := (new.check_out_date + new.check_out_time)::timestamptz;

  -- 清掃 (チェックアウト時刻)
  insert into public.tasks (reservation_id, room_id, type, scheduled_for, priority, note)
  values (new.id, new.room_id, 'cleaning', v_check_out_ts, 2, 'チェックアウト後の清掃');

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

create trigger trg_reservations_generate_tasks
  after insert on public.reservations
  for each row execute function public.generate_tasks_for_reservation();

-- ------------------------------------------------------------
-- タスク状態変化時に completed_at を自動セット
-- ------------------------------------------------------------
create or replace function public.set_task_completed_at()
returns trigger
language plpgsql
as $$
begin
  if old.status is distinct from new.status then
    if new.status = 'done' and old.status <> 'done' then
      new.completed_at := now();
    elsif new.status <> 'done' then
      new.completed_at := null;
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_tasks_completed_at
  before update on public.tasks
  for each row execute function public.set_task_completed_at();

-- ------------------------------------------------------------
-- タスク状態変化を監査ログに記録
-- ------------------------------------------------------------
create or replace function public.log_task_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is distinct from new.status then
    insert into public.task_status_log (task_id, from_status, to_status, changed_by)
    values (new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end;
$$;

create trigger trg_tasks_log_status
  after update on public.tasks
  for each row execute function public.log_task_status_change();

-- ------------------------------------------------------------
-- room_status 更新時に updated_at を自動セット
-- ------------------------------------------------------------
create or replace function public.set_room_status_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_room_status_updated_at
  before update on public.room_status
  for each row execute function public.set_room_status_updated_at();
