#!/usr/bin/env python3
"""Ask API-Football what it actually does, instead of assuming.

    python probe_feed.py --date 2026-08-23
    python probe_feed.py --fixture 1234567
    python probe_feed.py --date 2026-08-23 --league 39 --season 2026
    python probe_feed.py --player Rodri --clubs "Manchester City"

Needs API_FOOTBALL_KEY. Reads only; writes nothing, anywhere.

WHY THIS EXISTS. Three separate bugs in this repo were the same mistake:
believing something about the feed that turned out not to be true, and only
finding out when a manager noticed their points were wrong.

  * `goals.conceded` was read as the player's own figure. API-Football fills
    it in for goalkeepers and leaves it at 0 for everybody else, so a rule
    charging defenders never fired.
  * `passes.accuracy` was read as a percentage. It is a count, so the app
    showed "52%" for a midfielder who completed 52 passes.
  * A substitution event was read as `player` = coming on. Get that backwards
    and a substitute is charged for goals scored before he was on the pitch.

Each was invisible until somebody reported it, and each took a round of
guessing to find. This is the tool that should have existed instead: point it
at a real fixture and it prints what the feed SAYS, so the question stops
being a matter of opinion.

It answers four questions and will grow as more come up:

  1. Which penalty fields exist, and do they carry values?
  2. Does a penalty WON also show up as an assist?
  3. Which side of a `subst` event holds the player coming on?
  4. Is `passes.accuracy` a count or a percentage?
  5. Which club's squad list holds a given player, and what does his transfer
     history say? Those two disagreed twice in one week -- once because a
     squad list was stale, once because a transfer record was -- and there was
     no way to settle it except by guessing.
"""
import argparse
import sys
from collections import Counter

from daily_pull import api_get


def fixtures_on(date, league, season):
    params = {"date": date}
    if league:
        params.update({"league": league, "season": season})
    return api_get("fixtures", params).get("response", [])


def players_of(fid):
    return api_get("fixtures/players", {"fixture": fid}).get("response", [])


def events_of(fid):
    return api_get("fixtures/events", {"fixture": fid}).get("response", [])


def stat_blocks(teams_data):
    """(team_id, player_id, name, stats) for everyone in a fixture."""
    for tb in teams_data:
        tid = (tb.get("team") or {}).get("id")
        for entry in tb.get("players", []):
            p = entry.get("player") or {}
            sl = entry.get("statistics") or []
            yield tid, p.get("id"), p.get("name"), (sl[0] if sl else {})


def probe(fid, label):
    print(f"\n=== {label}  (fixture {fid})")
    teams = players_of(fid)
    events = events_of(fid)
    if not teams:
        print("  no player stats for this fixture — skipping")
        return

    blocks = list(stat_blocks(teams))
    by_id = {pid: (name, st) for _, pid, name, st in blocks}

    # 1. WHICH PENALTY FIELDS EXIST, and which are ever non-zero.
    keys, nonzero = Counter(), Counter()
    for _, _, _, st in blocks:
        for k, v in (st.get("penalty") or {}).items():
            keys[k] += 1
            if v:
                nonzero[k] += 1
    print("  penalty fields:", ", ".join(
        f"{k}({nonzero[k]}/{keys[k]} non-zero)" for k in sorted(keys)) or "none")

    # 2. DOES A PENALTY WON ALSO COUNT AS AN ASSIST?
    #    The direct question. For everyone the feed says won a penalty, print
    #    their assist count beside it. If winning one implies an assist, the
    #    two move together; if it does not, assists stay put.
    won = [(pid, by_id[pid][0], v) for _, pid, _, st in blocks
           for k, v in [("won", (st.get("penalty") or {}).get("won"))]
           if v and pid in by_id]
    if not won:
        print("  penalties won: none in this match — try a date with one")
    for pid, name, n in won:
        st = by_id[pid][1]
        assists = (st.get("goals") or {}).get("assists")
        print(f"  penalty won: {name} won={n} assists={assists!r}")
    # ...and the other side of it: every penalty GOAL, and who the event
    # credits alongside the scorer.
    for e in events:
        if str(e.get("type", "")).lower() == "goal" \
                and "penalty" in str(e.get("detail", "")).lower():
            pl = (e.get("player") or {}).get("name")
            asst = (e.get("assist") or {}).get("name")
            print(f"  penalty goal: detail={e.get('detail')!r} "
                  f"player={pl!r} assist={asst!r}")

    # 3. WHICH SIDE OF A SUBSTITUTION IS THE PLAYER COMING ON?
    #    Settled without opinion: `games.substitute` says who started on the
    #    bench, so whichever field names a bench player is the incoming one.
    for e in events:
        if str(e.get("type", "")).lower() != "subst":
            continue
        a = (e.get("player") or {}).get("id")
        b = (e.get("assist") or {}).get("id")
        sub_of = lambda pid: (by_id.get(pid, (None, {}))[1].get("games") or {}).get("substitute")
        print(f"  subst {e.get('time', {}).get('elapsed')}': "
              f"player={by_id.get(a, ('?',))[0]!r} started_on_bench={sub_of(a)!r} | "
              f"assist={by_id.get(b, ('?',))[0]!r} started_on_bench={sub_of(b)!r}")
        break                                   # one is enough to settle it

    # 4. IS passes.accuracy A COUNT OR A PERCENTAGE?
    #    A count can never exceed total passes; a percentage can never exceed
    #    100. Print the worst offender in each direction and let the numbers say.
    over100 = [(n, (st.get("passes") or {})) for _, _, n, st in blocks
               if (st.get("passes") or {}).get("accuracy")
               and float((st.get("passes") or {}).get("accuracy") or 0) > 100]
    sample = [(n, (st.get("passes") or {}).get("total"),
               (st.get("passes") or {}).get("accuracy"))
              for _, _, n, st in blocks if (st.get("passes") or {}).get("total")][:3]
    for n, total, acc in sample:
        print(f"  passes: {n} total={total!r} accuracy={acc!r}")
    print(f"  accuracy >100 for {len(over100)} player(s) "
          f"— {'so it is a COUNT' if over100 else 'inconclusive from this match'}")


