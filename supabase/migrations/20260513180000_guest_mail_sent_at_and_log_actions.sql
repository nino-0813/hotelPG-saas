-- Guest mail send tracking (dashboard → Gmail)
alter table public.reservations
  add column if not exists guest_mail_check_in_sent_at timestamptz,
  add column if not exists guest_mail_reservation_confirmed_sent_at timestamptz;

comment on column public.reservations.guest_mail_check_in_sent_at is
  'Last time staff sent check-in guidance email from dashboard (Gmail API).';
comment on column public.reservations.guest_mail_reservation_confirmed_sent_at is
  'Last time staff sent reservation-confirmed email from dashboard (Gmail API).';

-- Extend audit log actions for guest mail
alter table public.reservation_logs
  drop constraint if exists reservation_logs_action_check;

alter table public.reservation_logs
  add constraint reservation_logs_action_check
  check (
    action in (
      'created',
      'cancelled',
      'mail_check_in_sent',
      'mail_reservation_confirmed_sent'
    )
  );
