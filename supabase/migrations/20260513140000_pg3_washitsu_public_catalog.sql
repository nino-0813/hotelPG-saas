-- PG-III: 3名 / 4名タイプを public カタログに明示（Web / Stripe は washitsu_modern_* キー）

insert into public.public_room_settings (
  property_code, room_type, display_name,
  weekday_price, friday_price, saturday_price,
  included_guests, extra_guest_fee, max_guests, inventory_cap, is_active
) values
  (
    'PG3', 'washitsu_modern_3', 'HOTEL PG-III 3名タイプ',
    20400, 24400, 24400,
    3, 0, 3, 9, true
  ),
  (
    'PG3', 'washitsu_modern_4', 'HOTEL PG-III 4名タイプ',
    24400, 28500, 28500,
    4, 0, 4, 1, true
  )
on conflict (property_code, room_type) do update set
  display_name = excluded.display_name,
  weekday_price = excluded.weekday_price,
  friday_price = excluded.friday_price,
  saturday_price = excluded.saturday_price,
  included_guests = excluded.included_guests,
  extra_guest_fee = excluded.extra_guest_fee,
  max_guests = excluded.max_guests,
  inventory_cap = excluded.inventory_cap,
  is_active = excluded.is_active;

insert into public.public_inventory_caps (
  property_code, room_type, min_guests, max_guests, inventory_cap
) values
  ('PG3', 'washitsu_modern_3', 1, 3, 9),
  ('PG3', 'washitsu_modern_4', 4, 4, 1)
on conflict (property_code, room_type, min_guests, max_guests) do update set
  inventory_cap = excluded.inventory_cap;
