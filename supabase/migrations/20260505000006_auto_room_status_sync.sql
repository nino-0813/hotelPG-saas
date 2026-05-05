-- ============================================================
-- HotelPG SaaS: Auto-sync room status with reservation/task changes
-- ============================================================
-- 予約とタスクの状態変化に応じて room_status を自動更新する。
-- 手動でステータス変更する手間を消すための連動。
--
--   予約 status → room_status
--     checked_in   → occupied
--     checked_out  → uncleaned
--
--   タスク (type=cleaning) status → room_status
--     in_progress  → cleaning  (元が uncleaned/cleaning のときのみ)
--     done         → ready     (元が uncleaned/cleaning のときのみ)
--
-- 「occupied」や「ready」を上書きしないガードを入れることで、
-- 「滞在中の部屋に対して清掃完了が来ても誤上書きしない」「すでに ready のときに重複更新しない」
-- 等のエッジケースを安全側に倒している。
-- ============================================================

-- ------------------------------------------------------------
-- 1. 予約ステータス変化に追従
-- ------------------------------------------------------------
create or replace function public.sync_room_status_from_reservation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  if new.status = 'checked_in' then
    update public.room_status
      set status = 'occupied',
          updated_by = null
      where room_id = new.room_id;
  elsif new.status = 'checked_out' then
    update public.room_status
      set status = 'uncleaned',
          updated_by = null
      where room_id = new.room_id;
  end if;

  return new;
end;
$$;

create trigger trg_reservations_sync_room_status
  after update of status on public.reservations
  for each row execute function public.sync_room_status_from_reservation();

-- ------------------------------------------------------------
-- 2. 清掃タスクのステータス変化に追従
--    type='cleaning' のタスクのみ対象。
--    元の room_status が uncleaned / cleaning のときに限り上書き。
--    (occupied / ready のときは触らない = 安全側)
-- ------------------------------------------------------------
create or replace function public.sync_room_status_from_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.type <> 'cleaning' then
    return new;
  end if;

  if old.status is not distinct from new.status then
    return new;
  end if;

  if new.status = 'in_progress' then
    update public.room_status
      set status = 'cleaning',
          updated_by = new.assignee_id
      where room_id = new.room_id
        and status in ('uncleaned', 'cleaning');
  elsif new.status = 'done' then
    update public.room_status
      set status = 'ready',
          updated_by = new.assignee_id
      where room_id = new.room_id
        and status in ('uncleaned', 'cleaning');
  end if;

  return new;
end;
$$;

create trigger trg_tasks_sync_room_status
  after update of status on public.tasks
  for each row execute function public.sync_room_status_from_task();

-- ------------------------------------------------------------
-- 動作確認用クエリ (任意で実行)
-- ------------------------------------------------------------
-- 1) チェックイン → occupied になるか
--    update reservations set status = 'checked_in' where id = '<予約ID>';
--    select rs.status from room_status rs join reservations r on r.room_id = rs.room_id where r.id = '<予約ID>';
--    -- 期待: 'occupied'
--
-- 2) チェックアウト → uncleaned になるか
--    update reservations set status = 'checked_out' where id = '<予約ID>';
--    -- 期待: 'uncleaned'
--
-- 3) 清掃タスク開始 → cleaning, 完了 → ready
--    update tasks set status = 'in_progress' where id = '<清掃タスクID>';
--    -- 期待: 部屋ステータス 'cleaning'
--    update tasks set status = 'done' where id = '<清掃タスクID>';
--    -- 期待: 部屋ステータス 'ready'
