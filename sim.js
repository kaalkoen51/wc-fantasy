"use strict";
/* ============================================================================
 * TEST BENCH — play a season without waiting for real football.
 *
 * A nav tab of its own, offered only to an APP_OWNER_EMAILS account. Build a
 * fixture calendar over the league's real squads, jump to any stage of the
 * matchday cycle, play weeks, and — when a generated season is too blunt an
 * instrument — write individual fixtures and individual stat lines by hand.
 *
 * WHO CAN SEE IT: the tab is only offered to a product-owner account. That is a
 * UI gate, not enforcement — until RLS is applied the anon key can be driven
 * directly, so treat it as "kept out of the way", not "locked".
 *
 * WHAT ACTUALLY PROTECTS REAL DATA is the sandbox rule, which holds regardless
 * of who reaches this code:
 *
 *   1. Every write is refused unless the league is flagged `sim`.
 *   2. A sandbox league keeps its results in its OWN match_stats rows.
 *      statsScope() in app.js routes it away from competition_stats, which is
 *      shared by every league on that competition — writing invented results
 *      there would corrupt live leagues.
 *   3. The fixture calendar is in-memory plus localStorage. Nothing about it is
 *      ever written to the database, so the real fixture list is untouched.
 *
 * Squads are READ from the real competition pool and never written, so a test
 * league exercises the same code path a real one does.
 * ==========================================================================*/

const SIM_KEY = () => "wcf_sim_" + (S.league?.id || "none");
const SIM_TEAMS = 8;   // 8 clubs => 4 fixtures a normal matchweek

// Writes are allowed only into a sandbox league. Returns a reason, or null.
function simSafe() {
  if (!S.league) return "Open a league first.";
  if (!simLeague())
    return "This is a real league. Turn on sandbox mode first — it keeps every "
         + "invented result in this league's own rows, away from shared data.";
  return null;
}

/* ---------- fixture calendar ----------
   Dates are generated RELATIVE TO NOW so that "now" lands inside the stage you
   asked for. That exercises the real window logic (which compares wall-clock
   time against kickoffs) without threading a fake clock through the app. */
const H = 3600e3, DAY = 24 * H, WEEK = 7 * DAY;

/* Each stage puts "now" at a different point in the matchday cycle. The blurb
   is what the tab shows, so the button says what it will actually do rather
   than making you remember. */
const SIM_STAGES = {
  results:   { nextFirst: +5 * DAY,  prevLast: -0.5 * H,
               blurb: "Games just finished. No window open yet." },
  transfers: { nextFirst: +5 * DAY,  prevLast: -3 * H,
               blurb: "Trading AND line-ups both open." },
  lineup:    { nextFirst: +6 * H,    prevLast: -4 * DAY,
               blurb: "Trading shut, team selection still open." },
  locked:    { nextFirst: +0.5 * H,  prevLast: -4 * DAY,
               blurb: "Inside the lock, just before kick-off." },
  live:      { nextFirst: -0.5 * H,  prevLast: -4 * DAY,
               blurb: "A game in progress right now." },
};

/* One matchweek's pairings. `quirk` bends the week out of shape the way a real
   season does, so the matchweek code is tested against more than the easy case:
     blank  — the first two clubs have no fixture at all
     double — the first club plays a second game later that week
   Everything downstream keys off the round number, never a count of games, so
   these are exactly the shapes that used to break it. */
function simWeekPairs(teams, w, quirk) {
  const pairs = [];
  for (let i = 0; i < teams.length / 2; i++) {
    const home = teams[(w + i) % teams.length];
    const away = teams[(teams.length - 1 - i + w) % teams.length];
    if (home !== away) pairs.push([home, away]);
  }
  if (quirk === "blank")
    return pairs.filter(([h, a]) => ![h, a].some((t) => t === teams[0] || t === teams[1]));
  if (quirk === "double") return [...pairs, [teams[0], teams[teams.length - 1]]];
  return pairs;
}

function simCalendar(stage, weeks, quirks) {
  const teams = (S.teams || []).slice(0, SIM_TEAMS);
  if (teams.length < 4) return [];
  const off = SIM_STAGES[stage] || SIM_STAGES.transfers;
  const upcoming = Math.max(1, Math.floor(weeks / 2));   // played weeks behind us
  const fixtures = [];
  for (let w = 0; w < weeks; w++) {
    // A blank and a double are placed in already-played weeks, so their effect
    // on scoring and auto-subs is visible immediately rather than pending.
    const quirk = !quirks ? null
      : w === Math.max(0, upcoming - 2) ? "blank"
      : w === Math.max(0, upcoming - 1) ? "double" : null;
    const base = w === upcoming ? Date.now() + off.nextFirst
      : w === upcoming - 1 ? Date.now() + off.prevLast - 2 * H
      : Date.now() + off.nextFirst + (w - upcoming) * WEEK;
    simWeekPairs(teams, w, quirk).forEach(([home, away], i) => {
      // Spread kickoffs across the matchday; the last one defines the window.
      const kick = w === upcoming - 1 ? base + i * 40 * 60e3 : base + i * 2 * H;
      const past = kick < Date.now();
      fixtures.push({
        home, away, kickoff_utc: new Date(kick).toISOString(),
        date: new Date(kick).toISOString().slice(0, 10),
        status: stage === "live" && w === upcoming && i === 0 ? "1H" : past ? "FT" : "NS",
        round: `Regular Season - ${w + 1}`,
        home_score: past ? (i % 3) : null, away_score: past ? ((i + 1) % 2) : null,
      });
    });
  }
  return fixtures;
}

/* The calendar is saved as the FIXTURE LIST, not as the parameters that made
   it. Saving the parameters meant a hand-added or hand-edited fixture was
   silently discarded on the next reload, which defeats the point of being able
   to write one. The stage is kept alongside only so the UI can show it. */
function simSave(stage) {
  localStorage.setItem(SIM_KEY(), JSON.stringify({ stage, fixtures: S.fixtures || [] }));
}

