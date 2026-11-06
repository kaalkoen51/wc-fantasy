"""Compare a competition's STORED fixtures with what API-Football says now.

Read-only: one GET to Supabase for the pool row, one to API-Football for the
season's fixtures. Writes nothing.

Why. "There is a game on now and the app says every game is tomorrow at 5pm."
Nothing re-reads a football competition's fixture list once its pool is
loaded, and Premier League kick-off times are provisional -- every match
listed at 15:00 UK on the Saturday (17:00 in South Africa) -- until the TV
picks move them, weeks after a pool loaded in August. This prints both
versions of the days around now, side by side, so the theory is checked
rather than assumed.
"""

import argparse
import os
import sys
from datetime import datetime, timedelta, timezone

import requests

API = "https://v3.football.api-sports.io"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--key", default="39-2026", help="competition_key of the pool")
    ap.add_argument("--days", type=int, default=4, help="days either side of now")
    a = ap.parse_args()
    league, season = (int(x) for x in a.key.split("-"))
    now = datetime.now(timezone.utc)
    lo, hi = now - timedelta(days=a.days), now + timedelta(days=a.days)

    url, svc = os.environ["SUPABASE_URL"].rstrip("/"), os.environ["SUPABASE_SERVICE_KEY"]
    r = requests.get(f"{url}/rest/v1/competition_pools",
                     params={"competition_key": f"eq.{a.key}",
                             "select": "competition_key,updated_at,fixtures"},
                     headers={"apikey": svc, "Authorization": f"Bearer {svc}"}, timeout=30)
    r.raise_for_status()
    rows = r.json()
    if not rows:
        sys.exit(f"No pool stored for {a.key}.")
    stored = rows[0].get("fixtures") or []
    print(f"Pool {a.key}: {len(stored)} fixtures stored, pool last written {rows[0].get('updated_at')}")

    r = requests.get(f"{API}/fixtures", params={"league": league, "season": season},
                     headers={"x-apisports-key": os.environ["API_FOOTBALL_KEY"]}, timeout=30)
    r.raise_for_status()
    live = {f["fixture"]["id"]: f for f in r.json().get("response", [])}
    print(f"API-Football now: {len(live)} fixtures\n")

    def when(s):
        try:
            return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        except ValueError:
            return None

    near = [f for f in stored if (w := when(f.get("kickoff_utc"))) and lo <= w <= hi]
    near_ids = {f.get("fixture_id") for f in near}
    near += [{"fixture_id": i, "home": f["teams"]["home"]["name"], "away": f["teams"]["away"]["name"],
              "kickoff_utc": None, "status": None}
             for i, f in live.items()
             if i not in near_ids and (w := when(f["fixture"]["date"])) and lo <= w <= hi]
    moved = 0
    print(f"{'match':42} {'stored kick-off (UTC)':26} {'API now (UTC)':26} status s/a")
    for f in sorted(near, key=lambda f: str(f.get("kickoff_utc") or "")):
        api = live.get(f.get("fixture_id"))
        api_ko = api["fixture"]["date"] if api else "(not in API)"
        same = when(f.get("kickoff_utc")) == when(api_ko) if api else False
        moved += 0 if same else 1
        print(f"{(f.get('home','?') + ' v ' + f.get('away','?'))[:42]:42} "
              f"{str(f.get('kickoff_utc'))[:25]:26} {str(api_ko)[:25]:26} "
              f"{f.get('status')}/{api['fixture']['status']['short'] if api else '-'}"
              f"{'' if same else '   <-- differs'}")
    total_moved = sum(1 for f in stored if (api := live.get(f.get("fixture_id")))
                      and when(f.get("kickoff_utc")) != when(api["fixture"]["date"]))
    print(f"\n{moved} of the {len(near)} matches above differ; "
          f"{total_moved} of {len(stored)} across the whole stored season.")


if __name__ == "__main__":
    main()
