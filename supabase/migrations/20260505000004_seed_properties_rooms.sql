-- ============================================================
-- HotelPG SaaS: Seed properties + rooms
--   PG-I  : 4部屋 (standard 101-104)
--   PG-II : 5部屋 (family 201-203, single 204-205)
--   PG-III: 10部屋 (standard 301-310)
-- 部屋番号は仮値。後で正確な番号に差し替え可。
-- ============================================================

-- Properties
insert into public.properties (code, name, display_order) values
  ('PG1', 'HOTEL PG -I-',   1),
  ('PG2', 'HOTEL PG -II-',  2),
  ('PG3', 'HOTEL PG -III-', 3)
on conflict (code) do nothing;

-- PG1: 4 rooms (standard) - A/B/C/D
insert into public.rooms (property_id, room_number, room_type, display_order)
select p.id, r.room_number, 'standard', r.ord
from public.properties p
cross join (values
  ('A', 1), ('B', 2), ('C', 3), ('D', 4)
) as r(room_number, ord)
where p.code = 'PG1'
on conflict (property_id, room_number) do nothing;

-- PG2: 5 rooms (family: A/B/E, single: C/D)
insert into public.rooms (property_id, room_number, room_type, display_order)
select p.id, r.room_number, r.room_type, r.ord
from public.properties p
cross join (values
  ('A', 'family', 1),
  ('B', 'family', 2),
  ('E', 'family', 3),
  ('C', 'single', 4),
  ('D', 'single', 5)
) as r(room_number, room_type, ord)
where p.code = 'PG2'
on conflict (property_id, room_number) do nothing;

-- PG3: 10 rooms (standard) - A..J (room_type は別migrationでプラン別に更新)
insert into public.rooms (property_id, room_number, room_type, display_order)
select p.id, r.room_number, 'standard', r.ord
from public.properties p
cross join (values
  ('A',  1), ('B',  2), ('C',  3), ('D',  4), ('E',  5),
  ('F',  6), ('G',  7), ('H',  8), ('I',  9), ('J', 10)
) as r(room_number, ord)
where p.code = 'PG3'
on conflict (property_id, room_number) do nothing;
