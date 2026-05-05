-- ============================================================
-- HotelPG SaaS: Auth サインアップ → staff レコード自動作成
-- ============================================================
-- Supabase Auth で新しいユーザーが作成されたら、対応する public.staff の行を自動で作る。
-- フロントの「新規登録」フォームから signUp() するだけで、staff にも display_name 付きで登録される。
--
-- - display_name は signUp の options.data.display_name から取得
--   (なければメールの @ より前を使用)
-- - role はデフォルト 'admin'
--   (社内利用前提なので全員フル権限。後で個別にダウングレード可能)
-- - すでに staff 行が存在すれば何もしない (on conflict do nothing)
-- ============================================================

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_display_name text;
begin
  v_display_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
    split_part(new.email, '@', 1)
  );

  insert into public.staff (id, display_name, role, assigned_property_ids)
  values (
    new.id,
    v_display_name,
    'admin',
    '{}'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger trg_auth_users_create_staff
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ------------------------------------------------------------
-- 動作確認:
--   1) Supabase ダッシュボード Authentication > Email Auth で
--      "Confirm email" を OFF にしておく (即ログイン可)
--   2) /login の「新規登録」タブから登録
--   3) staff テーブルに display_name + role='admin' で行が増える
--      select id, display_name, role from public.staff order by created_at desc;
-- ------------------------------------------------------------
