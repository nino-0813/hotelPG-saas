-- Extend room_type / target_room_type for HOTEL PG-III Rakuten plan variants (和モダン)
-- PG-III seed rooms 301–305 → washitsu_modern_4, 306–310 → washitsu_modern_3

alter table public.rooms drop constraint if exists rooms_room_type_check;

alter table public.rooms add constraint rooms_room_type_check check (
  room_type in (
    'family',
    'single',
    'standard',
    'washitsu_modern_4',
    'washitsu_modern_3'
  )
);

alter table public.external_calendars drop constraint if exists external_calendars_target_room_type_check;

alter table public.external_calendars add constraint external_calendars_target_room_type_check check (
  target_room_type in (
    'family',
    'single',
    'standard',
    'washitsu_modern_4',
    'washitsu_modern_3'
  )
);

update public.rooms r
set room_type = 'washitsu_modern_4'
from public.properties p
where r.property_id = p.id
  and p.code = 'PG3'
  and r.room_number in ('301', '302', '303', '304', '305');

update public.rooms r
set room_type = 'washitsu_modern_3'
from public.properties p
where r.property_id = p.id
  and p.code = 'PG3'
  and r.room_number in ('306', '307', '308', '309', '310');
