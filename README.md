# Rugby Nations Fantasy

A live snake-draft fantasy app for the **2026 Nations Championship** — the
same engine as our soccer World Cup draft, ported to rugby. It's a single
web page (`index.html`) backed by Supabase, plus GitHub Actions that pull
match stats and score everyone's players.

The 12 nations, two pools of six:

| Europe | Rest of World |
| --- | --- |
| England, France, Ireland, Scotland, Wales, Italy | New Zealand, South Africa, Australia, Argentina, Japan, Fiji |

Each Europe side plays each Rest-of-World side once (three fixtures in the
July window, three in November), then a finals weekend.

---

## ⚠️ Status: working first iteration — two things to finish

This is a complete, test-passing port. Two items depend on external access
that isn't available yet and are clearly marked in the code:

1. **Live stats source (Draft Sport API).** Stats are meant to come from
   [draftrugby.com](https://draftrugby.com)'s Draft Sport API (DS-API). The
   scoring engine, the player-id matcher and the Supabase upsert are all
   built and tested; the **fetch layer is the documented adapter to repoint
   at the DS-API** (`fetch_fixtures` / `fetch_fixture_players` in
   `daily_pull.py`, and `providerGet` in `index.html`). Field names are
   marked `TODO: confirm vs source`. Some networks block the DS-API host, so
   wire and test it where that host is reachable.

2. **Squads are a placeholder.** The 2026 squads aren't published until the
   July window, so `players.json` ships a structurally-correct placeholder
   (12 unions × 33, correct position groups, placeholder names like
   "England Front Row 1"). Regenerate it from the real rosters with
   `python build_players.py` once the DS-API is wired, or hand-edit
   `players.json`.

Until then you can still run a full **test draft** and manual scoring (the
admin **Match stats** form), and all logic/tests run offline.

**Scoring values** mirror Draft Rugby's published system; the exact point
numbers are flagged `TODO: confirm vs source` in `SCORING`
(`daily_pull.py` + `index.html`) — verify them against draftrugby.com and
adjust the one table.

---

## What's here

| File | Purpose |
| --- | --- |
| `index.html` | The app: lobby, live snake draft, leaderboard, player stats, admin stats entry |
| `players.json` | Draft pool: 12 squads (placeholder until real rosters land) |
| `schema.sql` | Supabase schema (idempotent — safe to re-run anytime) |
| `daily_pull.py` | Daily stats pull → rugby fantasy points → `match_stats` upsert |
| `live_pull.py` | In-match live scoring loop (5-min updates while games are on) |
| `build_players.py` | Regenerates `players.json` (DS-API, or `--placeholder` offline) |
| `build_fixtures.py` | Generates `fixtures.json` (DS-API, or `--placeholder` offline) |
| `build_schedule.py` | Regenerates `live-pull.yml` cron triggers from `fixtures.json` |
| `build_injuries.py` / `build_photos.py` | Optional availability badges / avatars |
| `.github/workflows/*` | Daily/catch-up/live pulls + injuries/photos |
| `test_logic.js` | Smoke tests for draft order + rugby scoring (`node test_logic.js`) |
| `test_daily_pull.py` | Tests for the id mapping + rugby scoring (`python -m unittest test_daily_pull`) |

Scoring lives in one place each — `SCORING` in `daily_pull.py`, mirrored by
`SCORING` in `index.html` — kept in sync by hand. The test suites assert the
two stay in step.

---

## Positions

Six groups map to the starting XV (plus a `TEAM` pick for stage bonuses):

| Code | Group | Jerseys |
| --- | --- | --- |
| `FR` | Front Row | 1, 2, 3 |
| `SR` | Second Row | 4, 5 |
| `BR` | Back Row | 6, 7, 8 |
| `HB` | Half Backs | 9, 10 |
| `CE` | Centres | 12, 13 |
| `B3` | Back Three | 11, 14, 15 |

**Draft squad (phase 1):** 22 picks — a starting XV plus a 6-man bench plus
one nation:

- Quota: `FR 4 · SR 3 · BR 4 · HB 3 · CE 3 · B3 4 · TEAM 1`
- Starters (the XV): `FR 3 · SR 2 · BR 3 · HB 2 · CE 2 · B3 3`; the rest are subs.

A sub only scores in a round where its starter didn't feature. Quotas are
easy to tune in `PHASE1_QUOTA` / `PHASE1_STARTERS` (`index.html`).

## Scoring

Mirrors Draft Rugby's model (one `SCORING` table, flagged for final
confirmation against the source):

