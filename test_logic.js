const fs = require("fs");
const src = fs.readFileSync("index.html", "utf8")
  .match(/<script>\n("use strict";[\s\S]*)<\/script>/)[1];

const stubDoc = {
  getElementById: () => null,
  querySelectorAll: () => [],
  querySelector: () => null,
  addEventListener: () => {},
};
let scrollCalls = 0;
const winStub = { scrollTo: () => { scrollCalls++; } };
// A session so myManager() resolves to "m1" when a test puts it in S.managers
// (needed for the per-manager shortlist/planner helpers).
const _session = JSON.stringify({ leagueId: "L1", managerId: "m1" });
const lsStub = { getItem: (k) => k === "wcf_session" ? _session : null,
                 setItem: () => {}, removeItem: () => {} };
const api = new Function(
  "document", "localStorage", "window", "crypto", "navigator",
  src + "\nreturn { S, pickInfo, calcPlayerPoints, calcTeamPoints, computeScores, stageBonuses, stageOrder, finalPickBonus, phaseOneQuota, phaseOneStarters, starterQuota, effectiveConfig, flexCounting, formationValid, DEFAULT_FORMATION, roundRobin, h2hResult, h2hTable, h2hFixturesFor, resolveFaClaims, fixtureWindows, matchweeksOf, apiPosToSlot, teamCodeFrom, parseSquadPlayer, parseApiFixture, fetchCompetitionPool, fetchCompetitionFixtures, compKeyOf, competitionKey, slotGroup, pairValid, tradeError, quotaLeft, leagueFlex, slotForNewPick, posQuota, picksPerManager, totalPicks, playerBreakdown, playerPoints, suspendedNext, resilientWrite, playerStatTotal, teamMatchLabels, entryForManagerAt, ownerEntryAt, slotLabel, managerHistory, poolEntries, availableForGroup, isEliminated, computeYetToPlay, showView, plannerChoiceRank, choiceStatus, plannerPickPool, autoPickCandidates, entryForId, statsScopedRows, sumStatKey, sumMinutes, formAvg, formLog, dreamTeam, formDotColor, shortlistCleaned, standingsMovement, roundMVPs, seasonSeries, headToHead, currentRoundNo, currentRoundDreamIds, chatThreads, messagesForThread, threadUnread, markThreadSeen, koRoundOf, knockoutBracket, needsSummary, lineupValid };"
)(stubDoc, lsStub, winStub, {}, {});

const { S, pickInfo, calcPlayerPoints, calcTeamPoints, computeScores,
        scoring, stageBonuses, stageOrder, finalPickBonus, phaseOneQuota,
        phaseOneStarters, starterQuota, effectiveConfig,
        flexCounting, formationValid, DEFAULT_FORMATION,
        roundRobin, h2hResult, h2hTable, h2hFixturesFor, resolveFaClaims,
        fixtureWindows, matchweeksOf,
        apiPosToSlot, teamCodeFrom, parseSquadPlayer, parseApiFixture,
        fetchCompetitionPool, fetchCompetitionFixtures, compKeyOf, competitionKey,
        slotGroup, pairValid, tradeError, quotaLeft, leagueFlex, slotForNewPick,
        posQuota, picksPerManager, totalPicks,
        playerBreakdown, playerPoints, suspendedNext, resilientWrite,
        playerStatTotal, teamMatchLabels, entryForManagerAt, ownerEntryAt,
        slotLabel, managerHistory, poolEntries, availableForGroup,
        isEliminated, computeYetToPlay, showView,
        plannerChoiceRank, choiceStatus, plannerPickPool,
        autoPickCandidates, entryForId,
        statsScopedRows, sumStatKey, sumMinutes, formAvg, formLog,
        dreamTeam, formDotColor, shortlistCleaned, standingsMovement, roundMVPs,
        seasonSeries, headToHead,
        currentRoundNo, currentRoundDreamIds,
        chatThreads, messagesForThread, threadUnread, markThreadSeen,
        koRoundOf, knockoutBracket, needsSummary, lineupValid } = api;
let fails = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fails++; console.log(`FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${label}`);
};

/* snake order: 4 managers */
S.managers = [1, 2, 3, 4].map((i) => ({ id: "m" + i, name: "M" + i, draft_position: i }));
S.league = { num_managers: 4 };
check("pick 1 -> M1", pickInfo(1).manager.name, "M1");
check("pick 4 -> M4", pickInfo(4).manager.name, "M4");
check("pick 5 -> M4 (snake)", pickInfo(5).manager.name, "M4");
check("pick 8 -> M1", pickInfo(8).manager.name, "M1");
check("pick 9 -> M1 (snake back)", pickInfo(9).manager.name, "M1");
check("pick 37 round 10", pickInfo(37).round, 10);
check("pick 56 last -> M1", pickInfo(56).manager.name, "M1");

/* position quotas & default starter/sub slotting */
const roster = [];
const draftOne = (pos) => {
  const slot = slotForNewPick(roster, pos);
  roster.push({ position: pos, slot });
  return slot;
};
check("quota sums to 14", Object.values(posQuota()).reduce((a, b) => a + b, 0), 14);
check("1st GK is starter", draftOne("GK"), "GK");
check("2nd GK is sub", draftOne("GK"), "SUB_GK");
check("GK quota now 0", quotaLeft(roster, "GK"), 0);
check("DEF 1-3 start", [draftOne("DEF"), draftOne("DEF"), draftOne("DEF")], ["DEF", "DEF", "DEF"]);
check("4th DEF is sub", draftOne("DEF"), "SUB_DEF");
check("TEAM slot is TEAM", draftOne("TEAM"), "TEAM");
check("MID quota untouched", quotaLeft(roster, "MID"), 4);

/* scoring */
const row = (o) => ({ appeared: true, goals: 0, assists: 0, clean_sheet: false,
  yellow_cards: 0, red_cards: 0, saves: 0, motm: false, penalty_saved: 0,
  penalty_missed: 0, defensive_actions: 0, ...o });
check("GK: cs + 5 saves + pen save", calcPlayerPoints(row({ clean_sheet: true, saves: 5, penalty_saved: 1 }), "GK"), 6 + 2 + 5);
check("FWD: 2 goals + motm + yellow", calcPlayerPoints(row({ goals: 2, motm: true, yellow_cards: 1 }), "FWD"), 8 + 3 - 1);
check("DNP scores 0", calcPlayerPoints(row({ appeared: false, goals: 3 }), "MID"), 0);
check("DEF: cs + 5 def actions", calcPlayerPoints(row({ clean_sheet: true, defensive_actions: 5 }), "DEF"), 4 + 2);
check("GK def actions don't score", calcPlayerPoints(row({ defensive_actions: 8 }), "GK"), 0);
check("rows without def actions still score", calcPlayerPoints({ ...row({ goals: 1 }), defensive_actions: undefined }, "MID"), 5);

/* Workstream B: per-league config.scoring is a RULES array that replaces the
   defaults; stageBonus/finalPickBonus/quota still deep-merge. */
S.league = { config: { scoring: [
  { stat: "goals.total", mode: "each", perPosition: true, points: { GK: 8, DEF: 6, MID: 5, FWD: 10 } },
  { stat: "goals.assists", mode: "each", perPosition: false, points: 2 },
  { stat: "passes.total", mode: "per", per: 10, perPosition: false, points: 1 },
  { stat: "passes.accuracy", mode: "threshold", gte: 90, perPosition: false, points: 3 },
] } };
check("rule: per-position points (FWD goal 10)", calcPlayerPoints(row({ goals: 1 }), "FWD"), 10);
check("rule: position-independent points (assist 2, any pos)", calcPlayerPoints(row({ assists: 1 }), "DEF"), 2);
check("rule: 'per N' formula (1 pt / 10 passes → 34 passes = 3)",
  calcPlayerPoints({ ...row({}), raw: { "passes.total": 34 } }, "MID"), 3);
check("rule: 'threshold' formula (pass acc ≥ 90 → +3)",
  calcPlayerPoints({ ...row({}), raw: { "passes.accuracy": 91 } }, "MID"), 3);
check("rule: below threshold → 0",
  calcPlayerPoints({ ...row({}), raw: { "passes.accuracy": 88 } }, "MID"), 0);
check("custom rules REPLACE defaults (a yellow no longer scores)",
  calcPlayerPoints(row({ yellow_cards: 1 }), "MID"), 0);
// minMinutes gate: a rule only scores if the player met the minutes threshold.
S.league = { config: { scoring: [
  { stat: "clean_sheet", mode: "each", perPosition: false, points: 4, minMinutes: 60 },
] } };
check("minMinutes gate: 90 min clean sheet scores",
  calcPlayerPoints({ ...row({ clean_sheet: true }), raw: { "clean_sheet": 1, "minutes": 90 } }, "DEF"), 4);
check("minMinutes gate: 45 min clean sheet scores 0",
  calcPlayerPoints({ ...row({ clean_sheet: true }), raw: { "clean_sheet": 1, "minutes": 45 } }, "DEF"), 0);
S.league = { config: { stageBonus: { r32: 100 } } };
check("config overrides a stage bonus (r32 100 + r16 default 10)", calcTeamPoints("r16"), 110);
S.league = { config: { finalPickBonus: 20 } };
check("config overrides the champion-pick bonus", finalPickBonus(), 20);
S.league = { phase: 1, config: { quota: { FWD: 5 } } };
check("config overrides phase-1 quota (FWD 5)", posQuota().FWD, 5);
check("partial quota config keeps defaults (GK still 2)", posQuota().GK, 2);
S.league = { phase: 1, config: { starters: { MID: 4 } } };
check("config overrides phase-1 starters (MID 4)", starterQuota().MID, 4);
check("partial starters config keeps defaults (DEF still 3)", starterQuota().DEF, 3);
// effectiveConfig fills defaults for the create-form editor: rules array +
// merged quota/starters/bonuses.
{
  const eff = effectiveConfig({ quota: { GK: 3 } });
  check("effectiveConfig gives the default rules + merged quota/starters",
    [Array.isArray(eff.rules), eff.rules[0].stat, eff.quota.GK, eff.quota.DEF,
     eff.starters.GK, eff.finalPickBonus],
    [true, "goals.total", 3, 4, 1, 5]);
  check("effectiveConfig({}) equals effectiveConfig(null) (all defaults)",
    JSON.stringify(effectiveConfig({})), JSON.stringify(effectiveConfig(null)));
  check("effectiveConfig deep-clones rules (editor can mutate safely)",
    effectiveConfig({}).rules !== effectiveConfig({}).rules, true);
}

