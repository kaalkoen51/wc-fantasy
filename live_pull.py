#!/usr/bin/env python3
"""Live in-match scoring loop.

Designed to run from the "Live stats pull" GitHub Actions workflow,
which wakes it every 15 minutes (see .github/workflows/live-pull.yml):

- Nothing live and no kickoff within --max-wait minutes -> exits
  immediately (1-2 API calls, a few seconds of runner time).
- Kickoff within --max-wait (default 90 min) but not yet live ->
  stays alive, polling every --poll seconds; this bridges multi-hour
  gaps in GitHub Actions cron scheduling so nearby games are not missed.
- Kickoff time just passed but API hasn't flagged the fixture live yet ->
  stays alive for --kickoff-grace minutes (default 15) to absorb the
  typical 3-10 min lag before API-Football marks a fixture as "1H".
- Otherwise it polls every --poll seconds: upserts player stats for
  every live fixture, gives each fixture one final pull when it goes
  full-time, and exits once nothing is live or imminent.

Every pull is a full cumulative upsert on (league, player, match), so
restarts, overlaps with the manual "Pull stats now" button, and the
06:00 daily sweep are all safe — the last write simply wins.

WHAT IT WATCHES. Every competition whose scheduled-pull toggle is on in
the admin panel -- the same switch the twice-daily sweep reads -- plus,
if FANTASY_LEAGUE_ID is set, the original static World Cup league. All
of them in ONE live=all call per poll, so watching three competitions
costs exactly what watching one did.

This used to be World-Cup-only, and silently: the defaults said league 1,
players were mapped onto FIFA squad ids from players.json, and rows went
to match_stats. A league drafted from an API-Football competition matched
none of those three, so it got no in-match scoring at all and nothing
said so -- points simply appeared after the final whistle, once the
twice-daily sweep ran.

Environment variables: same as daily_pull.py (API_FOOTBALL_KEY,
SUPABASE_URL, SUPABASE_SERVICE_KEY, and optionally FANTASY_LEAGUE_ID --
one league uuid or a comma-separated allowlist for the static pool).
"""

import argparse
import os
import subprocess
import sys
import time
from datetime import datetime, timezone

from daily_pull import (
    COMPLETED_STATUSES,
    PLAYERS_JSON,
    PlayerMatcher,
    api_get,
    calculate_points,
    extract_player_rows,
    featured,
    fetch_fixture_players,
    fetch_scheduled_competitions,
    parse_competition_key,
    parse_league_ids,
)
from daily_pull import upsert_competition_stats, upsert_match_stats
import json

# In-play statuses, including halftime/breaks/shootouts/interruptions.
LIVE_STATUSES = {"1H", "HT", "2H", "ET", "BT", "P", "SUSP", "INT", "LIVE"}


def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc):%H:%M:%S}] {msg}", flush=True)


def fetch_live_fixtures(leagues) -> dict:
    """Every live fixture in the competitions we care about, by league id.

    ONE call for all of them. live=all is a single request whatever the number
    of competitions, so watching three costs exactly what watching one did --
    which matters, because this loop wakes every fifteen minutes all season.
    """
    wanted = set(leagues)
    out = {lid: [] for lid in wanted}
    for f in api_get("fixtures", {"live": "all"}).get("response", []):
        lid = f.get("league", {}).get("id")
        if lid in wanted:
            out[lid].append(f)
    return out


def minutes_to_next_kickoff(league: int, season: int):
    resp = api_get(
        "fixtures", {"league": league, "season": season, "next": 1}
    ).get("response", [])
    if not resp:
        return None
    kickoff = datetime.fromisoformat(resp[0]["fixture"]["date"])
    return (kickoff - datetime.now(timezone.utc)).total_seconds() / 60


def soonest_kickoff(targets):
    """The nearest kickoff across everything being watched, or None.

    Whether to stay alive is a question about the WHOLE watchlist: exiting
    because one competition has nothing on tonight would leave another one
    unscored.
    """
    times = [t for t in (minutes_to_next_kickoff(x.league, x.season)
                         for x in targets) if t is not None]
    return min(times) if times else None


def fetch_fixture(fixture_id: int) -> dict:
    resp = api_get("fixtures", {"id": fixture_id}).get("response", [])
    return resp[0] if resp else None


