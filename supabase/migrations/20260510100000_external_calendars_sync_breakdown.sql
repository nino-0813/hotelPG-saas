-- Track created vs updated reservation counts per sync for clearer dashboards.
alter table public.external_calendars
  add column if not exists last_sync_created int not null default 0;

alter table public.external_calendars
  add column if not exists last_sync_updated int not null default 0;
