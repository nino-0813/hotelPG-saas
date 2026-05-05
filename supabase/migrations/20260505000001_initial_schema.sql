-- ============================================================
-- HotelPG SaaS: Initial schema
-- Tables, indexes, constraints. No triggers / RLS / seed here.
-- ============================================================

create extension if not exists "uuid-ossp";

-- ------------------------------------------------------------
-- properties: 物件マスタ (PG-I, PG-II, PG-III の3レコード固定)
-- ------------------------------------------------------------
create table public.properties (
  id            uuid primary key default uuid_generate_v4(),
  code          text not null unique,
  name          text not null,
  address       text,
  display_order int  not null default 0,
  created_at    timestamptz not null default now()
);

-- ------------------------------------------------------------
-- rooms: 部屋マスタ
-- ------------------------------------------------------------
create table public.rooms (
  id              uuid primary key default uuid_generate_v4(),
  property_id     uuid not null references public.properties(id) on delete cascade,
  room_number     text not null,
  room_type       text not null check (room_type in ('family','single','standard')),
  smart_key_code  text,
  display_order   int  not null default 0,
  created_at      timestamptz not null default now(),
  unique (property_id, room_number)
);

-- ------------------------------------------------------------
-- staff: auth.users と 1:1
-- ------------------------------------------------------------
create table public.staff (
  id                     uuid primary key references auth.users(id) on delete cascade,
  display_name           text not null,
  role                   text not null default 'staff' check (role in ('admin','staff')),
  line_user_id           text,
  assigned_property_ids  uuid[] not null default '{}',
  created_at             timestamptz not null default now()
);

-- ------------------------------------------------------------
-- reservations: 予約
-- ------------------------------------------------------------
create table public.reservations (
  id              uuid primary key default uuid_generate_v4(),
  room_id         uuid not null references public.rooms(id) on delete restrict,
  guest_name      text not null,
  guest_phone     text,
  guest_count     int  not null default 1 check (guest_count > 0),
  check_in_date   date not null,
  check_out_date  date not null,
  check_in_time   time not null default '15:00',
  check_out_time  time not null default '11:00',
  payment_method  text not null default 'online' check (payment_method in ('online','onsite')),
  smart_key_code  text,
  special_notes   text,
  source          text,
  status          text not null default 'confirmed' check (status in ('confirmed','checked_in','checked_out','cancelled')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (check_out_date >= check_in_date)
);

-- ------------------------------------------------------------
-- tasks: 予約から自動生成される作業タスク
-- ------------------------------------------------------------
create table public.tasks (
  id              uuid primary key default uuid_generate_v4(),
  reservation_id  uuid references public.reservations(id) on delete cascade,
  room_id         uuid not null references public.rooms(id),
  type            text not null check (type in ('cleaning','prep','key_setup','special_check')),
  status          text not null default 'todo' check (status in ('todo','in_progress','done')),
  assignee_id     uuid references public.staff(id) on delete set null,
  scheduled_for   timestamptz not null,
  priority        int  not null default 2 check (priority between 1 and 3),
  note            text,
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ------------------------------------------------------------
-- room_status: 各部屋の現在状態
-- ------------------------------------------------------------
create table public.room_status (
  room_id     uuid primary key references public.rooms(id) on delete cascade,
  status      text not null default 'ready' check (status in ('uncleaned','cleaning','ready','occupied')),
  updated_by  uuid references public.staff(id) on delete set null,
  updated_at  timestamptz not null default now()
);

-- ------------------------------------------------------------
-- task_status_log: タスク状態変化の監査ログ
-- ------------------------------------------------------------
create table public.task_status_log (
  id          bigserial primary key,
  task_id     uuid not null references public.tasks(id) on delete cascade,
  from_status text,
  to_status   text not null,
  changed_by  uuid references public.staff(id) on delete set null,
  changed_at  timestamptz not null default now()
);

-- ------------------------------------------------------------
-- notification_log: LINE通知ログ
-- ------------------------------------------------------------
create table public.notification_log (
  id                   bigserial primary key,
  type                 text not null,
  payload              jsonb not null,
  sent_to_line_user_id text,
  status               text not null check (status in ('sent','failed','pending')),
  error                text,
  created_at           timestamptz not null default now(),
  sent_at              timestamptz
);

-- ------------------------------------------------------------
-- Indexes
-- ------------------------------------------------------------
create index idx_rooms_property              on public.rooms(property_id, display_order);
create index idx_reservations_room_dates     on public.reservations(room_id, check_in_date, check_out_date);
create index idx_reservations_check_in_date  on public.reservations(check_in_date);
create index idx_reservations_check_out_date on public.reservations(check_out_date);
create index idx_reservations_status         on public.reservations(status);
create index idx_tasks_assignee_status       on public.tasks(assignee_id, status);
create index idx_tasks_scheduled             on public.tasks(scheduled_for);
create index idx_tasks_status                on public.tasks(status);
create index idx_tasks_room                  on public.tasks(room_id);
create index idx_notification_log_status     on public.notification_log(status, created_at);
