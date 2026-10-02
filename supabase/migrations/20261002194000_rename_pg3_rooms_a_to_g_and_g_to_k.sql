-- HOTEL PG-III の実際の客室表記に合わせる。
-- 客室IDは変更しないため、既存予約・清掃タスクとの紐付けは維持される。

do $$
declare
  pg3_id uuid;
begin
  select id into pg3_id
  from public.properties
  where code = 'PG3';

  if pg3_id is null then
    raise exception 'PG3 property was not found';
  end if;

  -- すでに反映済みなら何もしない。
  if not exists (
    select 1 from public.rooms where property_id = pg3_id and room_number = 'A'
  ) and exists (
    select 1 from public.rooms where property_id = pg3_id and room_number = 'G'
  ) and exists (
    select 1 from public.rooms where property_id = pg3_id and room_number = 'K'
  ) then
    return;
  end if;

  if not exists (
    select 1 from public.rooms where property_id = pg3_id and room_number = 'A'
  ) or not exists (
    select 1 from public.rooms where property_id = pg3_id and room_number = 'G'
  ) or exists (
    select 1 from public.rooms where property_id = pg3_id and room_number = 'K'
  ) then
    raise exception 'Unexpected PG3 room state; expected A and G to exist and K to be unused';
  end if;

  update public.rooms
  set room_number = '__PG3_G_TO_K__'
  where property_id = pg3_id and room_number = 'G';

  update public.rooms
  set room_number = 'G'
  where property_id = pg3_id and room_number = 'A';

  update public.rooms
  set room_number = 'K'
  where property_id = pg3_id and room_number = '__PG3_G_TO_K__';
end $$;