/* Flexible formations: auto-subs promote bench in listed order, only into a
   subset that keeps the formation valid (DEF 3-5, MID 2-5, FWD 1-3, 11 total). */
{
  const B = DEFAULT_FORMATION;
  const P = (id, position) => ({ player_id: id, position });
  const st442 = [P("gk", "GK"), P("d1", "DEF"), P("d2", "DEF"), P("d3", "DEF"), P("d4", "DEF"),
    P("m1", "MID"), P("m2", "MID"), P("m3", "MID"), P("m4", "MID"), P("f1", "FWD"), P("f2", "FWD")];
  const ids = st442.map((s) => s.player_id);
  check("flex: all starters play → all 11 count",
    flexCounting(st442, [], new Set(ids), B).size, 11);
  // 1 DEF no-show, all-forward bench → first bench FWD subs in (4-4-2 → 3-4-3)
  const r1 = flexCounting(st442, [P("bf1", "FWD"), P("bf2", "FWD")],
    new Set([...ids.filter((id) => id !== "d4"), "bf1", "bf2"]), B);
  check("flex: DEF no-show + FWD bench → first FWD subs in (→ 3-4-3)",
    [r1.has("bf1"), r1.has("bf2"), r1.has("d4")], [true, false, false]);
  // 3-4-3, 1 DEF no-show, bench FWD already at max → no valid sub, slot stays empty
  const st343 = [P("gk", "GK"), P("d1", "DEF"), P("d2", "DEF"), P("d3", "DEF"),
    P("m1", "MID"), P("m2", "MID"), P("m3", "MID"), P("m4", "MID"),
    P("f1", "FWD"), P("f2", "FWD"), P("f3", "FWD")];
  const r2 = flexCounting(st343, [P("bf1", "FWD")],
    new Set([...st343.map((s) => s.player_id).filter((id) => id !== "d3"), "bf1"]), B);
  check("flex: no valid sub (FWD maxed) → slot empty, 10 count",
    [r2.has("bf1"), r2.size], [false, 10]);
  // GK no-show → only a bench GK can cover it
  check("flex: GK no-show → bench GK covers",
    flexCounting(st442, [P("bgk", "GK")], new Set([...ids.filter((id) => id !== "gk"), "bgk"]), B).has("bgk"), true);
  // bench order priority: MID listed before FWD → MID subs in (→ 3-5-2)
  const r3 = flexCounting(st442, [P("bm1", "MID"), P("bf1", "FWD")],
    new Set([...ids.filter((id) => id !== "d4"), "bm1", "bf1"]), B);
  check("flex: bench order priority (MID listed first subs in)",
    [r3.has("bm1"), r3.has("bf1")], [true, false]);
}
check("formationValid: 4-4-2 legal", formationValid({ GK: 1, DEF: 4, MID: 4, FWD: 2 }, DEFAULT_FORMATION), true);
check("formationValid: 2-4-4 illegal (DEF<3, FWD>3)", formationValid({ GK: 1, DEF: 2, MID: 4, FWD: 4 }, DEFAULT_FORMATION), false);
check("formationValid: wrong total illegal", formationValid({ GK: 1, DEF: 4, MID: 4, FWD: 1 }, DEFAULT_FORMATION), false);
// Max subs per round: cap the number of bench promotions.
{
  const B = DEFAULT_FORMATION;
  const P = (id, position) => ({ player_id: id, position });
  const st = [P("gk", "GK"), P("d1", "DEF"), P("d2", "DEF"), P("d3", "DEF"), P("d4", "DEF"),
    P("m1", "MID"), P("m2", "MID"), P("m3", "MID"), P("m4", "MID"), P("f1", "FWD"), P("f2", "FWD")];
  const ids = st.map((s) => s.player_id);
  const played = new Set([...ids.filter((id) => id !== "d3" && id !== "d4"), "bd1", "bd2"]);  // 2 DEF no-show
  const bench = [P("bd1", "DEF"), P("bd2", "DEF")];
  const capped = flexCounting(st, bench, played, B, 11, 1);   // cap 1
  check("flex maxSubs=1: only one bench player is promoted",
    [capped.has("bd1"), capped.has("bd2")], [true, false]);
  const uncapped = flexCounting(st, bench, played, B, 11);    // no cap
  check("flex no cap: both bench DEF fill the two open slots",
    [uncapped.has("bd1"), uncapped.has("bd2")], [true, true]);
  check("flex maxSubs=0: no subs come up at all", flexCounting(st, bench, played, B, 11, 0).size, 9);
}
// Flex draft + lineup use the existing flex-slot model (mins + fluid slots).
S.league = { phase: 1, config: { formationMode: "flex", squadSize: 15,
  formation: { GK: [1, 1], DEF: [3, 5], MID: [2, 5], FWD: [1, 3], starters: 11 } } };
check("flex draft: posQuota = formation minimums", [posQuota().DEF, posQuota().MID, posQuota().FWD], [3, 2, 1]);
check("flex draft: fluid squad slots = squadSize − minimums", leagueFlex(), 15 - (1 + 3 + 2 + 1));
check("flex draft: a position can be stacked (up to 9 FWD in a 15 squad)", quotaLeft([], "FWD"), 9);
check("flex lineup: 4-4-2 is valid", lineupValid({ GK: 1, DEF: 4, MID: 4, FWD: 2 }), true);
check("flex lineup: 3-5-2 is valid", lineupValid({ GK: 1, DEF: 3, MID: 5, FWD: 2 }), true);
check("flex lineup: 6 defenders exceeds max → invalid", lineupValid({ GK: 1, DEF: 6, MID: 2, FWD: 2 }), false);
check("flex lineup: only 10 outfield+GK → invalid (wrong total)", lineupValid({ GK: 1, DEF: 4, MID: 3, FWD: 2 }), false);
S.league = {};

/* H2H log + bonus points (mechanics-notes spec). */
{
  // §3 worked example: 470 loses by 30 to 500 (rugby defaults).
  const rugby = { win: 4, draw: 2, loss: 0, score_bonus: 450, losing_margin: 50 };
  const r = h2hResult(470, 500, rugby);
  check("h2hResult: loser 470 gets attacking + losing bonus (0 + 2)",
    [r.ptsA, r.bonusA], [0, 2]);
  check("h2hResult: winner 500 gets win + attacking (4 + 1)",
    [r.ptsB, r.bonusB], [4, 1]);
  check("h2hResult: a level game is a draw, no bonuses",
    h2hResult(30, 30, rugby), { ptsA: 2, ptsB: 2, bonusA: 0, bonusB: 0 });
  // roundRobin: 4 managers → 3 rounds, everyone plays everyone once.
  const rr = roundRobin(["a", "b", "c", "d"]);
  check("roundRobin: n=4 → 3 rounds of 2 fixtures", [rr.length, rr[0].length], [3, 2]);
  const opps = { a: new Set() };
  for (const rnd of rr) for (const [h, aw] of rnd) if (h === "a" && aw) opps.a.add(aw); else if (aw === "a") opps.a.add(h);
  check("roundRobin: 'a' meets all 3 others exactly once", [...opps.a].sort(), ["b", "c", "d"]);
  // h2hTable: a win + bonuses, ordering by log points.
  const cfg = { win: 3, draw: 1, loss: 0, score_bonus: 60, losing_margin: 5 };
  const scores = { a: [62], b: [59] };   // a beats b 62-59; a attacking bonus, b losing bonus
  const fx = [{ round: 1, home_manager_id: "a", away_manager_id: "b" }];
  const t = h2hTable(["a", "b"], scores, fx, cfg);
  check("h2hTable: winner logPts = win + attacking bonus", t.rows.a.logPts, 4);
  check("h2hTable: loser logPts = loss + losing bonus", t.rows.b.logPts, 1);
  check("h2hTable: PF/PA recorded", [t.rows.a.PF, t.rows.a.PA], [62, 59]);
  check("h2hTable: order by log points", t.order, ["a", "b"]);
  // A round only counts once BOTH have a score.
  const t2 = h2hTable(["a", "b"], { a: [62] }, fx, cfg);
  check("h2hTable: incomplete round is skipped", t2.rows.a.P, 0);
  // Bye: scores nothing but is tallied.
  const t3 = h2hTable(["a"], { a: [50] }, [{ round: 1, home_manager_id: "a", away_manager_id: null }], cfg);
  check("h2hTable: a bye scores nothing but counts", [t3.rows.a.byes, t3.rows.a.logPts], [1, 0]);
  // Fixture schedule cycles the round-robin across rounds.
  const fixAll = h2hFixturesFor(["a", "b", "c", "d"], 5);
  check("h2hFixturesFor: 5 rounds × 2 fixtures = 10", fixAll.length, 10);
  const r1 = fixAll.filter((f) => f.round === 1).map((f) => [f.home_manager_id, f.away_manager_id].sort().join());
  const r4 = fixAll.filter((f) => f.round === 4).map((f) => [f.home_manager_id, f.away_manager_id].sort().join());
  check("h2hFixturesFor: round 4 reuses the round-1 pairings (cycled)", r1.sort(), r4.sort());
}

/* Waiver-order free-agent claims (mechanics-notes §1). */
{
  // §1.6 worked example (cap 1): M1[P1,P2], M2[P2]. M1 wins P1 (uncontested,
  // keeps order 0), its P2 claim is ignored; M2 then wins P2 uncontested.
  const claims = [
    { id: "c1", manager_id: "M1", rank: 0, out_player_id: "O1", in_player_id: "P1", pick_id: "pk1" },
    { id: "c2", manager_id: "M1", rank: 1, out_player_id: "O2", in_player_id: "P2", pick_id: "pk2" },
    { id: "c3", manager_id: "M2", rank: 0, out_player_id: "O3", in_player_id: "P2", pick_id: "pk3" },
  ];
  const res = resolveFaClaims(claims, { M1: 0, M2: 1 }, ["O1", "O2", "O3"], 1,
    { pk1: "O1", pk2: "O2", pk3: "O3" });
  check("waiver: M1 wins P1 & M2 wins P2; over-cap c2 ignored",
    [res.awards.map((c) => c.id).sort(), res.failed], [["c1", "c3"], ["c2"]]);
  check("waiver: uncontested wins keep priority", [res.order.M1, res.order.M2], [0, 1]);
  // Contested win → winner drops below everyone for remaining turns.
  const contested = [
    { id: "a", manager_id: "M1", rank: 0, out_player_id: "O1", in_player_id: "P2", pick_id: "pk1" },
    { id: "b", manager_id: "M2", rank: 0, out_player_id: "O2", in_player_id: "P2", pick_id: "pk2" },
  ];
  const r2 = resolveFaClaims(contested, { M1: 0, M2: 1 }, ["O1", "O2"], Infinity, { pk1: "O1", pk2: "O2" });
  check("waiver: contested win → winner dropped below the loser",
    [r2.awards.map((c) => c.id), r2.order.M1 > r2.order.M2], [["a"], true]);
  // Fallback: an infeasible top preference lets the next one land.
  const fb = [
    { id: "x", manager_id: "M1", rank: 0, out_player_id: "O1", in_player_id: "P1", pick_id: "pk1" },
    { id: "y", manager_id: "M1", rank: 1, out_player_id: "O1", in_player_id: "P2", pick_id: "pk1" },
  ];
  const r3 = resolveFaClaims(fb, { M1: 0 }, ["O1", "P1"], Infinity, { pk1: "O1" });
  check("waiver: infeasible top claim falls back to next preference",
    [r3.awards.map((c) => c.id), r3.failed], [["y"], ["x"]]);
  // Per-manager cap as a function: M1 exhausted its season allowance (0 left),
  // M2 still has room — so only M2's uncontested claim lands.
  const perMgr = [
    { id: "p", manager_id: "M1", rank: 0, out_player_id: "O1", in_player_id: "P1", pick_id: "pk1" },
    { id: "q", manager_id: "M2", rank: 0, out_player_id: "O2", in_player_id: "P2", pick_id: "pk2" },
  ];
  const r4 = resolveFaClaims(perMgr, { M1: 0, M2: 1 }, ["O1", "O2"],
    (m) => (m === "M1" ? 0 : 5), { pk1: "O1", pk2: "O2" });
  check("waiver: per-manager cap fn blocks the tapped-out manager only",
    [r4.awards.map((c) => c.id), r4.failed], [["q"], ["p"]]);
  // Function cap of 1 for everyone behaves exactly like the scalar cap of 1.
  const r5 = resolveFaClaims(claims, { M1: 0, M2: 1 }, ["O1", "O2", "O3"],
    () => 1, { pk1: "O1", pk2: "O2", pk3: "O3" });
  check("waiver: constant cap fn matches the scalar cap",
    [r5.awards.map((c) => c.id).sort(), r5.failed], [["c1", "c3"], ["c2"]]);
}
// No config anywhere → identical to the original hardcoded league.
S.league = {};
check("no config = default FWD goal 4", calcPlayerPoints(row({ goals: 1 }), "FWD"), 4);
check("no config = default champion bonus 5", finalPickBonus(), 5);
check("no config = champion still banks 90", calcTeamPoints("winner"), 90);
S.league = null;

/* sub activation */
S.managers = [{ id: "m1", name: "M1", draft_position: 1 }];
S.picks = [
  { manager_id: "m1", player_id: "fra_5", player_name: "Starter Def", position: "DEF", team: "France", slot: "DEF", is_sub: false, pick_number: 2 },
  { manager_id: "m1", player_id: "arg_3", player_name: "Sub Def", position: "DEF", team: "Argentina", slot: "SUB_DEF", is_sub: true, pick_number: 12 },
];
// Day 1: France played (others' rows exist), starter has no row -> sub's day-1 match counts.
// Day 2: starter appeared -> sub's day-2 match doesn't count.
S.stats = [
  { player_id: "fra_9", match_label: "France vs Brazil (2026-06-15)", appeared: true, goals: 0 },
  { player_id: "arg_3", match_label: "Argentina vs Chile (2026-06-15)", appeared: true, goals: 1, clean_sheet: true },
  { player_id: "fra_5", match_label: "France vs Spain (2026-06-18)", appeared: true, clean_sheet: true },
  { player_id: "arg_3", match_label: "Argentina vs Peru (2026-06-18)", appeared: true, goals: 1 },
].map((r) => row(r));
const sc = computeScores()[0];
const subItem = sc.items.find((i) => i.pick.is_sub);
const startItem = sc.items.find((i) => !i.pick.is_sub);
check("starter DEF cs pts", startItem.pts, 4);
check("sub active only day 1 (goal 6 + cs 4)", [subItem.pts, subItem.note], [10, "sub"]);
check("manager total", sc.total, 14);

