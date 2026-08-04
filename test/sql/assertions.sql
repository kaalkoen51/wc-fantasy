-- Assertions about the state of the database, run between migration steps by
-- test_sql.sh. Each raises on failure, and psql runs with ON_ERROR_STOP, so a
-- broken invariant fails the run rather than printing something nobody reads.
--
-- :phase is passed in by the driver: 'open' before rls.sql has ever run,
-- 'locked' after it, and 'locked' AGAIN after schema.sql is deliberately
-- re-run on top -- which is the whole reason this file exists.

\set ON_ERROR_STOP on

-- psql does not substitute :variables inside a dollar-quoted block, so the
-- phase is handed over as a GUC rather than interpolated into the body.
select set_config('test.phase', :'phase', false) \gset dummy_

do $$
declare
    phase text := current_setting('test.phase');
    open_policies int;
    locked boolean;
    n int;
begin
    select count(*) into open_policies
      from pg_policies where schemaname = 'public' and policyname = 'open access';
    locked := to_regprocedure('public.is_league_member(uuid)') is not null;

    if phase = 'open' then
        -- A fresh database is wide open by design; schema.sql says so in its
        -- header. If this ever stops being true the lockdown test below stops
        -- proving anything, because there would be nothing to lock down.
        if open_policies = 0 then
            raise exception 'expected the open policies schema.sql creates, found none';
        end if;
        if locked then
            raise exception 'is_league_member() exists before rls.sql has run';
        end if;
        raise notice 'ok  fresh schema is open (% open policies)', open_policies;

    elsif phase = 'locked' then
        /* The regression this harness was built for. Re-running schema.sql
           used to drop and recreate "open access" on every table, silently
           undoing an applied rls.sql -- with the app still working and the
           dashboard still listing policies. The guard keys off
           is_league_member() existing. */
        if not locked then
            raise exception 'is_league_member() is missing after rls.sql';
        end if;
        if open_policies > 0 then
            raise exception
              'LOCKDOWN UNDONE: % table(s) are back to "open access"', open_policies;
        end if;

        -- Every league-scoped table must actually have RLS on. A table with
        -- RLS enabled and no policy is closed; one with RLS off is wide open
        -- however many policies it has.
        select count(*) into n from pg_tables t
          join pg_class c on c.relname = t.tablename
         where t.schemaname = 'public' and not c.relrowsecurity
           and t.tablename in ('leagues','managers','picks','team_stages','trades',
             'trade_items','lineup_snapshots','match_stats','messages','transactions',
             'fa_claims','rounds');
        if n > 0 then raise exception '% league table(s) have RLS disabled', n; end if;

        -- rounds arrived in Phase 1 and has to be in the member-policy list.
        -- Missing here means reads come back empty and writes are refused,
        -- which presents as "settlement never runs" and says nothing.
        select count(*) into n from pg_policies
         where schemaname = 'public' and tablename = 'rounds';
        if n = 0 then
            raise exception 'rounds has RLS enabled but NO policy — settlement will be refused silently';
        end if;
        raise notice 'ok  locked down, rounds policy present';
    else
        raise exception 'unknown phase %', phase;
    end if;
end $$;
