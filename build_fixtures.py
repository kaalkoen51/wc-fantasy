#!/usr/bin/env python3
"""Build fixtures.json so the app can show each player's (and union's) next
fixture on the Home/Trades tabs, and so lineup locks land on kickoff times.

Three modes:

    python build_fixtures.py               # confirmed 2026 schedule (default)
    python build_fixtures.py --placeholder # offline synthetic cross-pool schedule
    python build_fixtures.py --ds-api      # live Draft Sport API (not wired yet)

The Nations Championship is a cross-pool round robin: each of the six Europe
teams plays each of the six Rest-of-World teams once — three fixtures in the
July window (Southern-hemisphere hosts) and three in November (Northern hosts)
— then a finals weekend ranked by pool standings. The default now ships the
*confirmed* 2026 fixture list (source: World Rugby / union announcements,
Nov 2025). Re-run and re-commit whenever the confirmed schedule changes.

The file is optional — the app shows "no fixture data" hints without it.
"""

import argparse
import json
import os
import sys
from pathlib import Path

from build_players import TEAMS

ROOT = Path(__file__).parent
API_BASE = "https://api.draftsport.com"

EUROPE = [name for name, _code, pool in TEAMS if pool == "Europe"]
REST = [name for name, _code, pool in TEAMS if pool == "Rest of World"]

# Confirmed 2026 Nations Championship schedule — (kickoff_utc, home, away) per
# round, with precise per-match kickoff times. July window is BST (UTC+1) at
# source, November is GMT (UTC+0); both are stored here already converted to
# UTC. July: Rest-of-World host; November: Europe host (home listed first).
# Finals weekend (27–29 Nov, Allianz Stadium, London) is ranked by pool
# standings, so team pairings aren't known yet and are omitted here.
# Source: union/broadcaster announcements collated by ruck.co.uk & Yahoo Sport.
REAL_SCHEDULE = [
    # Round 1 — Sat 4 July
    ("2026-07-04T07:10:00+00:00", "New Zealand", "France"),
    ("2026-07-04T08:40:00+00:00", "Japan", "Italy"),
    ("2026-07-04T10:10:00+00:00", "Australia", "Ireland"),
    ("2026-07-04T13:10:00+00:00", "Fiji", "Wales"),
    ("2026-07-04T15:40:00+00:00", "South Africa", "England"),
    ("2026-07-04T19:10:00+00:00", "Argentina", "Scotland"),
    # Round 2 — Sat 11 July
    ("2026-07-11T05:10:00+00:00", "New Zealand", "Italy"),
    ("2026-07-11T07:40:00+00:00", "Australia", "France"),
    ("2026-07-11T10:00:00+00:00", "Japan", "Ireland"),
    ("2026-07-11T13:10:00+00:00", "Fiji", "England"),
    ("2026-07-11T15:40:00+00:00", "South Africa", "Scotland"),
    ("2026-07-11T19:00:00+00:00", "Argentina", "Wales"),
    # Round 3 — Sat 18 July
    ("2026-07-18T07:10:00+00:00", "New Zealand", "Ireland"),
    ("2026-07-18T07:10:00+00:00", "Japan", "France"),
    ("2026-07-18T10:10:00+00:00", "Australia", "Italy"),
    ("2026-07-18T13:10:00+00:00", "Fiji", "Scotland"),
    ("2026-07-18T15:40:00+00:00", "South Africa", "Wales"),
    ("2026-07-18T19:00:00+00:00", "Argentina", "England"),
    # Round 4 — Fri 6 to Sun 8 November
    ("2026-11-06T22:10:00+00:00", "Ireland", "Argentina"),
    ("2026-11-07T13:40:00+00:00", "Italy", "South Africa"),
    ("2026-11-07T16:10:00+00:00", "Scotland", "New Zealand"),
    ("2026-11-07T18:40:00+00:00", "Wales", "Japan"),
    ("2026-11-07T22:10:00+00:00", "France", "Fiji"),
    ("2026-11-08T17:10:00+00:00", "England", "Australia"),
    # Round 5 — Fri 13 to Sun 15 November
    ("2026-11-13T22:10:00+00:00", "France", "South Africa"),
    ("2026-11-14T13:40:00+00:00", "Italy", "Argentina"),
    ("2026-11-14T16:10:00+00:00", "Wales", "New Zealand"),
    ("2026-11-14T18:40:00+00:00", "England", "Japan"),
    ("2026-11-14T22:10:00+00:00", "Ireland", "Fiji"),
    ("2026-11-15T17:10:00+00:00", "Scotland", "Australia"),
    # Round 6 — Sat 21 November
    ("2026-11-21T16:10:00+00:00", "England", "New Zealand"),
    ("2026-11-21T16:10:00+00:00", "Scotland", "Japan"),
    ("2026-11-21T18:40:00+00:00", "Ireland", "South Africa"),
    ("2026-11-21T18:40:00+00:00", "Italy", "Fiji"),
    ("2026-11-21T21:10:00+00:00", "Wales", "Australia"),
    ("2026-11-21T21:10:00+00:00", "France", "Argentina"),
]