| Action | Points |
| --- | --- |
| Try | +10 |
| Try assist | +4 |
| Conversion | +2 |
| Penalty goal / drop goal | +3 |
| Tackle | +1 · Missed tackle −1 |
| Defender beaten / clean break | +2 |
| Offload | +1 |
| Turnover won | +5 · Turnover conceded −2 |
| Penalty conceded | −2 |
| Yellow card −3 · Red card −8 | |
| Metres made | 1 pt per X metres, by position (FR 4 · SR 2 · BR 8 · backs 10) |
| Bonuses | 100+ m **+3** · 15+ tackles **+2** · 3+ turnovers won **+2** |
| Top-rated player (per match) | +5 |

**TEAM pick** earns cumulative stage bonuses: reaching the **final +15**,
winning the **title +20**. In the final phase, surviving managers predict
the champion for **+5**.

---

## Setup guide

### 1. Supabase
New project → **SQL Editor** → paste `schema.sql` → run. It's idempotent.
Note your **Project URL**, **anon key** (used by the app) and
**service_role key** (used only by the daily pull).

### 2. Host the app
Push to GitHub, then **Settings → Pages → Deploy from a branch** (root). The
app loads at `https://<user>.github.io/<repo>/`. Locally: `python -m
http.server` then open `http://localhost:8000` (it needs HTTP to load
`players.json`).

### 3. First-run config
On first open the app asks for the Supabase **URL** and **anon key** (stored
in that browser's localStorage). The anon key is meant to be public.

### 4. Stats automation
`daily_pull.py` runs every morning via the workflow: fetches yesterday's
completed fixtures, scores them, upserts to `match_stats`. Repo secrets:

| Secret | Value |
| --- | --- |
| `DRAFT_SPORT_KEY` | your Draft Sport API key (once the DS-API is wired) |
| `SUPABASE_URL` | project URL |
| `SUPABASE_SERVICE_KEY` | **service_role** key |
| `FANTASY_LEAGUE_ID` | your league's `leagues.id` uuid (comma-separate several to automate multiple leagues) |

Live in-match scoring (`live_pull.py`) uses the same secrets and is driven
by per-kickoff triggers generated from `fixtures.json` by
`build_schedule.py`. Three layers guarantee nothing is missed: live
triggers, a same-day catch-up sweep, and the morning daily sweep — every
pull is a full idempotent upsert.

### 5. Create your league & draft
Open the app → **Create a league** (name, managers, seconds/pick) → save the
invite code + admin token. Everyone joins; admin hits **Start draft**.
Random snake order, 22 rounds; on your turn you draft any position you still
need. After the draft, set your lineup (the XV) via **Home → Pick my team**;
lineups lock when the admin closes the trading window, so each round scores
against the lineup that was locked at the time.

### 6. Admin (Admin tab → unlock with the admin token)
- **Pull stats now** — fetch a date's completed matches straight from the
  provider (once the DS-API is wired) and write everyone's stats.
- **Match stats** — enter/edit per-player rugby stat rows by hand (works
  today, no API needed). Match label format: `Home vs Away (YYYY-MM-DD)`.
- **Team stages** — set each nation's progress (pool → final → winner) for
  TEAM-pick bonuses; mark teams **out** when eliminated.
- **Trading window & lineup locks** — open between rounds, close before
  kickoff to snapshot lineups.
- **Redrafts & final phase** — as the field narrows, run redrafts with
  smaller, admin-chosen squads; before the final, switch to champion picks.

---

## Regenerating data

```bash
pip install -r requirements.txt

python build_players.py --placeholder     # offline placeholder squads
python build_players.py                    # real squads (needs DS-API wired + DRAFT_SPORT_KEY)
python build_fixtures.py --placeholder     # offline cross-pool schedule
python build_schedule.py                   # refresh live-pull cron triggers from fixtures.json
```

Player ids are `<code>_<number>` (e.g. `eng_10`); TEAM picks use
`team:<Nation>`. Re-run `schema.sql` (always additive) after pulling repo
updates.

## Tests

```bash
node test_logic.js                 # draft order, quotas, rugby scoring, subs, trades, redrafts
python -m unittest test_daily_pull # id mapping, rugby scoring, multi-league fan-out, graceful degradation
```

Both assert the JS and Python `SCORING` tables agree — change one, change
both, and the tests will catch drift.

---

This is a casual app for a friend group: one shared Supabase project with
open RLS policies. Right for people you know, not strangers — for those,
fork the repo for a fully isolated instance.
