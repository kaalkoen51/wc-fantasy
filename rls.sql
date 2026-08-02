-- ============================================================================
-- Row-Level Security lockdown  (Phase 1 · blocker #1)
-- ============================================================================
-- schema.sql ships every table with `for all using (true) with check (true)` —
-- i.e. anyone holding the public anon key can read and write every league. That
-- is fine for one private friends' league and unacceptable the moment two
-- paying strangers share a database.
--
-- This file replaces those open policies with membership-based ones.
--
--   *** DO NOT RUN THIS STRAIGHT AT PRODUCTION. ***
--
-- Apply it to a staging project first and walk the checklist at the bottom.
-- Every write path in the app has to keep working: joining, drafting, swapping,
-- proposing/accepting trades, lineup snapshots, waivers, chat, admin pulls.
-- Section 0 has a one-statement rollback if anything is wrong.
--
-- PREREQUISITE — every user must have an auth identity, because these policies
-- key off auth.uid(). That is now guaranteed: the app requires an account to
-- create a league, join one, or start a practice draft (requireAccount()), and
-- every manager and league row it writes carries user_id / owner_id.
--
-- WHAT THIS DOES AND DOES NOT BUY YOU. It buys league ISOLATION: someone who is
-- not in your league cannot read or write a single row of it. It does NOT buy
-- intra-league integrity -- a member can still write rows belonging to other
-- members of the SAME league, because the draft, trade and waiver engines all
-- do exactly that from an ordinary member's session (a pick advances
-- leagues.current_pick; resolving waivers rewrites other managers' picks and
-- waiver order). Closing that needs those writes moved behind SECURITY DEFINER
-- functions that re-check whose turn it is. Isolation first; integrity is a
-- separate, larger piece of work.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- HOW TO RUN — close the app first
-- ---------------------------------------------------------------------------
-- Every `drop policy` needs an AccessExclusiveLock on its table, which
-- conflicts with ANY other access. The app holds realtime subscriptions and
-- polls on load, so a single open browser tab is enough to fight this file for
-- locks and produce "deadlock detected". Close every tab on the site (and wait
-- for any scheduled pull to finish) before running.
--
-- lock_timeout makes that failure fast and legible -- a clear "could not obtain
-- lock" after 5s instead of two processes grappling until Postgres kills one.
-- The whole file is idempotent, so just re-run it once the app is closed.
set lock_timeout = '5s';


-- ---------------------------------------------------------------------------
-- 0 · Rollback (run this alone to get back to the wide-open behaviour)
-- ---------------------------------------------------------------------------
-- do $$ declare t text; begin
--   foreach t in array array['leagues','managers','picks','team_stages','trades',
--     'trade_items','lineup_snapshots','match_stats','messages','transactions',
--     'fa_claims','competition_pools','competition_stats','rounds']
--   loop
--     execute format('drop policy if exists %I_member on %I', t, t);
--     execute format('drop policy if exists %I_read on %I', t, t);
--     execute format('drop policy if exists %I_insert on %I', t, t);
--     execute format('drop policy if exists %I_owner_delete on %I', t, t);
--     execute format('create policy "open access" on %I for all using (true) with check (true)', t);
--   end loop;
-- end $$;


-- ---------------------------------------------------------------------------
-- 1 · Membership helpers
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so that checking "am I a member?" doesn't itself re-enter
-- RLS on managers/leagues and recurse. STABLE so the planner can cache them
-- per statement.

create or replace function public.is_league_member(l uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from managers m where m.league_id = l and m.user_id = auth.uid())
      or exists (select 1 from leagues g where g.id = l and g.owner_id = auth.uid());
$$;

create or replace function public.is_league_owner(l uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from leagues g where g.id = l and g.owner_id = auth.uid());
$$;

revoke execute on function public.is_league_member(uuid) from public;
revoke execute on function public.is_league_owner(uuid)  from public;
grant  execute on function public.is_league_member(uuid) to authenticated;
grant  execute on function public.is_league_owner(uuid)  to authenticated;


-- ---------------------------------------------------------------------------
-- 2 · Drop the open policies
-- ---------------------------------------------------------------------------
-- schema.sql names these two ways: most tables get a policy literally called
-- "open access" (note the space), while competition_pools, competition_stats
-- and fa_claims get <table>_all. BOTH have to go.
--
-- This matters more than it reads. Postgres policies are permissive and OR'd
-- together, so leaving one wide-open policy in place makes every policy below
-- it decorative: the dashboard would list them, the app would work perfectly,
-- and every league would still be readable by anyone holding the anon key.
-- Clears EVERY policy on these tables rather than the two known names, so a
-- re-run after a partial failure starts from the same place as a first run.
-- Without that, `create policy` would fail with "already exists" and you would
-- have to unpick by hand. app_owners is deliberately absent: it has RLS on and
-- no policies, which is what keeps the anon key out of the owner list.
do $$ declare r record; begin
  for r in
    select tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename = any (array['leagues','managers','picks','team_stages','trades',
        'trade_items','lineup_snapshots','match_stats','messages','transactions',
        'fa_claims','competition_pools','competition_stats','rounds'])
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- ---------------------------------------------------------------------------
-- 3 · leagues
-- ---------------------------------------------------------------------------
-- SELECT stays broad on purpose: finding a league by invite code happens BEFORE
-- you are a member, so it cannot require membership. See §7 for why this is
-- safe only once admin_token is no longer a shared secret.
create policy leagues_read on leagues
  for select to authenticated using (true);

