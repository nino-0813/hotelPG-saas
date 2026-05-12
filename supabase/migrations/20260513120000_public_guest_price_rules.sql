-- ============================================================
-- Guest-band list prices (e.g. PG3 family 3名 / 4名)
-- Priority after seasonal, before public_room_settings base row.
-- ============================================================

create table public.public_guest_price_rules (
  id               uuid primary key default gen_random_uuid(),
  property_code    text not null,
  room_type        text not null,
  min_guests       integer not null,
  max_guests       integer not null,
  weekday_price    integer not null,
  friday_price     integer not null,
  saturday_price   integer not null,
  is_active        boolean not null default true,
  priority         integer not null default 100,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint guest_price_rules_guest_range check (min_guests <= max_guests),
  constraint guest_price_rules_weekday_nonneg check (weekday_price >= 0),
  constraint guest_price_rules_friday_nonneg check (friday_price >= 0),
  constraint guest_price_rules_saturday_nonneg check (saturday_price >= 0)
);

create index idx_public_guest_price_rules_lookup
  on public.public_guest_price_rules (property_code, room_type, is_active, priority desc);

create trigger trg_public_guest_price_rules_updated_at
  before update on public.public_guest_price_rules
  for each row execute function public.set_updated_at();

alter table public.public_guest_price_rules enable row level security;

insert into public.public_guest_price_rules (
  property_code, room_type, min_guests, max_guests,
  weekday_price, friday_price, saturday_price, is_active, priority
) values
  ('PG3', 'family', 3, 3, 20400, 24400, 24400, true, 100),
  ('PG3', 'family', 4, 4, 24400, 28500, 28500, true, 100);