/* team stage bonuses */
check("stage group = 0", calcTeamPoints("group"), 0);
check("stage r32 = 5", calcTeamPoints("r32"), 5);
check("stage qf = 5+10+15", calcTeamPoints("qf"), 30);
check("stage final = 75", calcTeamPoints("final"), 75);
check("stage winner = 90", calcTeamPoints("winner"), 90);
check("unknown stage = 0", calcTeamPoints("nonsense"), 0);

/* TEAM pick in leaderboard total */
S.picks.push({ manager_id: "m1", player_id: "team:France", player_name: "France",
  position: "TEAM", team: "France", slot: "TEAM", is_sub: false, pick_number: 10 });
S.stages = [{ team: "France", stage: "sf" }];
const sc2 = computeScores()[0];
const teamItem = sc2.items.find((i) => i.pick.slot === "TEAM");
check("TEAM pick sf = 50", [teamItem.pts, teamItem.note], [50, "sf"]);
check("total includes stage bonus", sc2.total, 14 + 50);
check("teamPts isolates the national-team portion (player-only = total − teamPts)",
  [sc2.teamPts, sc2.total - sc2.teamPts], [50, 14]);
S.stages = [];
const teamItem0 = computeScores()[0].items.find((i) => i.pick.slot === "TEAM");
check("no stage row = group = 0", [teamItem0.pts, teamItem0.note], [0, "group"]);

/* sub activation is by ROUND, not calendar day: a sub covers a no-show starter
   in the same round of fixtures even when the two play on different dates. */
S.fixtures = [];
S.snapshots = [];
S.stages = [];
S.managers = [{ id: "m1", name: "M1", draft_position: 1 }];
S.picks = [
  { manager_id: "m1", player_id: "fra_5", player_name: "Starter Def", position: "DEF", team: "France", slot: "DEF", is_sub: false, pick_number: 2 },
  { manager_id: "m1", player_id: "arg_3", player_name: "Sub Def", position: "DEF", team: "Argentina", slot: "SUB_DEF", is_sub: true, pick_number: 12 },
];
S.stats = [
  // Round 1: France played 06-13 (a France player featured) but the starter did
  // not; the sub's Round 1 game is 06-16 (a different day) -> still activates.
  row({ player_id: "fra_9", match_label: "France vs Brazil (2026-06-13)", appeared: true, goals: 0 }),
  row({ player_id: "arg_3", match_label: "Argentina vs Chile (2026-06-16)", appeared: true, goals: 1 }),
];
check("sub activates same round on a different day",
  computeScores()[0].items.find((i) => i.pick.is_sub).pts, 6);

/* lineup locks: each matchday scores against the snapshot in effect */
S.managers = [{ id: "m1", name: "M1", draft_position: 1 }];
S.picks = [{ id: "p1", manager_id: "m1", player_id: "bra_2", player_name: "New Def",
  position: "DEF", team: "Brazil", slot: "DEF", is_sub: false, pick_number: 1 }];
S.stats = [
  row({ player_id: "fra_5", match_label: "France vs Chile (2026-06-12)", goals: 1 }),
  row({ player_id: "fra_5", match_label: "France vs Spain (2026-06-16)", goals: 1 }),
  row({ player_id: "bra_2", match_label: "Brazil vs Peru (2026-06-16)", clean_sheet: true }),
];
S.snapshots = [
  { manager_id: "m1", effective_from: "2026-06-10T08:00:00+00:00",
    roster: [{ player_id: "fra_5", player_name: "Old Def", position: "DEF",
               team: "France", is_sub: false, slot: "DEF" }] },
  { manager_id: "m1", effective_from: "2026-06-15T08:00:00+00:00",
    roster: [{ player_id: "bra_2", player_name: "New Def", position: "DEF",
               team: "Brazil", is_sub: false, slot: "DEF" }] },
];
const hist = computeScores()[0];
check("pre-trade points banked, post-trade not credited", hist.total, 6 + 4);
check("current pick scores from lock date only",
  hist.items.find((i) => i.pick.player_id === "bra_2").pts, 4);
check("former player line shows banked points",
  hist.items.find((i) => i.pick.player_id === "__former__").pts, 6);
S.snapshots = [];

/* Flex-formation scoring end-to-end: a bench FORWARD covers a no-show DEFENDER
   (cross-position — fixed mode never would) because the formation stays valid. */
S.fixtures = []; S.snapshots = []; S.stages = [];
S.league = { phase: 1, config: { formationMode: "flex",
  formation: { GK: [0, 0], DEF: [1, 2], MID: [1, 2], FWD: [1, 2], starters: 4 } } };
S.managers = [{ id: "m1", name: "M1", draft_position: 1 }];
S.picks = [
  { manager_id: "m1", player_id: "fra_5", position: "DEF", team: "France", is_sub: false, pick_number: 1 },
  { manager_id: "m1", player_id: "fra_6", position: "DEF", team: "France", is_sub: false, pick_number: 2 },
  { manager_id: "m1", player_id: "arg_5", position: "MID", team: "Argentina", is_sub: false, pick_number: 3 },
  { manager_id: "m1", player_id: "bra_5", position: "FWD", team: "Brazil", is_sub: false, pick_number: 4 },
  { manager_id: "m1", player_id: "ita_9", position: "FWD", team: "Italy", is_sub: true, pick_number: 5 },
];
S.stats = [
  row({ player_id: "fra_6", match_label: "France vs X (2026-06-13)", appeared: true }),   // France played; fra_5 no-show
  row({ player_id: "arg_5", match_label: "Argentina vs Y (2026-06-13)", appeared: true }),
  row({ player_id: "bra_5", match_label: "Brazil vs Z (2026-06-13)", appeared: true }),
  row({ player_id: "ita_9", match_label: "Italy vs W (2026-06-13)", appeared: true, goals: 1 }),
];
{
  const s = computeScores()[0];
  check("flex: bench FWD covers a no-show DEF (cross-position) → scores its 4",
    s.items.find((i) => i.pick.player_id === "ita_9").pts, 4);
  check("flex: the no-show starter scores 0",
    s.items.find((i) => i.pick.player_id === "fra_5").pts, 0);
  check("flex: manager total = the promoted forward's 4", s.total, 4);
}
S.league = {}; S.picks = []; S.stats = [];

/* Captain / vice-captain: the captain's round points double; the vice's double
   instead if the captain didn't play at all that round. */
S.fixtures = []; S.snapshots = []; S.stages = []; S.playerById = {};
S.league = { phase: 1, config: { captain: true } };
S.managers = [{ id: "m1", name: "M1", captain_id: "fra_5", vice_id: "arg_5" }];
S.picks = [
  { manager_id: "m1", player_id: "fra_5", position: "DEF", team: "France", is_sub: false, pick_number: 1 },
  { manager_id: "m1", player_id: "arg_5", position: "MID", team: "Argentina", is_sub: false, pick_number: 2 },
];
S.stats = [
  row({ player_id: "fra_5", match_label: "France vs X (2026-06-13)", appeared: true, goals: 1 }),      // DEF goal 6
  row({ player_id: "arg_5", match_label: "Argentina vs Y (2026-06-13)", appeared: true, goals: 1 }),   // MID goal 5
];
check("captain: the captain's round points double (6→12) + vice 5 = 17",
  computeScores()[0].total, 6 + 6 + 5);
// Captain doesn't play → the vice's points double instead.
S.stats = [row({ player_id: "arg_5", match_label: "Argentina vs Y (2026-06-13)", appeared: true, goals: 1 })];
check("captain: if the captain didn't play, the vice doubles (5→10)",
  computeScores()[0].total, 5 + 5);
S.league = {}; S.managers = []; S.picks = []; S.stats = [];

/* player stats breakdown: per-category points sum to the player total */
S.stats = [
  row({ player_id: "ger_1", match_label: "Germany vs X (2026-06-20)", saves: 5, clean_sheet: true }),
  row({ player_id: "ger_1", match_label: "Germany vs Y (2026-06-24)", saves: 3 }),
  row({ player_id: "ger_5", match_label: "Germany vs X (2026-06-20)", defensive_actions: 5, goals: 1, yellow_cards: 1 }),
];
check("GK breakdown sums to playerPoints",
  playerBreakdown("ger_1", "GK").reduce((s, r) => s + r.pts, 0),
  playerPoints("ger_1", "GK"));
check("GK saves floor per match (2+1, not 4)",
  playerBreakdown("ger_1", "GK").find((r) => r.label.startsWith("Save")).pts, 3);
check("DEF breakdown by rule (rules order)", playerBreakdown("ger_5", "DEF")
  .map((r) => [r.label, r.count, r.pts]),
  [["Goal", 1, 6], ["Yellow card", 1, -1], ["Defensive action (tackle/block/int)", 5, 2]]);

/* trading: slot position groups */
check("SUB_GK and GK same group", slotGroup("SUB_GK"), slotGroup("GK"));
check("SUB_FWD group is FWD", slotGroup("SUB_FWD"), "FWD");
check("DEF and MID differ", slotGroup("DEF") === slotGroup("MID"), false);

/* trading: pair validity */
const pick = (id, slot) => ({ id, slot, player_name: id });
check("GK ⇄ SUB_GK valid", pairValid(pick("a", "GK"), pick("b", "SUB_GK")), true);
check("SUB_DEF ⇄ SUB_DEF valid", pairValid(pick("a", "SUB_DEF"), pick("b", "SUB_DEF")), true);
check("DEF ⇄ MID invalid", pairValid(pick("a", "DEF"), pick("b", "MID")), false);
check("TEAM never tradable", pairValid(pick("a", "TEAM"), pick("b", "TEAM")), false);

/* trading: whole-trade validity */
const P = (id, slot) => pick(id, slot);
check("empty trade rejected", tradeError([]) !== null, true);
check("valid single pair", tradeError([{ mine: P("a", "MID"), theirs: P("b", "SUB_MID") }]), null);
check("valid multi pair", tradeError([
  { mine: P("a", "GK"), theirs: P("b", "GK") },
  { mine: P("c", "FWD"), theirs: P("d", "SUB_FWD") },
]), null);
check("mismatched pair rejected", tradeError([
  { mine: P("a", "DEF"), theirs: P("b", "FWD") },
]) !== null, true);
check("incomplete pair rejected", tradeError([
  { mine: P("a", "DEF"), theirs: null },
]) !== null, true);
check("same pick twice rejected", tradeError([
  { mine: P("a", "DEF"), theirs: P("b", "DEF") },
  { mine: P("a", "DEF"), theirs: P("c", "SUB_DEF") },
]) !== null, true);

/* redraft phases: admin quota, kept players, eliminated managers */
S.league = { num_managers: 4, phase: 2,
  phase_quota: { GK: 1, DEF: 2, MID: 2, FWD: 2 },
  phase_starters: { GK: 1, DEF: 2, MID: 2, FWD: 1 } };
S.managers = [
  { id: "m1", name: "M1", draft_position: 1 },
  { id: "m2", name: "M2", draft_position: 2 },
  { id: "m3", name: "M3", draft_position: 3, eliminated: true, frozen_points: 42 },
];
check("phase 2 quota has no TEAM", posQuota().TEAM, 0);
check("picks per manager from phase quota", picksPerManager(), 7);
check("totalPicks counts active managers only", totalPicks(), 14);
check("kept player counts toward the quota",
  quotaLeft([{ position: "DEF", kept: true }, { position: "DEF" }], "DEF"), 0);
check("kept player still fills a starter slot",
  slotForNewPick([{ position: "DEF", kept: true }, { position: "DEF" }], "DEF"), "SUB_DEF");
