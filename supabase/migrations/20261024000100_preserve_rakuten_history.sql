-- Preserve OTA history when old events disappear from the provider's iCal.
--
-- The application now cancels only future confirmed reservations that vanish
-- from the feed. This migration repairs historical Rakuten rows that were
-- previously auto-cancelled, while preserving explicit staff/guest cancels.

alter table public.reservation_logs
  drop constraint if exists reservation_logs_action_check;

alter table public.reservation_logs
  add constraint reservation_logs_action_check
  check (
    action in (
      'created',
      'cancelled',
      'cancelled_external_sync',
      'mail_check_in_sent',
      'mail_reservation_confirmed_sent'
    )
  );

create table if not exists public.reservation_history_repair_log (
  id bigserial primary key,
  reservation_id uuid not null references public.reservations(id) on delete restrict,
  previous_status text not null,
  restored_status text not null,
  reason text not null,
  reservation_snapshot jsonb not null,
  repaired_at timestamptz not null default now(),
  unique (reservation_id, reason)
);

alter table public.reservation_history_repair_log enable row level security;

drop policy if exists reservation_history_repair_log_admin_read
  on public.reservation_history_repair_log;
create policy reservation_history_repair_log_admin_read
  on public.reservation_history_repair_log
  for select to authenticated
  using (public.current_staff_role() = 'admin');

-- Completed stays are historical facts and must not participate in the
-- double-booking constraint. Restrict overlap prevention to live inventory.
alter table public.reservations
  drop constraint if exists no_overlap;

alter table public.reservations
  add constraint no_overlap
  exclude using gist (
    (case when status in ('confirmed', 'checked_in', 'blocked') then room_id end) with =,
    (case when status in ('confirmed', 'checked_in', 'blocked')
          then daterange(check_in_date, check_out_date, '[)') end) with &&
  );

-- Back up every candidate before changing its status. Explicit cancellations
-- are excluded when either the guest timestamp or an audit log is present.
insert into public.reservation_history_repair_log (
  reservation_id,
  previous_status,
  restored_status,
  reason,
  reservation_snapshot
)
select
  r.id,
  r.status,
  'checked_out',
  'restore_past_rakuten_history_20261024',
  to_jsonb(r)
from public.reservations r
where r.source = 'rakuten_oyado'
  and r.status = 'cancelled'
  and r.check_out_date < current_date
  and r.guest_cancelled_at is null
  and not exists (
    select 1
    from public.reservation_logs l
    where l.reservation_id = r.id
      and l.action = 'cancelled'
  )
on conflict (reservation_id, reason) do nothing;

update public.reservations r
set status = 'checked_out'
from public.reservation_history_repair_log repair
where repair.reservation_id = r.id
  and repair.reason = 'restore_past_rakuten_history_20261024'
  and r.status = 'cancelled';

comment on table public.reservation_history_repair_log is
  'Recoverable audit snapshots for one-time reservation history repairs.';
