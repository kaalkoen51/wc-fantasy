#!/usr/bin/env python3
"""Build players.json — the draft pool for the Rugby Nations Championship.

Two modes:

  python build_players.py            # try the Draft Sport API (DS-API)
  python build_players.py --placeholder
                                     # offline: generate a structurally
                                     # correct placeholder pool (no network)

The intended source is draftrugby.com's Draft Sport API. Until the 2026
squads are published (the July international window) and the DS-API host is
reachable, ship the placeholder pool: the 12 unions, correct team codes and
the six position groups, with clearly-marked placeholder player names. Then
re-run without --placeholder to replace the names with the real rosters.

Player ids follow <3-letter code, lowercase>_<squad number>, e.g.
"eng_10" — the id the app keys every roster and all scoring by. Position is
one of the six XV groups: FR, SR, BR, HB, CE, B3 (see POSITION GROUPS in
the README).
"""

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).parent
PLAYERS_JSON = ROOT / "players.json"

# Repoint at the DS-API base + player-listing endpoint when wiring the live
# source. The DS-API exposes per-competition player listings; the official
# draft-sport client libraries document the exact shape.
API_BASE = "https://api.draftsport.com"

# The 12 Nations Championship unions and their pools. Codes are the lower-
# cased prefix of every player id from that union.
TEAMS = [
    # (name, code, pool)
    ("England",      "ENG", "Europe"),
    ("France",       "FRA", "Europe"),
    ("Ireland",      "IRE", "Europe"),
    ("Scotland",     "SCO", "Europe"),
    ("Wales",        "WAL", "Europe"),
    ("Italy",        "ITA", "Europe"),
    ("New Zealand",  "NZL", "Rest of World"),
    ("South Africa", "RSA", "Rest of World"),
    ("Australia",    "AUS", "Rest of World"),
    ("Argentina",    "ARG", "Rest of World"),
    ("Japan",        "JPN", "Rest of World"),
    ("Fiji",         "FIJ", "Rest of World"),
]

# Position groups (six) and how many of each a placeholder squad carries.
# Sums to 33 — a realistic tournament squad (matchday 23 = 15 + 8 bench).
POSITION_GROUPS = ["FR", "SR", "BR", "HB", "CE", "B3"]
GROUP_LABEL = {
    "FR": "Front Row", "SR": "Second Row", "BR": "Back Row",
    "HB": "Half Back", "CE": "Centre", "B3": "Back Three",
}
SQUAD_COMPOSITION = {"FR": 6, "SR": 4, "BR": 6, "HB": 5, "CE": 5, "B3": 7}


def build_placeholder() -> list:
    """A full, structurally-correct pool with placeholder names. Names are
    obvious stand-ins ("England Front Row 1") to be replaced by the real
    rosters via the DS-API once available."""
    players = []
    for name, code, _pool in TEAMS:
        number = 0
        for group in POSITION_GROUPS:
            for i in range(1, SQUAD_COMPOSITION[group] + 1):
                number += 1
                players.append(
                    {
                        "player_id": f"{code.lower()}_{number}",
                        "name": f"{name} {GROUP_LABEL[group]} {i}",
                        "position": group,
                        "team": name,
                        "team_code": code,
                    }
                )
    return players


def fetch_from_ds_api() -> list:
    """Pull the real rosters from the Draft Sport API.

    Maps each DS-API player listing to {player_id, name, position, team,
    team_code}. The DS-API position string is normalised to one of the six
    groups via POSITION_FROM_DS. TODO: confirm the DS-API endpoint path and
    field names against the draft-sport client library, and the host is
    reachable (it is blocked by the network policy in some environments)."""
    import requests  # local import so --placeholder needs no dependency

    key = os.environ.get("DRAFT_SPORT_KEY")
    if not key:
        sys.exit("Error: DRAFT_SPORT_KEY not set (needed for the live DS-API "
                 "pull). Use --placeholder for an offline pool.")
    raise SystemExit(
        "Live DS-API pull is not wired yet: confirm the endpoint/field names "
        "against the draft-sport client library, then implement the mapping "
        "here. Run with --placeholder in the meantime."
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--placeholder", action="store_true",
        help="Generate an offline placeholder pool (no network/DS-API).",
    )
    args = parser.parse_args()

    players = build_placeholder() if args.placeholder else fetch_from_ds_api()

    teams = sorted({p["team_code"] for p in players})
    print(f"{len(players)} players across {len(teams)} teams")
    for code in teams:
        n = sum(1 for p in players if p["team_code"] == code)
        print(f"  {code}: {n} players")

    PLAYERS_JSON.write_text(
        json.dumps(players, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"Wrote {PLAYERS_JSON}")


if __name__ == "__main__":
    main()
