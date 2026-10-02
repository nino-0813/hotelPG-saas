alter table public.reservations
  drop constraint if exists reservations_payment_method_check;

alter table public.reservations
  add constraint reservations_payment_method_check
  check (payment_method in ('online', 'onsite', 'accounts_receivable'));
