"use strict";
/* ============================================================================
 * SIMULATOR — development builds only.
 *
 * This file is NOT shipped to users. `npm run build` omits it entirely and
 * leaves no reference to it in index.html; only `npm run build:dev` injects the
 * script tag. So this is not a hidden feature behind a flag a curious user
 * could flip — the code simply isn't in the production bundle, and build.js
 * fails the build if it ever appears there.
 *
 * What it's for: stepping the app through a season without waiting for real
 * football. Build a fake fixture calendar, jump to any stage of the matchday
 * cycle (transfers / lineup / locked / live / results), play a matchweek and
 * watch scores, recaps, standings and the H2H log populate.
 *
 * SAFETY: it refuses to touch a league that is tied to a real competition,
 * because competition_pools/competition_stats are SHARED across every league on
 * that competition — writing fake results there would corrupt real leagues.
 * It only ever writes match_stats for the league you are currently in, which is
 * private to that league. The fixture calendar is in-memory plus localStorage;
 * nothing about it is written to the database.
 * ==========================================================================*/

const SIM_KEY = () => "wcf_sim_" + (S.league?.id || "none");
const SIM_TEAMS_PER_WEEK = 8;   // 8 teams => 4 fixtures a matchweek

// A league is safe to simulate only when its results are private to it.
function simSafe() {
  if (!S.league) return "Open a league first.";
  if (leagueCompetition())
    return "This league uses a shared competition — simulating would write fake "
         + "results into data other leagues read. Use a practice draft instead.";
  return null;
}

/* ---------- fixture calendar ----------
   Dates are generated RELATIVE TO NOW so that "now" lands inside the stage you
   asked for. That tests the real window logic (which compares wall-clock time
   against kickoffs) without needing a fake clock threaded through the app. */
const H = 3600e3, DAY = 24 * H, WEEK = 7 * DAY;

// Offsets, from now, for the upcoming matchweek's first kickoff and the
// previous matchweek's last kickoff — chosen to sit inside each stage.
const SIM_STAGES = {
  results:   { nextFirst: +5 * DAY,  prevLast: -0.5 * H },  // window not open yet
  transfers: { nextFirst: +5 * DAY,  prevLast: -3 * H },    // both windows open
  lineup:    { nextFirst: +6 * H,    prevLast: -4 * DAY },  // trade shut, lineup open
  locked:    { nextFirst: +0.5 * H,  prevLast: -4 * DAY },  // inside the lock
  live:      { nextFirst: -0.5 * H,  prevLast: -4 * DAY },  // a game in progress
};

function simCalendar(stage, weeks) {
  const teams = (S.teams || []).slice(0, SIM_TEAMS_PER_WEEK);
  if (teams.length < 2) return [];
  const off = SIM_STAGES[stage] || SIM_STAGES.transfers;
  const upcoming = Math.max(1, Math.floor(weeks / 2));   // played weeks behind us
  const fixtures = [];
  for (let w = 0; w < weeks; w++) {
    // Week `upcoming` is the one about to be played; earlier weeks are history.
    const base = w === upcoming ? Date.now() + off.nextFirst
      : w === upcoming - 1 ? Date.now() + off.prevLast - 2 * H
      : Date.now() + off.nextFirst + (w - upcoming) * WEEK;
    for (let i = 0; i < teams.length / 2; i++) {
      const home = teams[(w + i) % teams.length];
      const away = teams[(teams.length - 1 - i + w) % teams.length];
      if (home === away) continue;
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
    }
  }
  return fixtures;
}

function simApply(stage, weeks) {
  const fx = simCalendar(stage, weeks);
  S.fixtures = fx;
  localStorage.setItem(SIM_KEY(), JSON.stringify({ stage, weeks }));
  // Auto-windows are what we're testing; make sure they're on for this league.
  const cfg = { ...(S.league.config || {}), autoWindows: true };
  S.league.config = cfg;
  S.sb.from("leagues").update({ config: cfg }).eq("id", S.league.id).then(() => {}, () => {});
  route();
  simToast(`Calendar rebuilt · ${fx.length} fixtures · stage: ${stage}`);
}

// Re-apply the saved calendar after a reload, so a simulated season persists
// across refreshes without ever being written to the database.
function simRestore() {
  try {
    const saved = JSON.parse(localStorage.getItem(SIM_KEY()) || "null");
    if (saved && !leagueCompetition()) S.fixtures = simCalendar(saved.stage, saved.weeks);
  } catch { /* ignore a corrupt entry */ }
}

/* ---------- results ---------- */