def origin_head_sha():
    """What the default branch points at right now, or None if unaskable.

    None on any failure -- no git, no network, no remote, a timeout. A
    watchdog must never fall over because it could not ask an optional
    question, so every one of those means "carry on" rather than "stop".
    """
    try:
        out = subprocess.run(["git", "ls-remote", "origin", "HEAD"],
                             capture_output=True, text=True, timeout=20)
    except Exception:
        return None
    if out.returncode != 0:
        return None
    line = out.stdout.strip().split("\n")[0].strip()
    return line.split()[0] if line else None


def code_has_moved(started_on):
    """True once the default branch has moved past the commit this run began at.

    THE PROBLEM THIS SOLVES, which cost a live league most of a Saturday
    afternoon: this loop can stay alive for hours, and the workflow's
    `concurrency: live-pull` group means only one run holds it at a time.
    So a run that started before a fix was merged keeps writing the OLD
    behaviour, and every run launched afterwards -- including the ones
    carrying the fix -- is cancelled while it queues behind this one. The
    fix is deployed, the tests are green, the code that is actually
    running is yesterday's, and nothing anywhere says so.

    Exiting is already the safe move: every write is a full cumulative
    upsert, the next cron resumes within fifteen minutes, and the daily
    sweep reconciles regardless. So the loop simply stops being the reason
    a newer version cannot start.

    GITHUB_SHA is set by Actions and by nothing else, which is deliberate:
    a local or manual run has no "newer commit" to be behind and should
    not be making network calls to find that out.
    """
    if not started_on:
        return False
    head = origin_head_sha()
    return bool(head) and head != started_on


class Target:
    """One thing to watch, and where its rows go.

    Two kinds, and the difference is the whole point of this change:

      competition  -- an API-Football competition a league has been drafted
                      from. Rows are keyed by the API's own player id and land
                      in the SHARED competition_stats, so one pull serves every
                      league on that competition.
      legacy       -- the original static World Cup pool. Rows are mapped
                      through players.json onto FIFA squad ids and land in
                      match_stats, keyed by the leagues named in
                      FANTASY_LEAGUE_ID.

    Before this, only the second kind existed -- and it was the default, with
    league 1 hardcoded. So a Premier League draft got no in-match scoring at
    all: wrong competition, wrong id space, wrong table, three independent
    reasons for the same silence.
    """

    def __init__(self, league, season, kind, key=None, matcher=None,
                 league_ids=None):
        self.league = league
        self.season = season
        self.kind = kind
        self.key = key
        self.matcher = matcher
        self.league_ids = league_ids or []

    def __repr__(self):
        return self.key or f"league {self.league}/{self.season}"


def pull_fixture(fixture: dict, target: Target, dry_run: bool) -> None:
    fid = fixture["fixture"]["id"]
    home = fixture["teams"]["home"]["name"]
    away = fixture["teams"]["away"]["name"]
    status = fixture["fixture"]["status"]["short"]
    competition = target.kind == "competition"
    rows = extract_player_rows(
        fixture, fetch_fixture_players(fid, mock=False), target.matcher,
        use_api_ids=competition)
    appeared = [r for r in rows if featured(r)]
    matched = [r for r in appeared if r["player_id"]]
    unmatched = len(appeared) - len(matched)
    note = f", {unmatched} unmapped" if unmatched else ""
    log(f"  [{target}] {home} vs {away} [{status}]: {len(matched)} players{note}")
    if dry_run or not matched:
        return
    if competition:
        # Same shape the twice-daily sweep writes, so a live row and the row
        # that later replaces it agree rather than differing by a column.
        for row in matched:
            row["points"] = calculate_points(row)
        upsert_competition_stats(matched, target.key)
    else:
        upsert_match_stats(matched, target.league_ids)


