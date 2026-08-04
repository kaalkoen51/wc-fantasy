/* Shared rig for the scenario tests.
 *
 * The point of a scenario here is not one assertion. A bug in this app is
 * typically correct on the screen you are looking at and wrong on another --
 * the transfer that still appeared in round 4 and round 5 was right in the
 * current line-up the whole time. So every scenario sets up a state and then
 * OPENS EVERYTHING: every tab, every sub-tab, every round of the pager, and
 * the overlays, asserting that nothing throws and every pane drew something.
 *
 * The database underneath is the in-memory stub, so this exercises the app,
 * not Postgres. test_sql.sh covers the other side.
 */
const fs = require("fs");
const path = require("path");
const { expect } = require("@playwright/test");

const STUB = fs.readFileSync(path.join(__dirname, "supabase-stub.js"), "utf8");
const POOL = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "players.json"), "utf8"));

const LEAGUE = "55555555-5555-4555-8555-555555555555";
const OWNER = "00000000-0000-4000-8000-000000000001";
const DAY = 86400000;

/* A squad that can field a legal XI, with every player at a DIFFERENT club.
   That matters more than it looks: the first version took players in pool
   order, which is grouped by country, so a whole squad came from one or two
   clubs -- and then a "blank week" that removes one fixture removed the only
   fixture, and the scenario was testing a season with a missing round rather
   than a blank one. The test data has to be as varied as a real league or the
   scenario is not the scenario.

   `nth` offsets which clubs each manager draws from, so two managers do not
   compete for the same players. */
function squadFor(nth) {
  const byClub = {};
  for (const p of POOL) (byClub[p.team] ||= []).push(p);
  const clubs = Object.keys(byClub).sort();
  const need = [["GK", 1], ["DEF", 4], ["MID", 4], ["FWD", 2],
                ["GK", 1], ["DEF", 1], ["MID", 1], ["FWD", 1]];
  const out = [];
  let ci = nth;                       // walk clubs, one player each
  for (const [pos, n] of need) {
    for (let k = 0; k < n; k++) {
      for (let tries = 0; tries < clubs.length; tries++) {
        const club = clubs[(ci++ * 2 + nth) % clubs.length];
        const cand = (byClub[club] || []).find((p) =>
          p.position === pos && !out.includes(p));
        if (cand) { out.push(cand); break; }
      }
    }
  }
  return { starters: out.slice(0, 11), bench: out.slice(11) };
}

/* A league mid-season: `played` rounds with results behind us, one round
   still to come, automatic windows and waiver mode on. Every stat row carries
   the round, the round key and the fixture id, the way the pullers write them. */
const KO_ROUNDS = ["Round of 16", "Quarter-finals", "Semi-finals", "Final"];