async function simApply(stage, weeks, quirks) {
  const bad = simSafe(); if (bad) return simToast(bad);
  const fx = simCalendar(stage, weeks, quirks);
  if (!fx.length) return simToast("No squads loaded yet — wait for the pool, then retry.");
  S.fixtures = fx;
  simSave(stage);
  // Auto-windows are part of what we're testing; make sure they're on.
  const cfg = { ...(S.league.config || {}), autoWindows: true };
  S.league.config = cfg;
  /* Awaited. The refetch below re-reads the league row, so a config write still
     in flight would be read back at its OLD value -- and settlement gives up
     immediately on a league it thinks is on manual windows. */
  await S.sb.from("leagues").update({ config: cfg }).eq("id", S.league.id)
    .then(() => {}, () => {});
  /* Every recorded settlement refers to dates that no longer exist. A round
     settles ONCE, so leaving those rows behind is what made the bench look
     broken: the first pass through the stages settled rounds 3 and 4, and every
     later pass -- with claims queued this time -- found them already recorded
     and correctly stood down. Nothing announced that, so it read as "waivers
     never resolve". Regenerating the calendar drops them with it. */
  // Awaited, not fired and forgotten: the refetch below re-reads `rounds`, and
  // reading them back before the delete lands would stand the ritual down again.
  await S.sb.from("rounds").delete().eq("league_id", S.league.id).then(() => {}, () => {});
  /* And the RESULTS of that calendar, which is the same trap one table over.

     A match_label carries the kickoff date, and every calendar is generated
     relative to now — so the moment you pick a different stage, every row from
     the previous pass is keyed to a match that no longer exists. Nothing
     overwrites it (the upsert key includes the label), nothing can reach it,
     and nothing was deleting it. They accumulated: three weeks played under
     "transfers", three more under "lineup", and a player's card showed each
     match twice with the season's points doubled.

     Only the orphans go. A row that still belongs to a fixture in the new
     calendar is a result of a match that is still in the season, and
     simCatchUpPast below will leave it alone. Read from the database rather
     than S.stats: this runs before the refetch, so the in-memory copy may not
     be what is actually stored. */
  const keep = new Set(fx.map(simLabel));
  const { data: had } = await S.sb.from("match_stats")
    .select("match_label").eq("league_id", S.league.id)
    .then((r) => r, () => ({ data: [] }));
  const orphans = [...new Set((had || []).map((r) => r.match_label))]
    .filter((l) => !keep.has(l));
  // In batches: the labels go into the query string, and a long-running bench
  // league accumulates a calendar's worth of them every time the stage moves.
  for (let i = 0; i < orphans.length; i += 50)
    await S.sb.from("match_stats").delete().eq("league_id", S.league.id)
      .in("match_label", orphans.slice(i, i + 50)).then(() => {}, () => {});
  /* The line-up snapshots STAY, and the reasoning that briefly deleted them
     here was wrong in a way worth recording.

     It ran "results belong to the old calendar, so the pins must too". They do
     not. A snapshot says which players a manager held at a moment in time —
     a fact about the manager, not about the fixture list. Moving the calendar
     changes when the matches are; it does not change who was in the squad.

     And deleting them is not neutral, because pinHistory's snapshot is the
     ONLY thing standing between a played round and rosterAtFor's live-roster
     fallback. Wiping it meant the next transfer rewrote every round already
     played — a player signed after round 3 appeared in round 1 — which is
     precisely the bug pinning exists to prevent, reintroduced by the cleanup
     that was supposed to make the bench tidier. */
  const wk = [...new Set(fx.map((f) => f.round))].length;
  // Say what was thrown away. A silent delete is how the last version of this
  // problem went unnoticed for as long as it did.
  simToast(`${fx.length} fixtures over ${wk} weeks · ${stage}${quirks ? " · blank + double" : ""}${
    orphans.length ? ` · dropped ${orphans.length} match${orphans.length === 1 ? "" : "es"} from the old calendar` : ""}`);
  /* Play the weeks it just put BEHIND you, so the season the results describe
     is the season the calendar describes. Without this the stage is a claim
     about the fixture list alone, and Play week spends three clicks catching
     up to it while settlement talks about a round with no scores. */
  const caught = await simCatchUpPast();
  /* A refetch, not a bare re-render. Moving the calendar is exactly what closes
     a trade window, and the settlement transition (advanceRound) hangs off
     refetchAll -- so re-rendering alone left the bench showing "window closed"
     while nothing had actually settled and waiver claims sat pending. */
  scheduleRefetch();
  renderTestTab();
  if (caught.length)
    simToast(`Played the ${caught.length} week${caught.length === 1 ? "" : "s"} now behind you: ${caught.join(", ")}.`);
}

// Re-apply the saved calendar after a reload, so a test season (including any
// fixture written by hand) survives a refresh without touching the database.
function simRestore() {
  try {
    const saved = JSON.parse(localStorage.getItem(SIM_KEY()) || "null");
    if (!saved || !simLeague()) return;
    if (Array.isArray(saved.fixtures) && saved.fixtures.length) S.fixtures = saved.fixtures;
    else if (saved.weeks) S.fixtures = simCalendar(saved.stage, saved.weeks, saved.quirks);
  } catch { /* ignore a corrupt entry */ }
}

const simStage = () => {
  try { return JSON.parse(localStorage.getItem(SIM_KEY()) || "null")?.stage || "transfers"; }
  catch { return "transfers"; }
};

/* ---------- results ---------- */

