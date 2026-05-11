-- Structured fields for Stripe webhook diagnostics (no PII)
alter table public.webhook_event_logs
  add column if not exists event_type text,
  add column if not exists stripe_session_id text,
  add column if not exists property_code text,
  add column if not exists room_type text,
  add column if not exists check_in_date date,
  add column if not exists check_out_date date,
  add column if not exists reason text,
  add column if not exists assigned_room_id uuid,
  add column if not exists has_smart_key_code boolean;

create index if not exists idx_webhook_event_logs_session
  on public.webhook_event_logs (stripe_session_id)
  where stripe_session_id is not null;
