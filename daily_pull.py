#!/usr/bin/env python3
"""Daily stats pull for the Rugby Nations Championship fantasy league.

Fetches completed-match player statistics from a rugby stats provider,
calculates fantasy points, and upserts them to the Supabase `match_stats`
table.

The intended source is draftrugby.com's Draft Sport API (DS-API). The
network policy in some environments blocks that host, and the DS-API field
names are finalised against the `draft-sport` client library, so the fetch
layer (`fetch_fixtures` / `fetch_fixture_players`) is the documented
adapter to repoint at the DS-API; everything downstream (scoring, the
player-id matcher, the upsert) is provider-independent and fully tested.

Upserted rows use the squad-list player ids from players.json
("eng_10" = <team code>_<squad number>) — the ids the app keys all rosters
and scoring by — not the provider's numeric ids. Each provider player is
mapped by team + name (exact, then surname, then fuzzy), with the squad
number as a tie-breaker / fallback when the provider supplies one. Players
that cannot be mapped are skipped and listed in the output so the admin can
enter them manually; use --dry-run to verify the mapping without writing.

Usage:
    python daily_pull.py                       # yesterday's fixtures
    python daily_pull.py --date 2026-07-04     # a specific date
    python daily_pull.py --dry-run             # fetch + calculate, no writes
    python daily_pull.py --mock --dry-run      # bundled sample data, no network

Environment variables:
    DRAFT_SPORT_KEY       required for any non-mock run (stats provider key)
    SUPABASE_URL          required for writes (non-dry-run)
    SUPABASE_SERVICE_KEY  required for writes (non-dry-run)
    FANTASY_LEAGUE_ID     Supabase leagues.id uuid — or a comma-separated
                          allowlist of several to score multiple leagues
                          from one deployment (can also be passed via
                          --league-id). Required for writes.
"""

import argparse
import json
import os
import re
import sys
import unicodedata
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from pathlib import Path

import requests

# Repoint at the Draft Sport API (DS-API) base when wiring the live source.
API_BASE = "https://api.draftsport.com"
MOCK_DIR = Path(__file__).parent / "mock_data"
PLAYERS_JSON = Path(__file__).parent / "players.json"

# Rugby fantasy scoring — mirrors draftrugby.com's published system. The
# JS copy in index.html (SCORING) must stay identical. Point values follow
# Draft Rugby's documented model; confirm the exact numbers against
# draftrugby.com once the host is reachable (TODO: verify vs source).
SCORING = {
    "try": 10,
    "try_assist": 4,
    "conversion": 2,
    "penalty_goal": 3,
    "drop_goal": 3,
    "tackle": 1,
    "missed_tackle": -1,
    "defender_beaten": 2,
    "clean_break": 2,
    "offload": 1,
    "turnover_won": 5,
    "turnover_conceded": -2,
    "penalty_conceded": -2,
    "yellow_card": -3,
    "red_card": -8,
    "motm": 5,
    # Metres made: points per metre vary by position group (Draft Rugby
    # rewards forwards more per metre than backs). Value = metres needed
    # for one point (integer floor division, kept in sync with the JS).
    "metres_div": {"FR": 4, "SR": 2, "BR": 8, "HB": 10, "CE": 10, "B3": 10},
    # Performance bonuses (Draft Rugby thresholds), awarded once per match.
    "bonus_metres_100": 3,
    "bonus_tackles_15": 2,
    "bonus_turnovers_3": 2,
}

# Position groups (rugby). The provider's position string maps to one of
# the six XV groups: Front Row, Second Row, Back Row, Half Backs, Centres,
# Back Three. Same six groups drive the draft quota in index.html.
POSITION_MAP = {
    # front row
    "Prop": "FR", "Loosehead Prop": "FR", "Tighthead Prop": "FR",
    "Hooker": "FR", "FR": "FR",
    # second row
    "Lock": "SR", "Second Row": "SR", "SR": "SR",
    # back row
    "Flanker": "BR", "Openside Flanker": "BR", "Blindside Flanker": "BR",
    "Number 8": "BR", "No. 8": "BR", "No.8": "BR", "Back Row": "BR", "BR": "BR",
    # half backs
    "Scrum-half": "HB", "Scrum Half": "HB", "Fly-half": "HB",
    "Fly Half": "HB", "Half Back": "HB", "HB": "HB",
    # centres
    "Centre": "CE", "Inside Centre": "CE", "Outside Centre": "CE", "CE": "CE",
    # back three
    "Wing": "B3", "Winger": "B3", "Fullback": "B3", "Full-back": "B3",
    "Back Three": "B3", "B3": "B3",
}