// Plausible-but-random match stats, weighted by position so forwards score and
// keepers make saves — enough for scoring, recaps and the H2H log to look real.
function simPlayerRow(p, team, label, clean, homeScore, awayScore, round, roundKey) {
  const r = (n) => Math.floor(Math.random() * n);
  const pos = p.position;
  const minutes = Math.random() < 0.15 ? r(60) : 90;
  const goals = pos === "FWD" ? (Math.random() < 0.35 ? 1 + r(2) : 0)
    : pos === "MID" ? (Math.random() < 0.18 ? 1 : 0)
    : pos === "DEF" ? (Math.random() < 0.06 ? 1 : 0) : 0;
  const assists = pos === "GK" ? 0 : (Math.random() < 0.18 ? 1 : 0);
  const saves = pos === "GK" ? 1 + r(5) : 0;
  const def = pos === "DEF" ? 2 + r(6) : pos === "MID" ? 1 + r(4) : r(2);
  const yellow = Math.random() < 0.12 ? 1 : 0;
  return simStatRow(p, team, label, {
    round, round_key: roundKey ?? null,
    minutes, goals, assists, saves, defensive_actions: def, yellow_cards: yellow,
    red_cards: Math.random() < 0.02 ? 1 : 0,
    clean_sheet: clean && minutes >= 60 && pos !== "FWD",
    home_score: homeScore, away_score: awayScore, rating: 6 + Math.random() * 3,
  });
}

/* One match_stats row. Shared by the random generator and the hand editor, so
   a row written by hand is shaped exactly like a pulled one -- including the
   flattened `raw` map the custom scoring rules read. */
function simStatRow(p, team, label, v) {
  const n = (x) => Number(x) || 0;
  const row = {
    league_id: S.league.id, player_id: p.player_id, match_label: label, team,
    // Same stamp the real pullers write: the matchweek this row belongs to.
    round: Number(v.round) || null,
    appeared: true,
    goals: n(v.goals), assists: n(v.assists),
    clean_sheet: !!v.clean_sheet,
    yellow_cards: n(v.yellow_cards), red_cards: n(v.red_cards),
    saves: n(v.saves), motm: !!v.motm,
    penalty_saved: n(v.penalty_saved), penalty_missed: n(v.penalty_missed),
    defensive_actions: n(v.defensive_actions),
    minutes: v.minutes == null ? 90 : n(v.minutes),
    home_score: v.home_score == null ? null : n(v.home_score),
    away_score: v.away_score == null ? null : n(v.away_score),
  };
  row.raw = {
    "goals.total": row.goals, "goals.assists": row.assists, "goals.saves": row.saves,
    "goals.conceded": n(v.conceded), "clean_sheet": row.clean_sheet ? 1 : 0,
    "cards.yellow": row.yellow_cards, "cards.red": row.red_cards,
    "penalty.saved": row.penalty_saved, "penalty.missed": row.penalty_missed,
    "defensive_actions": row.defensive_actions, "minutes": row.minutes,
    "motm": row.motm ? 1 : 0,
    "passes.total": n(v.passes), "passes.accuracy": n(v.accuracy),
    "shots.total": n(v.shots), "shots.on": n(v.shots_on),
    "rating": Number(v.rating) || 7,
  };
  return row;
}

const simLabel = (f) => `${f.home} vs ${f.away} (${f.date || String(f.kickoff_utc).slice(0, 10)})`;

/* What the settlement transition can see right now. The bench moves the
   calendar under the app, so "the window shut but nothing resolved" is the
   question it gets asked most -- and every answer so far has been invisible
   state (already recorded, no window closed yet, no claims pending). Put it on
   the card instead of leaving it to be inferred. */
function simSettlementNote() {
  if (typeof closedWindowRound !== "function") return "";
  const due = closedWindowRound(S.fixtures || [], Date.now(), cfgOf().windows || {});
  const pending = (S.faClaims || []).filter((c) => c.status === "pending").length;
  const claims = pending ? `${pending} claim${pending === 1 ? "" : "s"} pending` : "no claims pending";
  if (!due) return `Settlement: no trade window has closed yet — nothing due · ${claims}`;
  const rec = (S.rounds || []).find((r) =>
    (r.round_key != null && r.round_key === due.roundKey)
    || (r.round_key == null && due.roundNo != null && r.round_no === due.roundNo));
  /* When it is due and still unrecorded, the interesting question is not "has
     it run" but "what stopped it" -- advanceRound records that now. */
  const stalled = typeof advanceStalled === "string" && advanceStalled
    ? ` · <span class="text-wcred">stalled: ${esc(advanceStalled)}</span>` : "";
  const waiver = typeof faDeferToClose === "function" && !faDeferToClose()
    ? " · note: this league is not in waiver mode, so settling a round resolves no claims" : "";
  return `Settlement due for <b>${esc(due.roundKey)}</b> · ${
    rec ? `already recorded (${esc(rec.status)}) — it will not run again`
        : "not recorded yet — the next refresh runs it"} · ${claims}${stalled}${waiver}`;
}

// The calendar's matchweeks, earliest first, plus the labels already played.
function simWeeks() {
  const played = new Set((S.stats || []).map((r) => r.match_label));
  const weeks = {};
  for (const f of S.fixtures || []) (weeks[f.round] ||= []).push(f);
  const order = Object.keys(weeks).sort((a, b) =>
    Math.min(...weeks[a].map((f) => Date.parse(f.kickoff_utc)))
    - Math.min(...weeks[b].map((f) => Date.parse(f.kickoff_utc))));
  return { weeks, order, played };
}

// One matchweek's invented player rows, skipping fixtures already scored.
function simRoundRows(fixtures, played) {
  const rows = [];
  for (const f of fixtures) {
    const label = simLabel(f);
    if (played.has(label)) continue;
    const hs = f.home_score ?? Math.floor(Math.random() * 4);
    const as = f.away_score ?? Math.floor(Math.random() * 3);
    for (const team of [f.home, f.away]) {
      const clean = team === f.home ? as === 0 : hs === 0;
      // Whoever the pool currently says is at this club — so a simulated
      // transfer shows up in the next week's results, as it would for real.
      const squad = S.players.filter((p) => p.team === team).slice(0, 14);
      for (const p of squad)
        rows.push(simPlayerRow(p, team, label, clean, hs, as,
          Number(mwNo(f.round)), f.round == null ? null : String(f.round)));
    }
  }
  // Award the top-rated player in each match, like the real pull does.
  const best = {};
  for (const r of rows) {
    const k = r.match_label;
    if (!best[k] || r.raw.rating > best[k].raw.rating) best[k] = r;
  }
  for (const r of Object.values(best)) { r.motm = true; r.raw.motm = 1; }
  return rows;
}

