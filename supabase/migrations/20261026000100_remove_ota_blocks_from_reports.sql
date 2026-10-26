-- OTA inventory closures are calendar availability signals, not guest stays.
-- Some historical Rakuten "Not available" rows were restored together with
-- genuine stays on 2026-10-24. Return only those restored placeholders to a
-- non-reportable status. The repair snapshot remains available for auditing.

with restored_ota_blocks as (
  select r.id
  from public.reservations r
  inner join public.reservation_history_repair_log repair
    on repair.reservation_id = r.id
   and repair.reason = 'restore_past_rakuten_history_20261024'
  where r.source = 'rakuten_oyado'
    and r.status = 'checked_out'
    and lower(btrim(r.guest_name)) = 'not available'
),
cancelled as (
  update public.reservations r
  set status = 'cancelled'
  from restored_ota_blocks block
  where r.id = block.id
  returning r.id
)
insert into public.reservation_logs (reservation_id, action)
select id, 'cancelled_external_sync'
from cancelled
where not exists (
  select 1
  from public.reservation_logs existing
  where existing.reservation_id = cancelled.id
    and existing.action = 'cancelled_external_sync'
);

comment on table public.reservation_history_repair_log is
  'Recoverable audit snapshots for one-time reservation history repairs, including OTA inventory placeholders returned to cancelled status.';
