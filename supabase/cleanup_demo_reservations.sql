-- 動作確認用のダミー予約をまとめて削除する（カレンダーに表示される source=demo のデータ）
-- Supabase Dashboard → SQL Editor で「実行」してください。
--
-- tasks は reservations に ON DELETE CASCADE があるので、この DELETE で関連タスクも消えます。

delete from public.reservations where source = 'demo';

-- 手で登録した「テスト〇〇」など名前だけがテストの予約も消したい場合は、次の 1 行のコメントを外して実行
-- （本番で名前に「テスト」を含む本予約があるときは使わないでください）
-- delete from public.reservations where guest_name ilike '%テスト%';