def build_targets(args) -> list:
    """Everything worth watching this run.

    The competitions come from the same toggle the twice-daily sweep reads
    (competition_pools.scheduled), so turning a competition on in the admin
    panel turns on its live scoring too -- rather than being a second list
    someone has to remember to keep in step.
    """
    targets = []
    if not args.no_competitions:
        for key in fetch_scheduled_competitions():
            parsed = parse_competition_key(key)
            if not parsed:
                log(f"skipping {key} — not an API-Football competition")
                continue
            targets.append(Target(parsed[0], parsed[1], "competition", key=key))

    # The original World Cup league, kept alive only when it has somewhere to
    # write. It used to be the default and the only option; now it is the
    # fallback, because a repository without players.json -- every league
    # drafted from the API -- has no FIFA ids to map onto and would fail on
    # load, which is why load_players() sys.exits rather than returning empty.
    league_ids = parse_league_ids(os.environ.get("FANTASY_LEAGUE_ID"))
    if league_ids and PLAYERS_JSON.exists():
        matcher = PlayerMatcher(json.loads(PLAYERS_JSON.read_text(encoding="utf-8")))
        targets.append(Target(args.league, args.season, "legacy",
                              matcher=matcher, league_ids=league_ids))
    elif league_ids:
        log(f"FANTASY_LEAGUE_ID is set but {PLAYERS_JSON.name} is missing — "
            "skipping the static World Cup pool.")
    return targets


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--league", type=int, default=1)
    parser.add_argument("--season", type=int, default=2026)
    parser.add_argument("--poll", type=int, default=300,
                        help="seconds between live updates")
    parser.add_argument("--lookahead", type=int, default=15,
                        help="engage if a kickoff is this many minutes away")
    parser.add_argument("--max-minutes", type=int, default=330,
                        help="exit after this long; the next cron resumes")
    parser.add_argument("--max-wait", type=int, default=90,
                        help="stay alive if kickoff is within this many "
                        "minutes (bridges cron scheduling gaps; default: 90)")
    parser.add_argument("--kickoff-grace", type=int, default=15,
                        help="stay alive this many minutes past scheduled "
                        "kickoff while waiting for the API to flag the "
                        "fixture as live (API-Football typically lags "
                        "3-10 min; default: 15)")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--no-competitions", action="store_true",
                        help="watch only the static World Cup league")
    args = parser.parse_args()

    started_on = os.environ.get("GITHUB_SHA")
    targets = build_targets(args)
    if not targets:
        # Exit green, not red: this watchdog fires every 15 minutes, and
        # nothing to do would otherwise mean ~96 failure mails a day.
        log("Nothing to score into — no competition has its scheduled pull "
            "switched on, and FANTASY_LEAGUE_ID is not set. Turn a "
            "competition on in the admin panel, or set the secret for a "
            "static World Cup league. Exiting.")
        return
    log(f"watching {len(targets)}: {', '.join(str(t) for t in targets)}")

    deadline = time.monotonic() + args.max_minutes * 60
    # Fixture ids seen live this run, and which target each belongs to -- a
    # fixture that has gone full time still has to be written to the right
    # place, and by then it is no longer in any live list to look it up from.
    watched = {}
    grace_until = None  # monotonic timestamp: stay alive past kickoff lag

    while True:
        by_league = fetch_live_fixtures([t.league for t in targets])
        live_ids = set()

        for t in targets:
            for f in by_league.get(t.league, []):
                fid = f["fixture"]["id"]
                live_ids.add(fid)
                watched[fid] = t
                pull_fixture(f, t, args.dry_run)

        # One final pull with official full-time data per finished fixture.
        for fid in sorted(set(watched) - live_ids):
            t = watched.pop(fid)
            f = fetch_fixture(fid)
            if f and f["fixture"]["status"]["short"] in COMPLETED_STATUSES:
                log("final whistle:")
                pull_fixture(f, t, args.dry_run)

        if not live_ids:
            nxt = soonest_kickoff(targets)
            if nxt is not None and nxt <= args.lookahead:
                # Kickoff is imminent or just passed — arm/extend grace window.
                grace_until = time.monotonic() + args.kickoff_grace * 60
            if grace_until is not None and time.monotonic() < grace_until:
                log("nothing live yet — waiting for API to confirm kickoff.")
            elif nxt is None or nxt > args.max_wait:
                log("nothing live, next kickoff "
                    + (f"in {nxt:.0f} min" if nxt is not None else "unknown")
                    + " — exiting.")
                return
            elif nxt > args.lookahead:
                log(f"next kickoff in {nxt:.0f} min — staying alive.")
            else:
                log(f"kickoff in {nxt:.0f} min — standing by.")

        if time.monotonic() > deadline:
            log("max runtime reached — exiting; the next cron resumes.")
            return
        if code_has_moved(started_on):
            log("a newer commit is on the default branch — exiting so the "
                "next cron picks it up; the daily sweep reconciles anything "
                "this run missed.")
            return
        time.sleep(args.poll)


if __name__ == "__main__":
    main()