const simWriteRows = (rows) => resilientWrite("match_stats", rows,
  { upsert: true, onConflict: "league_id,player_id,match_label" });

/* Give every matchweek the calendar has placed in the PAST its results.

   "Build a calendar" says it moves the dates so that now lands at the stage you
   pick -- but it only ever wrote FIXTURES, so the weeks it put behind you had
   no results, and "Play week" started at week 1 catching up on a season the
   calendar already claimed had happened. The two halves of the bench described
   different seasons, and settlement -- which follows the calendar -- then
   looked unrelated to the scores on screen. This makes them agree.

   No snapshots are written here. These weeks are being invented in bulk right
   now, so stamping CURRENT squads at old lock times is exactly the
   late-snapshot mistake ROUNDS_DESIGN.md exists to prevent. rosterAtFor falls
   back to today's picks, which for invented history is the honest answer. */
async function simCatchUpPast() {
  const { weeks, order, played } = simWeeks();
  const now = Date.now();
  const done = [];
  for (const rd of order) {
    // Every game in the week has kicked off, and something is still unscored.
    if (!weeks[rd].every((f) => Date.parse(f.kickoff_utc) < now)) continue;
    const rows = simRoundRows(weeks[rd], played);
    if (!rows.length) continue;
    await simWriteRows(rows);
    for (const f of weeks[rd]) played.add(simLabel(f));
    done.push(rd);
  }
  return done;
}

// Play the earliest matchweek that has kicked off but has no results yet.
async function simPlayWeek() {
  const bad = simSafe();
  if (bad) return simToast(bad);
  const { weeks, order, played } = simWeeks();
  const target = order.find((rd) => weeks[rd].some((f) => !played.has(simLabel(f))));
  if (!target) return simToast("Every matchweek already has results.");

  const rows = simRoundRows(weeks[target], played);
  if (!rows.length) return simToast("Nothing to play.");

  simToast(`Playing ${target} — ${rows.length} player rows…`);
  await simWriteRows(rows);
  await snapshotRosters().catch(() => {});
  S._recapChecked = false;   // let the round recap offer itself again
  scheduleRefetch();
  simToast(`${target} played.`);
}

/* Move a drafted player to another club, the way a January transfer would.
   Updates the pool in memory and the pick's club on the server, so the next
   week's results come from the new club while the earlier ones stay put. */
async function simTransfer(pid, toTeam) {
  const bad = simSafe();
  if (bad) return simToast(bad);
  const mine = (S.picks || []).filter((pk) => pk.slot !== "TEAM" && pk.player_id);
  if (!mine.length) return simToast("Draft some players first.");
  const pk = pid ? mine.find((x) => x.player_id === pid)
                 : mine[Math.floor(Math.random() * mine.length)];
  if (!pk) return simToast("That player is not on a roster.");
  const teams = (S.teams || []).slice(0, SIM_TEAMS).filter((t) => t !== pk.team);
  const to = toTeam || teams[Math.floor(Math.random() * teams.length)];
  if (!to) return simToast("Need at least two clubs.");
  const p = S.playerById?.[pk.player_id];
  if (p) p.team = to;
  await S.sb.from("picks").update({ team: to }).eq("id", pk.id);
  scheduleRefetch();
  simToast(`${pk.player_name}: ${pk.team} → ${to}. Play a week to see it apply.`);
}

async function simClear() {
  const bad = simSafe();
  if (bad) return simToast(bad);
  if (!confirm("Delete every result, snapshot, transaction and waiver claim in this sandbox league? Invented data only.")) return;
  await S.sb.from("match_stats").delete().eq("league_id", S.league.id);
  await S.sb.from("lineup_snapshots").delete().eq("league_id", S.league.id);
  /* Transactions and claims too. They are what the per-window free-agent cap
     counts, so leaving them behind means a freshly cleared league still says
     you have used your transfers. */
  await S.sb.from("transactions").delete().eq("league_id", S.league.id).then(() => {}, () => {});
  await S.sb.from("fa_claims").delete().eq("league_id", S.league.id).then(() => {}, () => {});
  /* Settled-round records as well. A round only settles once, so leaving these
     behind means a cleared league replays the same matchweek with settlement
     already marked done -- the ritual stands down and the waiver claims made on
     the re-run never resolve. Same trap as the transactions above. */
  await S.sb.from("rounds").delete().eq("league_id", S.league.id).then(() => {}, () => {});
  localStorage.removeItem("wcf_recap_" + S.league.id);
  S._recapChecked = false;
  scheduleRefetch();
  simToast("Results cleared.");
}

// Flag this league as a sandbox. Everything else refuses to write until it is.
async function simEnable(on) {
  if (!S.league) return simToast("Open a league first.");
  if (!isAppOwner()) return simToast("Not a product-owner account.");
  const { error } = await S.sb.from("leagues").update({ sim: on }).eq("id", S.league.id);
  if (error) {
    if (/restricted to product owners/.test(error.message))
      return simToast("Your account is not in app_owners — see schema.sql.");
    return simToast(/'sim' column/.test(error.message) ? "Run schema.sql first." : error.message);
  }
  S.league.sim = on;
  if (!on) localStorage.removeItem(SIM_KEY());
  scheduleRefetch();
  renderTestTab();
  simToast(on ? "Sandbox on — invented results stay in this league." : "Sandbox off.");
}

/* ---------- hand-written fixtures ---------- */

