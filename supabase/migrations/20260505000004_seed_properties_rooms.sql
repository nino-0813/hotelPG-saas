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

-- PG1: 4 rooms (standard)
insert into public.rooms (property_id, room_number, room_type, display_order)
select p.id, r.room_number, 'standard', r.ord
from public.properties p
cross join (values
  ('101', 1), ('102', 2), ('103', 3), ('104', 4)
) as r(room_number, ord)
where p.code = 'PG1'
on conflict (property_id, room_number) do nothing;

-- PG2: 5 rooms (3 family + 2 single)
insert into public.rooms (property_id, room_number, room_type, display_order)
select p.id, r.room_number, r.room_type, r.ord
from public.properties p
cross join (values
  ('201', 'family', 1),
  ('202', 'family', 2),
  ('203', 'family', 3),
  ('204', 'single', 4),
  ('205', 'single', 5)
) as r(room_number, room_type, ord)
where p.code = 'PG2'
on conflict (property_id, room_number) do nothing;

-- PG3: 10 rooms (standard)
insert into public.rooms (property_id, room_number, room_type, display_order)
select p.id, r.room_number, 'standard', r.ord
from public.properties p
cross join (values
  ('301',  1), ('302',  2), ('303',  3), ('304',  4), ('305',  5),
  ('306',  6), ('307',  7), ('308',  8), ('309',  9), ('310', 10)
) as r(room_number, ord)
where p.code = 'PG3'
on conflict (property_id, room_number) do nothing;