function seedLeague({ managers = 2, played = 3, quirk = null,
                      h2h = false, knockout = false, claims = 0 } = {}) {
  const now = Date.now();
  const tables = {
    leagues: [{
      id: LEAGUE, name: "Scenario", invite_code: "SCEN", current_pick: 9999,
      num_managers: managers, sim: false, owner_id: OWNER,
      config: { autoWindows: true, fa_defer_to_close: true, captain: true,
                ...(h2h ? { h2hEnabled: true } : {}) },
    }],
    managers: [], picks: [], match_stats: [], lineup_snapshots: [],
    rounds: [], transactions: [], messages: [], fa_claims: [], team_stages: [],
  };

  const mgrIds = [];
  let pickNo = 1;
  for (let m = 0; m < managers; m++) {
    const id = `6666666${m}-6666-4666-8666-666666666666`;
    mgrIds.push(id);
    tables.managers.push({ id, league_id: LEAGUE, name: `Mgr${m + 1}`,
      draft_position: m + 1, waiver_order: m,
      user_id: m === 0 ? OWNER : `other-${m}` });
    const { starters, bench } = squadFor(m);
    for (const p of starters)
      tables.picks.push({ id: `pk${pickNo}`, league_id: LEAGUE, manager_id: id,
        player_id: p.player_id, player_name: p.name, position: p.position,
        team: p.team, slot: p.position, is_sub: false, pick_number: pickNo++ });
    for (const p of bench)
      tables.picks.push({ id: `pk${pickNo}`, league_id: LEAGUE, manager_id: id,
        player_id: p.player_id, player_name: p.name, position: p.position,
        team: p.team, slot: "SUB_" + p.position, is_sub: true, pick_number: pickNo++ });
    tables.managers[m].captain_id = starters[starters.length - 1].player_id;
    tables.managers[m].vice_id = starters[starters.length - 2].player_id;
  }

  // Everyone who is picked, plus their clubs, so the fixtures mean something.
  const picked = tables.picks.map((p) => POOL.find((x) => x.player_id === p.player_id));
  const clubs = [...new Set(picked.map((p) => p.team))];

  /* Knockout mode names the rounds the way a cup does -- no matchweek number
     anywhere. That is the World Cup path, and it is the one that has never
     been driven end to end: round_no is null for all of it, so everything
     from Phase 1.5 onward has to key on the label instead. */
  const roundName = (r) => knockout
    ? KO_ROUNDS[Math.min(r - 1, KO_ROUNDS.length - 1)]
    : `Regular Season - ${r}`;

  const fixtures = [];
  for (let r = 1; r <= played + 1; r++) {
    const at = now + (r - played - 0.5) * 7 * DAY;
    const iso = new Date(at).toISOString();
    for (let i = 0; i + 1 < clubs.length; i += 2) {
      // A blank week: the first pair simply has no fixture in round 2.
      if (quirk === "blank" && r === 2 && i === 0) continue;
      fixtures.push({ fixture_id: r * 1000 + i, home: clubs[i], away: clubs[i + 1],
        kickoff_utc: iso, date: iso.slice(0, 10),
        round: roundName(r), status: r <= played ? "FT" : "NS",
        home_score: r <= played ? (i % 3) : null,
        away_score: r <= played ? ((i + 1) % 2) : null });
    }
    // A double week: one club plays twice in round 3.
    if (quirk === "double" && r === 3) {
      const at2 = new Date(at + 2 * DAY).toISOString();
      fixtures.push({ fixture_id: r * 1000 + 99, home: clubs[0], away: clubs[3],
        kickoff_utc: at2, date: at2.slice(0, 10),
        round: roundName(r), status: "FT", home_score: 1, away_score: 1 });
    }
  }

  for (const f of fixtures) {
    if (f.status !== "FT") continue;
    const label = `${f.home} vs ${f.away} (${f.date})`;
    // Null for a knockout round, exactly as both pullers stamp it.
    const m = String(f.round).match(/-\s*(\d+)\s*$/);
    const n = m ? Number(m[1]) : null;
    for (const club of [f.home, f.away])
      for (const p of picked.filter((x) => x.team === club))
        tables.match_stats.push({
          league_id: LEAGUE, player_id: p.player_id, match_label: label,
          appeared: true, minutes: 90, goals: p.position === "FWD" ? 1 : 0,
          assists: p.position === "MID" ? 1 : 0,
          clean_sheet: p.position !== "FWD" && (club === f.home ? f.away_score === 0 : f.home_score === 0),
          yellow_cards: 0, red_cards: 0, saves: p.position === "GK" ? 3 : 0,
          motm: false, penalty_saved: 0, penalty_missed: 0,
          team: club, round: n, round_key: f.round, fixture_id: f.fixture_id,
        });
  }
  // Queued waiver claims, as a manager leaves them before a window shuts.
  for (let c = 0; c < claims; c++) {
    const mine = tables.picks.filter((p) => p.manager_id === mgrIds[0] && p.is_sub);
    const ownedIds = new Set(tables.picks.map((p) => p.player_id));
    const target = POOL.find((p) => p.position === mine[c].position && !ownedIds.has(p.player_id));
    tables.fa_claims.push({
      id: `claim${c}`, league_id: LEAGUE, manager_id: mgrIds[0], rank: c,
      status: "pending", pick_id: mine[c].id,
      out_player_id: mine[c].player_id, out_player_name: mine[c].player_name,
      in_player_id: target.player_id, in_player_name: target.name,
    });
  }
  return { tables, fixtures, mgrIds, picked, clubs, roundNames: [...new Set(fixtures.map((f) => f.round))] };
}

