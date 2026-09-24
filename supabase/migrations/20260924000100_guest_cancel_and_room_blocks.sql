create extension if not exists pgcrypto;

alter table public.reservations
  add column if not exists guest_cancellation_token uuid not null default gen_random_uuid(),
  add column if not exists guest_cancelled_at timestamptz;

create unique index if not exists idx_reservations_guest_cancellation_token
  on public.reservations(guest_cancellation_token);

create table if not exists public.room_blocks (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create index if not exists idx_room_blocks_room_dates
  on public.room_blocks(room_id, start_date, end_date) where is_active;

alter table public.room_blocks enable row level security;

drop policy if exists "room_blocks_admin_all" on public.room_blocks;
create policy "room_blocks_admin_all" on public.room_blocks
  for all
  using (public.current_staff_role() = 'admin')
  with check (public.current_staff_role() = 'admin');

drop policy if exists "room_blocks_staff_read" on public.room_blocks;
create policy "room_blocks_staff_read" on public.room_blocks
  for select using (auth.uid() is not null);
