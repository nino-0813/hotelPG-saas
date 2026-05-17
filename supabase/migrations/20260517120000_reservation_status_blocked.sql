-- Rakuten-only hold: status=blocked (exported to Rakuten ICS, not counted toward web inventory cap).
alter table public.reservations
  drop constraint if exists reservations_status_check;

alter table public.reservations
  add constraint reservations_status_check
  check (
    status in (
      'confirmed',
      'checked_in',
      'checked_out',
      'cancelled',
      'blocked'
    )
  );
