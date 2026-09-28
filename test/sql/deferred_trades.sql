-- Deals that go through when the window closes, against a real engine.
--
-- In such a league (config.trades_defer_to_close) accepting a trade marks it
-- 'agreed' and settlement runs accept_trade on it once the window has shut.
-- That only means anything if accept_trade itself holds the line: otherwise
-- "at window close" is a button, and any client can swap players mid-window.

\set ON_ERROR_STOP on

do $$
declare
    lg uuid;
    m1 uuid; m2 uuid;
    p1 uuid; p2 uuid; p3 uuid; p4 uuid;
    tr uuid; tr2 uuid;
    said text;
begin
    -- A MANUAL league, window open, deals deferred.
    insert into leagues (name, trading_open, config)
         values ('deferred', true, '{"trades_defer_to_close": true}'::jsonb)
         returning id into lg;
    insert into managers (league_id, name) values (lg, 'A') returning id into m1;
    insert into managers (league_id, name) values (lg, 'B') returning id into m2;
    insert into picks (league_id, manager_id, player_id, player_name, position, team, slot, pick_number)
         values (lg, m1, 'rug_1', 'One', 'PR', 'Leinster', 'PR', 1) returning id into p1;
    insert into picks (league_id, manager_id, player_id, player_name, position, team, slot, pick_number)
         values (lg, m2, 'rug_2', 'Two', 'PR', 'Munster', 'PR', 2) returning id into p2;
    insert into trades (league_id, proposer_manager_id, target_manager_id, status)
         values (lg, m1, m2, 'proposed') returning id into tr;
    insert into trade_items (trade_id, offered_pick_id, requested_pick_id,
                             offered_player_id, requested_player_id)
         values (tr, p1, p2, 'rug_1', 'rug_2');

    -- 1 · A proposed trade cannot be executed directly in a deferred league.
    begin
        perform accept_trade(tr);
        said := 'executed';
    exception when others then said := SQLERRM;
    end;
    if said = 'executed' then
        raise exception 'a deferred league executed a trade that was only proposed';
    end if;
    if (select player_id from picks where id = p1) <> 'rug_1' then
        raise exception 'the refused trade moved a player anyway';
    end if;

    -- 2 · The new statuses are storable at all -- the check constraint was
    --     created inline with the table and has to have been widened.
    update trades set status = 'agreed' where id = tr;

    -- 3 · An agreed deal does not go through while the window is still open.
    begin
        perform accept_trade(tr);
        said := 'executed';
    exception when others then said := SQLERRM;
    end;
    if said = 'executed' then
        raise exception 'an agreed deal went through with the window still open';
    end if;

    -- 4 · ...and does once it has shut.
    update leagues set trading_open = false where id = lg;
    perform accept_trade(tr);
    if (select status from trades where id = tr) <> 'accepted' then
        raise exception 'an agreed deal did not execute once the window closed';
    end if;
    if (select player_id from picks where id = p1) <> 'rug_2'
       or (select player_id from picks where id = p2) <> 'rug_1' then
        raise exception 'the agreed deal was marked accepted but nobody moved';
    end if;

    -- 5 · A deal agreed and then overtaken -- a player in it has gone -- is
    --     refused at execution, and leaves the squads alone.
    insert into picks (league_id, manager_id, player_id, player_name, position, team, slot, pick_number)
         values (lg, m1, 'rug_3', 'Three', 'LK', 'Ulster', 'LK', 3) returning id into p3;
    insert into picks (league_id, manager_id, player_id, player_name, position, team, slot, pick_number)
         values (lg, m2, 'rug_4', 'Four', 'LK', 'Connacht', 'LK', 4) returning id into p4;
    insert into trades (league_id, proposer_manager_id, target_manager_id, status)
         values (lg, m1, m2, 'agreed') returning id into tr2;
    insert into trade_items (trade_id, offered_pick_id, requested_pick_id,
                             offered_player_id, requested_player_id)
         values (tr2, p3, p4, 'rug_3', 'rug_4');
    update picks set player_id = 'rug_99' where id = p3;     -- dropped for a free agent
    begin
        perform accept_trade(tr2);
        said := 'executed';
    exception when others then said := SQLERRM;
    end;
    if said = 'executed' then
        raise exception 'a stale agreed deal executed anyway';
    end if;
    if (select player_id from picks where id = p4) <> 'rug_4' then
        raise exception 'the stale agreed deal moved a player';
    end if;
    update trades set status = 'failed', note = said where id = tr2;

    -- 6 · A league WITHOUT the rule is exactly as before: a proposed trade
    --     executes on accept while its window is open.
    update leagues set config = '{}'::jsonb, trading_open = true where id = lg;
    update picks set player_id = 'rug_3' where id = p3;
    update trades set status = 'proposed' where id = tr2;
    perform accept_trade(tr2);
    if (select player_id from picks where id = p3) <> 'rug_4' then
        raise exception 'an ordinary league can no longer accept a trade directly';
    end if;
end $$;

\echo '  ok  deferred deals: refused mid-window, executed after, stale ones refused'
