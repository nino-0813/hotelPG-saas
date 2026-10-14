#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
container="hotelpg-housekeeping-test-$$"
# Deliberately no network, ports, host credentials, production data or DB URL.
docker run --name "$container" --network none -e POSTGRES_PASSWORD=isolated-test-only -d postgres:17 >/dev/null
trap 'docker rm -f "$container" >/dev/null' EXIT
for attempt in $(seq 1 30); do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
psql_test() { docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 "$@"; }
psql_test <<'SQL'
create role authenticated;
create role anon;
create role service_role bypassrls;
create schema auth;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema public, auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
alter default privileges in schema public grant all on tables to authenticated;
alter default privileges in schema public grant all on sequences to authenticated;
SQL
for migration in supabase/migrations/*.sql; do
  if [[ "$migration" == *20261014000001* ]]; then
    psql_test <<'SQL'
create table test_legacy_reservations as select id,check_out_time from reservations;
create table test_legacy_tasks as select id,room_id,reservation_id,status,assignee_id,scheduled_for,completed_at,updated_at from tasks;
SQL
  fi
  echo "Applying $migration"
  psql_test < "$migration"
done
psql_test < tests/housekeeping-db.sql