def probe_player(name, league, season, clubs):
    """Where does the feed say this player is? Reads two independent things.

    The app builds its pool from `players/squads`, one call per club, and that
    is the ONLY question it asks -- so a stale answer to it is invisible.
    Twice now a manager has said a player is at the wrong club and there has
    been no way to settle it except by guessing at what the feed holds.

    This asks the feed directly and prints both answers side by side:

      1. Which club's squad list actually contains him, if any.
      2. What his transfer history says, newest first.

    Read-only, and cheap: one call for the club list, one per club searched,
    one for the history. Nothing is written anywhere.
    """
    want = name.strip().lower()
    teams = api_get("teams", {"league": league, "season": season}).get("response", [])
    print(f"\n=== {name} · league {league} season {season} ===")
    print(f"{len(teams)} clubs in the competition.")
    if not teams:
        return

    wanted = [t for t in teams
              if not clubs or any(c.strip().lower() in (t["team"]["name"] or "").lower()
                                  for c in clubs)]
    if clubs and not wanted:
        print(f"No club matched {clubs}. Names are: "
              + ", ".join(sorted(t["team"]["name"] for t in teams)))
        return
    print(f"Searching {len(wanted)} squad list(s): "
          + ", ".join(t["team"]["name"] for t in wanted))

    found = []
    for t in wanted:
        squad = api_get("players/squads", {"team": t["team"]["id"]}).get("response", [])
        for p in (squad[0].get("players") if squad else []) or []:
            if want in (p.get("name") or "").lower():
                found.append((t["team"]["name"], p))
                print(f"  IN SQUAD · {t['team']['name']}: {p.get('name')} "
                      f"(id {p.get('id')}, {p.get('position')}, no. {p.get('number')})")
    if not found:
        print("  NOT in any of those squad lists.")

    # The other source, for whoever we managed to identify.
    for pid in sorted({p.get("id") for _, p in found if p.get("id")}):
        hist = api_get("transfers", {"player": pid}).get("response", [])
        rows = hist[0].get("transfers", []) if hist else []
        rows = sorted(rows, key=lambda r: str(r.get("date") or ""), reverse=True)
        print(f"  TRANSFERS · id {pid}: {len(rows)} on record"
              + ("" if rows else " — the feed has no transfer history for him"))
        for r in rows[:6]:
            teams_ = r.get("teams") or {}
            print(f"      {r.get('date')}  {(teams_.get('out') or {}).get('name')}"
                  f"  ->  {(teams_.get('in') or {}).get('name')}   [{r.get('type')}]")