check("draft order skips eliminated managers",
  [pickInfo(1).manager.name, pickInfo(2).manager.name, pickInfo(3).manager.name],
  ["M1", "M2", "M2"]);

/* redraft "flex": min 1 per position + 1 fluid outfield slot = 5-player squad */
S.league = { phase: 2, phase_quota: { GK: 1, DEF: 1, MID: 1, FWD: 1 },
  phase_starters: { GK: 1, DEF: 1, MID: 1, FWD: 1 }, phase_flex: 1 };
check("flex: 5 picks per manager", picksPerManager(), 5);
check("flex: GK capped at its minimum", quotaLeft([{ position: "GK" }], "GK"), 0);
check("flex: an empty roster can take up to min+flex of an outfield",
  quotaLeft([], "DEF"), 2);
const fbase = [{ position: "GK", slot: "GK" }, { position: "DEF", slot: "DEF" },
  { position: "MID", slot: "MID" }, { position: "FWD", slot: "FWD" }];
check("flex: one fluid slot left after the minimums (outfield only)",
  ["DEF", "MID", "FWD", "GK"].map((g) => quotaLeft(fbase, g)), [1, 1, 1, 0]);
check("flex: needs-summary names the flex", needsSummary(fbase),
  "Still needs: 1 flex (DEF/MID/FWD)");
const fflex = [...fbase, { position: "MID", slot: "MID" }];
check("flex: squad full once the flex is used",
  ["DEF", "MID"].map((g) => quotaLeft(fflex, g)), [0, 0]);
check("flex: full roster reads complete", needsSummary(fflex), "Roster complete");
// the flex fills a starter slot too, so all five start
const fr = [];
const fpick = (pos) => { const s = slotForNewPick(fr, pos); fr.push({ position: pos, slot: s }); return s; };
check("flex: all five picks are starters",
  [fpick("GK"), fpick("DEF"), fpick("MID"), fpick("FWD"), fpick("MID")],
  ["GK", "DEF", "MID", "FWD", "MID"]);
check("flex: valid lineup with 2 MID (flex used)", lineupValid({ GK: 1, DEF: 1, MID: 2, FWD: 1 }), true);
check("flex: invalid lineup missing a FWD", lineupValid({ GK: 1, DEF: 2, MID: 2, FWD: 0 }), false);
check("flex: invalid lineup with 2 GK", lineupValid({ GK: 2, DEF: 1, MID: 1, FWD: 1 }), false);
// Restore the phase-2 config the following keeper tests expect.
S.league = { phase: 2, phase_quota: { GK: 1, DEF: 2, MID: 2, FWD: 2 },
  phase_starters: { GK: 1, DEF: 2, MID: 2, FWD: 1 } };
S.picks = [];

/* keepers consume the earliest rounds and shrink the draft */
S.picks = [
  { manager_id: "m1", player_id: "k1", player_name: "Kept FWD",
    position: "FWD", team: "X", slot: "FWD", kept: true, pick_number: 3 },
  { manager_id: "m1", player_id: "k2", player_name: "Kept DEF",
    position: "DEF", team: "Y", slot: "DEF", kept: true, pick_number: 7 },
];
check("totalPicks shrinks by kept players", totalPicks(), 12);
check("keeper-holders join the snake after their kept rounds",
  [pickInfo(1).manager.name, pickInfo(1).round,
   pickInfo(2).manager.name, pickInfo(2).round, pickInfo(3).manager.name],
  ["M2", 1, "M2", 2, "M1"]);
check("last pick still lands at the squad size", pickInfo(12).round, 7);
S.picks = [];

/* frozen totals & champion picks in scoring */
S.picks = []; S.stats = []; S.snapshots = [];
S.stages = [{ team: "France", stage: "winner" }];
S.managers = [
  { id: "m1", name: "M1", final_pick: "France" },
  { id: "m2", name: "M2", final_pick: "Brazil" },
  { id: "m3", name: "M3", eliminated: true, frozen_points: 42 },
];
const fin = computeScores();
check("correct champion pick +5", fin[0].total, 5);
check("wrong champion pick scores 0", fin[1].total, 0);
check("eliminated manager shows frozen points",
  [fin[2].total, fin[2].items.length], [42, 0]);
S.stages = [];
check("champion pick pending = 0", computeScores()[0].total, 0);

/* a cut manager keeps their TEAM pick and it keeps scoring as the team advances */
S.stages = [{ team: "Brazil", stage: "qf" }];
S.managers = [{ id: "e1", name: "Cut", eliminated: true, frozen_points: 42 }];
S.picks = [{ manager_id: "e1", player_id: "team:Brazil", slot: "TEAM", position: "TEAM", team: "Brazil" }];
const cut = computeScores()[0];
check("cut manager: frozen player pts + live TEAM bonus",
  cut.total, 42 + calcTeamPoints("qf"));
check("cut manager still lists the TEAM item", cut.items.length, 1);
S.stages = []; S.managers = []; S.picks = [];

/* same-day trade boundary: kickoff times decide which lock applies.
   Round-1 finale at 10:00, trade locked at 14:00, so the morning goal
   stays with the old owner and only later games credit the new one. */
S.fixtures = [
  { home: "Alpha", away: "Beta", kickoff_utc: "2026-06-20T10:00:00+00:00", status: "FT" },
];
S.managers = [{ id: "m1", name: "M1" }, { id: "m2", name: "M2" }];
S.picks = [
  { id: "p1", manager_id: "m1", player_id: "al_9", player_name: "Morning Scorer",
    position: "FWD", team: "Alpha", slot: "FWD", is_sub: false, pick_number: 1 },
  { id: "p2", manager_id: "m2", player_id: "ga_5", player_name: "Quiet Def",
    position: "DEF", team: "Gamma", slot: "DEF", is_sub: false, pick_number: 2 },
];
S.stats = [
  row({ player_id: "al_9", match_label: "Alpha vs Beta (2026-06-20)", goals: 1 }),
  row({ player_id: "al_9", match_label: "Alpha vs Delta (2026-06-22)", goals: 1 }),
];
const fwdAl9 = { player_id: "al_9", player_name: "Morning Scorer",
                 position: "FWD", team: "Alpha", is_sub: false, slot: "FWD" };
const defGa5 = { player_id: "ga_5", player_name: "Quiet Def",
                 position: "DEF", team: "Gamma", is_sub: false, slot: "DEF" };
S.snapshots = [
  { manager_id: "m1", effective_from: "2026-06-15T08:00:00+00:00", roster: [defGa5] },
  { manager_id: "m1", effective_from: "2026-06-20T14:00:00+00:00", roster: [fwdAl9] },
  { manager_id: "m2", effective_from: "2026-06-15T08:00:00+00:00", roster: [fwdAl9] },
  { manager_id: "m2", effective_from: "2026-06-20T14:00:00+00:00", roster: [defGa5] },
];
const sameDay = computeScores();
check("morning goal stays with the old owner", sameDay[1].total, 4);
check("new owner only gets post-trade games", sameDay[0].total, 4);
check("unknown kickoff falls back to end-of-day (lock still applies)",
  sameDay[0].items.find((i) => i.pick.player_id === "al_9").pts, 4);
S.fixtures = []; S.snapshots = [];

/* draft-night grace: draft + lineup window ran during the opening game,
   so no lock predates kickoff — the latest same-day lock counts, and the
   sub->starter promotion made during the match still pays out. */
S.fixtures = [
  { home: "Alpha", away: "Beta", kickoff_utc: "2026-06-11T19:00:00+00:00", status: "FT" },
];
S.managers = [{ id: "m1", name: "M1" }];
S.picks = [
  { id: "p1", manager_id: "m1", player_id: "al_9", player_name: "Opening Scorer",
    position: "FWD", team: "Alpha", slot: "FWD", is_sub: false, pick_number: 1 },
];
S.stats = [
  row({ player_id: "al_9", match_label: "Alpha vs Beta (2026-06-11)", goals: 1 }),
];
S.snapshots = [
  { manager_id: "m1", effective_from: "2026-06-11T20:00:00+00:00",   // draft baseline: sub
    roster: [{ player_id: "al_9", player_name: "Opening Scorer",
               position: "FWD", team: "Alpha", is_sub: true, slot: "SUB_FWD" }] },
  { manager_id: "m1", effective_from: "2026-06-11T20:15:00+00:00",   // lineup window: starter
    roster: [{ player_id: "al_9", player_name: "Opening Scorer",
               position: "FWD", team: "Alpha", is_sub: false, slot: "FWD" }] },
];
check("draft-night promotion still scores the opening game",
  computeScores()[0].total, 4);
S.fixtures = []; S.snapshots = [];

/* suspension indicator (best-effort, from our own card data) */
S.stats = [
  row({ player_id: "x1", match_label: "A vs B (2026-06-15)", red_cards: 1 }),
  row({ player_id: "x2", match_label: "A vs B (2026-06-15)", yellow_cards: 1 }),
  row({ player_id: "x2", match_label: "A vs C (2026-06-20)", yellow_cards: 1 }),
  row({ player_id: "x3", match_label: "A vs B (2026-06-15)", yellow_cards: 1 }),
  row({ player_id: "x4", match_label: "A vs B (2026-06-15)", red_cards: 1 }),
  row({ player_id: "x4", match_label: "A vs C (2026-06-20)" }),
  row({ player_id: "x5", match_label: "A vs B (2026-07-08)", yellow_cards: 1 }),
  row({ player_id: "x5", match_label: "A vs C (2026-07-14)", yellow_cards: 1 }),
  row({ player_id: "x6", match_label: "A vs B (2026-06-15)", yellow_cards: 2, red_cards: 1 }),
  row({ player_id: "x6", match_label: "A vs C (2026-06-20)", yellow_cards: 1 }),
  // group-stage yellow + Round-of-32 yellow: wiped at the group boundary, so
  // they don't combine (the Casemiro case — plays the R16).
  row({ player_id: "x8", match_label: "A vs B (2026-06-20)", yellow_cards: 1 }),
  row({ player_id: "x8", match_label: "A vs C (2026-06-30)", yellow_cards: 1 }),
];
check("red card -> suspended next match", suspendedNext("x1"), "red card");
check("2nd group yellow -> suspended (banned for R32)", suspendedNext("x2"), "2 yellows");
check("single yellow -> fine", suspendedNext("x3"), null);
check("ban cleared after playing again", suspendedNext("x4"), null);
check("yellow slate wiped after the QFs", suspendedNext("x5"), null);
check("two-yellow red doesn't count toward accumulation", suspendedNext("x6"), null);
check("no stats -> no flag", suspendedNext("x7"), null);
check("group + knockout yellow don't combine (wiped after group stage)",
  suspendedNext("x8"), null);

/* QF/semi boundary: a 2nd yellow IN the quarter-final still bans you for the
   semi (bookings reset only AFTER the QFs). The reset date is derived from the
   fixtures, so the last QF date (2026-07-12) must NOT fall in the semi window. */
S.fixtures = [
  { home: "A", away: "B", date: "2026-06-28", round: "Round of 32" },
  { home: "X", away: "Y", date: "2026-07-09", round: "Quarter-finals" },
  { home: "Argentina", away: "Switzerland", date: "2026-07-12", round: "Quarter-finals" },
];
S.stats = [
  row({ player_id: "q1", match_label: "Team vs Foe (2026-07-06)", yellow_cards: 1 }),      // R16 booking
  row({ player_id: "q1", match_label: "Argentina vs Switzerland (2026-07-12)", yellow_cards: 1 }), // 2nd, in the QF (last QF day)
  row({ player_id: "q2", match_label: "Argentina vs Switzerland (2026-07-12)", yellow_cards: 1 }), // a single QF yellow
];
check("2nd yellow in the QF (last QF date) bans for the semi", suspendedNext("q1"), "2 yellows");
check("a single QF yellow is not yet a suspension", suspendedNext("q2"), null);
S.fixtures = []; S.stats = [];

