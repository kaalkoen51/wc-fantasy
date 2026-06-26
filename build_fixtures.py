#!/usr/bin/env python3
"""Build fixtures.json so the app can show each player's (and union's) next
fixture on the Home/Trades tabs, and so lineup locks land on kickoff times.

Two modes:

    python build_fixtures.py               # live Draft Sport API (DS-API)
    python build_fixtures.py --placeholder # offline cross-pool schedule

The Nations Championship is a cross-pool round robin: each of the six
Europe teams plays each of the six Rest-of-World teams once, three fixtures
in the July window and three in November, then a finals weekend. The real
dates/pairings come from the DS-API; until then the placeholder generates
the full 36-match cross-pool schedule with representative kickoff dates so
the next-fixture and lineup-lock features work.

The file is optional — the app shows "no fixture data" hints without it.
Re-run and re-commit whenever the confirmed schedule changes.
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

# Representative kickoff dates: three July rounds, three November rounds,
# then the finals weekend. Placeholder only — replace from the DS-API.
ROUND_DATES = [
    "2026-07-04", "2026-07-11", "2026-07-18",   # July window
    "2026-11-07", "2026-11-14", "2026-11-21",   # November window
]
FINAL_DATE = "2026-11-28"


def build_placeholder() -> list:
    """Full cross-pool round robin: in round r, Europe[i] meets
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
    import requests  # local import so --placeholder needs no dependency

    key = os.environ.get("DRAFT_SPORT_KEY")
    if not key:
        sys.exit("Error: DRAFT_SPORT_KEY not set. Use --placeholder offline.")
    raise SystemExit(
        "Live DS-API fixtures pull is not wired yet: confirm the endpoint "
        "and field names, then map them here. Use --placeholder meanwhile."
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--placeholder", action="store_true",
                        help="Generate the offline cross-pool schedule.")
    args = parser.parse_args()

    fixtures = build_placeholder() if args.placeholder else fetch_from_ds_api()

    out = ROOT / "fixtures.json"
    out.write_text(
        json.dumps(fixtures, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"Wrote {len(fixtures)} fixtures to {out}")


if __name__ == "__main__":
    main()