# Representative kickoff dates for the synthetic --placeholder schedule only.
ROUND_DATES = [
    "2026-07-04", "2026-07-11", "2026-07-18",   # July window
    "2026-11-07", "2026-11-14", "2026-11-21",   # November window
]
FINAL_DATE = "2026-11-28"


def build_real() -> list:
    """The confirmed 2026 fixture list with precise per-match kickoffs."""
    fixtures = []
    for kickoff_utc, home, away in REAL_SCHEDULE:
        fixtures.append({
            "home": home,
            "away": away,
            "kickoff_utc": kickoff_utc,
            "date": kickoff_utc[:10],
            "status": "NS",
        })
    fixtures.sort(key=lambda f: f["kickoff_utc"])
    return fixtures


def build_placeholder() -> list:
    """Full synthetic cross-pool round robin: in round r, Europe[i] meets
    Rest[(i + r) % 6], so over six rounds every cross-pool pair plays once."""
    fixtures = []
    for r, date in enumerate(ROUND_DATES):
        for i, home in enumerate(EUROPE):
            away = REST[(i + r) % len(REST)]
            fixtures.append({
                "home": home,
                "away": away,
                "kickoff_utc": f"{date}T14:00:00+00:00",
                "date": date,
                "status": "NS",
            })
    # Placeholder Grand Final (real pairing depends on pool standings).
    fixtures.append({
        "home": EUROPE[0],
        "away": REST[0],
        "kickoff_utc": f"{FINAL_DATE}T15:00:00+00:00",
        "date": FINAL_DATE,
        "status": "NS",
    })
    fixtures.sort(key=lambda f: f["kickoff_utc"])
    return fixtures


def fetch_from_ds_api() -> list:
    """Pull the confirmed schedule from the Draft Sport API. TODO: confirm
    the DS-API fixtures endpoint/fields against the draft-sport library."""
    import requests  # local import so offline modes need no dependency

    key = os.environ.get("DRAFT_SPORT_KEY")
    if not key:
        sys.exit("Error: DRAFT_SPORT_KEY not set. Use the default confirmed schedule offline.")
    raise SystemExit(
        "Live DS-API fixtures pull is not wired yet: confirm the endpoint "
        "and field names, then map them here. Use the default confirmed "
        "schedule meanwhile."
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--placeholder", action="store_true",
                        help="Generate the offline synthetic cross-pool schedule.")
    parser.add_argument("--ds-api", action="store_true",
                        help="Pull the live schedule from the Draft Sport API (not wired yet).")
    args = parser.parse_args()

    if args.ds_api:
        fixtures = fetch_from_ds_api()
    elif args.placeholder:
        fixtures = build_placeholder()
    else:
        fixtures = build_real()

    out = ROOT / "fixtures.json"
    out.write_text(
        json.dumps(fixtures, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"Wrote {len(fixtures)} fixtures to {out}")


if __name__ == "__main__":
    main()
