# Rounds: record at decision time, don't re-derive

**Status:** Phases 0 and 1 shipped. Phases 2–3 planned, each its own reviewed step.

## Why this document exists

Six bugs in two weeks shared one root cause:

| Bug | What was re-derived, from what |
|---|---|
| Transferred player stopped scoring | round, from `pick.team` (which mutated) |
| Blank/double gameweeks mis-scored | round, by counting a club's fixtures |
| History pager stuck at round 1 | rounds, from snapshot cadence (which changed) |
| Lineup edit rescored played rounds | past roster, from live picks |
| FA cap "spent" in a fresh window | window, from fixture dates (which moved) |
| Waivers never resolved in auto leagues | "window closed" was a predicate no one acted on |

The pattern: **a value decided at a moment in time was recomputed later from
inputs that kept moving.** The codebase already contains five retrofits that
each record one such value after its bug shipped: forward-stamped
`lineup_snapshots`, `pinHistory()`, `match_stats.team`,
`transactions.window_key`, `leagues.fa_processed_until`. This design replaces
the pattern instead of adding a sixth patch.

## Principles

1. **Facts are stamped by the writer that knew.** Whoever writes a row knows
   which round/club/window it belongs to at that moment. Store it. Never ask
   "which round was that?" of today's fixture list.
2. **Transitions are events with effects, not predicates.** "The window
   closed" must be something that *happens* (and settles waivers, repairs
   line-ups, snapshots rosters) — not a boolean that flips silently as the
   clock passes a derived boundary. Derived predicates remain fine for
   *display*.
3. **Settled is immutable.** Once a round is settled, no lineup edit,
   transfer, reschedule or pool refresh may move its numbers — structurally,
   not via compensating writes.

## Phases

### Phase 0 — stamp `round` on stat rows ✅ (this change)

`match_stats.round` / `competition_stats.round` (int, the competition's own
matchweek number). Stamped by all three writers, which already hold it:

- in-app pull: `buildFixtureStatRows` from `f.league.round`
- `daily_pull.py`: from `fixture["league"]["round"]`
- test bench: from the fixture the row is written against

Readers prefer the recorded round; every inference path stays as the fallback
for legacy rows and the World Cup pool (whose round labels are names, not
numbers). Additive + strippable/optional on both writers, so an unapplied
migration degrades to exactly today's behaviour.

**What this kills permanently for new data:** the transfer, blank-week and
double-week classes — the row itself says which round it was.

### Phase 1 — the `rounds` table and `advanceRound()` ✅

Shipped with three decisions the original sketch left open:

- **The table records settlement, not the display lifecycle.** Rows are
  claimed lazily (INSERT wins, unique key makes racers lose) by whichever
  client notices a window closed — no pre-creation writer, no backfill of old
  seasons. Persisted status is `settling → settled`; upcoming/open/locked/live
  stay derived, because for pure display derivation is correct.
- **The ritual does NOT snapshot every roster at the lock.** It usually runs
  late, and a late snapshot would stamp *current* squads at an old lock time —
  recreating the history-rewrite bug forward-stamping exists to prevent.
  Ritual = resolve waivers (already late-safe) → repair every line-up →
  mark settled.
- **`fa_processed_until` survives as the fallback** for databases without the
  rounds table, marked deprecated. Its deletion is Phase 2's acceptance
  criterion.

Also fixed here because Phase 1 touched it: re-running `schema.sql` used to
drop-and-recreate the "open access" policies, silently undoing an applied
`rls.sql` lockdown. The open-policy block now refuses to run once the lockdown
marker (`is_league_member`) exists — proven against real Postgres, including
the re-run.

Original sketch:

```
rounds: league_id (or competition_key) · round_no · opens_at · locks_at ·
        first_kickoff · last_kickoff · status
status: upcoming → open → locked → live → settled
```

Created/refreshed by the same paths that pull fixtures. Reschedules may only
touch rounds with status `upcoming`/`open`.

`advanceRound(league)`: idempotent, CAS-guarded on `rounds.status`. Moving
`open → locked` performs the settlement ritual **in order**: resolve waivers →
repair line-ups → snapshot every roster → mark settled. Any client, pg_cron or
an Action may call it; the CAS lets them race safely.
`leagues.fa_processed_until` and its bespoke CAS collapse into this.

### Phase 2 — settled/live scoring split

- `settledPoints`: pure read of recorded rounds (round snapshot ×
  round-stamped stats). No `Date.now()`, no fixture list. Cacheable.
- `livePoints`: current round only, recomputed as today.

Only after this is verified: delete `pinHistory()`, the forward-stamp
restamping (`restampPlan`/`restampSnapshots`), and the snapshot-fallback
guards. **Nothing is deleted before its replacement is proven** — the deletion
list is the acceptance criterion of this phase, not a side effect.

### Phase 3 (optional) — retire label parsing

`match_label` ("Home vs Away (date)") is today's de-facto match key, parsed by
regex in ~43 places. Identity becomes `(round_no, home, away)` or the API
fixture id; the label stays as an opaque display/storage string. Big, low
urgency once rounds are first-class.

## Invariants to hold at every phase

- All ~630 unit tests and every browser suite pass unchanged, or the change to
  a test is itself reviewed (a test that encodes the old wrong behaviour gets
  rewritten, never silently bent).
- Legacy World Cup leagues (count-based rounds, no API matchweek) keep working
  through the fallback branches.
- Unapplied migrations degrade to prior behaviour (strippable columns in the
  app, OPTIONAL_COLUMNS in the pullers) — never to an error, never to a
  different wrong answer.
- The sandbox (`sim`) write-confinement and its build-time guards stay intact.

## Verification checklist per phase

1. Full unit suite + all browser harness suites.
2. The specific historical bugs re-run as scenarios (transfer, blank, double,
   reschedule, lineup-edit-after-round) — they exist as tests already; they
   must pass through the *new* path (assert the recorded value is used, not
   just that the answer is right).
3. `npm run build:css` clean, `node build.js` clean, sim guards bite.
4. A hand test in the bench: play two weeks, transfer, reschedule (rebuild
   calendar), edit a lineup — totals for played rounds must not move.