def probe_team_transfers(club, league, season, want):
    """What does `transfers?team=` actually ANSWER with?

    The pool's departure rule reads this endpoint for every club and looks for
    a newest transfer INTO somewhere outside the competition. It never finds
    one -- every row that comes back has an in-club inside the league -- and
    Rodri, whose own history plainly shows Manchester City -> Barcelona, is not
    reported as having left. Either the endpoint answers only with arrivals, or
    it is paginated and we are reading page one, or he is simply not in it.

    So print the envelope, not just the rows: paging, results, how many players
    came back, which direction their newest rows point, and whether the named
    player is in there at all.
    """
    teams = api_get("teams", {"league": league, "season": season}).get("response", [])
    ids = {t["team"]["id"] for t in teams}
    match = [t for t in teams if club.strip().lower() in (t["team"]["name"] or "").lower()]
    if not match:
        print(f"No club matched {club!r}. Names: "
              + ", ".join(sorted(t["team"]["name"] for t in teams)))
        return
    t = match[0]["team"]
    data = api_get("transfers", {"team": t["id"]})
    rows = data.get("response", [])
    print(f"\n=== transfers?team={t['id']} ({t['name']}) ===")
    print(f"  results={data.get('results')}  paging={data.get('paging')}")
    print(f"  {len(rows)} player blocks in the response")

    # Which way do the newest rows point? That is the whole question.
    into_league = out_of_league = 0
    for r in rows:
        newest = max((x for x in (r.get("transfers") or []) if x.get("date")),
                     key=lambda x: x["date"], default=None)
        if not newest:
            continue
        in_id = ((newest.get("teams") or {}).get("in") or {}).get("id")
        if in_id in ids:
            into_league += 1
        else:
            out_of_league += 1
    print(f"  newest row points INTO the competition for {into_league} of them, "
          f"OUT of it for {out_of_league}")

    if want:
        hits = [r for r in rows if want.lower() in (r.get("player", {}).get("name") or "").lower()]
        print(f"  {want}: {'FOUND' if hits else 'NOT in this response'}")
        for r in hits:
            for x in sorted(r.get("transfers") or [],
                            key=lambda y: str(y.get("date")), reverse=True)[:6]:
                tm = x.get("teams") or {}
                print(f"      {x.get('date')}  {(tm.get('out') or {}).get('name')}"
                      f"  ->  {(tm.get('in') or {}).get('name')}   [{x.get('type')}]")


def probe_league(league, season):
    """What league is this id, and who plays in it?

    Adding a competition to the app means writing an API-Football league id
    into COMPETITIONS, and a wrong one is not a small mistake: "Load
    competition" would fill the shared pool for that key with somebody else's
    clubs. There is no reaching the feed from the container this repo is
    written in, so the id cannot be checked there -- it gets checked here.

    Two calls, read-only: the league's own name and country, then its clubs.
    """
    got = api_get("leagues", {"id": league})
    if not got:
        print(f"league {league}: NOTHING. That id does not exist.")
        return
    info = got[0]
    lg, country = info.get("league") or {}, info.get("country") or {}
    print(f"league {league}: {lg.get('name')}  ({country.get('name')})  "
          f"type={lg.get('type')}")
    seasons = [s.get("year") for s in (info.get("seasons") or [])]
    print(f"  seasons on record: {seasons[-6:] if seasons else 'none'}")
    if season not in seasons:
        print(f"  !! {season} is NOT among them -- the app would pull nothing.")

    teams = api_get("teams", {"league": league, "season": season})
    print(f"  {len(teams)} club(s) in {season}:")
    for t in teams:
        c = t.get("team") or {}
        print(f"    {c.get('name')}  ({c.get('country')})")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--team-transfers", help="club name: dump what transfers?team= answers with")
    ap.add_argument("--date", help="probe every fixture on this date")
    ap.add_argument("--fixture", type=int, help="probe one fixture by id")
    ap.add_argument("--player", help="probe where a player is, by name substring")
    ap.add_argument("--clubs", default="",
                    help="comma-separated club names to search (blank = every club)")
    ap.add_argument("--league-info", action="store_true",
                    help="name and clubs for --league: checks an id before it ships")
    ap.add_argument("--league", type=int, default=39)
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--limit", type=int, default=3, help="max fixtures per date")
    args = ap.parse_args()

    if args.league_info:
        probe_league(args.league, args.season)
        return
    if args.team_transfers:
        probe_team_transfers(args.team_transfers, args.league, args.season, args.player)
        return
    if args.player:
        for who in [w for w in args.player.split(",") if w.strip()]:
            probe_player(who, args.league, args.season,
                         [c for c in args.clubs.split(",") if c.strip()])
        return
    if args.fixture:
        probe(args.fixture, f"fixture {args.fixture}")
        return
    if not args.date:
        sys.exit("Give --date YYYY-MM-DD, --fixture <id>, --player <name>, "
                 "or --league-info.")

    fixtures = fixtures_on(args.date, args.league, args.season)
    if not fixtures:
        sys.exit(f"No fixtures found for {args.date}.")
    print(f"{len(fixtures)} fixture(s) on {args.date}; probing up to {args.limit}.")
    for f in fixtures[:args.limit]:
        t = f.get("teams", {})
        probe(f["fixture"]["id"],
              f"{t.get('home', {}).get('name')} vs {t.get('away', {}).get('name')}")


if __name__ == "__main__":
    main()
