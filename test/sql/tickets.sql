-- Tickets, against a real engine AND as the `authenticated` role.
--
-- Every other file here runs as the superuser, which bypasses RLS entirely --
-- fine for testing what a function does, useless for testing who may see a
-- row. Tickets are nothing BUT who may see a row, so each check below runs
-- under `set local role authenticated` with a user id in the JWT claim.

\set ON_ERROR_STOP on

insert into auth.users (id, email) values
    ('a0000000-0000-4000-8000-00000000000a', 'admin-a@example.com'),
    ('b0000000-0000-4000-8000-00000000000b', 'admin-b@example.com'),
    ('c0000000-0000-4000-8000-00000000000c', 'owner@example.com')
    on conflict do nothing;
insert into app_owners (user_id, note)
    values ('c0000000-0000-4000-8000-00000000000c', 'owner') on conflict do nothing;

begin;
set local role authenticated;
do $$ begin perform set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-00000000000a', true); end $$;
insert into tickets (kind, title, body, author_name)
    values ('bug', 'Line-up asks for a keeper', 'In a rugby league…', 'Admin A');
commit;

do $$ begin
    -- The default fills user_id from the caller.
    if (select user_id from tickets where title = 'Line-up asks for a keeper')
       is distinct from 'a0000000-0000-4000-8000-00000000000a' then
        raise exception 'a ticket was not filed as the person who wrote it';
    end if;
end $$;

-- 1 · Another admin cannot read it.
begin;
set local role authenticated;
do $$ begin perform set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-00000000000b', true); end $$;
do $$ begin
    if (select count(*) from tickets) <> 0 then
        raise exception 'one admin can read another admin''s tickets';
    end if;
end $$;
-- 2 · ...nor file one as somebody else, nor file one already closed.
do $$ declare said text; begin
    begin
        insert into tickets (user_id, title) values ('a0000000-0000-4000-8000-00000000000a', 'forged');
        said := 'allowed';
    exception when others then said := SQLERRM; end;
    if said = 'allowed' then raise exception 'a ticket was filed in someone else''s name'; end if;
    begin
        insert into tickets (title, status) values ('pre-closed', 'done');
        said := 'allowed';
    exception when others then said := SQLERRM; end;
    if said = 'allowed' then raise exception 'a ticket was filed already marked done'; end if;
end $$;
commit;

-- 3 · Its author can read it but not close it.
begin;
set local role authenticated;
do $$ begin perform set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-00000000000a', true); end $$;
do $$ begin
    if (select count(*) from tickets) <> 1 then
        raise exception 'an admin cannot read their own ticket';
    end if;
    update tickets set status = 'done';
    if exists (select 1 from tickets where status = 'done') then
        raise exception 'a ticket''s author was able to close it';
    end if;
    if is_app_owner() then raise exception 'an ordinary admin reads as an app owner'; end if;
end $$;
commit;

-- 4 · An app owner reads everything and can close it.
begin;
set local role authenticated;
do $$ begin perform set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-00000000000c', true); end $$;
do $$ begin
    if not is_app_owner() then raise exception 'the app owner is not recognised'; end if;
    if (select count(*) from tickets) <> 1 then
        raise exception 'the app owner cannot read the tickets';
    end if;
    update tickets set status = 'done', updated_at = now();
    if not exists (select 1 from tickets where status = 'done') then
        raise exception 'the app owner could not close a ticket';
    end if;
end $$;
commit;

\echo '  ok  tickets: filed as yourself, read by yourself and the app owners, closed only by them'
