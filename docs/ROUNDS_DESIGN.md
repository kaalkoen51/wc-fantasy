# Rounds: record at decision time, don't re-derive

**Status:** Phases 0, 1 and 1.5 shipped. Phases 2–3 planned, each its own
reviewed step. See [Progress log](#progress-log) at the bottom for where each
phase stands and what the database still needs.

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

**Two things fall back to it, not one.** A `rounds` row is keyed by
`(league_id, round_no)`, so a round whose label carries no matchweek number
cannot be recorded — and every knockout label is one ("Round of 16", "Final";
the World Cup calendar is six in a row). The first cut treated "no number" as
"nothing to settle", which would have silently stopped waivers resolving for
the whole knockout stage of the app's flagship competition — bug row 6 of the
table above, reintroduced. `advanceRound()` now distinguishes them: `"no-table"`
(unmigrated) and `"no-round"` (unnumbered) both hand off to the legacy path.
The fallback resolves waivers and repairs the winners' line-ups — exactly the
pre-Phase-1 behaviour — but not the ritual's league-wide line-up repair. That
gap is bounded and documented rather than silent. Phase 1.5 below closes it:
with a text key every round is recordable, so the knockout fallback now only
serves databases behind on migrations.

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

### Phase 1.5 — the round KEY is the label, and snapshots carry it ✅

Two gaps that only became visible once Phase 1 was built.

**The key was a number, and not every round has one.** `rounds.round_no` is
`mwNo()` — the matchweek parsed out of the round label. Every knockout label
returns null from it ("Round of 16", "Quarter-finals", "Final"), and so does
`daily_pull.py`'s identical regex, and so does `buildFixtureStatRows` ("Cups
get null — their round labels are names, not numbers"). The whole rework was
therefore numbered-matchweek-shaped: for the World Cup knockout stage — six
consecutive rounds, the half of the tournament anyone cares about — Phase 0
stamped null, Phase 1 could not claim a row, and everything ran on the
inference fallbacks. Phase 2's acceptance criterion (deleting those fallbacks)
was unreachable by construction.

The key is now the competition's own round label, verbatim: `rounds.round_key`,
with `round_no` demoted to display and ordering. Principle #1 applied honestly
— stamp what the writer knew, rather than parsing it down to a representation
some competitions cannot express. The old `(league_id, round_no)` unique stays
in place: nulls are distinct in Postgres so it no longer blocks knockout rows,
while it still stops a pre-1.5 client settling a numbered round twice. Legacy
rows are deliberately **not** backfilled — `"4"` is not the key, it is a
different fact, and inventing one would be the re-derivation this design exists
to stop.

**Phase 2's left operand did not exist.** `settledPoints` is defined below as
"round snapshot × round-stamped stats". Phase 0 built the stats half. The
snapshot half was never built — Phase 1 deliberately declined to snapshot at
the lock, correctly. What stood in for it was `rosterAtFor()`'s three layers of
timestamp fallback, kept honest by `restampPlan()`, which recovers *which round
a snapshot was for* by nearest-gap matching:

```js
const gap = Math.abs(l - at);
if (gap < bestGap) { bestGap = gap; best = l; }
```

That is the pattern in the table at the top of this document, still running.
`snapshotForNextLock()` computes the lock from `matchweeksOf()` and therefore
knows the round exactly; it stored a timestamp and discarded it.

`lineup_snapshots.round_key` now records it (`roundKeyLockedAt()`), and
`rosterAtFor()` takes a round key and answers from the stamp when one matches,
falling back to today's timestamp logic otherwise. A reschedule can no longer
move which round a line-up applies to — the property `restampSnapshots()`
currently maintains by hand.

Two things deliberately left alone:

- **`pinHistory()` stays unstamped.** It is a mid-round safety net taken at
  `now`, not a record of a round's line-up. Matches earlier in the same round
  were played against the *lock* snapshot, so keying the pin to that round
  would hand those matches the post-pin squad. It belongs on the timestamp
  path — which is where Phase 2 deletes it from anyway.
- **Nothing is deleted yet.** `restampPlan`/`restampSnapshots` still run. Their
  replacement is now in place but not yet proven across a full season, and the
  invariant below is explicit that the deletion list is Phase 2's acceptance
  criterion, not a side effect of building the replacement.

### Phase 2 — settled/live scoring split

**2a — the boundary, shipped ✅**

`computeScores()` now returns `settledTotal` / `liveTotal` beside `total`. A
round is settled when a `rounds` row says so (`isRoundSettled()`) — the
recorded answer, never a guess from the clock. Everything else is LIVE, which
is the safe direction: a live round is recomputed every render, so misfiling a
settled round as live costs a little work and changes no number, while the
reverse would freeze a round still in motion.

The point of this step is that it moves **no** number. `settled + live` is the
player score exactly, in every settlement state, and the tests pin that: a
worked example holds `total = 8` while settled goes 0 → 4 → 8 as rounds are
recorded. A split that changed a total would not be a split; it would be a
second, disagreeing scoring engine.

TEAM points stay live for a real reason rather than a technical one: a stage
bonus keeps moving as the tournament advances, long after any matchweek is
done. Points from a label with no resolvable round stay live too — they are
never inside a settled round, so they can never be frozen.

**2b — the round key on stat rows, shipped ✅ (the third writer)**

2b turned out to be blocked the same way Phase 2 was: `settledPoints` is meant
to need no fixture list, but a stat row only carried `round` — the label parsed
to an int, null for every knockout round. The key existed on `rounds` and on
`lineup_snapshots` after Phase 1.5; the third writer never got it.

`match_stats.round_key` / `competition_stats.round_key` now carry the label
verbatim, stamped by all three writers exactly as Phase 0 stamped the number:
`buildFixtureStatRows`, `daily_pull.py` (with `round_key` in OPTIONAL_COLUMNS),
and the test bench. `roundResolvers().roundKeyOf()` prefers what the row
recorded over anything derived from today's fixtures, so a settled round
survives a reschedule and a knockout round can be settled at all — the tests
score one with `S.fixtures` empty.

**2c — cache the settled side, then delete (next)**

The settled half is now identifiable without the clock or the calendar, but it
is still recomputed on every render. Caching it per round is what makes the
"no `Date.now()`" claim structural rather than incidental. Only two
`Date.now()` calls remain anywhere in scoring, both in the snapshot-fallback
last resort (`rosterAtFor`, `snapIndexAt`) — both on the deletion list below.

**2c — the deletions, once 2b is proven**

Delete `pinHistory()` (6 references), the forward-stamp restamping
(`restampPlan`/`restampSnapshots`, 6), and the snapshot-fallback guards; then
`fa_processed_until` (14). **Nothing is deleted before its replacement is
proven** — the deletion list is the acceptance criterion of this phase, not a
side effect.

### Phase 3 (optional) — retire label parsing

`match_label` ("Home vs Away (date)") is today's de-facto match key, parsed by
regex in ~43 places. Identity becomes `(round_no, home, away)` or the API
fixture id; the label stays as an opaque display/storage string. Big, low
urgency once rounds are first-class.

## Invariants to hold at every phase

- The full unit suite passes unchanged, or the change to
  a test is itself reviewed (a test that encodes the old wrong behaviour gets
  rewritten, never silently bent).
- Legacy World Cup leagues (count-based rounds, no API matchweek) keep working
  through the fallback branches.
- Unapplied migrations degrade to prior behaviour (strippable columns in the
  app, OPTIONAL_COLUMNS in the pullers) — never to an error, never to a
  different wrong answer.
- The sandbox (`sim`) write-confinement and its build-time guards stay intact.

## Verification checklist per phase

1. Full unit suite. (There is no browser harness — see the progress log.)
2. The specific historical bugs re-run as scenarios (transfer, blank, double,
   reschedule, lineup-edit-after-round) — they exist as tests already; they
   must pass through the *new* path (assert the recorded value is used, not
   just that the answer is right).
3. `npm run build:css` clean, `node build.js` clean, sim guards bite.
4. A hand test in the bench: play two weeks, transfer, reschedule (rebuild
   calendar), edit a lineup — totals for played rounds must not move.

## Progress log

Kept here rather than in commit messages so the current state of the rework is
readable in one place.

| | |
|---|---|
| ✅ | **Phase 0** — every stat row stamped with its matchweek at write time |
| ✅ | **Phase 1** — settlement is a recorded, CAS-claimed transition (`rounds` + `advanceRound()`): waivers → line-up repair → settled, exactly once, any client may race |
| ✅ | **The `schema.sql` re-run trap closed** — re-runs can never again undo the RLS lockdown |
| ✅ | **Knockout fallback** — a window closing into an unnumbered round settles through the legacy path instead of being dropped |
| ✅ | **Phase 1.5** — the round key is the label, so cups are recordable; line-up snapshots carry the round they were for |
| ◐ | **Phase 2a/2b** — the settled/live boundary ✅ and the round key on stat rows ✅; 2c (cache, then delete) remains |
| ⬜ | **Phase 3** (optional) — retire label parsing |

### Database steps for Phase 1 — in order, the middle one is not optional

1. Run the new `schema.sql` (adds `rounds` and the Phase 1.5 `round_key`
   columns, closes the re-run trap). Additive and idempotent — safe to re-run
   as each phase lands, which is the whole point of the trap being closed.
2. **Re-run `rls.sql`.** If `schema.sql` was re-run at any point after the
   lockdown — it was, twice, for `window_key` and for the round columns — every
   table has been silently open to the anon key since. This closes it. The file
   is idempotent by design.
3. Re-run the three-row verification. All three must be ✅, especially
   *"wide-open policies: none left"*.

That ordering is safe permanently from here: a `schema.sql` re-run can no
longer reopen a locked database.

> The verification query itself lives only in the chat that produced it. It
> belongs in `rls.sql` next to the section 8 checklist — worth committing so it
> survives the conversation.

### Due-diligence tally, Phase 1

- One critical latent hole found and closed: the lockdown-undo. The app kept
  working and the dashboard kept listing policies throughout, which is what
  made it the worst kind of regression.
- One broken fix caught by its own test before shipping: `to_regproc` does not
  accept a signature, `to_regprocedure` does — the first guard silently never
  fired and resurrected the very trap it existed to close.
- One regression caught in review after the phase was verified: `"no round
  number"` conflated with `"no settlement owed"`, which would have taken out
  automatic waiver resolution across the entire knockout stage. The lesson is
  the general one — a null returned for two different reasons needs two
  different answers.
- The legacy waiver path kept verbatim as the fallback. Nothing deleted ahead
  of its replacement being proven; the deletion list is Phase 2's acceptance
  criterion, not a side effect.
- One bug found by the hand test in the bench (verification step 4), not by
  the suite: `managerHistory()` built its list of rounds from `periodDates`,
  which was only populated for matches where *that* manager had a player with
  a stat row. A manager whose whole squad had a blank week got no round entry
  at all — no pager, stuck on "season to date" while everyone else advanced.
  Bug row 3's exact shape: the set of rounds re-derived from one manager's
  scoring activity instead of from what the league played.
- 670 unit tests green, and the settlement path verified by hand in the bench:
  build a calendar on `transfers`, queue waiver claims, move to `lineup` — the
  claims resolve and the round records as settled.

That hand test took five attempts, and the reason is worth keeping: **every
failure on the way was invisible.** `advanceRound()` returned a bare `false`
from every path except success, so "the database refused the insert", "this
league is on manual windows" and "nothing is due" were indistinguishable from
each other and from the transition never having run. A phase whose entire
premise is that settlement should be a visible, recorded event had no way to
say why it had not happened. It now records the reason and the bench prints it.

The lesson generalises past this phase: a transition that can decline needs to
say so. Silence is the one outcome that cannot be debugged.

### Still open

- ~~Only the most recent closed window settles.~~ ✅ Fixed. `advanceRound()`
  now works through `roundsOwedSettlement()`, oldest first, claiming each round
  as its own row. Bounded deliberately: the newest closed round is always
  eligible, older ones only once something later has been recorded — so a first
  run against a season already under way still settles one round, honouring
  Phase 1's decision not to backfill, while a league nobody opened for a
  fortnight catches up in full. Waivers resolve only on the newest round:
  `fa_claims` carry no window and are cleared when one reopens, so anything
  pending belongs to the newest closed window, never to a round being caught
  up on.
- **The "browser suites" do not exist.** Phase 1's commit message claims
  "eleven suites green" and the checklist above names "all browser harness
  suites", but the whole git history contains three test artifacts —
  `test_logic.js`, `test_daily_pull.py`, `backtest.py`. No harness, no
  Playwright/Puppeteer/vitest, nothing in CI. Those runs were hand walkthroughs
  in the bench, described as suites and never committed. Either build the
  harness or stop citing it; a verification step that cannot be performed is
  worse than no step at all.

### Phase 1.5 addendum

Found while sizing Phase 2, and both are the same lesson as the six bugs in the
table at the top: a fact was parsed down to a representation that could not
hold it (`round_no`), and a fact the writer knew was discarded and guessed back
later (which round a snapshot was for). Neither was a bug you could see from
the app — the fallbacks covered them, which is exactly why they survived three
phases of review.

Phase 2 is the payoff phase: scoring splits into **settled** (a pure read of
recorded rounds — immune to edits and reschedules by construction) and
**live**, after which three compensating mechanisms come *out* rather than
going in. Its first task is to prove the Phase 1.5 stamp across a full season
in the bench, because the deletion list depends on it.