# The provider may name some unions differently from the squad lists
# (players.json). Match labels must use the squad-list names: the app's
# sub-activation rule compares label team names against squad team names.
# Same map lives in index.html (TEAM_NAME_FIX) — keep in sync.
TEAM_NAME_FIX = {
    "USA": "United States",
    "NZ": "New Zealand",
    "RSA": "South Africa",
}


def fix_team_name(name: str) -> str:
    return TEAM_NAME_FIX.get(name, name)


FUZZY_MIN_RATIO = 0.75


def normalize_name(s: str) -> str:
    """Lowercase, strip accents and punctuation: "N'Golo Kanté" -> "n golo kante"."""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = "".join(c if c.isalnum() else " " for c in s.lower())
    return " ".join(s.split())


def surname_key(name: str) -> str:
    tokens = normalize_name(name).split()
    return tokens[-1] if tokens else ""


class PlayerMatcher:
    """Maps provider players to squad-list entries from players.json.

    Squad ids are <team code>_<squad number> ("eng_10"), so the number can
    be recovered from the id itself. Provider names are often abbreviated
    ("M. Smith" for "Marcus Smith"), hence the surname/fuzzy tiers.
    """

    def __init__(self, players: list):
        self.by_team = {}
        self.by_number = {}
        self.by_surname = {}
        for p in players:
            team = normalize_name(p["team"])
            self.by_team.setdefault(team, []).append(p)
            self.by_surname.setdefault((team, surname_key(p["name"])), []).append(p)
            shirt = p["player_id"].rsplit("_", 1)[-1]
            if shirt.isdigit():
                self.by_number[(team, int(shirt))] = p

    def match(self, api_name: str, api_team: str, shirt_number=None):
        """Return (players.json entry, how) on success, (None, reason) otherwise."""
        team = normalize_name(fix_team_name(api_team))
        roster = self.by_team.get(team)
        if not roster:
            return None, f"team {api_team!r} not in players.json"

        target = normalize_name(api_name)
        candidates = [p for p in roster if normalize_name(p["name"]) == target]
        how = "exact name"
        if not candidates:
            candidates = self.by_surname.get((team, surname_key(api_name)), [])
            how = "surname"
        if not candidates:
            scored = [
                (SequenceMatcher(None, target, normalize_name(p["name"])).ratio(), p)
                for p in roster
            ]
            best = max(ratio for ratio, _ in scored)
            if best >= FUZZY_MIN_RATIO:
                candidates = [p for ratio, p in scored if ratio == best]
                how = f"fuzzy name ({best:.2f})"

        if len(candidates) > 1 and shirt_number is not None:
            by_number = self.by_number.get((team, shirt_number))
            if by_number in candidates:
                return by_number, f"{how} + shirt number"
        if len(candidates) > 1 and target:
            # "E. Martinez" -> the initial picks Emiliano over Lautaro
            first = target.split()[0]
            narrowed = [
                p
                for p in candidates
                if normalize_name(p["name"]).split()[0].startswith(first)
            ]
            if len(narrowed) == 1:
                candidates = narrowed
                how += " + first initial"
        if len(candidates) == 1:
            return candidates[0], how
        if len(candidates) > 1:
            names = ", ".join(p["name"] for p in candidates)
            return None, f"ambiguous {how} match: {names}"

        if shirt_number is not None:
            by_number = self.by_number.get((team, shirt_number))
            if by_number:
                return by_number, "shirt number only"
        return None, "no name match"


def load_players() -> list:
    if not PLAYERS_JSON.exists():
        sys.exit(f"Error: {PLAYERS_JSON} not found (needed to map player ids).")
    return json.loads(PLAYERS_JSON.read_text(encoding="utf-8"))


COMPLETED_STATUSES = {"FT", "AET", "PEN"}

MOTM_MIN_RATING = 7.5


def require_env(name: str, why: str) -> str:
    value = os.environ.get(name)
    if not value:
        sys.exit(f"Error: environment variable {name} is not set ({why}).")
    return value


