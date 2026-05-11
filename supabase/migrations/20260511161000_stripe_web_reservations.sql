-- ============================================================
-- Stripe web reservations support
-- - Store stripe checkout session id to prevent duplicates
-- - Lightweight webhook logs for post-payment no-availability cases
-- ============================================================

-- 1) reservations: add stripe_session_id
alter table public.reservations
  add column if not exists stripe_session_id text;

create unique index if not exists reservations_stripe_session_id_unique
  on public.reservations (stripe_session_id)
  where stripe_session_id is not null;

-- 2) webhook logs (no PII)
create table if not exists public.webhook_event_logs (
  id          bigserial primary key,
  source      text not null,                 -- 'stripe'
  event_id    text,                          -- Stripe event id (evt_*)
  session_id  text,                          -- Stripe checkout session id (cs_*)
  level       text not null default 'info',   -- 'info' | 'warn' | 'error'
  message     text not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_webhook_event_logs_created_at
  on public.webhook_event_logs(created_at desc);

alter table public.webhook_event_logs enable row level security;
