-- Repair external_calendars.target_room_type CHECK when:
--   - Migration 20260506160000 was not applied yet, or
--   - The old CHECK kept an auto-generated name so DROP ... IF EXISTS missed it.
-- Drops every CHECK on external_calendars whose definition mentions target_room_type, then re-adds one rule.

do $$
declare
  r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    inner join pg_class rel on rel.oid = con.conrelid
    inner join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname = 'public'
      and rel.relname = 'external_calendars'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%target_room_type%'
  loop
    execute format(
      'alter table public.external_calendars drop constraint %I',
      r.conname
    );
  end loop;
end $$;

alter table public.external_calendars add constraint external_calendars_target_room_type_check check (
  target_room_type in (
    'family',
    'single',
    'standard',
    'washitsu_modern_4',
    'washitsu_modern_3'
  )
);
