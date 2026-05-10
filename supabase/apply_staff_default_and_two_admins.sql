-- ============================================================
-- 本番などで SQL Editor から「1回だけ」実行する想定のスクリプト
-- 1) 新規サインアップ時の role を staff にする（トリガー関数を差し替え）
-- 2) 既存 staff を一旦すべて staff にし、管理者2名だけ admin に戻す
-- ============================================================
-- 管理者 UID は Authentication Users と一致させること:
--   hotelpg.info@gmail.com      → c35992ad-9f93-48e0-8270-4c50ffac6e4c
--   ninomiya.8130@gmail.com    → d193ece1-ea2d-49d3-948c-970269e87d9d
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
    'staff',
    '{}'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

update public.staff
set role = 'staff';

update public.staff
set role = 'admin'
where id in (
  'c35992ad-9f93-48e0-8270-4c50ffac6e4c'::uuid,
  'd193ece1-ea2d-49d3-948c-970269e87d9d'::uuid
);

select id, display_name, role, assigned_property_ids
from public.staff
order by role desc, display_name;
