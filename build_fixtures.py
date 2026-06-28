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

    # Knockout fixtures exist before their teams are decided, with placeholder
    # names ("Winner Group A", null, etc.) that match no real squad. Keep only
    # fixtures between two actual tournament teams; undecided rounds drop out and
    # reappear automatically once the pairing is set and the feed rebuilds.
    valid = {p["team"] for p in load_players()}
    fixtures = []
    dropped = 0
    for f in data.get("response", []):
        home = fix_team_name((f["teams"]["home"] or {}).get("name") or "")
        away = fix_team_name((f["teams"]["away"] or {}).get("name") or "")
        if home not in valid or away not in valid:
            dropped += 1
            continue
        fixtures.append({
            "home": home,
            "away": away,
            "kickoff_utc": f["fixture"]["date"],
            "date": f["fixture"]["date"][:10],
            "status": f["fixture"]["status"]["short"],
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