/* player detail: per-match lineup status, owner, team matches, category totals */
S.fixtures = [
  { home: "Brazil", away: "Chile", kickoff_utc: "2026-06-22T19:00:00+00:00", status: "FT" },
];
S.managers = [{ id: "m1", name: "Koen" }, { id: "m2", name: "Sam" }];
S.picks = [
  { id: "p1", manager_id: "m1", player_id: "bra_4", player_name: "Z One",
    position: "DEF", team: "Brazil", slot: "DEF", is_sub: false, pick_number: 1 },
];
S.playerById = { bra_4: { player_id: "bra_4", name: "Z One", position: "DEF", team: "Brazil" } };
S.snapshots = [
  { manager_id: "m1", effective_from: "2026-06-21T08:00:00+00:00",
    roster: [{ player_id: "bra_4", player_name: "Z One", position: "DEF",
               team: "Brazil", is_sub: false, slot: "DEF" }] },
];
S.stats = [
  row({ player_id: "bra_4", match_label: "Brazil vs Chile (2026-06-22)",
        goals: 1, defensive_actions: 4, yellow_cards: 1, minutes: 90 }),
  row({ player_id: "chi_9", match_label: "Brazil vs Chile (2026-06-22)", goals: 2, minutes: 90 }),
];
check("teamMatchLabels finds the team's games",
  teamMatchLabels("Brazil"), ["Brazil vs Chile (2026-06-22)"]);
check("entryForManagerAt: starter in my locked lineup",
  slotLabel(entryForManagerAt("m1", "bra_4", "Brazil vs Chile (2026-06-22)")), "starter");
check("entryForManagerAt: not in another manager's team",
  entryForManagerAt("m2", "bra_4", "Brazil vs Chile (2026-06-22)"), null);
check("ownerEntryAt: resolves the fielding manager",
  ownerEntryAt("bra_4", "Brazil vs Chile (2026-06-22)").manager.name, "Koen");
check("ownerEntryAt: free agent when unrostered",
  ownerEntryAt("chi_9", "Brazil vs Chile (2026-06-22)"), null);
check("playerStatTotal sums a numeric category", playerStatTotal("bra_4", "defensive_actions"), 4);
check("playerStatTotal counts goals", playerStatTotal("bra_4", "goals"), 1);
check("playerStatTotal counts boolean clean sheets",
  playerStatTotal("bra_4", "clean_sheet"), 0);
S.fixtures = []; S.snapshots = []; S.picks = [];

/* managerHistory: current view (credited + former) ties out to the
   leaderboard, and past rounds split points by lock period. */
S.fixtures = [];
S.managers = [{ id: "m1", name: "Koen" }];
S.picks = [{ id: "p2", manager_id: "m1", player_id: "bra_2", player_name: "New Def",
  position: "DEF", team: "Brazil", slot: "DEF", is_sub: false, pick_number: 1 }];
S.playerById = {
  fra_5: { player_id: "fra_5", name: "Old Def", position: "DEF", team: "France" },
  bra_2: { player_id: "bra_2", name: "New Def", position: "DEF", team: "Brazil" },
};
S.stats = [
  row({ player_id: "fra_5", match_label: "France vs Chile (2026-06-12)", goals: 1 }),
  row({ player_id: "bra_2", match_label: "Brazil vs Peru (2026-06-16)", clean_sheet: true }),
];
S.snapshots = [
  { manager_id: "m1", effective_from: "2026-06-10T08:00:00+00:00",
    roster: [{ player_id: "fra_5", player_name: "Old Def", position: "DEF",
               team: "France", is_sub: false, slot: "DEF" }] },
  { manager_id: "m1", effective_from: "2026-06-15T08:00:00+00:00",
    roster: [{ player_id: "bra_2", player_name: "New Def", position: "DEF",
               team: "Brazil", is_sub: false, slot: "DEF" }] },
];
const mh = managerHistory("m1");
check("history total ties out to leaderboard", mh.total, computeScores()[0].total);
check("history total is 6 banked + 4 current", mh.total, 10);
check("current view itemises the former player",
  mh.current.former.map((f) => [f.entry.player_id, f.pts]), [["fra_5", 6]]);
check("current view shows current player credited", mh.current.items[0].pts, 4);
check("two past rounds, one per lock period",
  mh.rounds.map((r) => [r.n, r.subtotal]), [[1, 6], [2, 4]]);
check("round 1 covers the pre-trade matchday", mh.rounds[0].dates, ["2026-06-12"]);
S.fixtures = []; S.snapshots = []; S.picks = []; S.playerById = {};

/* "played since last lock" highlight + starters-yet-to-play counter */
S.fixtures = [];
S.managers = [{ id: "m1", name: "Koen" }];
S.playerById = {
  fra_5: { player_id: "fra_5", name: "P5", position: "DEF", team: "France" },
  arg_3: { player_id: "arg_3", name: "P3", position: "MID", team: "Argentina" },
  ger_7: { player_id: "ger_7", name: "P7", position: "FWD", team: "Germany" },
};
S.picks = [
  { id: "a", manager_id: "m1", player_id: "fra_5", player_name: "P5",
    position: "DEF", team: "France", slot: "DEF", is_sub: false, pick_number: 1 },
  { id: "b", manager_id: "m1", player_id: "arg_3", player_name: "P3",
    position: "MID", team: "Argentina", slot: "MID", is_sub: false, pick_number: 2 },
  { id: "c", manager_id: "m1", player_id: "ger_7", player_name: "P7",
    position: "FWD", team: "Germany", slot: "SUB_FWD", is_sub: true, pick_number: 3 },
];
S.snapshots = [{ manager_id: "m1", effective_from: "2026-06-10T08:00:00+00:00",
  roster: S.picks.map((pk) => ({ player_id: pk.player_id, player_name: pk.player_name,
    position: pk.position, team: pk.team, is_sub: pk.is_sub, slot: pk.slot })) }];
// fra_5 played (0 pts) after the lock; arg_3 hasn't; ger_7 is a sub.
S.stats = [row({ player_id: "fra_5", match_label: "France vs Chile (2026-06-12)", goals: 0 })];
const playedBy = Object.fromEntries(
  managerHistory("m1").current.items.map((i) => [i.entry.player_id, i.played]));
check("played-since-lock true even at 0 pts", playedBy.fra_5, true);
check("yet-to-play starter not flagged played", playedBy.arg_3, false);
const ytp = computeYetToPlay().m1;
check("yet-to-play counts only starters",
  [ytp.played, ytp.total, ytp.yet, ytp.hasSnapshot], [1, 2, 1, true]);
// before any lineup lock the counter is suppressed
S.snapshots = [];
check("no snapshot -> not flagged played", managerHistory("m1").current.items[0].played, false);
check("no snapshot -> counter suppressed", computeYetToPlay().m1.hasSnapshot, false);
S.fixtures = []; S.snapshots = []; S.picks = []; S.playerById = {};

/* draft pool keeps picked players visible (Feature B); the auto-pick /
   quota pool (availableForGroup) still excludes them. */
S.players = [
  { player_id: "fra_5", name: "A", position: "DEF", team: "France" },
  { player_id: "fra_6", name: "B", position: "DEF", team: "France" },
];
S.teams = ["France"];
S.picks = [{ manager_id: "m1", player_id: "fra_5", position: "DEF" }];
check("poolEntries keeps picked players in the list",
  poolEntries("DEF").map((e) => e.player_id).sort(), ["fra_5", "fra_6"]);
check("availableForGroup excludes picked (auto-pick pool)",
  availableForGroup("DEF").map((e) => e.player_id), ["fra_6"]);
S.players = []; S.teams = []; S.picks = [];

/* knocked-out teams: eliminated flag drives badges + draft/swap blocking */
S.stages = [{ team: "France", stage: "r32", eliminated: true },
            { team: "Brazil", stage: "r16" }];
check("isEliminated reads the eliminated flag", isEliminated("France"), true);
check("non-eliminated team is in", isEliminated("Brazil"), false);
check("unknown team defaults to in", isEliminated("Spain"), false);
S.stages = [];

/* squad planner: choice ranking + acquirability tiers (viewing manager m1) */
S.managers = [
  { id: "m1", name: "Koen", planner: { moves: [{ out: "pk_out", choices: ["arg_8", "bra_5"] }] } },
  { id: "m2", name: "Sam" },
];
S.playerById = {
  arg_8: { player_id: "arg_8", name: "FA", position: "MID", team: "Argentina" },
  bra_5: { player_id: "bra_5", name: "Owned", position: "MID", team: "Brazil" },
  fra_1: { player_id: "fra_1", name: "Mine", position: "MID", team: "France" },
};
S.picks = [
  { id: "pk_out", manager_id: "m1", player_id: "fra_1", player_name: "Mine",
    position: "MID", team: "France", slot: "MID" },
  { id: "pk_b", manager_id: "m2", player_id: "bra_5", player_name: "Owned",
    position: "MID", team: "Brazil", slot: "MID" },
];
S.stages = [];
check("planner rank: first choice is 1", plannerChoiceRank("arg_8"), 1);
check("planner rank: backup is 2", plannerChoiceRank("bra_5"), 2);
check("planner rank: unplanned is null", plannerChoiceRank("zzz"), null);
check("choice status: unrostered = free agent", choiceStatus("arg_8").kind, "fa");
check("choice status: other roster = owned", choiceStatus("bra_5").kind, "owned");
check("choice status: my roster = yours", choiceStatus("fra_1").kind, "yours");
S.stages = [{ team: "Argentina", eliminated: true }];
check("choice status: eliminated team = ko", choiceStatus("arg_8").kind, "ko");
S.stages = []; S.managers = []; S.picks = []; S.playerById = {};

/* squad-planner replacement picker pool: position scope, own-roster exclusion,
   shortlist + nation filters, and keeping already-chosen players visible. */
S.managers = [{ id: "m1", name: "Koen", shortlist: ["arg_8", "bra_5"],
  planner: { moves: [{ out: "pk_out", choices: ["arg_8"] }] } }];
S.players = [
  { player_id: "arg_8", name: "Aaa", position: "MID", team: "Argentina" },
  { player_id: "bra_5", name: "Bbb", position: "MID", team: "Brazil" },
  { player_id: "fra_1", name: "Ccc", position: "MID", team: "France" }, // on my roster
  { player_id: "esp_2", name: "Ddd", position: "MID", team: "Spain" },
  { player_id: "gk_1", name: "Eee", position: "GK", team: "Spain" },
];
S.playerById = Object.fromEntries(S.players.map((p) => [p.player_id, p]));
S.picks = [{ id: "pk_out", manager_id: "m1", player_id: "fra_1",
  position: "MID", team: "France", slot: "MID" }];
S.stats = [];
const pickIds = (opts) => plannerPickPool("MID", opts).map((x) => x.p.player_id);
check("picker excludes own-roster player", pickIds({}).includes("fra_1"), false);
check("picker excludes other positions", pickIds({}).includes("gk_1"), false);
check("picker keeps an already-chosen player", pickIds({}).includes("arg_8"), true);
check("picker shortlist-only filter", pickIds({ shortlistOnly: true }).sort(), ["arg_8", "bra_5"]);
check("picker search filters by team", pickIds({ q: "Spain" }), ["esp_2"]);
S.managers = []; S.picks = []; S.playerById = {}; S.players = []; S.stats = [];

/* auto-pick on a timeout: shortlist first (valid only), else the full pool,
   never a knocked-out team. Phase-1 quota GK2/DEF4/MID4/FWD3/TEAM1. */
S.league = { id: "L1", phase: 1 };
S.stages = [{ team: "Brazil", eliminated: true }];
S.players = [
  { player_id: "fra_1", name: "Fwd A", position: "FWD", team: "France" },
  { player_id: "esp_1", name: "Fwd B", position: "FWD", team: "Spain" },
  { player_id: "bra_1", name: "Fwd KO", position: "FWD", team: "Brazil" },   // knocked out
  { player_id: "arg_1", name: "Gk A", position: "GK", team: "Argentina" },
];
S.playerById = Object.fromEntries(S.players.map((p) => [p.player_id, p]));
const apMgr = { id: "m1", name: "Koen",
  shortlist: ["bra_1", "esp_1", "arg_1"] };   // bra_1 is KO, arg_1 is a GK
