-- ============================================================
-- Seasonal / date-range list prices (overrides public_room_settings per night).
-- Read by /api/public/* via service role; managed via admin API.
-- ============================================================

create table public.public_seasonal_room_rates (
  id                      uuid primary key default gen_random_uuid(),
  property_code           text not null,
  room_type               text not null,
  name                    text not null,
  start_date              date not null,
  end_date                date not null,
  weekday_price           integer not null,
  friday_price            integer not null,
  saturday_price          integer not null,
  included_guests       integer,
  extra_guest_fee         integer,
  inventory_cap_override  integer,
  is_active               boolean not null default true,
  priority                integer not null default 100,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint seasonal_rates_date_range check (start_date <= end_date)
);

create index idx_public_seasonal_room_rates_lookup
  on public.public_seasonal_room_rates (property_code, room_type, is_active, start_date, end_date);

create trigger trg_public_seasonal_room_rates_updated_at
  before update on public.public_seasonal_room_rates
  for each row execute function public.set_updated_at();

alter table public.public_seasonal_room_rates enable row level security;
