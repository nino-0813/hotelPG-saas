-- PG-III: メゾネット洋室（最大6名）を public カタログに追加
-- Website/Stripe は roomType=maisonette_6 を明示で送る想定

insert into public.public_room_settings (
  property_code, room_type, display_name,
  weekday_price, friday_price, saturday_price,
  included_guests, extra_guest_fee, max_guests, inventory_cap, is_active
) values
  (
    'PG3', 'maisonette_6', 'HOTEL PG-III メゾネット洋室（最大6名）',
    22500, 26500, 26500,
    2, 5200, 6, 1, true
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
  ('PG3', 'maisonette_6', 1, 6, 1)
on conflict (property_code, room_type, min_guests, max_guests) do update set
  inventory_cap = excluded.inventory_cap;
