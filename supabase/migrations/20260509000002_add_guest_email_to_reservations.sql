-- Add guest email (from external iCal DESCRIPTION: EMAIL)
alter table public.reservations
  add column if not exists guest_email text;

