-- Auto-update reservations.status by Japan-local check-in / check-out instants
-- (matches each row's check_in_time / check_out_time in Asia/Tokyo).
-- Intended to be invoked periodically (e.g. Vercel Cron -> /api/cron/reservation-stay-status).

create or replace function public.auto_transition_reservation_stay_statuses()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  n_checkout int;
  n_checkin int;
begin
  -- 1) After checkout instant: end stay (order matters vs check-in below)
  update public.reservations r
  set status = 'checked_out'
  where r.status in ('checked_in', 'confirmed')
    and now()
      >= ((r.check_out_date + r.check_out_time)::timestamp at time zone 'Asia/Tokyo');

  get diagnostics n_checkout = row_count;

  -- 2) After check-in instant, before checkout instant: start stay
  update public.reservations r
  set status = 'checked_in'
  where r.status = 'confirmed'
    and now()
      >= ((r.check_in_date + r.check_in_time)::timestamp at time zone 'Asia/Tokyo')
    and now()
      < ((r.check_out_date + r.check_out_time)::timestamp at time zone 'Asia/Tokyo');

  get diagnostics n_checkin = row_count;

  return json_build_object(
    'checked_out', n_checkout,
    'checked_in', n_checkin
  );
end;
$$;

revoke all on function public.auto_transition_reservation_stay_statuses() from public;
grant execute on function public.auto_transition_reservation_stay_statuses() to service_role;