// Add one fixture to a round. Kickoff is given as days from now, so "-2" is a
// game already played and "3" is one still to come — which is the axis that
// actually matters when testing windows.
function simAddFixture({ round, home, away, daysFromNow, status, hs, as }) {
  const bad = simSafe(); if (bad) return simToast(bad);
  if (!home || !away || home === away) return simToast("Pick two different clubs.");
  const rnd = Math.max(1, Number(round) || 1);
  const at = Date.now() + (Number(daysFromNow) || 0) * DAY;
  const iso = new Date(at).toISOString();
  const played = status === "FT";
  S.fixtures = [...(S.fixtures || []), {
    home, away, kickoff_utc: iso, date: iso.slice(0, 10),
    status: status || (at < Date.now() ? "FT" : "NS"),
    round: `Regular Season - ${rnd}`,
    home_score: played ? (Number(hs) || 0) : null,
    away_score: played ? (Number(as) || 0) : null,
  }].sort((a, b) => Date.parse(a.kickoff_utc) - Date.parse(b.kickoff_utc));
  simSave(simStage());
  scheduleRefetch(); renderTestTab();     // a new fixture can close a window too
  simToast(`Added ${home} v ${away} to round ${rnd}.`);
}

function simRemoveFixture(label) {
  const bad = simSafe(); if (bad) return simToast(bad);
  S.fixtures = (S.fixtures || []).filter((f) => simLabel(f) !== label);
  simSave(simStage());
  scheduleRefetch(); renderTestTab();     // ...and removing one can open one
  simToast("Fixture removed. Its results, if any, are still there — use Clear to drop them.");
}

/* ---------- hand-written stat lines ---------- */

/* Write one player's line for one match. This is the instrument for testing a
   specific thing -- a keeper's clean sheet, a hat-trick, a red card, a blank --
   rather than playing a whole random week and hoping it comes up. */
async function simSetStat(pid, label, values) {
  const bad = simSafe(); if (bad) return simToast(bad);
  const p = S.playerById?.[pid];
  if (!p) return simToast("Unknown player.");
  const fx = (S.fixtures || []).find((f) => simLabel(f) === label);
  if (!fx) return simToast("Pick a fixture that exists.");
  const team = [fx.home, fx.away].includes(p.team) ? p.team : fx.home;
  const row = simStatRow(p, team, label, {
    ...values, round: Number(mwNo(fx.round)) || null,
    home_score: fx.home_score, away_score: fx.away_score,
  });
  await resilientWrite("match_stats", [row],
    { upsert: true, onConflict: "league_id,player_id,match_label" });
  scheduleRefetch();
  simToast(`${p.name}: ${row.goals}G ${row.assists}A ${row.minutes}' in ${label}.`);
}

/* ---------- the tab ---------- */

function simToast(msg) {
  const el = document.getElementById("sim-log");
  if (el) el.textContent = msg;
}

const simCard = (title, help, body) => `
  <div class="rounded-xl border border-slate-700 bg-slate-900 p-4 space-y-2">
    <div class="text-sm font-semibold">${title}</div>
    ${help ? `<p class="text-xs text-slate-400">${help}</p>` : ""}
    ${body}
  </div>`;

const simOpts = (list, sel) => list.map((t) =>
  `<option value="${esc(t)}"${t === sel ? " selected" : ""}>${esc(t)}</option>`).join("");

/* Where each played round's line-up actually comes from.
 *
 * Read-only, and it changes nothing. It exists because three fixes for "a
 * player I transferred in is showing in rounds played before I signed him"
 * were built on reproductions in the test bench and a theory about which
 * snapshot had gone wrong -- without ever establishing what was true in the
 * league that had the fault. This says so directly: for every round with
 * results, which rule answered, and which row it answered with.
 *
 * The arm is reported BY rosterAtFor as it decides, not worked out again
 * here. A second copy of those rules is the bug this app keeps producing.
 */
function simHistorySource() {
  const me = typeof myManager === "function" ? myManager() : null;
  if (!me) return "";
  const snaps = (S.snapshots || []).filter((s) => s.manager_id === me.id);
  const txs = (S.transactions || []).filter((x) => x.manager_id === me.id);
  const labels = [...new Set((S.stats || []).map((r) => r.match_label))]
    .filter((l) => labelDate(l));
  // One entry per round, using the round's earliest match -- the same label
  // the scoring pass resolves first.
  const byRound = new Map();
  for (const label of labels) {
    const key = roundKeyOfLabel(label);
    if (!key) continue;
    const t = matchTimeFor(label);
    if (!isFinite(t)) continue;
    if (!byRound.has(key) || t < byRound.get(key).t) byRound.set(key, { t, label });
  }
  const order = [...byRound.entries()].sort((a, b) => a[1].t - b[1].t);

  const RECORD = ["the round's own line-up", "a line-up set in an earlier round"];
  const rows = order.map(([key, { t, label }]) => {
    const why = {};
    rosterAtFor(me.id, t, labelDate(label), null, key, why);
    const solid = RECORD.includes(why.arm);
    const eff = why.snap?.effective_from;
    return `<div class="flex items-start gap-2 py-1 border-t border-slate-800 text-xs">
      <span class="w-20 shrink-0 font-semibold ${solid ? "text-emerald-400" : "text-amber-400"}">${esc(roundLabelShort(key) || key)}</span>
      <span class="flex-1 min-w-0">
        <span class="${solid ? "text-slate-300" : "text-amber-300"}">${esc(why.arm || "—")}</span>
        ${eff ? `<span class="block text-slate-500 truncate">${esc(String(eff).slice(0, 16).replace("T", " "))}${
          why.snap.round_key ? ` · stamped ${esc(roundLabelShort(why.snap.round_key) || why.snap.round_key)}` : " · no round stamp"}</span>` : ""}
      </span>
    </div>`;
  }).join("");

  const guessed = order.filter(([key, { t, label }]) => {
    const why = {};
    rosterAtFor(me.id, t, labelDate(label), null, key, why);
    return !RECORD.includes(why.arm);
  }).length;

  return simCard("🔎 Where each round's line-up comes from",
    "Green means the round has a record of its own and nothing can move it. Amber means it is being inferred — from a timestamp, from the oldest row there is, or from your squad as it stands right now, which is what puts a new signing into old rounds.",
    `<div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
       <span><b class="text-slate-200">${snaps.length}</b> snapshot${snaps.length === 1 ? "" : "s"} for you</span>
       <span><b class="text-slate-200">${txs.length}</b> logged move${txs.length === 1 ? "" : "s"}</span>
       <span><b class="${guessed ? "text-amber-400" : "text-emerald-400"}">${guessed}</b> of ${order.length} round${order.length === 1 ? "" : "s"} inferred</span>
     </div>
     ${order.length ? rows : '<p class="text-xs text-slate-500">No rounds with results yet.</p>'}`);
}

