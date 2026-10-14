-- Read-only preflight for the SaaS Supabase SQL Editor. No guest data or credentials.
-- Verify the selected project is the SaaS production project before running.
select current_database() as database_name, current_user as database_role;

select table_name, column_name, data_type, column_default
from information_schema.columns
where table_schema='public'
  and ((table_name='tasks' and column_name in
        ('cleaning_origin','cleaning_date','cleaning_requirement','superseded_at'))
    or (table_name='reservations' and column_name='check_out_time'))
order by table_name,column_name;

select p.proname, pg_get_userbyid(p.proowner) as owner,
       p.prosecdef as security_definer,
       has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
       has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
 ('reconcile_reservation_cleaning','set_stay_cleaning_requirement',
  'guard_cleaning_work_state','protect_generated_cleaning_metadata',
  'staff_can_access_property','current_staff_role');

select tablename,policyname,roles,cmd,qual,with_check
from pg_policies
where schemaname='public' and tablename in ('tasks','reservations','staff')
order by tablename,policyname;

select c.relname as table_name,t.tgname as trigger_name,pg_get_triggerdef(t.oid) as definition
from pg_trigger t join pg_class c on c.oid=t.tgrelid
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('tasks','reservations') and not t.tgisinternal
order by c.relname,t.tgname;

-- Determine whether migration history is available; do not infer application from this alone.
select to_regclass('supabase_migrations.schema_migrations') is not null as has_migration_history;
