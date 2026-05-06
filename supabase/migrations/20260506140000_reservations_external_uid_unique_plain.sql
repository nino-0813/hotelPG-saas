-- PostgREST/Supabase upsert sends ON CONFLICT (external_uid) without a predicate.
-- PostgreSQL cannot use a partial unique index as the conflict target unless the
-- same WHERE clause is supplied, so external-calendar upserts were failing silently.
-- Multiple rows with external_uid IS NULL remain valid (NULLs do not collide in UNIQUE).

drop index if exists public.reservations_external_uid_unique;

create unique index reservations_external_uid_unique
  on public.reservations (external_uid);