/* What the stored pool says about this league's squads, pulling nothing.

   The refresh log reports what a pull CHANGED; this reports what the data
   says now. That is the question when a refresh looks like it did nothing --
   is the player still in the pool, and at which club -- and without it the
   only way to tell a pull that failed from a feed that has not moved is to
   guess. Read-only: it issues no request and writes nothing. */
function simSquadCheck() {
  const chk = squadCheck(S.picks, S.playerById);
  const age = leagueCompetition() ? poolAge(S._compPool?.updated_at, Date.now()) : null;
  const row = (cls, a, b) => `<div class="flex items-baseline gap-2 py-1 border-t border-slate-800 text-xs">
      <span class="min-w-0 flex-1 truncate text-slate-300">${esc(a)}</span>
      <span class="shrink-0 ${cls}">${esc(b)}</span></div>`;
  const clean = !chk.gone.length && !chk.moved.length;
  return simCard("🔎 What the squad list actually says",
    "Read straight from the stored pool — nothing is pulled and nothing is written. "
    + "If a transfer has happened and this still shows the old club, the pool has not been "
    + "refreshed; if it shows the new one and the app does not, the problem is downstream.",
    `<div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
       <span><b class="text-slate-200">${esc(competitionKey() || "no competition")}</b></span>
       <span><b class="text-slate-200">${(S.players || []).length}</b> in the pool</span>
       <span><b class="text-slate-200">${chk.total}</b> drafted</span>
     </div>
     ${age ? `<p class="text-xs ${age.stale ? "text-amber-300" : "text-slate-400"}">${esc(age.text)}</p>` : ""}
     ${chk.gone.length ? `<div><p class="text-xs font-semibold text-red-300 pt-1">${
        chk.gone.length} not in the pool at all — ✈ LEFT, cannot score again</p>${
        chk.gone.map((g) => row("text-red-300", g.name, `was ${g.team}`)).join("")}</div>` : ""}
     ${chk.moved.length ? `<div><p class="text-xs font-semibold text-amber-300 pt-1">${
        chk.moved.length} whose pick disagrees with the pool</p>${
        chk.moved.map((m) => row("text-amber-300", m.name, `${m.from} → ${m.to}`)).join("")}</div>` : ""}
     ${clean ? '<p class="text-xs text-emerald-400 pt-1">Every drafted player is in the pool, at the club his pick says. The pool and the app agree.</p>' : ""}
     <div class="pt-1 border-t border-slate-800">
       <input id="sim-pool-find" placeholder="Look a player up in the pool…"
         class="w-full rounded bg-slate-800 border border-slate-700 px-2 py-1.5 text-xs">
       <div id="sim-pool-hits" class="text-xs"></div>
     </div>`);
}

// Name lookup against the pool, so "where does it think Rodri is" is one box.
function simPoolFind(q) {
  const out = document.getElementById("sim-pool-hits");
  if (!out) return;
  const t = String(q || "").trim().toLowerCase();
  if (t.length < 2) { out.innerHTML = ""; return; }
  const owner = {};
  for (const pk of (S.picks || [])) if (pk.player_id) owner[pk.player_id] = pk;
  const hits = (S.players || []).filter((p) => String(p.name || "").toLowerCase().includes(t));
  out.innerHTML = hits.length
    ? hits.slice(0, 12).map((p) => {
        const pk = owner[p.player_id];
        return `<div class="flex items-baseline gap-2 py-1 border-t border-slate-800">
          <span class="min-w-0 flex-1 truncate text-slate-300">${esc(p.name)}</span>
          <span class="shrink-0 text-slate-400">${esc(p.position)} · ${esc(p.team)}</span>
          <span class="shrink-0 ${pk ? "text-wcgold" : "text-slate-500"}">${
            pk ? esc((S.managers || []).find((m) => m.id === pk.manager_id)?.name || "owned") : "free"}</span>
        </div>`; }).join("")
      + (hits.length > 12 ? `<p class="text-slate-500 pt-1">…and ${hits.length - 12} more</p>` : "")
    /* Nobody by that name IS the answer when you are checking a transfer: he
       is not in any squad in this competition any more. */
    : `<p class="text-red-300 pt-1">Nobody in the pool matches “${esc(q)}”. If he used to be
        here, the pull says he has left the competition.</p>`;
}

