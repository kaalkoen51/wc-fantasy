#!/usr/bin/env python3
"""Build fixtures.json from API-Football so the app can show each player's
(and national team's) next fixture on the Home tab.

    $env:API_FOOTBALL_KEY = "..."; python build_fixtures.py

Re-run and re-commit whenever new fixtures are confirmed (e.g. once
knockout pairings are set). The file is optional — the app shows "no
fixture data" hints without it.
"""

import json
import os
import sys
from pathlib import Path

import requests

from daily_pull import fix_team_name, load_players

API_BASE = "https://v3.football.api-sports.io"


def main() -> None:
    key = os.environ.get("API_FOOTBALL_KEY")
    if not key:
        sys.exit("Error: API_FOOTBALL_KEY env var is required.")
    league = int(os.environ.get("FIXTURES_LEAGUE", "1"))   # 1 = World Cup
    season = int(os.environ.get("FIXTURES_SEASON", "2026"))

    resp = requests.get(
        f"{API_BASE}/fixtures",
        headers={"x-apisports-key": key},
        params={"league": league, "season": season},
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()
    if data.get("errors"):
        sys.exit(f"API-Football error: {data['errors']}")

    # Group-stage fixtures with a placeholder/non-tournament team are dropped.
    # Knockout fixtures, though, are KEPT even before their teams are decided
    # (placeholder names like "Winner Group A" / null): an undecided side becomes
    # "TBC" so the app can show the full bracket tree — semis, final and the
    # third-place playoff included — and fill the names in as rounds resolve.
    valid = {p["team"] for p in load_players()}
    ko_hints = ("round of", "quarter", "semi", "final", "3rd", "third")
    fixtures = []
    dropped = 0
    for f in data.get("response", []):
        round_str = (f.get("league") or {}).get("round") or ""
        is_ko = any(h in round_str.lower() for h in ko_hints)
        home = fix_team_name((f["teams"]["home"] or {}).get("name") or "")
        away = fix_team_name((f["teams"]["away"] or {}).get("name") or "")
        if not is_ko and (home not in valid or away not in valid):
            dropped += 1
            continue
        if is_ko:
            home = home if home in valid else "TBC"
            away = away if away in valid else "TBC"
        goals = f.get("goals") or {}
        fixtures.append({
            "home": home,
            "away": away,
            "kickoff_utc": f["fixture"]["date"],
            "date": f["fixture"]["date"][:10],
            "status": f["fixture"]["status"]["short"],
            # round + score power the knockout bracket view (built into the app).
            # "round" is API-Football's stage label, e.g. "Round of 16", "Final".
            "round": round_str,
            "home_score": goals.get("home"),
            "away_score": goals.get("away"),
        })
    fixtures.sort(key=lambda f: f["kickoff_utc"])

    out = Path(__file__).parent / "fixtures.json"
    out.write_text(
        json.dumps(fixtures, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"Wrote {len(fixtures)} fixtures to {out} "
          f"({dropped} skipped — undecided pairings / non-tournament teams).")


if __name__ == "__main__":
    main()
