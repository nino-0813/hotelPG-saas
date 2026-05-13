-- Revert scheduled auto reservation status updates (manual room board flow only).
drop function if exists public.auto_transition_reservation_stay_statuses();
