-- Stand-ins for what Supabase provides and vanilla Postgres does not.
--
-- Deliberately minimal: the point of this harness is to exercise OUR sql
-- against a real engine, not to reimplement Supabase. Anything faked here is
-- something the tests must not be asserting about.

-- Realtime publication: schema.sql adds tables to it. The wal_level warning
-- Postgres emits here is irrelevant -- nothing subscribes in a test.
set client_min_messages = error;
create publication supabase_realtime;
reset client_min_messages;

-- auth.uid() is what every policy in rls.sql keys off. Backed by a settable
-- GUC so a test can "become" a user with `set local request.jwt.claim.sub`.
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- rls.sql grants to these roles; PostgREST creates them, so we must.
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