function renderTestTab() {
  const box = document.getElementById("board-test");
  const navBtn = document.getElementById("nav-test");
  if (navBtn) navBtn.classList.toggle("hidden", !isAppOwner());
  /* Five buttons in a four-column grid wrapped onto a second row, costing about
     55px of every screen for the account that uses the app most. */
  document.getElementById("nav-row")?.classList.toggle("nav-5", isAppOwner());
  if (!box || !isAppOwner()) return;

  const on = simLeague();
  const teams = (S.teams || []).slice(0, SIM_TEAMS);
  const rounds = {};
  for (const f of S.fixtures || []) (rounds[f.round] ||= []).push(f);
  const roundKeys = Object.keys(rounds).sort((a, b) => (Number(mwNo(a)) || 0) - (Number(mwNo(b)) || 0));
  const played = new Set((S.stats || []).map((r) => r.match_label));
  const squad = (S.picks || []).filter((pk) => pk.slot !== "TEAM" && pk.player_id);

  box.innerHTML = `
    ${simCard("🧪 Sandbox",
      on ? "This league is a sandbox. Invented results are written to its own rows and never reach the shared competition data every other league reads."
         : "Nothing below will write anything until this is on. It is what keeps invented results out of the data other leagues read.",
      `<div class="flex items-center justify-between gap-2">
         <span class="text-sm ${on ? "text-emerald-400" : "text-slate-400"}">${on ? "● sandbox league" : "○ real league — writes refused"}</span>
         <button id="sim-enable" class="rounded-lg px-3 py-1.5 text-xs font-semibold ${on ? "bg-slate-800 border border-slate-700" : "bg-wcred"}">${on ? "Turn off" : "Turn on"}</button>
       </div>`)}

    ${simSquadCheck()}

    ${simCard("📅 Build a calendar",
      "Generates a whole season over this league's clubs, moves the dates so <b>now</b> lands at the stage you pick, and plays every week that leaves behind you — so the results agree with the calendar instead of trailing it. <b>Play week</b> then plays the next one forward.",
      `<div class="flex items-center gap-2 text-xs">
         <label class="text-slate-400">Weeks
           <input id="sim-weeks" type="number" min="2" max="20" value="6"
             class="ml-1 w-14 rounded bg-slate-800 border border-slate-700 px-2 py-1"></label>
         <label class="flex items-center gap-1 text-slate-300">
           <input id="sim-quirks" type="checkbox" checked class="rounded border-slate-600 bg-slate-800">
           include a blank &amp; a double week</label>
       </div>
       <p class="text-xs text-slate-500">A blank week gives a club no fixture; a double gives one two games. Both are shapes that have broken round numbering before.</p>
       <p class="text-xs text-slate-400 border-t border-slate-800 pt-2">${simSettlementNote()}</p>
       <div class="space-y-1">
         ${Object.entries(SIM_STAGES).map(([k, v]) => `
           <button data-stage="${k}" class="w-full text-left rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2">
             <span class="text-xs font-semibold text-wcgold">${k}</span>
             <span class="block text-xs text-slate-400">${v.blurb}</span>
           </button>`).join("")}
       </div>`)}

    ${simCard("⚽ Fixtures by hand",
      "Add a single game to a round when a generated season is too blunt. Kick-off is <b>days from now</b>, so a negative number is a game already played.",
      `<div class="grid grid-cols-2 gap-1.5 text-xs">
         <label class="text-slate-400">Round<input id="sim-fx-round" type="number" min="1" value="1" class="mt-0.5 w-full rounded bg-slate-800 border border-slate-700 px-2 py-1"></label>
         <label class="text-slate-400">Days from now<input id="sim-fx-days" type="number" value="-1" class="mt-0.5 w-full rounded bg-slate-800 border border-slate-700 px-2 py-1"></label>
         <label class="text-slate-400">Home<select id="sim-fx-home" class="mt-0.5 w-full rounded bg-slate-800 border border-slate-700 px-2 py-1">${simOpts(teams, teams[0])}</select></label>
         <label class="text-slate-400">Away<select id="sim-fx-away" class="mt-0.5 w-full rounded bg-slate-800 border border-slate-700 px-2 py-1">${simOpts(teams, teams[1])}</select></label>
         <label class="text-slate-400">Status<select id="sim-fx-status" class="mt-0.5 w-full rounded bg-slate-800 border border-slate-700 px-2 py-1">
           <option value="FT">FT — played</option><option value="NS">NS — to come</option><option value="1H">1H — in progress</option></select></label>
         <label class="text-slate-400">Score<span class="mt-0.5 flex gap-1">
           <input id="sim-fx-hs" type="number" min="0" value="1" class="w-full rounded bg-slate-800 border border-slate-700 px-2 py-1">
           <input id="sim-fx-as" type="number" min="0" value="0" class="w-full rounded bg-slate-800 border border-slate-700 px-2 py-1"></span></label>
       </div>
       <button id="sim-fx-add" class="w-full rounded-lg bg-slate-800 border border-wcgold/60 text-wcgold py-2 text-xs font-semibold">Add fixture</button>
       ${roundKeys.length ? `<div class="pt-1 space-y-1">${roundKeys.map((rk) => `
         <div class="rounded-lg bg-slate-800/40 px-2 py-1.5">
           <div class="eyebrow mb-1">${esc(rk)} · ${rounds[rk].length} game${rounds[rk].length === 1 ? "" : "s"}</div>
           ${rounds[rk].map((f) => `<div class="flex items-center gap-1.5 text-xs py-0.5">
             <span class="flex-1 min-w-0 truncate">${esc(f.home)} v ${esc(f.away)}
               <span class="text-slate-500">${f.status}${f.home_score != null ? ` ${f.home_score}-${f.away_score}` : ""}</span></span>
             ${played.has(simLabel(f)) ? '<span class="text-[10px] text-emerald-400">scored</span>' : ""}
             <button data-rmfx="${esc(simLabel(f))}" class="tap shrink-0 text-slate-400">✕</button>
           </div>`).join("")}
         </div>`).join("")}</div>` : '<p class="text-xs text-slate-500">No fixtures yet.</p>'}`)}

    ${simCard("📊 One player's stat line",
      "Write exactly what a player did in one match — a clean sheet, a hat-trick, a red card, a blank — instead of playing a random week and hoping it comes up.",
      `<div class="grid grid-cols-2 gap-1.5 text-xs">
         <label class="col-span-2 text-slate-400">Player<select id="sim-st-player" class="mt-0.5 w-full rounded bg-slate-800 border border-slate-700 px-2 py-1">
           ${squad.map((pk) => `<option value="${esc(pk.player_id)}">${esc(pk.player_name)} · ${esc(pk.position)} · ${esc(pk.team)}</option>`).join("")}
         </select></label>
         <label class="col-span-2 text-slate-400">Match<select id="sim-st-match" class="mt-0.5 w-full rounded bg-slate-800 border border-slate-700 px-2 py-1">
           ${(S.fixtures || []).map((f) => `<option value="${esc(simLabel(f))}">${esc(simLabel(f))}</option>`).join("")}
         </select></label>
         <label class="text-slate-400">Minutes<input id="sim-st-min" type="number" min="0" max="120" value="90" class="mt-0.5 w-full rounded bg-slate-800 border border-slate-700 px-2 py-1"></label>
         <label class="text-slate-400">Goals<input id="sim-st-g" type="number" min="0" value="0" class="mt-0.5 w-full rounded bg-slate-800 border border-slate-700 px-2 py-1"></label>
         <label class="text-slate-400">Assists<input id="sim-st-a" type="number" min="0" value="0" class="mt-0.5 w-full rounded bg-slate-800 border border-slate-700 px-2 py-1"></label>
         <label class="text-slate-400">Saves<input id="sim-st-s" type="number" min="0" value="0" class="mt-0.5 w-full rounded bg-slate-800 border border-slate-700 px-2 py-1"></label>
         <label class="text-slate-400">Def. actions<input id="sim-st-d" type="number" min="0" value="0" class="mt-0.5 w-full rounded bg-slate-800 border border-slate-700 px-2 py-1"></label>
         <label class="text-slate-400">Yellow / Red<span class="mt-0.5 flex gap-1">
           <input id="sim-st-y" type="number" min="0" max="2" value="0" class="w-full rounded bg-slate-800 border border-slate-700 px-2 py-1">
           <input id="sim-st-r" type="number" min="0" max="1" value="0" class="w-full rounded bg-slate-800 border border-slate-700 px-2 py-1"></span></label>
         <label class="flex items-center gap-1 text-slate-300"><input id="sim-st-cs" type="checkbox" class="rounded border-slate-600 bg-slate-800"> clean sheet</label>
         <label class="flex items-center gap-1 text-slate-300"><input id="sim-st-motm" type="checkbox" class="rounded border-slate-600 bg-slate-800"> top-rated</label>
       </div>
       <button id="sim-st-save" class="w-full rounded-lg bg-slate-800 border border-wcgold/60 text-wcgold py-2 text-xs font-semibold">Write this line</button>`)}

    ${simCard("▶️ Run",
      "Play the earliest week that has kicked off and has no results. Transfer moves a drafted player to another club, the way a January move would.",
      `<div class="grid grid-cols-3 gap-1.5">
         <button id="sim-play" class="rounded-lg bg-wcred py-2 text-xs font-semibold">Play week</button>
         <button id="sim-xfer" class="rounded-lg bg-slate-800 border border-slate-700 py-2 text-xs font-semibold">Transfer</button>
         <button id="sim-clear" class="rounded-lg bg-slate-800 border border-wcred/60 text-wcred py-2 text-xs font-semibold">Clear results</button>
       </div>`)}

    ${simHistorySource()}

    <p id="sim-log" class="text-xs text-slate-400 min-h-[1.5em] px-1"></p>`;

  const val = (id) => document.getElementById(id)?.value;
  const num = (id) => Number(val(id)) || 0;
  const chk = (id) => document.getElementById(id)?.checked === true;
  const weeks = () => Math.max(2, Math.min(20, Number(val("sim-weeks")) || 6));

  document.getElementById("sim-enable").onclick = () =>
    simEnable(!simLeague()).catch((e) => simToast(e.message));
  box.querySelectorAll("[data-stage]").forEach((b) => b.onclick = () =>
    simApply(b.dataset.stage, weeks(), chk("sim-quirks")).catch((e) => simToast(e.message)));
  document.getElementById("sim-fx-add").onclick = () => simAddFixture({
    round: num("sim-fx-round"), home: val("sim-fx-home"), away: val("sim-fx-away"),
    daysFromNow: num("sim-fx-days"), status: val("sim-fx-status"),
    hs: num("sim-fx-hs"), as: num("sim-fx-as"),
  });
  box.querySelectorAll("[data-rmfx]").forEach((b) => b.onclick = () => simRemoveFixture(b.dataset.rmfx));
  const find = document.getElementById("sim-pool-find");
  if (find) find.oninput = () => simPoolFind(find.value);
  document.getElementById("sim-st-save").onclick = () =>
    simSetStat(val("sim-st-player"), val("sim-st-match"), {
      minutes: num("sim-st-min"), goals: num("sim-st-g"), assists: num("sim-st-a"),
      saves: num("sim-st-s"), defensive_actions: num("sim-st-d"),
      yellow_cards: num("sim-st-y"), red_cards: num("sim-st-r"),
      clean_sheet: chk("sim-st-cs"), motm: chk("sim-st-motm"),
    }).catch((e) => simToast(e.message));
  document.getElementById("sim-play").onclick = () => simPlayWeek().catch((e) => simToast(e.message));
  document.getElementById("sim-xfer").onclick = () => simTransfer().catch((e) => simToast(e.message));
  document.getElementById("sim-clear").onclick = () => simClear().catch((e) => simToast(e.message));
}

document.addEventListener("DOMContentLoaded", () => {
  // The nav button only appears once auth has resolved and says this is an
  // owner account; a slow session lookup would otherwise hide it on every load.
  const t = setInterval(() => {
    if (!isAppOwner()) return;
    const b = document.getElementById("nav-test");
    if (b) b.classList.remove("hidden");
    clearInterval(t);
  }, 1000);
  setTimeout(() => clearInterval(t), 30000);
  /* The sandbox calendar is restored AFTER the initial refetch, so the
     settlement hook has already run against the wrong fixture list by now.
     Re-run it against the real one rather than only repainting. */
  setTimeout(() => { if (S.league && simLeague()) { simRestore(); scheduleRefetch(); } }, 1500);
});
