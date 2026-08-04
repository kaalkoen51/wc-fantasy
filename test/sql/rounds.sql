-- The settlement claim, against a real engine.
--
-- advanceRound() relies on the database to pick exactly one winner when
-- several clients notice the same window has closed: the INSERT is the claim,
-- and the unique key is what makes the losers lose. That is a property of the
-- schema, not of the client, so it is asserted here rather than mocked.

\set ON_ERROR_STOP on

do $$
declare
    lg uuid;
    other uuid;
    duplicated boolean := false;
    n int;
begin
    insert into leagues (name) values ('claim test') returning id into lg;
    insert into leagues (name) values ('someone else') returning id into other;

    -- One client claims the round.
    insert into rounds (league_id, round_key, round_no, status)
         values (lg, 'Regular Season - 4', 4, 'settling');

    -- A racing client, same round, same key: must lose.
    begin
        insert into rounds (league_id, round_key, round_no, status)
             values (lg, 'Regular Season - 4', 4, 'settling');
        duplicated := true;
    exception when unique_violation then null;
    end;
    if duplicated then
        raise exception 'two clients both claimed the same round — settlement can double-run';
    end if;

    /* A knockout round has no matchweek number, so round_no is null. Nulls are
       distinct in a Postgres unique constraint, which is exactly why the old
       (league_id, round_no) key could not hold these and round_key had to
       exist (ROUNDS_DESIGN.md Phase 1.5). Two DIFFERENT knockout rounds must
       both be recordable. */
    insert into rounds (league_id, round_key, round_no, status)
         values (lg, 'Round of 16', null, 'settling');
    insert into rounds (league_id, round_key, round_no, status)
         values (lg, 'Quarter-finals', null, 'settling');
    select count(*) into n from rounds where league_id = lg and round_no is null;
    if n <> 2 then
        raise exception 'expected 2 unnumbered rounds, found % — knockout rounds are unrecordable', n;
    end if;

    -- ...but the SAME knockout round twice must still lose.
    duplicated := false;
    begin
        insert into rounds (league_id, round_key, round_no, status)
             values (lg, 'Round of 16', null, 'settling');
        duplicated := true;
    exception when unique_violation then null;
    end;
    if duplicated then
        raise exception 'a knockout round could be claimed twice';
    end if;

    -- Another league's identically-named round is a different round.
    insert into rounds (league_id, round_key, round_no, status)
         values (other, 'Regular Season - 4', 4, 'settling');

    raise notice 'ok  insert wins, duplicate loses, knockout rounds recordable';
    delete from leagues where id in (lg, other);
end $$;
