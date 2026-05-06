-- ============================================================
-- HotelPG SaaS: 動作確認用ダミー予約 (削除/再生成OK)
-- 流すと約2週間ぶんの予約データが入って、カレンダー画面が埋まります。
--
-- 削除したいとき:
--   supabase/cleanup_demo_reservations.sql を SQL Editor で実行
--  （または: delete from public.reservations where source = 'demo';）
-- ============================================================

with picks as (
  select id, room_number, property_id,
         (row_number() over (order by property_id, display_order))::int as n
  from public.rooms
)
insert into public.reservations
  (room_id, guest_name, guest_phone, guest_count, check_in_date, check_out_date,
   payment_method, smart_key_code, special_notes, source, status)
select
  p.id,
  case (p.n % 8)
    when 0 then '田中 太郎'
    when 1 then '山田 花子'
    when 2 then '佐藤 一郎'
    when 3 then 'John Smith'
    when 4 then '鈴木 美咲'
    when 5 then 'Emma Wilson'
    when 6 then '高橋 健'
    else '伊藤 真理'
  end,
  '090-0000-0000',
  ((p.n % 4) + 1),
  current_date + ((p.n * 2) % 10 - 1),
  current_date + ((p.n * 2) % 10 - 1 + (p.n % 3) + 1),
  case when p.n % 3 = 0 then 'onsite' else 'online' end,
  lpad((1000 + p.n)::text, 4, '0'),
  case
    when p.n % 5 = 0 then 'バイク有'
    when p.n % 7 = 0 then 'チェックイン遅め (21時頃)'
    else null
  end,
  'demo',
  case
    when p.n % 6 = 0 then 'checked_in'
    else 'confirmed'
  end
from picks p
where p.n <= 14;

-- 一部の部屋に2件目の予約 (連続滞在パターンの確認用)
with picks as (
  select id, (row_number() over (order by property_id, display_order))::int as n
  from public.rooms
)
insert into public.reservations
  (room_id, guest_name, guest_count, check_in_date, check_out_date,
   payment_method, source, status)
select
  p.id,
  '次のお客様 ' || p.n,
  2,
  current_date + ((p.n * 2) % 10 - 1 + (p.n % 3) + 2),
  current_date + ((p.n * 2) % 10 - 1 + (p.n % 3) + 4),
  'online',
  'demo',
  'confirmed'
from picks p
where p.n in (1, 5, 9);
