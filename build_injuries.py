#!/usr/bin/env python3
"""Build injuries.json — availability hints shown as badges in the app.

Fetches API-Football's injury reports and writes a small JSON the app loads
optionally (like fixtures.json):

    [{"player_id": "api_276", "status": "out", "reason": "Knee Injury",
      "fixture_date": "2026-09-18", "as_of": "2026-09-14"}, ...]

"out" = reported missing a fixture; "doubtful" = questionable. A stale file
fails soft (no badges) and never affects scoring or league data.

TWO ID SPACES, and getting this wrong is why the badges were invisible for
every league that was not the World Cup. A league built from an API-Football
competition keys its pool on the API's own player id ("api_276", see
parseSquadPlayer in app.js); the original static World Cup pool keys on FIFA
squad-list ids ("mex_9", from players.json). This script emits BOTH for every
player it can: an unmatched id is inert, so one file serves every league and
each one picks up only the ids it recognises.

Runs over a LIST of competitions in one invocation and writes them all, so a
competition is never dropped from the file just because another one was built
last. Configure with --competitions "39:2026,1:2026" or the env var
INJURY_COMPETITIONS; see COMPETITIONS below for the default.

Run by .github/workflows/injuries.yml daily; needs API_FOOTBALL_KEY.
"""

import argparse
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from daily_pull import PLAYERS_JSON, PlayerMatcher, api_get, fix_team_name

OUT = Path(__file__).parent / "injuries.json"

# league id : season. Add a competition here (or via --competitions) and its
# players start getting badges; nothing else in the app needs to change.
COMPETITIONS = [(1, 2026), (39, 2026)]

# The World Cup is the one competition that also has a static players.json pool
# behind it, so it is the only one worth running the name matcher for.
FIFA_LEAGUE_ID = 1

# How stale a report's fixture may be before we stop calling it current.
#
# This matters far more for a 38-week season than for a four-week tournament,
# and it was wrong for both: the app expires entries on `as_of`, which is
# always the day the file was built, so a September hamstring would have gone
# on being reported in May. Reports from the future are kept -- an upcoming
# fixture the player is flagged to miss is exactly the thing worth badging.
CURRENT_WINDOW_DAYS = 10


def injury_status(player_type: str) -> str:
    """API-Football's `player.type`, reduced to what the badge can show."""
    return "out" if str(player_type or "").lower().startswith("missing") else "doubtful"


def is_current(fixture_date: str, today: str, window_days: int = CURRENT_WINDOW_DAYS) -> bool:
    """Is a report about a fixture recent enough to still mean something?

    An empty date comes from the `injured` flag sweep, which reports current
    state by construction and has no fixture to date.
    """
    if not fixture_date:
        return True
    cutoff = (datetime.strptime(today, "%Y-%m-%d") - timedelta(days=window_days))
    return fixture_date >= cutoff.strftime("%Y-%m-%d")


def better(prev: dict, new: dict) -> bool:
    """Should `new` replace `prev` for the same player id?

    "out" beats "doubtful" outright -- the stronger claim is the one worth
    showing -- and within the same status the more recent fixture wins.
    """
    if not prev:
        return True
    if prev["status"] != "out" and new["status"] == "out":
        return True
    return prev["status"] == new["status"] and (new.get("fixture_date") or "") > (
        prev.get("fixture_date") or ""
    )


def put(best: dict, rec: dict) -> None:
    if better(best.get(rec["player_id"]), rec):
        best[rec["player_id"]] = rec


def ids_for(api_player: dict, team_name: str, matcher) -> list:
    """Every player id this report should be filed under.

    Always the API's own id; plus the FIFA squad-list id when a matcher is
    supplied and the name resolves. Returns (ids, why_not) so an unmatched
    name can be reported rather than silently dropped.
    """
    ids, why = [], None
    api_id = api_player.get("id")
    if api_id is not None:
        ids.append(f"api_{api_id}")
    if matcher is not None:
        entry, how = matcher.match(api_player.get("name", ""), team_name, None)
        if entry:
            ids.append(entry["player_id"])
        else:
            why = how
    return ids, why


def load_matcher():
    """The FIFA name matcher, or None when there is no static pool to match to.

    Deliberately not fatal: a repository without players.json can still build
    injuries for its API competitions, which is the normal case now.
    """
    if not PLAYERS_JSON.exists():
        return None
    return PlayerMatcher(json.loads(PLAYERS_JSON.read_text(encoding="utf-8")))


