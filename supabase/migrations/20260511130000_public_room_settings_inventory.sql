-- ============================================================
-- Public marketing catalog: list prices + inventory caps (website calendar)
-- Managed via SaaS admin API; read by /api/public/availability (service role).
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- public_room_settings
-- ------------------------------------------------------------
create table public.public_room_settings (
  id                 uuid primary key default gen_random_uuid(),
  property_code      text not null,
  room_type          text not null,
  display_name       text not null,
  weekday_price      integer not null,
  friday_price       integer not null,
  saturday_price     integer not null,
  included_guests    integer not null default 2,
  extra_guest_fee    integer not null default 0,
  max_guests         integer not null default 2,
  inventory_cap      integer not null,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (property_code, room_type)
);

create trigger trg_public_room_settings_updated_at
  before update on public.public_room_settings
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- public_inventory_caps (guest-band caps, e.g. PG3 1–3 vs 4)
-- ------------------------------------------------------------
create table public.public_inventory_caps (
  id             uuid primary key default gen_random_uuid(),
  property_code  text not null,
  room_type      text not null,
  min_guests     integer not null,
  max_guests     integer not null,
  inventory_cap  integer not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (property_code, room_type, min_guests, max_guests)
);

create trigger trg_public_inventory_caps_updated_at
  before update on public.public_inventory_caps
  for each row execute function public.set_updated_at();

-- RLS: no policies — anon/authenticated cannot read; service role bypasses.
alter table public.public_room_settings enable row level security;
alter table public.public_inventory_caps enable row level security;

-- ------------------------------------------------------------
-- Seed
-- ------------------------------------------------------------
insert into public.public_room_settings (
  property_code, room_type, display_name,
  weekday_price, friday_price, saturday_price,
  included_guests, extra_guest_fee, max_guests, inventory_cap, is_active
) values
  ('PG1', 'standard', 'HOTEL PG -I-',
   8000, 8000, 8000,
   2, 0, 2, 3, true),
  ('PG2', 'single', 'HOTEL PG -II- シングル',
   8000, 12000, 12000,
   2, 0, 2, 1, true),
  ('PG2', 'family', 'HOTEL PG -II- ファミリー',
   14500, 18500, 18500,
   2, 5200, 4, 2, true),
  ('PG3', 'family', 'HOTEL PG -III',
   22500, 26500, 26500,
   2, 5200, 4, 10, true)
on conflict (property_code, room_type) do nothing;

insert into public.public_inventory_caps (
  property_code, room_type, min_guests, max_guests, inventory_cap
) values
  ('PG1', 'standard', 1, 2, 3),
  ('PG2', 'single', 1, 2, 1),
  ('PG2', 'family', 1, 4, 2),
  ('PG3', 'family', 1, 3, 10),
  ('PG3', 'family', 4, 4, 1)
on conflict (property_code, room_type, min_guests, max_guests) do nothing;
