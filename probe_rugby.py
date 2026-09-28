"""Ask the rugby feed what it actually returns for a competition's fixtures.

Read-only. Writes nothing, anywhere, and needs no key -- the feed is open.

Why this exists. A URC league showed its next round as 19 December at the end
of September. app.js already carries a comment describing that exact symptom
("a hundred rows reaches only as far back as December") and a fix for it: ask
for 400 matches instead of 100. Whether that fix works depends on something
nobody has checked -- whether the feed honours `size` above 100 at all, or
quietly caps it and answers newest-first either way. The container this app is
developed in cannot reach the feed, so the question goes to a GitHub runner,
which can.

Four questions, each printed with the evidence rather than a verdict:

  1. Does `size` do anything past 100? Same query at 100, 400 and 1000.
  2. Does any paging parameter move the window? `page` 0/1/2 and 1/2/3, and
     `offset`, compared by the match ids they return.
  3. Does the body say anything about paging (totals, page counts, cursors)?
  4. For the season window the app computes, which rounds are present, when
     each one starts, and how many matches the app's own "settled" filter
     would drop (TBC teams, tbc flag).
"""

import argparse
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone

import requests

BASE = "https://rugby-union-feeds.incrowdsports.com/v1/"


def ask(path, **params):
    params["provider"] = "rugbyviz"
    r = requests.get(BASE + path, params=params, timeout=30)
    print(f"  GET {r.url} -> {r.status_code}, {len(r.content)} bytes")
    try:
        return r.json()
    except ValueError:
        print("  (not JSON)", r.text[:300])
        return None


def rows_of(body):
    """The match list, wherever this response keeps it (mirrors firstArray)."""
    if isinstance(body, list):
        return body
    if isinstance(body, dict):
        for k in ("data", "matches"):
            v = body.get(k)
            if isinstance(v, list):
                return v
            if isinstance(v, dict):
                for kk in ("data", "matches"):
                    if isinstance(v.get(kk), list):
                        return v[kk]
    return []


def meta_of(body):
    """Everything in the body that is not the match list itself."""
    if not isinstance(body, dict):
        return {}
    out = {}
    for k, v in body.items():
        if isinstance(v, list):
            out[k] = f"<list of {len(v)}>"
        elif isinstance(v, dict):
            out[k] = {kk: (f"<list of {len(vv)}>" if isinstance(vv, list) else vv)
                      for kk, vv in v.items()}
        else:
            out[k] = v
    return out


def span(rows):
    ds = sorted(str(m.get("date") or "") for m in rows if m.get("date"))
    return (ds[0], ds[-1]) if ds else ("-", "-")


def team_known(t):
    return bool(t) and str(t.get("id", "0")).lstrip("-").isdigit() \
        and int(t.get("id") or 0) > 0 and bool(t.get("name")) \
        and str(t.get("name")).upper() != "TBC"


def settled(m):
    return str(m.get("tbc")) != "1" and team_known(m.get("homeTeam")) \
        and team_known(m.get("awayTeam"))


def summarise(label, body):
    rows = rows_of(body)
    lo, hi = span(rows)
    ids = [str(m.get("id")) for m in rows]
    print(f"  {label}: {len(rows)} rows, dates {lo} .. {hi}")
    return rows, ids


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--competition", default="United Rugby Championship")
    ap.add_argument("--season", type=int, default=2026,
                    help="season START year, as the league stores it")
    ap.add_argument("--kind", default="league", choices=["league", "cup"])
    a = ap.parse_args()
    now = datetime.now(timezone.utc)
    print(f"Probing {a.competition!r}, season {a.season} ({a.kind}), now {now:%Y-%m-%d %H:%M}Z\n")

    # 1 · size
    print("1 · Does `size` do anything past 100?")
    by_size = {}
    for size in (100, 400, 1000):
        body = ask("matches/search", competitionName=a.competition, size=size)
        rows, ids = summarise(f"size={size}", body)
        by_size[size] = (rows, set(ids))
    n100, n400 = len(by_size[100][0]), len(by_size[400][0])
    print(f"  -> size=400 returned {n400} rows vs {n100} at size=100\n")

    # 2 · paging
    print("2 · Does any paging parameter move the window?")
    first = by_size[100][1]
    for name, values in (("page", (0, 1, 2)), ("page", (1, 2, 3)),
                         ("offset", (100, 200)), ("from", (100,)), ("start", (100,))):
        for v in values:
            body = ask("matches/search", competitionName=a.competition, size=100, **{name: v})
            rows, ids = summarise(f"{name}={v}", body)
            new = len(set(ids) - first)
            print(f"     {new} of {len(ids)} ids not in the size=100 answer")
    print()

    # 3 · metadata
    print("3 · What else is in the body?")
    body = ask("matches/search", competitionName=a.competition, size=100)
    print("  " + json.dumps(meta_of(body), default=str, indent=2).replace("\n", "\n  "))
    print()

    # 4 · the season the app would compute from the biggest answer
    print("4 · The season window the app computes, from the largest answer above")
    rows = max((by_size[s][0] for s in by_size), key=len)
    y = a.season
    lo = datetime(y, 1 if a.kind == "cup" else 7, 1, tzinfo=timezone.utc)
    hi = datetime(y + 1, 1 if a.kind == "cup" else 7, 1, tzinfo=timezone.utc)

    def when(m):
        try:
            return datetime.fromisoformat(str(m.get("date")).replace("Z", "+00:00"))
        except ValueError:
            return None

    season = [m for m in rows if (w := when(m)) and lo <= w < hi]
    kept = [m for m in season if settled(m)]
    print(f"  window {lo:%Y-%m-%d} .. {hi:%Y-%m-%d}: {len(season)} matches, "
          f"{len(kept)} survive the settled filter "
          f"({len(season) - len(kept)} dropped as TBC)")
    status = Counter(str(m.get("status")) for m in season)
    print(f"  statuses: {dict(status)}")
    rounds = defaultdict(list)
    for m in kept:
        rounds[str(m.get("round") if m.get("round") not in (None, "") else m.get("title"))].append(m)

    def rkey(r):
        return (0, int(r)) if r.isdigit() else (1, r)
    print("  round : matches, first kickoff (settled matches only)")
    for r in sorted(rounds, key=rkey):
        ms = rounds[r]
        first_ko = min(str(m.get("date")) for m in ms)
        print(f"   {r:>5} : {len(ms):>2}  {first_ko}")
    upcoming = sorted((when(m), m) for m in kept if when(m) and when(m) > now)
    if upcoming:
        w, m = upcoming[0]
        print(f"\n  -> next settled match after now: round {m.get('round')} at {w:%Y-%m-%d %H:%M}Z")
    dropped_soon = sorted((when(m), m) for m in season
                          if not settled(m) and when(m) and when(m) > now)[:5]
    for w, m in dropped_soon:
        print(f"  dropped (TBC) {w:%Y-%m-%d}: round {m.get('round')} "
              f"{(m.get('homeTeam') or {}).get('name')} v {(m.get('awayTeam') or {}).get('name')} "
              f"tbc={m.get('tbc')}")


if __name__ == "__main__":
    sys.exit(main())