def api_get(path: str, params: dict) -> dict:
    key = require_env("DRAFT_SPORT_KEY", "needed to call the rugby stats provider")
    resp = requests.get(
        f"{API_BASE}/{path}",
        headers={"Authorization": f"Bearer {key}"},
        params=params,
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    if data.get("errors"):
        sys.exit(f"Stats provider error on /{path}: {data['errors']}")
    return data


def load_mock(name: str) -> dict:
    path = MOCK_DIR / f"{name}.json"
    if not path.exists():
        sys.exit(
            f"Error: mock file {path} not found. --mock requires sample data "
            "in mock_data/ (see README)."
        )
    return json.loads(path.read_text(encoding="utf-8"))


def fetch_fixtures(date: str, league: int, season: int, mock: bool) -> list:
    if mock:
        data = load_mock("fixtures")
    else:
        data = api_get(
            "fixtures", {"date": date, "league": league, "season": season}
        )
    fixtures = data.get("response", [])
    return [
        f
        for f in fixtures
        if f.get("fixture", {}).get("status", {}).get("short")
        in COMPLETED_STATUSES
    ]


def fetch_fixture_players(fixture_id: int, mock: bool) -> list:
    if mock:
        data = load_mock(f"players_{fixture_id}")
    else:
        data = api_get("fixtures/players", {"fixture": fixture_id})
    return data.get("response", [])


def to_int(value) -> int:
    return int(value) if value else 0


def to_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


# A provider may return minutes:null for a just-finished fixture's players
# even when they featured/scored. Treat a player as having featured if they
# have minutes OR any recorded counting stat, so a scorer is never dropped
# for a blank minute. True non-participants (no minutes, no stats) are
# still excluded.
STAT_FIELDS = (
    "tries", "try_assists", "conversions", "penalty_goals", "drop_goals",
    "tackles", "missed_tackles", "metres", "defenders_beaten", "clean_breaks",
    "offloads", "turnovers_won", "turnovers_conceded", "penalties_conceded",
    "yellow_cards", "red_cards",
)

# Counting stats carried straight through from the provider's per-player
# stat block to the match_stats row (and on to calculate_points).
COUNTING_STATS = STAT_FIELDS


def featured(row: dict) -> bool:
    return bool(row.get("minutes")) or any(row.get(k) for k in STAT_FIELDS)


def extract_player_rows(fixture: dict, teams_data: list, matcher: PlayerMatcher) -> list:
    """Flatten provider fixture-player stats into per-player dicts.

    `player_id` is the squad-list id from players.json (the id the app
    scores by), or None when the player could not be mapped — those rows
    must not be upserted. The provider's per-player entry carries a `games`
    block (minutes/position/number/rating) and the rugby counting stats as
    flat keys under `statistics[0]`; the DS-API adapter maps its fields onto
    this shape (TODO: confirm DS-API field names against the source).
    """
    home = fixture["teams"]["home"]
    away = fixture["teams"]["away"]
    goals = fixture.get("goals", {})
    match_label = (
        f"{fix_team_name(home['name'])} vs {fix_team_name(away['name'])} "
        f"({fixture['fixture']['date'][:10]})"
    )

    rows = []
    for team_block in teams_data:
        team_name = team_block.get("team", {}).get("name", "")
        for entry in team_block.get("players", []):
            player = entry.get("player", {})
            stats_list = entry.get("statistics", [])
            stats = stats_list[0] if stats_list else {}
            games = stats.get("games", {}) or {}

            minutes = to_int(games.get("minutes"))
            position = POSITION_MAP.get(games.get("position"), "B3")

            api_name = player.get("name", "Unknown")
            shirt = to_int(games.get("number")) or None
            matched, match_note = matcher.match(api_name, team_name, shirt)

            row = {
                "player_id": matched["player_id"] if matched else None,
                "player_name": matched["name"] if matched else api_name,
                "api_player_id": str(player.get("id")),
                "api_name": api_name,
                "team": fix_team_name(team_name),
                "match_note": match_note,
                # the app scores by the squad-list position, so prefer it
                "position": matched["position"] if matched else position,
                "match_label": match_label,
                "minutes": minutes,
                "rating": to_float(games.get("rating")),
                "home_score": to_int(goals.get("home")),
                "away_score": to_int(goals.get("away")),
                "motm": False,  # assigned per fixture below
            }
            for key in COUNTING_STATS:
                row[key] = to_int(stats.get(key))
            rows.append(row)

    assign_motm(rows)
    return rows


def assign_motm(rows: list) -> None:
    """MOTM heuristic: highest-rated player in the fixture, rating >= 7.5."""
    rated = [r for r in rows if r["rating"] is not None and r["minutes"] > 0]
    if not rated:
        return
    best = max(rated, key=lambda r: r["rating"])
    if best["rating"] >= MOTM_MIN_RATING:
        best["motm"] = True


def calculate_points(row: dict) -> int:
    """Rugby fantasy points for one match row. Mirrors scoringRow() in
    index.html — keep the two in exact step (integer floor division)."""
    if row["minutes"] == 0:
        return 0

    pos = row["position"]
    g = lambda k: to_int(row.get(k))
    points = 0
    points += g("tries") * SCORING["try"]
    points += g("try_assists") * SCORING["try_assist"]
    points += g("conversions") * SCORING["conversion"]
    points += g("penalty_goals") * SCORING["penalty_goal"]
    points += g("drop_goals") * SCORING["drop_goal"]
    points += g("tackles") * SCORING["tackle"]
    points += g("missed_tackles") * SCORING["missed_tackle"]
    points += g("defenders_beaten") * SCORING["defender_beaten"]
    points += g("clean_breaks") * SCORING["clean_break"]
    points += g("offloads") * SCORING["offload"]
    points += g("turnovers_won") * SCORING["turnover_won"]
    points += g("turnovers_conceded") * SCORING["turnover_conceded"]
    points += g("penalties_conceded") * SCORING["penalty_conceded"]
    points += g("yellow_cards") * SCORING["yellow_card"]
    points += g("red_cards") * SCORING["red_card"]
    # metres made, points per metre by position group
    div = SCORING["metres_div"].get(pos, 10)
    points += g("metres") // div
    if row["motm"]:
        points += SCORING["motm"]
    # performance bonuses (Draft Rugby thresholds)
    if g("metres") >= 100:
        points += SCORING["bonus_metres_100"]
    if g("tackles") >= 15:
        points += SCORING["bonus_tackles_15"]
    if g("turnovers_won") >= 3:
        points += SCORING["bonus_turnovers_3"]
    return points


def parse_league_ids(value) -> list:
    """FANTASY_LEAGUE_ID holds one league uuid or a comma-separated
    allowlist; only the leagues listed get the automated scoring (other
    leagues in the same Supabase project still work via the app's manual
    "Pull stats now" button)."""
    return [s.strip() for s in (value or "").split(",") if s.strip()]


def build_stats_payload(rows: list, league_ids) -> list:
    """One match_stats upsert entry per (row, league). The API fetching
    is league-independent — fan-out across leagues only multiplies the
    free Supabase writes, never the provider API calls."""
    if isinstance(league_ids, str):
        league_ids = parse_league_ids(league_ids)
    return [
        {
            "league_id": league_id,
            "player_id": row["player_id"],
            "match_label": row["match_label"],
            "appeared": True,
            "motm": row["motm"],
            "home_score": row.get("home_score"),
            "away_score": row.get("away_score"),
            "minutes": row.get("minutes"),
            **{key: to_int(row.get(key)) for key in COUNTING_STATS},
        }
        for league_id in league_ids
        for row in rows
    ]


# Columns added by later, additive schema.sql migrations. If the
# migration hasn't been applied to a database yet, PostgREST rejects the
# whole write with PGRST204; we drop the offending column and retry so an
# unapplied migration degrades gracefully (these are display-only — they
# never affect scoring) instead of silently killing every pull.
OPTIONAL_COLUMNS = ("home_score", "away_score", "minutes")

MISSING_COLUMN_RE = re.compile(r"Could not find the '(\w+)' column")


def upsert_match_stats(rows: list, league_ids) -> None:
    supabase_url = require_env("SUPABASE_URL", "Supabase project URL")
    service_key = require_env("SUPABASE_SERVICE_KEY", "Supabase service role key")

    payload = build_stats_payload(rows, league_ids)

    dropped = []
    while True:
        resp = requests.post(
            f"{supabase_url.rstrip('/')}/rest/v1/match_stats",
            params={"on_conflict": "league_id,player_id,match_label"},
            headers={
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates",
            },
            json=payload,
            timeout=30,
        )
        if resp.status_code < 400:
            break
        col = (MISSING_COLUMN_RE.search(resp.text) or [None, None])[1]
        if col in OPTIONAL_COLUMNS and col not in dropped:
            for row in payload:
                row.pop(col, None)
            dropped.append(col)
            continue
        sys.exit(f"Supabase upsert failed ({resp.status_code}): {resp.text}")

    leagues = max(1, len(payload) // max(1, len(rows)))
    note = f" (dropped missing column(s): {', '.join(dropped)} — run schema.sql)" \
        if dropped else ""
    print(f"Upserted {len(rows)} rows x {leagues} league(s) to match_stats.{note}")


def print_summary(rows: list) -> None:
    scored = sorted(rows, key=lambda r: r["points"], reverse=True)[:10]
    if not scored:
        print("No player stats to report.")
        return
    print("\nTop 10 scorers:")
    print(f"{'Pts':>4}  {'Pos':<4} {'Player':<28} Match")
    for row in scored:
        print(
            f"{row['points']:>4}  {row['position']:<4} "
            f"{row['player_name']:<28} {row['match_label']}"
        )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Pull completed-match player stats and upsert fantasy points."
    )
    parser.add_argument(
        "--date",
        default=(datetime.now(timezone.utc) - timedelta(days=1)).strftime(
            "%Y-%m-%d"
        ),
        help="Match date YYYY-MM-DD (default: yesterday UTC)",
    )
    parser.add_argument(
        "--league",
        type=int,
        default=1,
        help="Stats-provider competition id (default 1 = Nations Championship)",
    )
    parser.add_argument("--season", type=int, default=2026)
    parser.add_argument(
        "--league-id",
        default=os.environ.get("FANTASY_LEAGUE_ID"),
        help="Supabase leagues.id uuid, or a comma-separated allowlist of "
        "several (default: FANTASY_LEAGUE_ID env var)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch and calculate but do not write to Supabase",
    )
    parser.add_argument(
        "--mock",
        action="store_true",
        help="Use bundled sample data from mock_data/ instead of the network",
    )
    args = parser.parse_args()

    league_ids = parse_league_ids(args.league_id)
    if not args.dry_run and not league_ids:
        sys.exit(
            "Error: FANTASY_LEAGUE_ID env var (or --league-id) is required "
            "for non-dry-run writes."
        )

    print(
        f"Pulling fixtures for {args.date} "
        f"(league {args.league}, season {args.season})"
        + (" [mock]" if args.mock else "")
        + (" [dry-run]" if args.dry_run else "")
    )

    matcher = PlayerMatcher(load_players())

    fixtures = fetch_fixtures(args.date, args.league, args.season, args.mock)
    if not fixtures:
        print("No completed fixtures found for this date. Nothing to do.")
        return
    print(f"Found {len(fixtures)} completed fixture(s).")

    all_rows = []
    for fixture in fixtures:
        fixture_id = fixture["fixture"]["id"]
        teams_data = fetch_fixture_players(fixture_id, args.mock)
        rows_f = extract_player_rows(fixture, teams_data, matcher)
        # Diagnostic: does the player-stats endpoint actually carry tries? If
        # the scoreline implies tries but the summed player tries are 0, the
        # provider isn't populating tries in the per-player feed for this
        # match — which looks like "no try points" in the app.
        captured = sum(r["tries"] for r in rows_f)
        label = rows_f[0]["match_label"] if rows_f else f"fixture {fixture_id}"
        scorers = [f'{r["player_name"]}={r["tries"]}(min:{r["minutes"]},id:{r["player_id"]})'
                   for r in rows_f if r["tries"]]
        print(f"  {label}: player-stat tries={captured}"
              f"{' | ' + ', '.join(scorers) if scorers else ''}")
        all_rows.extend(rows_f)

    appeared = [r for r in all_rows if featured(r)]
    matched = [r for r in appeared if r["player_id"]]
    unmatched = [r for r in appeared if not r["player_id"]]
    for row in matched:
        row["points"] = calculate_points(row)
    unmatched_scorers = [r for r in all_rows if not r["player_id"] and r["tries"]]
    if unmatched_scorers:
        print("UNMATCHED try-scorers (scored but no squad id):")
        for r in unmatched_scorers:
            print(f"  - {r['api_name']} ({r['team']}) tries={r['tries']}: {r['match_note']}")

    print(
        f"{len(appeared)} player(s) appeared across all fixtures; "
        f"{len(matched)} mapped to squad-list ids."
    )

    loose = [
        r for r in matched if r["match_note"] not in ("exact name", "surname")
    ]
    if loose:
        print("\nLoosely matched (verify these look right):")
        for row in loose:
            print(
                f"  - {row['api_name']} -> {row['player_id']} "
                f"{row['player_name']} ({row['team']}): {row['match_note']}"
            )

    if unmatched:
        print(
            f"\nWARNING: {len(unmatched)} appeared player(s) could not be "
            "mapped to players.json — SKIPPED, enter manually via admin:"
        )
        for row in unmatched:
            print(
                f"  - {row['api_name']} ({row['team']}, "
                f"api id {row['api_player_id']}): {row['match_note']}"
            )

    if args.dry_run:
        print("\nDry run: skipping Supabase write.")
    else:
        upsert_match_stats(matched, league_ids)

    print_summary(matched)


if __name__ == "__main__":
    main()