async function openLeague(page, opts = {}) {
  const seed = seedLeague(opts);
  await page.route("**/vendor/supabase.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: STUB }));
  await page.goto("/index.html", { waitUntil: "networkidle" });
  await page.evaluate(([tables, lid, mid]) => {
    Object.assign(window.__db.tables, tables);
    localStorage.setItem("wcf_session", JSON.stringify({ leagueId: lid, managerId: mid }));
  }, [seed.tables, LEAGUE, seed.mgrIds[0]]);
  await page.evaluate(async ([fx, email]) => {
    S.authUser = { id: "00000000-0000-4000-8000-000000000001", email };
    await loadPlayers();
    await refetchAll();
    S.fixtures = fx;                 // the app's fixture source, as loaded
    route();
  }, [seed.fixtures, "tester@example.com"]);
  return seed;
}

/* Open every view the league offers and assert each one drew something and
   threw nothing. This is the part that catches "right here, wrong there". */
async function sweepAllViews(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(`uncaught: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text()))
      errors.push(`console.error: ${m.text()}`);
  });

  const visited = await page.evaluate(async () => {
    const seen = [];
    /* Capture the TEXT as well as the size. "It rendered something" is a very
       low bar -- a pane full of "undefined" clears it -- so the checks below
       read what a person would actually see. */
    const note = (name, el) => seen.push({
      name,
      html: (el?.innerHTML || "").length,
      text: (el?.textContent || "").replace(/\s+/g, " ").trim(),
      hidden: !!el?.classList?.contains("hidden"),
    });

    showView("board");
    for (const [group, tabs] of Object.entries(navGroups())) {
      for (const tab of tabs) {
        setBoardTab(tab);
        // Let anything the tab defers actually run.
        await new Promise((r) => setTimeout(r, 30));
        note(`${group}/${tab}`, document.getElementById("board-" + tab));

        // Sub-panes that are their own screens.
        if (tab === "trades") for (const t of (window.TRADE_TABS || []).map((x) => x.id || x)) {
          try { S.tradeTab = t; renderTrades(); } catch (e) { throw new Error(`trades/${t}: ${e.message}`); }
          await new Promise((r) => setTimeout(r, 10));
          note(`trades/${t}`, document.getElementById("board-trades"));
        }
        if (tab === "stats") for (const v of ["leaderboard", "dream"]) {
          S.statsView = v; renderStatsTab();
          note(`stats/${v}`, document.getElementById("board-stats"));
        }
        // Every round of the history pager, not just the newest.
        if (tab === "lb") {
          const h = managerHistory(myManager().id);
          for (let i = 0; i <= h.rounds.length; i++) {
            S.histIdx = i; renderBoard();
            note(`lb/round-${i}`, document.getElementById("board-lb"));
          }
          S.histIdx = 0;
        }
      }
    }
    return seen;
  });

  // Overlays, opened one at a time. Each is a screen a person can reach.
  const overlayErrors = await page.evaluate(() => {
    const out = [];
    const me = myManager();
    const pid = managerPicks(me.id)[0]?.player_id;
    const tries = [
      ["player detail", () => openPlayerDetail(pid)],
      ["lineup editor", () => openLineup()],
      ["scoring sheet", () => openScoringSheet()],
      ["squad builder", () => openBuilder && openBuilder()],
    ];
    for (const [name, fn] of tries) {
      try { fn(); } catch (e) { out.push(`${name}: ${e.message}`); }
    }
    return out;
  });

  return { errors, visited, overlayErrors };
}

/* Text that means a value did not survive the trip to the screen. These are
   what a broken render actually looks like in this app -- a missing player
   becomes "undefined", a missing number becomes "NaN", a date that failed to
   parse becomes "Invalid Date", and an object rendered by accident becomes
   "[object Object]". None of them throw, so none of them were caught before. */
const BAD_TEXT = [
  ["undefined", /\bundefined\b/],
  ["NaN", /\bNaN\b/],
  ["[object Object]", /\[object Object\]/],
  ["Invalid Date", /Invalid Date/],
  ["null", /(^|[\s>])null([\s<]|$)/],
];

// Assert the sweep was clean AND actually rendered something legible, so a
// pane full of "undefined" cannot pass as "no errors".
function expectCleanSweep(res) {
  expect(res.errors, `errors while sweeping:\n${res.errors.join("\n")}`).toEqual([]);
  expect(res.overlayErrors, `overlays threw:\n${res.overlayErrors.join("\n")}`).toEqual([]);
  const empty = res.visited.filter((v) => v.html === 0);
  expect(empty, `panes rendered nothing: ${JSON.stringify(empty)}`).toEqual([]);
  expect(res.visited.length, "swept nothing at all").toBeGreaterThan(5);

  const broken = [];
  for (const v of res.visited)
    for (const [label, re] of BAD_TEXT)
      if (re.test(v.text))
        broken.push(`${v.name}: "${label}" in "${
          (v.text.match(new RegExp(`.{0,40}${re.source}.{0,40}`)) || [v.text.slice(0, 80)])[0]}"`);
  expect(broken, `values did not survive rendering:\n${broken.join("\n")}`).toEqual([]);
}

/* Cross-screen consistency: the same fact, read off different screens, has to
   agree. This is where this app's bugs live -- each screen is individually
   plausible and they contradict each other, which is invisible unless you put
   them side by side. */
async function expectScreensAgree(page) {
  const facts = await page.evaluate(() => {
    const out = { managers: [], rounds: [] };
    for (const row of computeScores()) {
      const h = managerHistory(row.manager.id);
      out.managers.push({
        id: row.manager.id,
        board: row.total,
        history: h.total,
        // The pager's rounds plus what is still live must be the whole score.
        roundSum: h.rounds.reduce((s, r) => s + r.subtotal, 0),
        settled: row.settledTotal, live: row.liveTotal,
        // Every player the pager shows for a round must be a real player.
        unknown: h.rounds.flatMap((r) => r.items
          .filter((i) => i.entry.player_id && !S.playerById[i.entry.player_id]
            && !String(i.entry.player_id).startsWith("__"))
          .map((i) => `${r.n}:${i.entry.player_id}`)),
      });
    }
    return out;
  });

  for (const m of facts.managers) {
    expect(m.history, `manager ${m.id}: leaderboard ${m.board} vs history ${m.history}`)
      .toBe(m.board);
    expect(m.settled + m.live, `manager ${m.id}: settled+live ${m.settled + m.live} vs total ${m.board}`)
      .toBe(m.board);
    expect(m.unknown, `manager ${m.id}: the pager shows players that are not in the pool`)
      .toEqual([]);
  }
  return facts;
}

/* Geometry, not pixels. A broken layout does not throw and does not change any
   text -- the Test tab rendered for weeks with a collapsed grid and an
   "invisible" that showed, and every check we had passed. These are the faults
   that are visible to a person and to nothing else, asserted without baseline
   images so they cannot go stale or drift with a font. */
async function expectLayoutSane(page) {
  const faults = await page.evaluate(() => {
    const bad = [];
    const vw = document.documentElement.clientWidth;
    showView("board");
    for (const tabs of Object.values(navGroups())) for (const tab of tabs) {
      setBoardTab(tab);
      const pane = document.getElementById("board-" + tab);
      if (!pane || pane.classList.contains("hidden")) continue;

      for (const el of pane.querySelectorAll("*")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;          // deliberately hidden
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") continue;

        // Nothing may run off the side of the screen. The app is mobile-first
        // and horizontal scroll is how a broken grid actually presents.
        if (r.right > vw + 1)
          bad.push(`${tab}: <${el.tagName.toLowerCase()}> overflows the viewport by ${
            Math.round(r.right - vw)}px ("${(el.textContent || "").trim().slice(0, 30)}")`);

        /* Text with no height is text nobody can read. Only checked on leaf
           elements that actually contain words, since an empty wrapper legitimately
           collapses. */
        const leaf = !el.children.length && (el.textContent || "").trim().length > 0;
        if (leaf && r.height === 0)
          bad.push(`${tab}: text collapsed to zero height ("${
            (el.textContent || "").trim().slice(0, 30)}")`);
      }
    }
    return bad;
  });
  expect(faults, `layout faults:\n${faults.join("\n")}`).toEqual([]);
}

/* What the SCREEN says, not what the functions return. A render can drop a
   player while every underlying number stays right, and only reading the DOM
   catches that. */
async function expectLineupOnScreen(page, mgrId, names) {
  const text = await page.evaluate(() => {
    setBoardTab("home");
    return (document.getElementById("board-home")?.textContent || "").replace(/\s+/g, " ");
  });
  for (const n of names)
    expect(text, `"${n}" is in the squad but not on the team screen`).toContain(n);
  return text;
}

module.exports = { openLeague, sweepAllViews, expectCleanSweep, expectScreensAgree,
                   expectLineupOnScreen, expectLayoutSane, seedLeague, LEAGUE, POOL, DAY };