def collect(league: int, season: int, today: str, matcher, best: dict, log: list) -> None:
    """Add one competition's reports into `best`, keyed by player id."""

    def safe(path, params):
        try:
            return api_get(path, params)          # full payload (response + paging)
        except SystemExit:                        # unsupported combo on this plan
            log.append(f"  /{path} unavailable for league {league} on this plan")
            return {"response": [], "paging": {"current": 1, "total": 1}}

    teams = safe("teams", {"league": league, "season": season}).get("response", [])
    skipped = []

    # 1) Detailed injury reports (these carry a reason) from league + per-team.
    raw = list(safe("injuries", {"league": league, "season": season}).get("response", []))
    league_n = len(raw)
    for t in teams:
        tid = (t.get("team", {}) or {}).get("id")
        if tid:
            raw += safe("injuries", {"team": tid, "season": season}).get("response", [])
    team_n = len(raw) - league_n

    stale = 0
    for it in raw:
        fx_date = (it.get("fixture", {}).get("date") or "")[:10]
        if not is_current(fx_date, today):
            stale += 1
            continue
        player = it.get("player", {}) or {}
        team = it.get("team", {}).get("name", "")
        ids, why = ids_for(player, team, matcher)
        if not ids:
            skipped.append(f"{player.get('name')} ({fix_team_name(team)}): no id")
            continue
        if why:
            skipped.append(f"{player.get('name')} ({fix_team_name(team)}): {why}")
        for pid in ids:
            put(best, {"player_id": pid, "status": injury_status(player.get("type")),
                       "reason": player.get("reason") or "Injured",
                       "fixture_date": fx_date, "as_of": today})

    # 2) The `injured` flag on the player object. This is the broad source: it
    # reflects current status even when the injury happened somewhere the
    # /injuries endpoints do not cover for this competition.
    flagged = scanned = 0
    for t in teams:
        tm = t.get("team", {}) or {}
        tid, tname = tm.get("id"), tm.get("name", "")
        if not tid:
            continue
        page = 1
        while page <= 6:
            data = safe("players", {"team": tid, "season": season, "page": page})
            people = data.get("response", [])
            scanned += len(people)
            for e in people:
                p = e.get("player", {}) or {}
                if not p.get("injured"):
                    continue
                ids, why = ids_for(p, tname, matcher)
                if not ids:
                    skipped.append(f"{p.get('name')} ({fix_team_name(tname)}): no id [flag]")
                    continue
                if why:
                    skipped.append(f"{p.get('name')} ({fix_team_name(tname)}): {why} [flag]")
                flagged += 1
                for pid in ids:
                    put(best, {"player_id": pid, "status": "out", "reason": "Injured",
                               "fixture_date": "", "as_of": today})
            total = (data.get("paging") or {}).get("total", 1)
            if page >= total:
                break
            page += 1

    log.append(
        f"league {league} season {season}: {league_n} league + {team_n} team report(s), "
        f"{stale} too old to be current; /players scanned {scanned} rows across "
        f"{len(teams)} squads, {flagged} flagged injured."
    )
    if skipped:
        log.append(f"  {len(skipped)} report(s) not fully mapped:")
        log.extend(f"    - {s}" for s in sorted(set(skipped)))


def parse_competitions(spec: str) -> list:
    """"39:2026,1:2026" -> [(39, 2026), (1, 2026)]."""
    out = []
    for part in str(spec or "").split(","):
        part = part.strip()
        if not part:
            continue
        league, _, season = part.partition(":")
        out.append((int(league), int(season)))
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--competitions",
                        default=os.environ.get("INJURY_COMPETITIONS", ""),
                        help='"<league>:<season>,..." (default: see COMPETITIONS)')
    parser.add_argument("--league", type=int, help="shorthand for a single competition")
    parser.add_argument("--season", type=int, default=2026)
    args = parser.parse_args()

    if args.league:
        comps = [(args.league, args.season)]
    else:
        comps = parse_competitions(args.competitions) or COMPETITIONS

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    matcher = load_matcher()
    if matcher is None:
        print(f"No {PLAYERS_JSON.name}; FIFA squad ids will not be emitted.")

    best, log = {}, []
    for league, season in comps:
        collect(league, season, today,
                matcher if league == FIFA_LEAGUE_ID else None, best, log)

    out = sorted(best.values(), key=lambda r: r["player_id"])
    OUT.write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    for line in log:
        print(line)
    print(f"Wrote {len(out)} injury entr{'y' if len(out) == 1 else 'ies'} to {OUT.name}.")


if __name__ == "__main__":
    main()
