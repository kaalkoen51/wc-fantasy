-- Co-admins, against a real engine.
--
-- The whole feature rests on three things being true in the DATABASE rather
-- than in the browser, and none of them is reachable from the app suite:
--
--   1. The admin code is compared here. The browser never sees it, because
--      leagues SELECT is broad -- looking a league up by invite code happens
--      before you are a member -- so a code the client compares is one anybody
--      can read out of the league row and then hold up.
--   2. managers.is_admin cannot be written directly. managers_update is
--      deliberately open to ANY member (resolving waivers rewrites every
--      manager's waiver_order from whichever client noticed the window shut),
--      so without the trigger the flag is self-grantable by anyone with the
--      anon key.
--   3. Appointing and removing is the creator's alone, so a co-admin can run
--      the league and can never lock its owner out of it.
--
-- The browser suite models these functions. A model written by the same hand
-- as the tests can be wrong in the same direction as the code, which is why
-- the real ones are exercised here.

\set ON_ERROR_STOP on

do $$
declare
    creator uuid := '11111111-1111-4111-8111-111111111111';
    mate    uuid := '22222222-2222-4222-8222-222222222222';
    rando   uuid := '33333333-3333-4333-8333-333333333333';
    lg uuid;
    m_creator uuid; m_mate uuid; m_rando uuid;
    code text := 'the-admin-code';
    said text;
    got boolean;
begin
    insert into leagues (name, admin_token, owner_id)
         values ('co-admins', code, creator) returning id into lg;
    insert into managers (league_id, name, user_id)
         values (lg, 'Creator', creator) returning id into m_creator;
    insert into managers (league_id, name, user_id)
         values (lg, 'Mate', mate) returning id into m_mate;
    insert into managers (league_id, name, user_id)
         values (lg, 'Rando', rando) returning id into m_rando;

    -- 1 · A wrong code is refused, and refused as FALSE rather than as an
    --     exception: a typo is not an error worth a stack trace, and the
    --     caller has to tell it apart from "you are not in this league".
    perform set_config('request.jwt.claim.sub', mate::text, true);
    if claim_league_admin(lg, 'not-the-code') then
        raise exception 'a wrong admin code was accepted';
    end if;
    if (select coalesce(is_admin, false) from managers where id = m_mate) then
        raise exception 'a wrong code still flagged the manager';
    end if;
    if claim_league_admin(lg, null) or claim_league_admin(lg, '   ') then
        raise exception 'an empty admin code was accepted';
    end if;

    -- 2 · Somebody outside the league cannot claim it even WITH the code.
    --     There is no admin who is not one of the league's managers.
    perform set_config('request.jwt.claim.sub',
                       '44444444-4444-4444-8444-444444444444', true);
    if claim_league_admin(lg, code) then
        raise exception 'a non-member became an admin of a league they had not joined';
    end if;

    -- 3 · The right code, from a member, works.
    perform set_config('request.jwt.claim.sub', mate::text, true);
    if not claim_league_admin(lg, code) then
        raise exception 'the correct admin code was refused';
    end if;
    if not (select is_admin from managers where id = m_mate) then
        raise exception 'the code was accepted but nothing was written';
    end if;

    -- ...and that is what is_league_admin() answers on, while ownership is
    -- untouched: a co-admin runs the league, they do not own it.
    if not is_league_admin(lg) then
        raise exception 'a flagged manager is not treated as an admin';
    end if;
    if is_league_owner(lg) then
        raise exception 'claiming the code made somebody the league owner';
    end if;
    perform set_config('request.jwt.claim.sub', rando::text, true);
    if is_league_admin(lg) then
        raise exception 'an ordinary member is being treated as an admin';
    end if;

    -- 4 · THE one that matters. managers_update lets any member write any
    --     manager row in the league, so the flag has to be defended by the
    --     trigger and not by the policy.
    begin
        update managers set is_admin = true where id = m_rando;
        said := 'allowed';
    exception when others then said := SQLERRM;
    end;
    if said = 'allowed' then
        raise exception 'is_admin can be granted by a plain update -- anyone can make themselves an admin';
    end if;
    if (select coalesce(is_admin, false) from managers where id = m_rando) then
        raise exception 'the refused update was written anyway';
    end if;
    -- The guard must not stand in the way of ordinary manager writes, which is
    -- what waiver resolution does on everyone's row.
    update managers set waiver_order = 7 where id = m_mate;
    if (select waiver_order from managers where id = m_mate) <> 7 then
        raise exception 'the is_admin guard is blocking ordinary manager updates';
    end if;

    -- 5 · Appointing and removing is the creator's alone -- including for a
    --     co-admin, who otherwise could staff the league out from under them.
    perform set_config('request.jwt.claim.sub', mate::text, true);
    begin
        perform set_league_admin(m_rando, true);
        said := 'allowed';
    exception when others then said := SQLERRM;
    end;
    if said = 'allowed' then
        raise exception 'a co-admin was able to appoint another admin';
    end if;

    perform set_config('request.jwt.claim.sub', creator::text, true);
    perform set_league_admin(m_rando, true);
    if not (select is_admin from managers where id = m_rando) then
        raise exception 'the creator could not appoint an admin';
    end if;
    perform set_league_admin(m_rando, false);
    if (select is_admin from managers where id = m_rando) then
        raise exception 'the creator could not remove an admin';
    end if;

    -- 6 · The code comes back to the creator and to nobody else, which is what
    --     lets the app stop reading leagues.admin_token altogether.
    got := league_admin_code(lg) is not distinct from code;
    if not got then
        raise exception 'the creator cannot read back their own admin code';
    end if;
    perform set_config('request.jwt.claim.sub', mate::text, true);
    if league_admin_code(lg) is not null then
        raise exception 'a co-admin can read the admin code';
    end if;
    perform set_config('request.jwt.claim.sub', rando::text, true);
    if league_admin_code(lg) is not null then
        raise exception 'an ordinary member can read the admin code';
    end if;
end $$;

\echo '  ok  co-admin claim, guard and creator-only appointment'
