-- ============================================================
-- HotelPG SaaS: reservation_logs + double-booking prevention
-- 1) reservation_logs (audit)
-- 2) EXCLUDE constraint to prevent overlapping stays per room
-- ============================================================

-- Needed for EXCLUDE USING gist on uuid (=) operator class
create extension if not exists btree_gist;

-- ------------------------------------------------------------
-- reservation_logs
-- ------------------------------------------------------------
create table if not exists public.reservation_logs (
  id             bigserial primary key,
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  action         text not null check (action in ('created','cancelled')),
  changed_at     timestamptz not null default now()
);

create index if not exists idx_reservation_logs_reservation_id
  on public.reservation_logs(reservation_id, changed_at desc);

alter table public.reservation_logs enable row level security;

-- Admin can read everything
drop policy if exists reservation_logs_admin_read on public.reservation_logs;
create policy reservation_logs_admin_read on public.reservation_logs
  for select to authenticated
  using (public.current_staff_role() = 'admin');

-- Any authenticated user may insert logs (writes originate from server actions).
drop policy if exists reservation_logs_insert_authenticated on public.reservation_logs;
create policy reservation_logs_insert_authenticated on public.reservation_logs
  for insert to authenticated
  with check (auth.uid() is not null);

-- ------------------------------------------------------------
-- Prevent double-booking on assigned rooms
-- ------------------------------------------------------------
do $$
declare
  v_conflicts int;
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'no_overlap'
  ) then
    -- Precheck: existing *active* (non-cancelled) data must not overlap.
    select count(*) into v_conflicts
    from public.reservations a
    join public.reservations b
      on a.room_id = b.room_id
     and a.id < b.id
    where a.room_id is not null
      and b.room_id is not null
      and a.status is distinct from 'cancelled'
      and b.status is distinct from 'cancelled'
      and daterange(a.check_in_date, a.check_out_date, '[)') &&
          daterange(b.check_in_date, b.check_out_date, '[)');

    if v_conflicts > 0 then
      raise exception
        'Cannot create no_overlap constraint: % overlapping reservation pairs exist. Resolve overlaps first (e.g. cancel one), then rerun. Suggested query:\n\nselect a.id as a_id, a.room_id, a.guest_name as a_guest, a.check_in_date as a_in, a.check_out_date as a_out,\n       b.id as b_id, b.guest_name as b_guest, b.check_in_date as b_in, b.check_out_date as b_out\nfrom public.reservations a\njoin public.reservations b\n  on a.room_id = b.room_id\n and a.id < b.id\nwhere a.status <> ''cancelled''\n  and b.status <> ''cancelled''\n  and a.room_id is not null\n  and a.check_in_date < b.check_out_date\n  and b.check_in_date < a.check_out_date\norder by a.room_id, a.check_in_date;',
        v_conflicts;
    end if;

    -- Apply EXCLUDE only to active rows by nulling out the operands for cancelled rows.
    -- This keeps cancelled history while preventing active double-booking.
    alter table public.reservations
      add constraint no_overlap
      exclude using gist (
        (case when status is distinct from 'cancelled' then room_id end) with =,
        (case when status is distinct from 'cancelled'
              then daterange(check_in_date, check_out_date, '[)') end) with &&
      );
  end if;
end $$;