// Plausible-but-random match stats, weighted by position so forwards score and
// keepers make saves — enough for scoring, recaps and the H2H log to look real.
function simPlayerRow(p, label, clean, homeScore, awayScore) {
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
  return {
    league_id: S.league.id, player_id: p.player_id, match_label: label,
    appeared: true, goals, assists,
    clean_sheet: clean && minutes >= 60 && pos !== "FWD",
    yellow_cards: yellow, red_cards: Math.random() < 0.02 ? 1 : 0,
    saves, motm: false, penalty_saved: 0, penalty_missed: 0,
    defensive_actions: def, minutes,
    home_score: homeScore, away_score: awayScore,
    raw: {
      "goals.total": goals, "goals.assists": assists, "goals.saves": saves,
      "clean_sheet": clean && minutes >= 60 && pos !== "FWD" ? 1 : 0,
      "cards.yellow": yellow, "cards.red": 0, "defensive_actions": def,
      "minutes": minutes, "motm": 0,
      "passes.total": 20 + r(50), "passes.accuracy": 60 + r(35),
      "shots.total": pos === "FWD" ? r(5) : r(2), "shots.on": r(2),
      "rating": 6 + Math.random() * 3,
    },
  };
}

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
    weeks[rd].some((f) => !played.has(`${f.home} vs ${f.away} (${f.date})`)));
  if (!target) return simToast("Every matchweek already has results.");

  const rows = [];
  for (const f of weeks[target]) {
    const label = `${f.home} vs ${f.away} (${f.date})`;
    if (played.has(label)) continue;
    const hs = f.home_score ?? Math.floor(Math.random() * 4);
    const as = f.away_score ?? Math.floor(Math.random() * 3);
    for (const team of [f.home, f.away]) {
      const clean = team === f.home ? as === 0 : hs === 0;
      const squad = S.players.filter((p) => p.team === team).slice(0, 14);
      for (const p of squad) rows.push(simPlayerRow(p, label, clean, hs, as));
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

async function simClear() {
  const bad = simSafe();
  if (bad) return simToast(bad);
  if (!confirm("Delete ALL results in this league? (Simulated data only — this league is not tied to a real competition.)")) return;
  await S.sb.from("match_stats").delete().eq("league_id", S.league.id);
  await S.sb.from("lineup_snapshots").delete().eq("league_id", S.league.id);
  localStorage.removeItem("wcf_recap_" + S.league.id);
  S._recapChecked = false;
  scheduleRefetch();
  simToast("Results cleared.");
}

/* ---------- panel ---------- */

function simToast(msg) {
  const el = document.getElementById("sim-log");
  if (el) el.textContent = msg;
  console.log("[sim]", msg);
}

function simPanel() {
  if (document.getElementById("sim-panel")) return;
  const wrap = document.createElement("div");
  wrap.id = "sim-panel";
  wrap.className = "fixed bottom-16 left-2 z-50 w-64 rounded-xl border border-fuchsia-500/60 "
    + "bg-slate-900/95 backdrop-blur p-3 space-y-2 text-slate-100 shadow-xl";
  wrap.innerHTML = `
    <div class="flex items-center justify-between">
      <span class="text-xs font-bold text-fuchsia-400">SIMULATOR · dev build</span>
      <button id="sim-hide" class="text-xs text-slate-400">hide</button>
    </div>
    <div class="flex items-center gap-1.5 text-xs">
      <label class="text-slate-400">Weeks<input id="sim-weeks" type="number" min="2" max="20" value="6"
        class="ml-1 w-12 rounded bg-slate-800 border border-slate-700 px-1 py-0.5"></label>
      <button id="sim-build" class="flex-1 rounded bg-fuchsia-700 px-2 py-1 font-semibold">Build calendar</button>
    </div>
    <div class="grid grid-cols-3 gap-1 text-xs" id="sim-stages">
      ${Object.keys(SIM_STAGES).map((k) =>
        `<button data-stage="${k}" class="rounded border border-slate-700 px-1 py-1">${k}</button>`).join("")}
    </div>
    <div class="grid grid-cols-2 gap-1 text-xs">
      <button id="sim-play" class="rounded bg-slate-800 border border-slate-700 px-2 py-1 font-semibold">Play week</button>
      <button id="sim-clear" class="rounded bg-slate-800 border border-slate-700 px-2 py-1 font-semibold">Clear results</button>
    </div>
    <div id="sim-log" class="text-xs text-slate-400 min-h-[2em]"></div>`;
  document.body.appendChild(wrap);

  const weeks = () => Math.max(2, Math.min(20, Number(document.getElementById("sim-weeks").value) || 6));
  const stageNow = () => JSON.parse(localStorage.getItem(SIM_KEY()) || "null")?.stage || "transfers";
  document.getElementById("sim-hide").onclick = () => wrap.remove();
  document.getElementById("sim-build").onclick = () => {
    const bad = simSafe(); if (bad) return simToast(bad);
    simApply(stageNow(), weeks());
  };
  wrap.querySelectorAll("[data-stage]").forEach((b) => b.onclick = () => {
    const bad = simSafe(); if (bad) return simToast(bad);
    simApply(b.dataset.stage, weeks());
  });
  document.getElementById("sim-play").onclick = () => simPlayWeek().catch((e) => simToast(e.message));
  document.getElementById("sim-clear").onclick = () => simClear().catch((e) => simToast(e.message));
  simToast(simSafe() || "Ready.");
}

// A small always-there handle, so hiding the panel doesn't lose the simulator.
document.addEventListener("DOMContentLoaded", () => {
  const btn = document.createElement("button");
  btn.textContent = "SIM";
  btn.className = "fixed bottom-2 left-2 z-50 rounded-lg bg-fuchsia-700 text-white "
    + "text-xs font-bold px-2.5 py-1.5 shadow-lg";
  btn.onclick = simPanel;
  document.body.appendChild(btn);
  // Re-apply a saved calendar once the league has loaded.
  setTimeout(() => { if (S.league) { simRestore(); route(); } }, 1500);
});