S.managers = [apMgr];
// GK and TEAM quotas already filled (closed); only FWD/DEF/MID open, and only
// FWD has any players defined here.
S.picks = [
  { manager_id: "m1", player_id: "gk_x", position: "GK", slot: "GK", is_sub: false },
  { manager_id: "m1", player_id: "gk_y", position: "GK", slot: "SUB_GK", is_sub: true },
  { manager_id: "m1", player_id: "team:Germany", position: "TEAM", slot: "TEAM", is_sub: false },
];
const apc = autoPickCandidates(apMgr);
check("entryForId resolves a player", entryForId("fra_1").team, "France");
check("entryForId resolves a TEAM id", entryForId("team:Spain"),
  { player_id: "team:Spain", name: "Spain", position: "TEAM", team: "Spain" });
check("auto-pick shortlist excludes KO + closed-quota position",
  apc.shortlist.map((e) => e.player_id), ["esp_1"]);
check("auto-pick pool excludes KO and already-picked",
  apc.pool.some((e) => e.team === "Brazil"), false);
check("auto-pick pool has the open-position players",
  apc.pool.map((e) => e.player_id).sort(), ["esp_1", "fra_1"]);
// No valid shortlist entries -> falls back to the pool (still no KO).
apMgr.shortlist = ["bra_1"];
const apc2 = autoPickCandidates(apMgr);
check("empty valid shortlist -> use pool", apc2.shortlist.length, 0);
check("fallback pool still non-empty and KO-free",
  [apc2.pool.length > 0, apc2.pool.some((e) => e.team === "Brazil")], [true, false]);
S.league = null; S.stages = []; S.managers = []; S.picks = [];
S.playerById = {}; S.players = [];

/* showView only scrolls to top on an actual view change, so a re-render
   of the current view (e.g. the refetch after starring) doesn't jump. */
scrollCalls = 0;
showView("board");
check("entering a view scrolls to top", scrollCalls, 1);
showView("board");
showView("board");
check("re-showing the same view does not scroll", scrollCalls, 1);
showView("draft");
check("changing view scrolls again", scrollCalls, 2);

/* Stats-tab depth: round scoping, per-90 rates, recent form. */
S.stages = []; S.managers = []; S.picks = []; S.fixtures = [];
S.playerById = {
  gk_1: { player_id: "gk_1", name: "Keeper", position: "GK", team: "Alpha" },
};
S.stats = [
  // Alpha's three matches (rounds 1-3) for gk_1.
  { player_id: "gk_1", match_label: "Alpha vs Beta (2026-06-10)", appeared: true, goals: 1, minutes: 90, clean_sheet: true },
  { player_id: "gk_1", match_label: "Alpha vs Gamma (2026-06-14)", appeared: true, goals: 0, minutes: 45 },
  { player_id: "gk_1", match_label: "Delta vs Alpha (2026-06-18)", appeared: true, goals: 2, minutes: 90, red_cards: 1 },
];
// Round scoping: round 1 = each team's first match (by date).
check("statsScopedRows round 0 = all", statsScopedRows("gk_1", "Alpha", 0).length, 3);
check("statsScopedRows round 1 = first match",
  statsScopedRows("gk_1", "Alpha", 1).map((r) => r.goals), [1]);
check("statsScopedRows round 3 = third match",
  statsScopedRows("gk_1", "Alpha", 3).map((r) => r.goals), [2]);
check("statsScopedRows out-of-range round = empty",
  statsScopedRows("gk_1", "Alpha", 9).length, 0);
// Stat totals and minutes over a row set.
const allRows = statsScopedRows("gk_1", "Alpha", 0);
check("sumStatKey goals over all rounds", sumStatKey(allRows, "goals"), 3);
check("sumStatKey clean_sheet counts booleans", sumStatKey(allRows, "clean_sheet"), 1);
check("sumMinutes totals played minutes", sumMinutes(allRows), 225);
check("sumMinutes treats null minutes as a full 90",
  sumMinutes([{ appeared: true, minutes: null }]), 90);
// Form: appearance points, newest last; GK goal = 8, cs = 6, red = -3.
check("formLog is chronological newest-last",
  formLog("gk_1", "GK", 3).map((f) => f.pts), [8 + 6, 0, 16 - 3]);
// Form metric = average points over the last 5 appearances (here only 3).
check("formAvg averages the last 5 (only 3) appearances",
  formAvg("gk_1", "GK", 5), 9);            // (14 + 0 + 13) / 3 = 9
check("formAvg window of 1 = latest only", formAvg("gk_1", "GK", 1), 13);
check("formAvg no appearances = 0", formAvg("nobody", "GK", 5), 0);
// Form-dot color ramp: brighter green = better game (dim→bright), then purple.
check("formDotColor negative = red", formDotColor(-3), "bg-red-500");
check("formDotColor zero = grey", formDotColor(0), "bg-slate-600");
check("formDotColor 1-2 = dim green", formDotColor(2), "bg-emerald-800");
check("formDotColor >2 = mid green", formDotColor(3), "bg-emerald-600");
check("formDotColor 5 boundary stays mid green", formDotColor(5), "bg-emerald-600");
check("formDotColor >5 = bright green", formDotColor(6), "bg-emerald-400");
check("formDotColor 10 boundary stays bright green", formDotColor(10), "bg-emerald-400");
check("formDotColor >10 = purple", formDotColor(11), "bg-purple-500");
// Shortlist "Clean": drop knocked-out players, keep alive and unknown ids.
S.stages = [{ team: "OutLand", eliminated: true }, { team: "AliveLand", eliminated: false }];
S.playerById = {
  ko1: { player_id: "ko1", team: "OutLand", position: "FWD", name: "KO" },
  ok1: { player_id: "ok1", team: "AliveLand", position: "MID", name: "OK" },
};
check("shortlistCleaned drops KO, keeps alive + unknown ids",
  shortlistCleaned(["ko1", "ok1", "stale9"]), ["ok1", "stale9"]);
check("shortlistCleaned no-op when nobody is out",
  shortlistCleaned(["ok1"]), ["ok1"]);
S.stages = []; S.stats = []; S.playerById = {};

// Standings movement: computeScores buckets player-match points by round, so
// the board can diff rank now vs. before the current round.
S.managers = [{ id: "m1", name: "Ann" }]; S.stages = []; S.fixtures = []; S.snapshots = [];
S.picks = [{ manager_id: "m1", player_id: "fwd_a", position: "FWD", is_sub: false,
            slot: "FWD", pick_number: 1, player_name: "Ace", team: "A" }];
S.playerById = { fwd_a: { player_id: "fwd_a", name: "Ace", position: "FWD", team: "A" } };
S.stats = [
  { player_id: "fwd_a", match_label: "A vs B (2026-06-10)", appeared: true, goals: 1, minutes: 90 },
  { player_id: "fwd_a", match_label: "A vs C (2026-06-14)", appeared: true, goals: 1, minutes: 90 },
];
const rpsc = computeScores()[0];   // FWD goal = 4
check("roundPts buckets player points by round", [rpsc.roundPts[1], rpsc.roundPts[2]], [4, 4]);
check("roundPts sum equals total", rpsc.total, 8);
S.picks = []; S.managers = []; S.stats = []; S.playerById = {};

// standingsMovement: after round 2, a manager who out-scored the leader that
// round jumps them → ▲ for the climber, ▼ for the overtaken, level otherwise.
{
  const scores = [
    { manager: { id: "b" }, total: 20, roundPts: { 1: 10, 2: 10 } },  // was 10 (2nd), now 20 (1st)
    { manager: { id: "a" }, total: 18, roundPts: { 1: 15, 2: 3 } },   // was 15 (1st), now 18 (2nd)
    { manager: { id: "c" }, total: 5, roundPts: { 1: 3, 2: 2 } },     // stays 3rd
  ];
  const mv = standingsMovement(scores);
  check("movement current round = round 2", mv.maxRound, 2);
  check("movement shown once 2 rounds exist", mv.showMovement, true);
  check("climber moved up (+1)", mv.byId.b.delta, 1);
  check("overtaken moved down (-1)", mv.byId.a.delta, -1);
  check("unchanged manager is level (0)", mv.byId.c.delta, 0);
  check("this-round tally surfaced", [mv.byId.b.roundPts, mv.byId.a.roundPts], [10, 3]);
  check("round MVP = top scorer of the current round", [...roundMVPs(scores)], ["b"]);
}
// One round only → no movement yet.
check("single round hides movement",
  standingsMovement([{ manager: { id: "x" }, total: 4, roundPts: { 1: 4 } }]).showMovement, false);
// Round MVP: ties shared, none before any scoring, eliminated excluded.
check("round MVP ties are shared", [...roundMVPs([
  { manager: { id: "a" }, total: 5, roundPts: { 1: 5 } },
  { manager: { id: "b" }, total: 5, roundPts: { 1: 5 } }])].sort(), ["a", "b"]);
check("no round MVP before any scoring",
  roundMVPs([{ manager: { id: "x" }, total: 0, roundPts: {} }]).size, 0);
// Season chart series = cumulative points by round (seeded at 0); H2H per round.
{
  const scores = [
    { manager: { id: "a", name: "A" }, total: 20, roundPts: { 1: 10, 2: 10 } },
    { manager: { id: "b", name: "B" }, total: 18, roundPts: { 1: 15, 2: 3 } },
    { manager: { id: "c", name: "C" }, total: 5, eliminated: true, frozen_points: 5 },
  ];
  const ss = seasonSeries(scores);
  check("season chart spans the played rounds", ss.maxR, 2);
  check("cumulative series seeded at 0 then adds each round",
    ss.series.find((s) => s.id === "a").pts, [0, 10, 20]);
  check("eliminated managers (no round history) are left off the chart",
    ss.series.map((s) => s.id), ["a", "b"]);
  const hh = headToHead(scores, "a", "b");
  check("head-to-head counts round wins/losses from A's view",
    [hh.w, hh.l, hh.t], [1, 1, 0]);   // R1: B 15>10 (A loss); R2: A 10>3 (A win)
}

// Home current-team view: per-round points, "played this round" flag, and the
// Dream XI badge all key off the current round (each team's Nth match).
S.league = { phase: 1 }; S.managers = [{ id: "m1", name: "Me" }];
S.stages = []; S.snapshots = []; S.fixtures = [];
S.playerById = {
  fwd_a: { player_id: "fwd_a", name: "Ace", position: "FWD", team: "A" },
  mid_b: { player_id: "mid_b", name: "Boe", position: "MID", team: "B" },
};
S.picks = [
  { id: "pa", manager_id: "m1", player_id: "fwd_a", player_name: "Ace", position: "FWD", team: "A", slot: "FWD", is_sub: false, pick_number: 1 },
  { id: "pb", manager_id: "m1", player_id: "mid_b", player_name: "Boe", position: "MID", team: "B", slot: "MID", is_sub: false, pick_number: 2 },
];
S.stats = [
  { player_id: "fwd_a", match_label: "A vs X (2026-06-10)", appeared: true, goals: 1, minutes: 90 },  // round 1
  { player_id: "fwd_a", match_label: "A vs Y (2026-06-14)", appeared: true, goals: 2, minutes: 90 },  // round 2
  { player_id: "mid_b", match_label: "B vs Z (2026-06-10)", appeared: true, goals: 1, minutes: 90 },  // round 1 only
];
check("currentRoundNo = furthest team round", currentRoundNo(), 2);
const mh2 = managerHistory("m1");
check("managerHistory exposes current round", mh2.curRound, 2);
const byPid = Object.fromEntries(mh2.current.items.map((i) => [i.entry.player_id, i]));
check("roundPts counts only the current round", byPid.fwd_a.roundPts, 8);   // FWD 2 goals ×4
check("player who skipped this round scores 0 this round", byPid.mid_b.roundPts, 0);
check("playedRound true only if featured this round",
  [byPid.fwd_a.playedRound, byPid.mid_b.playedRound], [true, false]);
check("cumulative pts still span all rounds", byPid.fwd_a.pts, 12);         // 4 + 8
const dreamIds = currentRoundDreamIds();
check("Dream XI badge set holds this round's best, not last round's",
  [dreamIds.has("fwd_a"), dreamIds.has("mid_b")], [true, false]);
S.league = {}; S.managers = []; S.picks = []; S.stats = []; S.playerById = {};

