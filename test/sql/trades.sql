-- accept_trade's window guard, against a real engine.
--
-- The guard reads leagues.trading_open, which is the MANUAL toggle. An
-- auto-window league never writes that column -- the window is arithmetic on
-- the fixture list, computed in the client every minute -- so the column sits
-- at its creation default forever, and the guard answers a question nobody
-- asked. Whichever way it lands it is wrong: false means trades can never be
-- accepted at all, true means there is no server-side guard.
--
-- That is a property of the function, not of the client, so it is asserted
-- here rather than reasoned about.

\set ON_ERROR_STOP on

do $$
declare
    lg uuid;
    m1 uuid; m2 uuid;
    p1 uuid; p2 uuid;
    tr uuid;
    said text;
begin
    insert into leagues (name, config)
         values ('auto league', '{"autoWindows": true}'::jsonb) returning id into lg;
    insert into managers (league_id, name) values (lg, 'A') returning id into m1;
    insert into managers (league_id, name) values (lg, 'B') returning id into m2;
    insert into picks (league_id, manager_id, player_id, player_name, position, team, slot, pick_number)
         values (lg, m1, 'api_1', 'One', 'MID', 'City', 'MID', 1) returning id into p1;
    insert into picks (league_id, manager_id, player_id, player_name, position, team, slot, pick_number)
         values (lg, m2, 'api_2', 'Two', 'MID', 'Spurs', 'MID', 2) returning id into p2;
    insert into trades (league_id, proposer_manager_id, target_manager_id, status)
         values (lg, m1, m2, 'proposed') returning id into tr;
    insert into trade_items (trade_id, offered_pick_id, requested_pick_id,
                             offered_player_id, requested_player_id)
         values (tr, p1, p2, 'api_1', 'api_2');

    -- An auto-window league, mid-window as far as its managers are concerned.
    begin
        perform accept_trade(tr);
        said := 'accepted';
    exception when others then said := SQLERRM;
    end;

    if said <> 'accepted' then
        raise exception 'an auto-window league cannot accept trades at all: %', said;
    end if;

    -- ...and the swap really happened, rather than the guard passing over a
    -- function that then did nothing.
    if (select player_id from picks where id = p1) <> 'api_2'
       or (select player_id from picks where id = p2) <> 'api_1' then
        raise exception 'accept_trade returned without swapping the players';
    end if;

    -- The manual toggle still governs a manual league, which is what the
    -- guard was written for and must keep doing.
    declare
        lg2 uuid; n1 uuid; n2 uuid; q1 uuid; q2 uuid; tr2 uuid; said2 text;
    begin
        insert into leagues (name, trading_open) values ('manual league', false) returning id into lg2;
        insert into managers (league_id, name) values (lg2, 'A') returning id into n1;
        insert into managers (league_id, name) values (lg2, 'B') returning id into n2;
        insert into picks (league_id, manager_id, player_id, player_name, position, team, slot, pick_number)
             values (lg2, n1, 'api_3', 'Three', 'MID', 'City', 'MID', 1) returning id into q1;
        insert into picks (league_id, manager_id, player_id, player_name, position, team, slot, pick_number)
             values (lg2, n2, 'api_4', 'Four', 'MID', 'Spurs', 'MID', 2) returning id into q2;
        insert into trades (league_id, proposer_manager_id, target_manager_id, status)
             values (lg2, n1, n2, 'proposed') returning id into tr2;
        insert into trade_items (trade_id, offered_pick_id, requested_pick_id,
                                 offered_player_id, requested_player_id)
             values (tr2, q1, q2, 'api_3', 'api_4');
        begin
            perform accept_trade(tr2);
            said2 := 'accepted';
        exception when others then said2 := SQLERRM;
        end;
        if said2 = 'accepted' then
            raise exception 'a manual league with trading shut accepted a trade anyway';
        end if;
    end;

    raise notice 'accept_trade window guard ok';
end $$;
