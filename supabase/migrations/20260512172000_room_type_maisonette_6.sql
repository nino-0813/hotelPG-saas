-- Extend room_type / target_room_type for PG-III Rakuten plan variant (メゾネット洋室 最大6名)

alter table public.rooms drop constraint if exists rooms_room_type_check;

alter table public.rooms add constraint rooms_room_type_check check (
  room_type in (
    'family',
    'single',
    'standard',
    'washitsu_modern_4',
    'washitsu_modern_3',
    'maisonette_6'
  )
);

alter table public.external_calendars drop constraint if exists external_calendars_target_room_type_check;

alter table public.external_calendars add constraint external_calendars_target_room_type_check check (
  target_room_type in (
    'family',
    'single',
    'standard',
    'washitsu_modern_4',
    'washitsu_modern_3',
    'maisonette_6'
  )
);
