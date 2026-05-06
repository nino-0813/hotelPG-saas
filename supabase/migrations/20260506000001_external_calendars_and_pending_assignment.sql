-- ============================================================
-- HotelPG SaaS: External calendar sync (Rakuten Oyado / OTA)
--                + 未割当予約のサポート
-- ============================================================
-- 楽天お宿等の OTA から iCal で予約を取り込めるようにする。
-- 取り込んだ予約はメタ情報のみで「部屋未割当」状態。
-- スタッフが画面で「部屋」と「キー番号」を入力して確定すると、
-- そのタイミングで自動タスク生成（清掃/準備/鍵/特記）が走る。
--
-- スキーマ変更:
--   1. reservations.room_id を NULL 許容に
--   2. reservations に external_* / requested_* カラム追加
--   3. external_calendars テーブル新設
--   4. 既存タスク生成トリガーを「room_id が NULL なら何もしない」に変更
--   5. 新トリガー: 部屋が未割当 → 割当 になったタイミングでタスク生成
-- ============================================================

-- ------------------------------------------------------------
-- 1. reservations の拡張
-- ------------------------------------------------------------
alter table public.reservations
  alter column room_id drop not null;

alter table public.reservations
  add column external_uid           text,
  add column external_source        text,
  add column external_calendar_id   uuid,
  add column requested_property_id  uuid references public.properties(id) on delete set null,
  add column requested_room_type    text;

create unique index reservations_external_uid_unique
  on public.reservations(external_uid)
  where external_uid is not null;

create index idx_reservations_pending_room
  on public.reservations(requested_property_id)
  where room_id is null and status <> 'cancelled';

-- ------------------------------------------------------------
-- 2. external_calendars テーブル
--    OTA ごとに ics URL を保存し、対応する物件・部屋タイプを紐付ける
-- ------------------------------------------------------------
create table public.external_calendars (
  id                   uuid primary key default uuid_generate_v4(),
  source               text not null,           -- 'rakuten_oyado' | 'booking_com' | etc.
  external_id          text not null,           -- room_groups/917598 の '917598' 部分など
  ics_url              text not null,           -- フル URL (トークン込み、要保護)
  property_id          uuid not null references public.properties(id) on delete cascade,
  target_room_type     text not null check (target_room_type in ('family','single','standard')),
  display_name         text,                    -- 管理画面用ラベル "HOTEL PG -II- ファミリータイプ"
  enabled              boolean not null default true,
  last_synced_at       timestamptz,
  last_sync_status     text check (last_sync_status in ('success','error') or last_sync_status is null),
  last_sync_error      text,
  last_sync_imported   int not null default 0,
  last_sync_cancelled  int not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (source, external_id)
);

-- 後付けで FK を付ける (循環参照を避けるため)
alter table public.reservations
  add constraint reservations_external_calendar_id_fkey
  foreign key (external_calendar_id) references public.external_calendars(id) on delete set null;

create index idx_external_calendars_enabled
  on public.external_calendars(enabled, last_synced_at);

create trigger trg_external_calendars_updated_at
  before update on public.external_calendars
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 3. タスク生成トリガーの更新
--    room_id が NULL の予約はタスクを作らない (部屋が決まってないため)
--    更新で room_id が NULL → 値 になったら、そのタイミングでタスクを作る
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

  if not v_should_run then
    return new;
  end if;

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

-- 既存トリガーは AFTER INSERT のみ。ここで AFTER UPDATE OF room_id も追加する。
drop trigger if exists trg_reservations_generate_tasks on public.reservations;

create trigger trg_reservations_generate_tasks
  after insert on public.reservations
  for each row execute function public.generate_tasks_for_reservation();

create trigger trg_reservations_generate_tasks_on_assign
  after update of room_id on public.reservations
  for each row execute function public.generate_tasks_for_reservation();

-- ------------------------------------------------------------
-- 4. RLS for external_calendars
-- ------------------------------------------------------------
alter table public.external_calendars enable row level security;

create policy "external_calendars_admin_all" on public.external_calendars
  for all to authenticated
  using (public.current_staff_role() = 'admin')
  with check (public.current_staff_role() = 'admin');

-- staff は読み取りのみ可 (管理画面に最低限のステータスが見えるように)
create policy "external_calendars_staff_read" on public.external_calendars
  for select to authenticated
  using (auth.uid() is not null);
