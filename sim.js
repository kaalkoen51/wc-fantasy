"use strict";
/* ============================================================================
 * TEST RUN — play a season without waiting for real football.
 *
 * Build a fake fixture calendar over the league's real squads, jump to any
 * stage of the matchday cycle (transfers / lineup / locked / live / results),
 * play matchweeks and watch scoring, auto-subs, recaps, standings and the H2H
 * log populate. Deliberately able to produce the awkward weeks a real league
 * throws at you: a BLANK week where a club doesn't play, a DOUBLE week where
 * one plays twice, and a mid-season TRANSFER.
 *
 * WHO CAN SEE IT: the controls only render for an APP_OWNER_EMAILS account.
 * That is a UI gate, not enforcement — until RLS is applied the anon key can be
 * driven directly, so treat it as "kept out of the way", not "locked".
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

// Offsets, from now, for the upcoming matchweek's first kickoff and the
// previous matchweek's last kickoff — chosen to sit inside each stage.
const SIM_STAGES = {
  results:   { nextFirst: +5 * DAY,  prevLast: -0.5 * H },  // window not open yet
  transfers: { nextFirst: +5 * DAY,  prevLast: -3 * H },    // both windows open
  lineup:    { nextFirst: +6 * H,    prevLast: -4 * DAY },  // trade shut, lineup open
  locked:    { nextFirst: +0.5 * H,  prevLast: -4 * DAY },  // inside the lock
  live:      { nextFirst: -0.5 * H,  prevLast: -4 * DAY },  // a game in progress
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

function simApply(stage, weeks, quirks) {
  const bad = simSafe(); if (bad) return simToast(bad);
  const fx = simCalendar(stage, weeks, quirks);
  if (!fx.length) return simToast("No squads loaded yet — wait for the pool, then retry.");
  S.fixtures = fx;
  localStorage.setItem(SIM_KEY(), JSON.stringify({ stage, weeks, quirks }));
  // Auto-windows are part of what we're testing; make sure they're on.
  const cfg = { ...(S.league.config || {}), autoWindows: true };
  S.league.config = cfg;
  S.sb.from("leagues").update({ config: cfg }).eq("id", S.league.id).then(() => {}, () => {});
  route();
  const wk = [...new Set(fx.map((f) => f.round))].length;
  simToast(`${fx.length} fixtures over ${wk} weeks · ${stage}${quirks ? " · blank + double" : ""}`);
}

// Re-apply the saved calendar after a reload, so a test season survives a
// refresh without ever being written to the database.
function simRestore() {
  try {
    const saved = JSON.parse(localStorage.getItem(SIM_KEY()) || "null");
    if (saved && simLeague()) S.fixtures = simCalendar(saved.stage, saved.weeks, saved.quirks);
  } catch { /* ignore a corrupt entry */ }
}

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
  return {
    league_id: S.league.id, player_id: p.player_id, match_label: label,
    // The club they turned out for, same as a real pull writes.
    team,
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
   week's results come from the new club while the earlier ones stay put — the
   case that used to strand a player's history. */
async function simTransfer() {
  const bad = simSafe();
  if (bad) return simToast(bad);
  const mine = (S.picks || []).filter((pk) => pk.slot !== "TEAM" && pk.player_id);
  if (!mine.length) return simToast("Draft some players first.");
  const pk = mine[Math.floor(Math.random() * mine.length)];
  const teams = (S.teams || []).slice(0, SIM_TEAMS).filter((t) => t !== pk.team);
  if (!teams.length) return simToast("Need at least two clubs.");
  const to = teams[Math.floor(Math.random() * teams.length)];
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
  // The database has the final say (guard_sim_flag): this account must be in
  // app_owners. A missing column instead means schema.sql has not been run.
  if (error) {
    if (/restricted to product owners/.test(error.message))
      return simToast("Your account is not in app_owners — see schema.sql.");
    return simToast(/'sim' column/.test(error.message) ? "Run schema.sql first." : error.message);
  }
  S.league.sim = on;
  if (!on) localStorage.removeItem(SIM_KEY());
  simPanelRefresh();
  scheduleRefetch();
  simToast(on ? "Sandbox on — invented results stay in this league." : "Sandbox off.");
}

/* ---------- panel ---------- */

function simToast(msg) {
  const el = document.getElementById("sim-log");
  if (el) el.textContent = msg;
}

function simPanelRefresh() {
  const el = document.getElementById("sim-state");
  if (el) el.textContent = simLeague() ? "sandbox league" : "real league — writes refused";
  const btn = document.getElementById("sim-enable");
  if (btn) btn.textContent = simLeague() ? "Turn sandbox off" : "Turn sandbox on";
}

function simPanel() {
  if (!isAppOwner()) return;
  if (document.getElementById("sim-panel")) return;
  const wrap = document.createElement("div");
  wrap.id = "sim-panel";
  wrap.className = "fixed bottom-16 left-2 z-50 w-64 rounded-xl border border-fuchsia-500/60 "
    + "bg-slate-900/95 backdrop-blur p-3 space-y-2 text-slate-100 shadow-xl";
  wrap.innerHTML = `
    <div class="flex items-center justify-between">
      <span class="text-xs font-bold text-fuchsia-400">TEST RUN</span>
      <button id="sim-hide" class="text-xs text-slate-400">hide</button>
    </div>
    <div class="text-xs text-slate-400">Status: <span id="sim-state"></span></div>
    <button id="sim-enable" class="w-full rounded bg-fuchsia-700 px-2 py-1 text-xs font-semibold"></button>
    <div class="flex items-center gap-1.5 text-xs">
      <label class="text-slate-400">Weeks<input id="sim-weeks" type="number" min="2" max="20" value="6"
        class="ml-1 w-12 rounded bg-slate-800 border border-slate-700 px-1 py-0.5"></label>
      <label class="flex items-center gap-1 text-slate-400">
        <input id="sim-quirks" type="checkbox" checked> blank+double</label>
    </div>
    <div class="grid grid-cols-3 gap-1 text-xs" id="sim-stages">
      ${Object.keys(SIM_STAGES).map((k) =>
        `<button data-stage="${k}" class="rounded border border-slate-700 px-1 py-1">${k}</button>`).join("")}
    </div>
    <div class="grid grid-cols-3 gap-1 text-xs">
      <button id="sim-play" class="rounded bg-slate-800 border border-slate-700 px-2 py-1 font-semibold">Play week</button>
      <button id="sim-xfer" class="rounded bg-slate-800 border border-slate-700 px-2 py-1 font-semibold">Transfer</button>
      <button id="sim-clear" class="rounded bg-slate-800 border border-slate-700 px-2 py-1 font-semibold">Clear</button>
    </div>
    <div id="sim-log" class="text-xs text-slate-400 min-h-[2em]"></div>`;
  document.body.appendChild(wrap);

  const weeks = () => Math.max(2, Math.min(20, Number(document.getElementById("sim-weeks").value) || 6));
  const quirks = () => document.getElementById("sim-quirks").checked;
  const stageNow = () => JSON.parse(localStorage.getItem(SIM_KEY()) || "null")?.stage || "transfers";
  document.getElementById("sim-hide").onclick = () => wrap.remove();
  document.getElementById("sim-enable").onclick = () =>
    simEnable(!simLeague()).catch((e) => simToast(e.message));
  wrap.querySelectorAll("[data-stage]").forEach((b) => b.onclick = () =>
    simApply(b.dataset.stage, weeks(), quirks()));
  document.getElementById("sim-play").onclick = () => simPlayWeek().catch((e) => simToast(e.message));
  document.getElementById("sim-xfer").onclick = () => simTransfer().catch((e) => simToast(e.message));
  document.getElementById("sim-clear").onclick = () => simClear().catch((e) => simToast(e.message));
  simPanelRefresh();
  simToast(simSafe() || "Ready.");
}

// The handle only appears for an owner account, and only once auth has
// resolved — otherwise a slow session lookup would hide it on every load.
function simMountHandle() {
  if (document.getElementById("sim-handle") || !isAppOwner()) return;
  const btn = document.createElement("button");
  btn.id = "sim-handle";
  btn.textContent = "TEST";
  btn.className = "fixed bottom-2 left-2 z-50 rounded-lg bg-fuchsia-700 text-white "
    + "text-xs font-bold px-2.5 py-1.5 shadow-lg";
  btn.onclick = simPanel;
  document.body.appendChild(btn);
}

document.addEventListener("DOMContentLoaded", () => {
  const t = setInterval(() => { if (isAppOwner()) { simMountHandle(); clearInterval(t); } }, 1000);
  setTimeout(() => clearInterval(t), 30000);
  setTimeout(() => { if (S.league && simLeague()) { simRestore(); route(); } }, 1500);
});