// Chat: league group room + 1:1 DM threads (session manager is "m1").
S.managers = [{ id: "m1", name: "Me" }, { id: "m2", name: "Bob" }, { id: "m3", name: "Cat" }];
S.messages = [
  { sender_id: "m2", recipient_id: null, body: "hi all", created_at: "2026-06-01T00:00:01Z" },
  { sender_id: "m2", recipient_id: "m1", body: "yo", created_at: "2026-06-01T00:00:02Z" },
  { sender_id: "m1", recipient_id: "m2", body: "sup", created_at: "2026-06-01T00:00:03Z" },
  { sender_id: "m2", recipient_id: "m3", body: "not yours", created_at: "2026-06-01T00:00:04Z" },
];
S.chatSeen = {};
check("chatThreads = league + other managers (not me)",
  chatThreads().map((t) => t.id), ["league", "m2", "m3"]);
check("league thread = only group messages",
  messagesForThread("league", "m1").map((m) => m.body), ["hi all"]);
check("DM thread = both directions between me and them",
  messagesForThread("m2", "m1").map((m) => m.body), ["yo", "sup"]);
check("DM thread excludes others' private messages",
  messagesForThread("m2", "m1").some((m) => m.body === "not yours"), false);
check("unread counts others' messages I haven't seen", threadUnread("league", "m1"), 1);
check("unread ignores my own messages", threadUnread("m2", "m1"), 1);   // "yo" only, not my "sup"
markThreadSeen("m2", "m1");
check("marking a thread seen clears its unread", threadUnread("m2", "m1"), 0);
// Active DMs sort to the front (by most recent message); league stays first.
S.messages = [
  { sender_id: "m3", recipient_id: "m1", body: "hey", created_at: "2026-06-02T00:00:05Z" },
  { sender_id: "m2", recipient_id: "m1", body: "yo", created_at: "2026-06-02T00:00:02Z" },
];
check("chat: league first, then DMs by recent activity",
  chatThreads().map((t) => t.id), ["league", "m3", "m2"]);
S.managers = []; S.messages = []; S.chatSeen = {};

/* unpicked / hide-KO filters (planner pool; same predicates power stats & shortlist) */
S.managers = [{ id: "m1", name: "Me" }];
S.players = [
  { player_id: "a", position: "MID", team: "Alive", name: "A" },   // free agent, alive
  { player_id: "b", position: "MID", team: "Alive", name: "B" },   // owned by m2
  { player_id: "c", position: "MID", team: "OutLand", name: "C" }, // free agent, knocked out
  { player_id: "d", position: "MID", team: "Alive", name: "D" },   // on my roster
];
S.playerById = Object.fromEntries(S.players.map((p) => [p.player_id, p]));
S.picks = [{ manager_id: "m2", player_id: "b" }, { manager_id: "m1", player_id: "d" }];
S.stages = [{ team: "OutLand", eliminated: true }];
check("planner: unpicked filter = free agents only",
  plannerPickPool("MID", { unpicked: true }).map((x) => x.p.player_id), ["a", "c"]);
check("planner: hide-KO filter drops eliminated teams",
  plannerPickPool("MID", { hideKO: true }).map((x) => x.p.player_id), ["a", "b"]);
check("planner: both filters = available and alive",
  plannerPickPool("MID", { unpicked: true, hideKO: true }).map((x) => x.p.player_id), ["a"]);
S.managers = []; S.players = []; S.playerById = {}; S.picks = []; S.stages = [];

// Knockout bracket: round classification, structure, scores, winner detection.
check("koRoundOf maps the feed's round labels",
  ["Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final", "3rd Place Final", "Group Stage - 1"]
    .map(koRoundOf), ["R32", "R16", "QF", "SF", "F", "3rd", null]);
S.stats = []; S.playerById = {};
S.fixtures = [
  { home: "A", away: "B", date: "2026-06-28", kickoff_utc: "2026-06-28T18:00:00Z", round: "Round of 32", home_score: 2, away_score: 1 },
  { home: "C", away: "D", date: "2026-06-29", kickoff_utc: "2026-06-29T18:00:00Z", round: "Round of 32", home_score: 1, away_score: 1 }, // pens; C advances
  { home: "A", away: "C", date: "2026-07-03", kickoff_utc: "2026-07-03T18:00:00Z", round: "Round of 16", home_score: null, away_score: null },
  { home: "E", away: "F", date: "2026-07-10", kickoff_utc: "2026-07-10T18:00:00Z", round: "3rd Place Final", home_score: null, away_score: null },
];
const bk = knockoutBracket();
check("bracket groups rounds in order", bk.rounds.map((r) => r.key), ["R32", "R16"]);
check("third-place match split out", bk.third && bk.third.home, "E");
const r32 = bk.rounds[0].matches;
check("decided match: higher score wins", [r32[0].winner, r32[0].score], ["A", [2, 1]]);
check("penalty draw: winner is who advanced to the next round",
  [r32[1].winner, r32[1].score], ["C", [1, 1]]);
check("unplayed match has no winner yet", bk.rounds[1].matches[0].winner, null);
check("tree links each tie to its two feeder matches",
  bk.rounds[1].matches[0].feeders.map((x) => x.home), ["A", "C"]);
// match_stats result overrides the fixture's stored score (live/pulled)
S.stats = [{ match_label: "A vs B (2026-06-28)", home_score: 3, away_score: 0, player_id: "x" }];
check("live/pulled score overrides fixture score",
  knockoutBracket().rounds[0].matches[0].score, [3, 0]);
// Finished games must NOT show as live (the reported bug).
S.stats = [];
S.fixtures = [
  { home: "X", away: "Y", date: "2000-01-01", kickoff_utc: "2000-01-01T00:00:00Z", round: "Round of 32", status: "FT", home_score: 1, away_score: 0 },
  { home: "P", away: "Q", date: "2000-01-02", kickoff_utc: "2000-01-02T00:00:00Z", round: "Round of 32", status: "NS", home_score: null, away_score: null },
];
const koLive = knockoutBracket().rounds[0].matches;
check("finished game (FT) is not flagged live", koLive.find((m) => m.home === "X").live, false);
check("long-past game not live even without an FT status",
  koLive.find((m) => m.home === "P").live, false);
// Unconfirmed rounds (semis/final/3rd) appear as TBC and link forward by
// position: each next-round slot is fed by the adjacent pair below it.
S.fixtures = [
  { home: "A", away: "B", date: "2026-07-09", kickoff_utc: "2026-07-09T18:00:00Z", round: "Quarter-finals", home_score: 2, away_score: 0 },
  { home: "C", away: "D", date: "2026-07-09", kickoff_utc: "2026-07-09T21:00:00Z", round: "Quarter-finals", home_score: 1, away_score: 0 },
  { home: "E", away: "F", date: "2026-07-10", kickoff_utc: "2026-07-10T18:00:00Z", round: "Quarter-finals", home_score: 3, away_score: 1 },
  { home: "G", away: "H", date: "2026-07-10", kickoff_utc: "2026-07-10T21:00:00Z", round: "Quarter-finals", home_score: 2, away_score: 1 },
  { home: "TBC", away: "TBC", date: "2026-07-14", kickoff_utc: "2026-07-14T20:00:00Z", round: "Semi-finals", home_score: null, away_score: null },
  { home: "TBC", away: "TBC", date: "2026-07-15", kickoff_utc: "2026-07-15T20:00:00Z", round: "Semi-finals", home_score: null, away_score: null },
  { home: "TBC", away: "TBC", date: "2026-07-18", kickoff_utc: "2026-07-18T20:00:00Z", round: "Final", home_score: null, away_score: null },
  { home: "TBC", away: "TBC", date: "2026-07-17", kickoff_utc: "2026-07-17T20:00:00Z", round: "3rd Place Final", home_score: null, away_score: null },
];
const tb = knockoutBracket();
check("bracket extends to SF + Final", tb.rounds.map((r) => r.key), ["QF", "SF", "F"]);
check("third-place TBC match included", tb.third && [tb.third.home, tb.third.away], ["TBC", "TBC"]);
check("SF links to the correct QF pairs by position",
  tb.rounds[1].matches.map((m) => m.feeders.map((x) => x.home)), [["A", "C"], ["E", "G"]]);
check("Final links to both semi-finals", tb.rounds[2].matches[0].feeders.length, 2);
// When the feed stops at the QFs (API hasn't published SF/final yet), the app
// synthesizes the rest of the tree from the QF count.
S.fixtures = [
  { home: "A", away: "B", date: "2026-07-09", kickoff_utc: "2026-07-09T18:00:00Z", round: "Quarter-finals", home_score: 2, away_score: 0 },
  { home: "C", away: "D", date: "2026-07-09", kickoff_utc: "2026-07-09T21:00:00Z", round: "Quarter-finals", home_score: 1, away_score: 0 },
  { home: "E", away: "F", date: "2026-07-10", kickoff_utc: "2026-07-10T18:00:00Z", round: "Quarter-finals", home_score: 3, away_score: 1 },
  { home: "G", away: "H", date: "2026-07-10", kickoff_utc: "2026-07-10T21:00:00Z", round: "Quarter-finals", home_score: 2, away_score: 1 },
];
const syn = knockoutBracket();
check("synthesizes SF + Final from the QFs", syn.rounds.map((r) => r.key), ["QF", "SF", "F"]);
check("synthesized SF has two slots", syn.rounds[1].matches.length, 2);
check("synthesized final has one slot", syn.rounds[2].matches.length, 1);
check("synthesized third-place present", !!syn.third, true);
check("synthesized SF still links to the right QF pairs",
  syn.rounds[1].matches.map((m) => m.feeders.map((x) => x.home)), [["A", "C"], ["E", "G"]]);
S.fixtures = []; S.stats = []; S.playerById = {};

/* Dream XI: best starters per position (GK1/DEF3/MID3/FWD2 in phase 1),
   cumulative and per-round, with per-90 scoping. SCORING: FWD goal 4,
   GK clean sheet 6, GK saves +1 per 2. */
S.stages = []; S.managers = [{ id: "m1", name: "Ann" }];
S.picks = [{ manager_id: "m1", player_id: "fwd_a" }]; S.fixtures = [];
S.league = { phase: 1 };
S.playerById = {
  gk_a: { player_id: "gk_a", name: "GA", position: "GK", team: "A" },
  gk_b: { player_id: "gk_b", name: "GB", position: "GK", team: "B" },
  fwd_a: { player_id: "fwd_a", name: "FA", position: "FWD", team: "A" },
  fwd_b: { player_id: "fwd_b", name: "FB", position: "FWD", team: "B" },
  fwd_c: { player_id: "fwd_c", name: "FC", position: "FWD", team: "C" },
};
S.stats = [
  { player_id: "gk_a", match_label: "A vs X (2026-06-10)", appeared: true, clean_sheet: true, minutes: 90 }, // 6
  { player_id: "gk_b", match_label: "B vs Y (2026-06-10)", appeared: true, saves: 4, minutes: 90 },          // 2
  { player_id: "fwd_a", match_label: "A vs X (2026-06-10)", appeared: true, goals: 1, minutes: 90 },         // 4
  { player_id: "fwd_b", match_label: "B vs Y (2026-06-10)", appeared: true, goals: 2, minutes: 90 },         // 8
  { player_id: "fwd_c", match_label: "C vs Z (2026-06-11)", appeared: true, goals: 0, minutes: 90 },         // 0
  { player_id: "fwd_a", match_label: "A vs P (2026-06-14)", appeared: true, goals: 3, minutes: 90 },         // 12
];
const dtc = dreamTeam(0, false);   // cumulative
check("dream GK cumulative = top keeper", dtc.GK.map((x) => x.p.player_id), ["gk_a"]);
check("dream FWD cumulative order (best first)", dtc.FWD.map((x) => x.p.player_id), ["fwd_a", "fwd_b"]);
check("dream FWD capped at 2 starter slots", dtc.FWD.length, 2);
check("dream unfilled positions stay empty", [dtc.DEF.length, dtc.MID.length], [0, 0]);
check("dream cumulative total = sum of chosen pts", dtc.total, 30);   // 6 + 16 + 8
const dtr = dreamTeam(1, false);   // round 1 = each team's first match
check("dream FWD round-1 order (fwd_b leads that round)",
  dtr.FWD.map((x) => x.p.player_id), ["fwd_b", "fwd_a"]);
