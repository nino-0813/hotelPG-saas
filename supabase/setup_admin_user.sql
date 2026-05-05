-- ============================================================
-- 初期管理者ユーザーを staff テーブルに登録
-- ============================================================
-- 前提: Supabase Auth でユーザーを作成済み
--
-- 使い方: 下のメールアドレスを自分のものに置き換えて実行
-- ============================================================

insert into public.staff (id, display_name, role, assigned_property_ids)
select id, '管理者', 'admin', '{}'
from auth.users
where email = 'admin@example.com'   -- ← ここをログインしたメールアドレスに置き換えて実行
on conflict (id) do update
set role         = 'admin',
    display_name = '管理者';

-- 確認:
select s.display_name, s.role, u.email
from public.staff s
join auth.users u on u.id = s.id;
