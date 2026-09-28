create table if not exists public.refund_settings (
  id boolean primary key default true check (id),
  normal_policy text not null default 'full' check (normal_policy in ('full', 'deduct_processing_fee')),
  processing_fee_rate numeric(6,3) not null default 3.960 check (processing_fee_rate >= 0 and processing_fee_rate <= 100),
  last_minute_days integer not null default 3 check (last_minute_days >= 0 and last_minute_days <= 365),
  last_minute_fee_type text not null default 'percentage' check (last_minute_fee_type in ('percentage', 'fixed')),
  last_minute_fee_value integer not null default 0 check (last_minute_fee_value >= 0),
  updated_by uuid references public.staff(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.refund_settings (id) values (true)
on conflict (id) do nothing;

create table if not exists public.refund_transactions (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null unique references public.reservations(id) on delete restrict,
  stripe_session_id text not null,
  stripe_payment_intent_id text not null,
  stripe_refund_id text unique,
  original_charge_amount integer not null check (original_charge_amount > 0),
  refund_amount integer not null check (refund_amount > 0),
  deducted_amount integer not null default 0 check (deducted_amount >= 0),
  policy text not null check (policy in ('full', 'deduct_processing_fee', 'last_minute', 'custom')),
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'canceled', 'requires_action')),
  error_message text,
  created_by uuid references public.staff(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_refund_transactions_status_created
  on public.refund_transactions(status, created_at desc);

alter table public.refund_settings enable row level security;
alter table public.refund_transactions enable row level security;

drop policy if exists "refund_settings_admin_all" on public.refund_settings;
create policy "refund_settings_admin_all" on public.refund_settings
  for all using (public.current_staff_role() = 'admin')
  with check (public.current_staff_role() = 'admin');

drop policy if exists "refund_transactions_admin_all" on public.refund_transactions;
create policy "refund_transactions_admin_all" on public.refund_transactions
  for all using (public.current_staff_role() = 'admin')
  with check (public.current_staff_role() = 'admin');
