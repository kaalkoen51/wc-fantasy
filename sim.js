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

function simApply(stage, weeks, quirks) {
  const bad = simSafe(); if (bad) return simToast(bad);
  const fx = simCalendar(stage, weeks, quirks);
  if (!fx.length) return simToast("No squads loaded yet — wait for the pool, then retry.");
  S.fixtures = fx;
  simSave(stage);
  // Auto-windows are part of what we're testing; make sure they're on.
  const cfg = { ...(S.league.config || {}), autoWindows: true };
  S.league.config = cfg;
  S.sb.from("leagues").update({ config: cfg }).eq("id", S.league.id).then(() => {}, () => {});
  route();
  const wk = [...new Set(fx.map((f) => f.round))].length;
  simToast(`${fx.length} fixtures over ${wk} weeks · ${stage}${quirks ? " · blank + double" : ""}`);
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
function simPlayerRow(p, team, label, clean, homeScore, awayScore) {
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

// Play the earliest matchweek that has kicked off but has no results yet.
async function simPlayWeek() {
  const bad = simSafe();
  if (bad) return simToast(bad);
  const played = new Set((S.stats || []).map((r) => r.match_label));
  const weeks = {};
  for (const f of S.fixtures || []) (weeks[f.round] ||= []).push(f);
  const order = Object.keys(weeks).sort((a, b) =>
    Math.min(...weeks[a].map((f) => Date.parse(f.kickoff_utc)))
    - Math.min(...weeks[b].map((f) => Date.parse(f.kickoff_utc))));
  const target = order.find((rd) =>
    weeks[rd].some((f) => !played.has(simLabel(f))));
  if (!target) return simToast("Every matchweek already has results.");

  const rows = [];
  for (const f of weeks[target]) {
    const label = simLabel(f);
    if (played.has(label)) continue;
    const hs = f.home_score ?? Math.floor(Math.random() * 4);
    const as = f.away_score ?? Math.floor(Math.random() * 3);
    for (const team of [f.home, f.away]) {
      const clean = team === f.home ? as === 0 : hs === 0;
      // Whoever the pool currently says is at this club — so a simulated
      // transfer shows up in the next week's results, as it would for real.
      const squad = S.players.filter((p) => p.team === team).slice(0, 14);
      for (const p of squad) rows.push(simPlayerRow(p, team, label, clean, hs, as));
    }
  }
  if (!rows.length) return simToast("Nothing to play.");
  // Award the top-rated player in each match, like the real pull does.
  const best = {};
  for (const r of rows) {
    const k = r.match_label;
    if (!best[k] || r.raw.rating > best[k].raw.rating) best[k] = r;
  }
  for (const r of Object.values(best)) { r.motm = true; r.raw.motm = 1; }

  simToast(`Playing ${target} — ${rows.length} player rows…`);
  await resilientWrite("match_stats", rows, { upsert: true, onConflict: "league_id,player_id,match_label" });
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
  if (!confirm("Delete every result in this sandbox league? Invented data only.")) return;
  await S.sb.from("match_stats").delete().eq("league_id", S.league.id);
  await S.sb.from("lineup_snapshots").delete().eq("league_id", S.league.id);
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
  route(); renderTestTab();
  simToast(`Added ${home} v ${away} to round ${rnd}.`);
}

function simRemoveFixture(label) {
  const bad = simSafe(); if (bad) return simToast(bad);
  S.fixtures = (S.fixtures || []).filter((f) => simLabel(f) !== label);
  simSave(simStage());
  route(); renderTestTab();
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
    ...values, home_score: fx.home_score, away_score: fx.away_score,
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

function renderTestTab() {
  const box = document.getElementById("board-test");
  const navBtn = document.getElementById("nav-test");
  if (navBtn) navBtn.classList.toggle("hidden", !isAppOwner());
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

    ${simCard("📅 Build a calendar",
      "Generates a whole season over this league's clubs and moves the dates so that <b>now</b> lands at the stage you pick. That is how the real window logic gets tested — it compares the clock against kick-offs.",
      `<div class="flex items-center gap-2 text-xs">
         <label class="text-slate-400">Weeks
           <input id="sim-weeks" type="number" min="2" max="20" value="6"
             class="ml-1 w-14 rounded bg-slate-800 border border-slate-700 px-2 py-1"></label>
         <label class="flex items-center gap-1 text-slate-300">
           <input id="sim-quirks" type="checkbox" checked class="rounded border-slate-600 bg-slate-800">
           include a blank &amp; a double week</label>
       </div>
       <p class="text-xs text-slate-500">A blank week gives a club no fixture; a double gives one two games. Both are shapes that have broken round numbering before.</p>
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

    <p id="sim-log" class="text-xs text-slate-400 min-h-[1.5em] px-1"></p>`;

  const val = (id) => document.getElementById(id)?.value;
  const num = (id) => Number(val(id)) || 0;
  const chk = (id) => document.getElementById(id)?.checked === true;
  const weeks = () => Math.max(2, Math.min(20, Number(val("sim-weeks")) || 6));

  document.getElementById("sim-enable").onclick = () =>
    simEnable(!simLeague()).catch((e) => simToast(e.message));
  box.querySelectorAll("[data-stage]").forEach((b) => b.onclick = () =>
    simApply(b.dataset.stage, weeks(), chk("sim-quirks")));
  document.getElementById("sim-fx-add").onclick = () => simAddFixture({
    round: num("sim-fx-round"), home: val("sim-fx-home"), away: val("sim-fx-away"),
    daysFromNow: num("sim-fx-days"), status: val("sim-fx-status"),
    hs: num("sim-fx-hs"), as: num("sim-fx-as"),
  });
  box.querySelectorAll("[data-rmfx]").forEach((b) => b.onclick = () => simRemoveFixture(b.dataset.rmfx));
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
  setTimeout(() => { if (S.league && simLeague()) { simRestore(); route(); } }, 1500);
});
