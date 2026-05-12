-- PG-III: 実部屋「メゾネット」を追加（最大6名プラン）
-- smart_key_code は未確定のため NULL のままにする（後でSupabaseから設定）

insert into public.rooms (property_id, room_number, room_type, smart_key_code, display_order)
select p.id, 'メゾネット', 'maisonette_6', null, 11
from public.properties p
where p.code = 'PG3'
on conflict (property_id, room_number) do nothing;
