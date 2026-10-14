-- Run this WHOLE statement once in the SaaS production project's SQL Editor.
-- Returns ONE row / ONE JSON column: export the result as JSON or CSV.
-- Catalog-only SELECT: no application rows, function calls to application code,
-- credentials, JWT claims, literal-bearing function bodies, or history-table reads.
-- Missing history/schema objects/roles are reported, not assumed unapplied.
with
wanted_roles(role_name) as (
  values ('anon'), ('authenticated'), ('service_role'), ('authenticator')
),
app_roles as (
  select w.role_name, r.oid, r.rolsuper, r.rolinherit, r.rolcanlogin, r.rolbypassrls
  from wanted_roles w left join pg_roles r on r.rolname=w.role_name
),
wanted_tables(table_name) as (
  values ('tasks'), ('reservations'), ('staff'), ('rooms'), ('properties')
),
app_tables as (
  select w.table_name, c.oid, c.relowner, c.relrowsecurity, c.relforcerowsecurity
  from wanted_tables w
  left join pg_namespace n on n.nspname='public'
  left join pg_class c on c.relnamespace=n.oid and c.relname=w.table_name
    and c.relkind in ('r','p')
),
wanted_columns(table_name,column_name) as (
  values
    ('tasks','id'), ('tasks','reservation_id'), ('tasks','room_id'),
    ('tasks','type'), ('tasks','status'), ('tasks','assignee_id'),
    ('tasks','scheduled_for'), ('tasks','completed_at'),
    ('tasks','cleaning_origin'), ('tasks','cleaning_date'),
    ('tasks','cleaning_requirement'), ('tasks','superseded_at'),
    ('reservations','room_id'), ('reservations','check_in_date'),
    ('reservations','check_out_date'), ('reservations','check_out_time'),
    ('reservations','status'), ('staff','role'),
    ('staff','assigned_property_ids'), ('rooms','property_id')
),
column_state as (
  select w.table_name, w.column_name, a.attnum is not null as present,
    format_type(a.atttypid,a.atttypmod) as data_type, a.attnotnull as not_null,
    pg_get_expr(d.adbin,d.adrelid) as default_expression
  from wanted_columns w join app_tables t using(table_name)
  left join pg_attribute a on a.attrelid=t.oid and a.attname=w.column_name
    and a.attnum>0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid=t.oid and d.adnum=a.attnum
),
wanted_functions(function_name) as (
  values ('generate_tasks_for_reservation'), ('reconcile_reservation_cleaning'),
    ('set_stay_cleaning_requirement'), ('guard_cleaning_work_state'),
    ('protect_generated_cleaning_metadata'), ('staff_can_access_property'),
    ('current_staff_role'), ('current_staff_property_ids')
),
function_state as (
  select w.function_name, p.oid, p.pronamespace, p.proowner, p.prosecdef,
    p.provolatile, p.proacl, p.prosrc, p.proconfig,
    pg_get_function_identity_arguments(p.oid) as identity_arguments,
    pg_get_function_result(p.oid) as return_type
  from wanted_functions w left join pg_namespace n on n.nspname='public'
  left join pg_proc p on p.pronamespace=n.oid and p.proname=w.function_name
)
select jsonb_build_object(
  'report_version','housekeeping-preflight-v2',
  'checked_at_utc',to_char(current_timestamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'database',current_database(),
  'execution_role',current_user,
  'server_version',current_setting('server_version'),
  'scope','public schema metadata only; project ref is not inferred from database name',
  'history',jsonb_build_object(
    'table_exists',to_regclass('supabase_migrations.schema_migrations') is not null,
    'note','Absence of history is NOT evidence that migrations are unapplied; no history rows are read.'
  ),
  'application_roles',(
    select jsonb_agg(jsonb_build_object(
      'role',r.role_name, 'exists',r.oid is not null,
      'superuser',r.rolsuper, 'bypass_rls',r.rolbypassrls,
      'inherit',r.rolinherit, 'can_login',r.rolcanlogin,
      'member_of',coalesce((
        select jsonb_agg(parent.rolname order by parent.rolname)
        from pg_auth_members m join pg_roles parent on parent.oid=m.roleid
        where m.member=r.oid
      ),'[]'::jsonb)
    ) order by r.role_name) from app_roles r
  ),
  'tables',(
    select jsonb_agg(jsonb_build_object(
      'table',t.table_name, 'exists',t.oid is not null,
      'owner',pg_get_userbyid(t.relowner),
      'rls_enabled',t.relrowsecurity, 'rls_forced',t.relforcerowsecurity,
      'role_privileges',(
        select jsonb_agg(jsonb_build_object(
          'role',r.role_name,
          'select',case when r.oid is not null and t.oid is not null then has_table_privilege(r.oid,t.oid,'SELECT') end,
          'insert',case when r.oid is not null and t.oid is not null then has_table_privilege(r.oid,t.oid,'INSERT') end,
          'update',case when r.oid is not null and t.oid is not null then has_table_privilege(r.oid,t.oid,'UPDATE') end,
          'delete',case when r.oid is not null and t.oid is not null then has_table_privilege(r.oid,t.oid,'DELETE') end
        ) order by r.role_name) from app_roles r
      )
    ) order by t.table_name) from app_tables t
  ),
  'columns',(
    select jsonb_agg(jsonb_build_object(
      'table',c.table_name, 'column',c.column_name, 'exists',c.present,
      'type',c.data_type, 'not_null',c.not_null,
      'default_redacted',regexp_replace(c.default_expression,$rx$'(?:[^']|'')*'$rx$,'''[literal]''','g'),
      'default_md5',md5(c.default_expression),
      'known_checkout_default',case
        when c.table_name='reservations' and c.column_name='check_out_time' then
          case when c.default_expression in ('''10:00:00''::time without time zone','''10:00''::time without time zone') then '10:00'
               when c.default_expression in ('''11:00:00''::time without time zone','''11:00''::time without time zone') then '11:00'
               else 'other_or_missing' end end
    ) order by c.table_name,c.column_name) from column_state c
  ),
  'constraints',coalesce((
    select jsonb_agg(jsonb_build_object(
      'table',t.table_name, 'name',c.conname, 'type',c.contype,
      'validated',c.convalidated, 'deferrable',c.condeferrable,
      'definition_redacted',regexp_replace(pg_get_constraintdef(c.oid),$rx$'(?:[^']|'')*'$rx$,'''[literal]''','g'),
      'definition_md5',md5(pg_get_constraintdef(c.oid))
    ) order by t.table_name,c.conname)
    from app_tables t join pg_constraint c on c.conrelid=t.oid
    where t.table_name in ('tasks','reservations')
  ),'[]'::jsonb),
  'indexes',coalesce((
    select jsonb_agg(jsonb_build_object(
      'table',t.table_name, 'name',c.relname, 'unique',i.indisunique,
      'valid',i.indisvalid, 'ready',i.indisready,
      'definition_redacted',regexp_replace(pg_get_indexdef(i.indexrelid),$rx$'(?:[^']|'')*'$rx$,'''[literal]''','g'),
      'definition_md5',md5(pg_get_indexdef(i.indexrelid))
    ) order by t.table_name,c.relname)
    from app_tables t join pg_index i on i.indrelid=t.oid
    join pg_class c on c.oid=i.indexrelid
    where t.table_name in ('tasks','reservations')
  ),'[]'::jsonb),
  'triggers',coalesce((
    select jsonb_agg(jsonb_build_object(
      'table',t.table_name, 'name',g.tgname, 'enabled',g.tgenabled,
      'function',g.tgfoid::regprocedure::text,
      'definition_redacted',regexp_replace(pg_get_triggerdef(g.oid),$rx$'(?:[^']|'')*'$rx$,'''[literal]''','g'),
      'definition_md5',md5(pg_get_triggerdef(g.oid))
    ) order by t.table_name,g.tgname)
    from app_tables t join pg_trigger g on g.tgrelid=t.oid
    where not g.tgisinternal and t.table_name in ('tasks','reservations')
  ),'[]'::jsonb),
  'functions',(
    select jsonb_agg(jsonb_build_object(
      'name',f.function_name, 'exists',f.oid is not null,
      'identity_arguments',f.identity_arguments, 'returns',f.return_type,
      'owner',pg_get_userbyid(f.proowner),
      'owner_superuser',(select r.rolsuper from pg_roles r where r.oid=f.proowner),
      'owner_bypass_rls',(select r.rolbypassrls from pg_roles r where r.oid=f.proowner),
      'security_definer',f.prosecdef, 'volatility',f.provolatile,
      'has_pinned_search_path',exists(select 1 from unnest(f.proconfig) x where x like 'search_path=%'),
      'source_md5',md5(f.prosrc),
      'definition_md5',md5(pg_get_functiondef(f.oid)),
      'source_mentions_for_share',f.prosrc ~* '\mfor\s+share\M',
      'source_mentions_property_check',f.prosrc like '%staff_can_access_property%',
      'public_execute',case when f.oid is not null then exists(
        select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) acl
        where acl.grantee=0 and acl.privilege_type='EXECUTE'
      ) end,
      'effective_role_access',(
        select jsonb_agg(jsonb_build_object(
          'role',r.role_name,
          'schema_usage',case when r.oid is not null and f.oid is not null then has_schema_privilege(r.oid,f.pronamespace,'USAGE') end,
          'execute',case when r.oid is not null and f.oid is not null then has_function_privilege(r.oid,f.oid,'EXECUTE') end
        ) order by r.role_name) from app_roles r
      )
    ) order by f.function_name,f.identity_arguments) from function_state f
  ),
  'rls_policies',coalesce((
    select jsonb_agg(jsonb_build_object(
      'table',p.tablename, 'name',p.policyname, 'roles',p.roles,
      'command',p.cmd, 'permissive',p.permissive,
      'using_redacted',regexp_replace(p.qual,$rx$'(?:[^']|'')*'$rx$,'''[literal]''','g'),
      'using_md5',md5(p.qual),
      'with_check_redacted',regexp_replace(p.with_check,$rx$'(?:[^']|'')*'$rx$,'''[literal]''','g'),
      'with_check_md5',md5(p.with_check)
    ) order by p.tablename,p.policyname)
    from pg_policies p where p.schemaname='public'
      and p.tablename in ('tasks','reservations','staff','rooms','properties')
  ),'[]'::jsonb),
  'interpretation',jsonb_build_object(
    'permissions','SQL role grants alone do not imply access: RLS and RPC staff/property/assignee checks also apply.',
    'redaction','All quoted SQL literals in expressions are masked. Function bodies/config values and application rows are omitted. MD5 values are comparison fingerprints, not proof of correctness.',
    'next_step','Compare actual objects and fingerprints with the reviewed migration; do not infer unapplied state from missing history or apply changes based on this report alone.'
  )
) as housekeeping_preflight;