check("dream round-1 total", dtr.total, 18);   // gk_a 6 + fwd_b 8 + fwd_a 4
S.stats.push({ player_id: "gk_b", match_label: "B vs W (2026-06-14)", appeared: true, saves: 2, minutes: 20 });
const dtp = dreamTeam(0, true);    // per-90
check("dream per-90 keeps the better rate", dtp.GK.map((x) => x.p.player_id), ["gk_a"]);
check("no flex slot when the league grants none", dtc.FLEX.length, 0);
S.stats = []; S.picks = []; S.managers = []; S.playerById = {}; S.league = {};

/* Dream XI flex: a redraft with phase_flex adds the best remaining outfielder
   (any of DEF/MID/FWD not already in the XI). starters GK1/DEF1/MID1/FWD1 +1 flex. */
S.stages = []; S.managers = []; S.picks = []; S.fixtures = [];
S.league = { phase: 2, phase_starters: { GK: 1, DEF: 1, MID: 1, FWD: 1 }, phase_flex: 1 };
S.playerById = {
  gk: { player_id: "gk", name: "K", position: "GK", team: "A" },
  def_a: { player_id: "def_a", name: "DA", position: "DEF", team: "A" },
  def_b: { player_id: "def_b", name: "DB", position: "DEF", team: "B" },
  mid_a: { player_id: "mid_a", name: "MA", position: "MID", team: "C" },
  mid_b: { player_id: "mid_b", name: "MB", position: "MID", team: "D" },
  fwd_a: { player_id: "fwd_a", name: "FA", position: "FWD", team: "E" },
};
const g = (id, goals) => ({ player_id: id, match_label: `${id} vs Z (2026-07-10)`, appeared: true, goals, minutes: 90 });
S.stats = [                     // DEF goal 6, MID goal 5, FWD goal 4, GK cs 6
  { player_id: "gk", match_label: "A vs Z (2026-07-10)", appeared: true, clean_sheet: true, minutes: 90 }, // 6
  g("def_a", 2), g("def_b", 1), // 12 / 6
  g("mid_a", 2), g("mid_b", 1), // 10 / 5
  g("fwd_a", 2),                // 8
];
const dtf = dreamTeam(0, false);
check("dream XI has GK/DEF/MID/FWD + one flex",
  [dtf.GK.length, dtf.DEF.length, dtf.MID.length, dtf.FWD.length, dtf.FLEX.length], [1, 1, 1, 1, 1]);
check("dream flex = best remaining outfielder (def_b 6 > mid_b 5)",
  dtf.FLEX.map((x) => x.p.player_id), ["def_b"]);
check("dream flex adds to the total", dtf.total, 6 + 12 + 10 + 8 + 6);
S.stats = []; S.managers = []; S.playerById = {}; S.league = {};

/* resilientWrite: an unapplied additive migration (missing optional
   column) is dropped and retried instead of failing the whole write. */
function mockSb(responses) {
  const sent = [];
  const seq = responses.slice();
  const builder = {
    upsert: (rows) => { sent.push(rows); return Promise.resolve(seq.shift()); },
    insert: (rows) => { sent.push(rows); return Promise.resolve(seq.shift()); },
  };
  return { sb: { from: () => builder }, sent };
}
const PGRST = (col) => ({ error: { code: "PGRST204",
  message: `Could not find the '${col}' column of 'match_stats' in the schema cache` } });

(async () => {
  // Two missing optional columns -> three attempts, both stripped, real data kept.
  let m = mockSb([PGRST("away_score"), PGRST("home_score"), { error: null }]);
  S.sb = m.sb;
  await resilientWrite("match_stats",
    [{ player_id: "arg_10", goals: 1, home_score: 2, away_score: 0 }],
    { upsert: true, onConflict: "league_id,player_id,match_label" });
  check("resilientWrite retries until it succeeds", m.sent.length, 3);
  check("resilientWrite strips the missing optional columns",
    [("home_score" in m.sent[2][0]), ("away_score" in m.sent[2][0])], [false, false]);
  check("resilientWrite keeps the real data", m.sent[2][0].goals, 1);

  // A non-strippable / non-column error must propagate.
  m = mockSb([{ error: { code: "23505", message: "duplicate key" } }]);
  S.sb = m.sb;
  let threw = false;
  try { await resilientWrite("trade_items", [{ trade_id: "t1" }]); }
  catch { threw = true; }
  check("resilientWrite rethrows a real error", threw, true);

  /* Workstream B part 3: API-Football competition transforms + pool fetch. */
  check("apiPosToSlot maps API positions",
    ["Goalkeeper", "Defender", "Midfielder", "Attacker", "?"].map(apiPosToSlot),
    ["GK", "DEF", "MID", "FWD", "MID"]);
  check("teamCodeFrom uses the API code when present", teamCodeFrom("Chelsea", "CHE"), "CHE");
  check("teamCodeFrom derives a code from the name", teamCodeFrom("Manchester United", null), "MAN");
  const sp = parseSquadPlayer(
    { id: 42, name: "Bukayo Saka", position: "Attacker", number: 7, photo: "x.png" }, "Arsenal", "ARS");
  check("parseSquadPlayer builds api_ id + fields",
    [sp.player_id, sp.api_id, sp.position, sp.team, sp.team_code, sp.number],
    ["api_42", 42, "FWD", "Arsenal", "ARS", 7]);
  const fx = parseApiFixture({ fixture: { id: 9, date: "2026-08-15T14:00:00+00:00", status: { short: "NS" } },
    teams: { home: { name: "Arsenal" }, away: { name: "Chelsea" } },
    goals: { home: null, away: null }, league: { round: "Regular Season - 1" } });
  check("parseApiFixture matches the fixtures.json shape",
    [fx.home, fx.away, fx.date, fx.status, fx.round], ["Arsenal", "Chelsea", "2026-08-15", "NS", "Regular Season - 1"]);

  // fetchCompetitionPool: teams → squads, deduping a player in two squads.
  const savedFetch = global.fetch;
  global.fetch = async (url) => {
    const u = new URL(url), path = u.pathname;
    let response = [];
    if (path === "/teams")
      response = [{ team: { id: 10, name: "Arsenal", code: "ARS" } }, { team: { id: 11, name: "Chelsea", code: null } }];
    else if (path === "/players/squads")
      response = u.searchParams.get("team") === "10"
        ? [{ players: [{ id: 1, name: "Saka", position: "Attacker", number: 7 }, { id: 2, name: "Rice", position: "Midfielder", number: 41 }] }]
        : [{ players: [{ id: 3, name: "Palmer", position: "Midfielder", number: 20 }, { id: 1, name: "Saka", position: "Attacker", number: 7 }] }];
    return { json: async () => ({ response, errors: {} }) };
  };
  // Competition key: shared across every league on the same competition+season.
  check("compKeyOf builds <league>-<season>", compKeyOf({ apiLeagueId: 39, season: 2024 }), "39-2024");
  check("compKeyOf is null with no competition", compKeyOf(null), null);
  S.league = { competition: { apiLeagueId: 2, season: 2025 } };
  check("competitionKey reads the league's competition", competitionKey(), "2-2025");
  S.league = {};
  check("competitionKey null for a legacy league", competitionKey(), null);
  S.league = null;

  const built = await fetchCompetitionPool("k", 39, 2024);
  check("fetchCompetitionPool dedups a player across squads", built.players.length, 3);
  check("fetchCompetitionPool sorts team names", built.teams, ["Arsenal", "Chelsea"]);
  check("fetchCompetitionPool keeps first team for a dup player",
    built.players.find((p) => p.player_id === "api_1").team, "Arsenal");
  check("fetchCompetitionPool derives a code for a codeless team",
    built.players.find((p) => p.team === "Chelsea").team_code, "CHE");
  global.fetch = savedFetch;

  /* ---------- automatic trade/lineup windows (fixtureWindows) ---------- */
  const awH = 3600e3, awDay = 24 * awH;
  // Three matchweeks a week apart. MW1 has two games; MW2 has two games; MW3 one.
  const mw1a = Date.UTC(2026, 7, 15, 12, 0);   // Sat 12:00
  const mw1b = Date.UTC(2026, 7, 15, 14, 30);  // Sat 14:30 (MW1 last game)
  const mw2a = Date.UTC(2026, 7, 22, 12, 0);   // next Sat 12:00 (MW2 first game)
  const mw2b = Date.UTC(2026, 7, 22, 14, 0);
  const mw3a = Date.UTC(2026, 7, 29, 12, 0);
  const awFx = [
    { round: "Regular Season - 2", kickoff_utc: new Date(mw2b).toISOString() },  // out of order on purpose
    { round: "Regular Season - 1", kickoff_utc: new Date(mw1a).toISOString() },
    { round: "Regular Season - 1", kickoff_utc: new Date(mw1b).toISOString() },
    { round: "Regular Season - 2", kickoff_utc: mw2a },                          // numeric ms accepted too
    { round: "Regular Season - 3", kickoff_utc: new Date(mw3a).toISOString() },
    { round: null, kickoff_utc: mw1a },                                          // no round → ignored
  ];
  const awWeeks = matchweeksOf(awFx);
  check("matchweeksOf groups + sorts by first kickoff",
    awWeeks.map((w) => w.round), ["Regular Season - 1", "Regular Season - 2", "Regular Season - 3"]);
  check("matchweeksOf first/last span a double-game week",
    [awWeeks[0].first, awWeeks[0].last], [mw1a, mw1b]);

  // Trade window between MW1 and MW2: opens mw1b+1h, closes mw2a-24h.
  const awMidGap = mw1b + 3 * awDay;   // well inside the gap
  const wGap = fixtureWindows(awFx, awMidGap);
  check("trade window open in the MW1 to MW2 gap", wGap.tradeOpen, true);
  check("trade window names the bounding matchweeks",
    [wGap.tradeWindow.from, wGap.tradeWindow.to], ["Regular Season - 1", "Regular Season - 2"]);
  check("trade window opens 1h after MW1's last game", wGap.tradeWindow.openAt, mw1b + awH);
  check("trade window closes 24h before MW2's first game", wGap.tradeWindow.closeAt, mw2a - awDay);

  check("trade closed while MW1 is being played",
    fixtureWindows(awFx, mw1a + 30 * 60e3).tradeOpen, false);
  check("trade closed until 1h after MW1's last game",
    fixtureWindows(awFx, mw1b + 30 * 60e3).tradeOpen, false);
  check("trade open once 1h has passed",
    fixtureWindows(awFx, mw1b + awH + 60e3).tradeOpen, true);
  check("trade closed inside the 24h pre-MW2 lock-in",
    fixtureWindows(awFx, mw2a - 12 * awH).tradeOpen, false);

  // Lineup window: locks 1h before the upcoming matchweek's first game.
  const wLine = fixtureWindows(awFx, awMidGap);
  check("upcoming matchweek is the next unplayed one", wLine.upcoming.round, "Regular Season - 2");
  check("lineup locks 1h before MW2's first game", wLine.lineupLockAt, mw2a - awH);
  check("lineup open during the gap", wLine.lineupOpen, true);
  check("lineup locked in the final hour before kickoff",
    fixtureWindows(awFx, mw2a - 30 * 60e3).lineupOpen, false);
  check("lineup reopens for MW3 once MW2 has kicked off",
    fixtureWindows(awFx, mw2a + awH).upcoming.round, "Regular Season - 3");

  // Custom thresholds override the 1h / 24h / 1h defaults.
  const wOpt = fixtureWindows(awFx, awMidGap, { tradeOpenAfterH: 2, tradeCloseBeforeH: 48, lineupLockBeforeH: 3 });
  check("custom trade-open offset respected", wOpt.tradeWindow.openAt, mw1b + 2 * awH);
  check("custom trade-close offset respected", wOpt.tradeWindow.closeAt, mw2a - 48 * awH);
  check("custom lineup-lock offset respected", wOpt.lineupLockAt, mw2a - 3 * awH);

  // No fixtures / season finished → everything closed, nothing crashes.
  check("empty fixtures → no windows",
    (() => { const w = fixtureWindows([], awMidGap); return [w.tradeOpen, w.lineupOpen, w.upcoming]; })(),
    [false, false, null]);
  check("past the last matchweek → lineup closed",
    fixtureWindows(awFx, mw3a + awDay).lineupOpen, false);

  process.exit(fails ? 1 : 0);
})();
