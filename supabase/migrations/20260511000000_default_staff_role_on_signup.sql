-- ============================================================
-- 新規サインアップ時のデフォルト role を staff に変更
-- 管理者は public.staff で個別に role = 'admin' を付与する運用とする。
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