-- You may only create a league owned by you.
create policy leagues_insert on leagues
  for insert to authenticated with check (owner_id = auth.uid());

-- NOTE: update is deliberately open to any MEMBER, not just the owner, because
-- making a draft pick advances leagues.current_pick from the picking manager's
-- own session. Column-level grants (§7) are what stop a member from flipping
-- admin-only settings; RLS alone cannot restrict columns.
create policy leagues_update on leagues
  for update to authenticated using (is_league_member(id)) with check (is_league_member(id));

create policy leagues_owner_delete on leagues
  for delete to authenticated using (owner_id = auth.uid());


-- ---------------------------------------------------------------------------
-- 4 · managers
-- ---------------------------------------------------------------------------
-- SELECT is broad for the same reason as leagues: the join screen lists
-- existing managers (so you can reclaim your name) before you are a member.
create policy managers_read on managers
  for select to authenticated using (true);

-- Join a league as yourself -- or, as the league's owner, add a bot. Bots
-- deliberately have no user_id (nobody owns them), so without the second clause
-- "fill empty slots with bots" would be refused.
create policy managers_insert on managers
  for insert to authenticated
  with check (
    user_id = auth.uid()
    or (coalesce(is_bot, false) and is_league_owner(league_id))
  );

-- Any member of the league, NOT just the owner or the row's own user. This is
-- wider than it looks like it should be, and it is deliberate: resolving
-- waivers rewrites every manager's waiver_order, and whichever member's client
-- notices the window has shut is the one doing it. Restricting this to the
-- owner would leave waivers unresolved whenever the owner was not the one with
-- the app open. `user_id is null` is gone -- that clause let anyone edit any
-- unclaimed row, and the app no longer creates human managers without an owner.
create policy managers_update on managers
  for update to authenticated
  using (is_league_member(league_id))
  with check (is_league_member(league_id));

create policy managers_owner_delete on managers
  for delete to authenticated using (is_league_owner(league_id));


-- ---------------------------------------------------------------------------
-- 5 · League-scoped tables — members only
-- ---------------------------------------------------------------------------
-- Everything below is private to the league. Members read and write (the draft,
-- trades and waiver engine all have managers writing rows that reference other
-- managers, so per-row ownership checks would break them); non-members see
-- nothing at all, which is the property that actually matters here.
do $$ declare t text; begin
  foreach t in array array['picks','team_stages','trades','lineup_snapshots',
    'match_stats','messages','transactions','fa_claims','rounds']
  loop
    execute format($f$
      create policy %1$I_member on %1$I
        for all to authenticated
        using (is_league_member(league_id))
        with check (is_league_member(league_id));
    $f$, t);
  end loop;
end $$;

-- trade_items has no league_id; it is reachable only through its trade.
create policy trade_items_member on trade_items
  for all to authenticated
  using (exists (select 1 from trades t where t.id = trade_id and is_league_member(t.league_id)))
  with check (exists (select 1 from trades t where t.id = trade_id and is_league_member(t.league_id)));


-- ---------------------------------------------------------------------------
-- 6 · Shared competition data
-- ---------------------------------------------------------------------------
-- Deliberately global: pools and stats are keyed by competition, not league, so
-- one pull serves every customer. Readable by all; writable by signed-in users
-- because any league's admin pull tops it up.
create policy competition_pools_read on competition_pools
  for select to authenticated using (true);
create policy competition_pools_write on competition_pools
  for all to authenticated using (true) with check (true);

create policy competition_stats_read on competition_stats
  for select to authenticated using (true);
create policy competition_stats_write on competition_stats
  for all to authenticated using (true) with check (true);


-- ---------------------------------------------------------------------------
-- 7 · Column grants — the part RLS cannot do
-- ---------------------------------------------------------------------------
-- leagues.admin_token is a bearer secret sitting in a world-readable row: with
-- broad SELECT (needed for invite lookup) anyone could read it and claim admin.
-- Once the app has stopped using the token (owner-by-account is already the
-- primary path), revoke it:
--
--   revoke select (admin_token) on leagues from authenticated;
--
-- Do this only after confirming no live league still depends on the token, and
-- backfill owner_id for legacy leagues first:
--
--   update leagues set owner_id = '<your-auth-uid>' where owner_id is null;
--
-- Similarly, to stop a member editing admin-only league settings, grant update
-- on just the columns the draft engine needs and revoke the rest:
--
--   revoke update on leagues from authenticated;
--   grant  update (current_pick, phase, trading_open) on leagues to authenticated;
--   -- owner-only settings then move to a SECURITY DEFINER function or an
--   -- Edge Function that checks is_league_owner() before writing.


-- ---------------------------------------------------------------------------
-- 8 · Staging checklist — verify each of these still works after applying
-- ---------------------------------------------------------------------------
--   [ ] Sign up, create a league            → league appears, you are admin
--   [ ] Second account joins by invite code → sees the league, can join
--   [ ] Reclaim an existing manager name    → claims to your account
--   [ ] Run a draft to completion           → picks land, clock advances
--   [ ] Swap a free agent                   → pick updates, transaction logged
--   [ ] Propose + accept a trade            → both rosters change
--   [ ] Set a lineup / captain              → snapshot written
--   [ ] Waiver window close                 → claims resolve, order rotates
--   [ ] Post a chat message                 → visible to the other account
--   [ ] Admin stats pull                    → competition_stats populated
--   [ ] A THIRD account NOT in the league   → cannot read picks, messages,
--       lineups, trades or stats for it (this is the whole point — check it
--       from the API directly, not just the UI)
