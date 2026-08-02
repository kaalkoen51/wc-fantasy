const fs = require("fs");
const src = fs.readFileSync("app.js", "utf8");

// Enough of a DOM for the draft's pick-flash to actually run: it appends to
// document.body, and it vanished once already when a region rewrite deleted it.
const appended = [];
const mkEl = () => ({ className: "", innerHTML: "", textContent: "", dataset: {},
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  style: {}, appendChild() {}, remove() {}, addEventListener() {},
  querySelectorAll: () => [], querySelector: () => null });
const stubDoc = {
  getElementById: () => null,
  querySelectorAll: () => [],
  querySelector: () => null,
  addEventListener: () => {},
  createElement: mkEl,
  body: { appendChild: (el) => appended.push(el) },
  // The real DOM always has one; showView clears an abandoned drag lock on it.
  documentElement: mkEl(),
};
let scrollCalls = 0;
const winStub = { scrollTo: () => { scrollCalls++; } };
// A session so myManager() resolves to "m1" when a test puts it in S.managers
// (needed for the per-manager shortlist/planner helpers).
const _session = JSON.stringify({ leagueId: "L1", managerId: "m1" });
/* A real (in-memory) store rather than a no-op, so code paths that WRITE to
   localStorage and read it back -- setSession() above all -- behave the way
   they do in a browser instead of silently losing the value. */
const _lsData = new Map([["wcf_session", _session]]);
const lsStub = {
  getItem: (k) => (_lsData.has(k) ? _lsData.get(k) : null),
  setItem: (k, v) => { _lsData.set(k, String(v)); },
  removeItem: (k) => { _lsData.delete(k); },
};
globalThis.appended = appended;
const api = new Function(
  "document", "localStorage", "window", "crypto", "navigator",
  src + "\nreturn { S, pickInfo, myManager, isAdmin, boardRulesNote, calcPlayerPoints, calcTeamPoints, computeScores, stageBonuses, stageOrder, finalPickBonus, phaseOneQuota, phaseOneStarters, starterQuota, effectiveConfig, flexCounting, formationValid, DEFAULT_FORMATION, roundRobin, h2hResult, h2hTable, h2hFixturesFor, resolveFaClaims, h2hSchedulePlan, rumblePlacement, matchdayPlan, fmtCountdown, roundRecap, deadlineCrossed, managerStreaks, seasonAwards, transferRoundup, picksUntilTurn, autoPickPreview, navGroups, groupOfTab, isCupCompetition, CREATE_PRESETS, scoringBalance, pointsHistogram, statSummary, rowPointsWith, buildFixtureStatRows, fixtureWindows, matchweeksOf, maxFaPerWindow, faMovesThisWindow, faMovesLeft, faWindowStartMs, apiPosToSlot, teamCodeFrom, parseSquadPlayer, parseApiFixture, fetchCompetitionPool, fetchCompetitionFixtures, compKeyOf, competitionKey, slotGroup, pairValid, tradeError, quotaLeft, leagueFlex, slotForNewPick, posQuota, picksPerManager, totalPicks, playerBreakdown, playerPoints, suspendedNext, resilientWrite, playerStatTotal, teamMatchLabels, entryForManagerAt, ownerEntryAt, slotLabel, managerHistory, poolEntries, availableForGroup, isEliminated, computeYetToPlay, showView, plannerChoiceRank, choiceStatus, plannerPickPool, autoPickCandidates, entryForId, botChoice, botThinkMs, queuePlan, flashPick, announceNewPicks, renderDraftQueue, renderDraft, statsScopedRows, sumStatKey, sumMinutes, formAvg, formLog, dreamTeam, formDotColor, shortlistCleaned, standingsMovement, roundMVPs, seasonSeries, headToHead, currentRoundNo, currentRoundDreamIds, chatThreads, messagesForThread, threadUnread, markThreadSeen, koRoundOf, knockoutBracket, needsSummary, lineupValid, pitchHtml, pitchFacingHtml, pitchRowsHtml, squadBoardHtml, historyViewHtml, benchInOrder, moveBench, orderedRoster, flipRows, wireLineupControls, markQueueMoved, matchdayCtaAct, matchdayCardHtml, renderLineup, renderHomeTab, openH2HPreview, openH2HFixture, lineupRowHtml, dugoutHtml, renderFixturesTab, h2hRoundFixtures, h2hTotalRounds, h2hFormOf, h2hStandingsHtml, seasonChartHtml, renderScoutList, renderStatsTab, renderPredraftShortlist, preDraftBrowsing, shortlistCoverage, coverageHint, scoringByPositionHtml, openScoringSheet, animateReorder, applyLocalOverrides, queueManagerWrite, wireStars, starHtml, draftFactCards, draftRulesHtml, lobbyRulesHtml, scoringHtml, applyVisibleOrder, makeReorderable, refetchAll, markConnection, enterLeagueWithFeedback, route, showView, dragActive, afterDrag, overrideStillWins, queueManagerWrite, applyLocalOverrides, keepLocalPick, autoPickStale, makePick, autoPick, tickTimer, mergeOptimisticPicks, pickKey, queueFieldWrite, OVERRIDE_TABLES, setPlanner, saveLineup, toggleKeeper, setFinalPick, txWindowStarts, txWhen, txShell, txAvatar, txMgrChip, tradeTxCard, swapTxCard, transactionsLogHtml, renderTrades, builderHtml, faClaimsSectionHtml, waiverOrderHtml, shortlistSectionHtml, plannerSectionHtml, plannerMoveHtml, squadChooserHtml, tradeSectionHtml, setClaimOrder, reorderClaim, tradeForShortlisted, submitTrade, TRADE_TABS, tradeTabBodyHtml, faClaimRowHtml, faClaimRowsHtml, renderClaimList, wireClaimControls, ROW_ATTRS, plannerMoveChoice, plannerSetChoiceOrder, plannerPickPool, renderPlannerPick, setWindowMode, toggleLineups, squadPitchHtml, squadShape, renderDreamTeam, dreamTeam, renderChat, chatThreads, interacting, markInteracting, scheduleDeferredFlush, INTERACT_MS, animateReorder, flipRows, flushDeferredRender, currentSeasonFor, seasonOptions, seasonLabel, backtestSeason, createCompKind, createPreviewSeason, loadScoringPreviewData, pullCreateHistory, renderCreateBalance, updateCreatePullStatus, renderCreateForm, pickReconciliation, reconcilePicksToPool, mapApiPlayer, loadCompetition, roundResolvers, roundIndex, mwNo, FINAL_STATUS, draftOrderMode, lobbyOrderManagers, shuffled, setDraftOrder, renderLobbyOrder, lastClosedTradeWindow, waiverDue, maybeProcessAutoWaivers, processWaiversNow, nextLockMs, lockAfterWindow, restampPlan, snapshotAt, snapshotForNextLock, restampSnapshots, rosterAtFor, setSession, getSession, repairStarters, lineupShape, repairLineupFor, faWindowKey, roundToSettle, closedWindowRound, advanceRound, maybeAdvanceRounds };"
)(stubDoc, lsStub, winStub, {}, {});

const { S, pickInfo, myManager, isAdmin, boardRulesNote, calcPlayerPoints, calcTeamPoints, computeScores,
        scoring, stageBonuses, stageOrder, finalPickBonus, phaseOneQuota,
        phaseOneStarters, starterQuota, effectiveConfig,
        flexCounting, formationValid, DEFAULT_FORMATION,
        roundRobin, h2hResult, h2hTable, h2hFixturesFor, resolveFaClaims,
        h2hSchedulePlan, rumblePlacement, matchdayPlan, fmtCountdown, roundRecap, deadlineCrossed, managerStreaks, seasonAwards, transferRoundup, picksUntilTurn, autoPickPreview, navGroups, groupOfTab, isCupCompetition, CREATE_PRESETS, scoringBalance, pointsHistogram, statSummary, rowPointsWith,
        buildFixtureStatRows,
        fixtureWindows, matchweeksOf, shortlistCoverage, coverageHint, applyVisibleOrder,
        currentSeasonFor, seasonOptions, seasonLabel, backtestSeason, pickReconciliation,
        overrideStillWins, keepLocalPick, autoPickStale, mergeOptimisticPicks,
        maxFaPerWindow, faMovesThisWindow, faMovesLeft, faWindowStartMs,
        apiPosToSlot, teamCodeFrom, parseSquadPlayer, parseApiFixture,
        fetchCompetitionPool, fetchCompetitionFixtures, compKeyOf, competitionKey,
        slotGroup, pairValid, tradeError, quotaLeft, leagueFlex, slotForNewPick,
        posQuota, picksPerManager, totalPicks,
        playerBreakdown, playerPoints, suspendedNext, resilientWrite,
        playerStatTotal, teamMatchLabels, entryForManagerAt, ownerEntryAt,
        slotLabel, managerHistory, poolEntries, availableForGroup,
        isEliminated, computeYetToPlay, showView,
        plannerChoiceRank, choiceStatus, plannerPickPool,
        autoPickCandidates, entryForId, botChoice, botThinkMs, queuePlan, flashPick, announceNewPicks, renderDraftQueue, renderDraft,
        statsScopedRows, sumStatKey, sumMinutes, formAvg, formLog,
        dreamTeam, formDotColor, shortlistCleaned, standingsMovement, roundMVPs,
        seasonSeries, headToHead,
        currentRoundNo, currentRoundDreamIds,
        chatThreads, messagesForThread, threadUnread, markThreadSeen,
        koRoundOf, knockoutBracket, needsSummary, lineupValid,
        roundResolvers, roundIndex, draftOrderMode, lobbyOrderManagers,
        shuffled, setDraftOrder, renderLobbyOrder, draftFactCards,
        lastClosedTradeWindow, waiverDue, maybeProcessAutoWaivers, processWaiversNow,
        nextLockMs, lockAfterWindow, restampPlan, snapshotAt, snapshotForNextLock, restampSnapshots,
        txWindowStarts, rosterAtFor, setSession, getSession, faWindowKey, roundToSettle,
        closedWindowRound,
        repairStarters, lineupShape, repairLineupFor } = api;
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

  /* h2hSchedulePlan: fairness analysis of managers × rounds. */
  // Even N: one cycle = N-1 rounds, no byes ever.
  const even6 = h2hSchedulePlan(6, 5);   // 6 managers, exactly one cycle
  check("plan even/exact: balanced, no byes",
    [even6.balanced, even6.cycle, even6.playsMin, even6.playsMax, even6.byesMax], [true, 5, 1, 1, 0]);
  const even6b = h2hSchedulePlan(6, 10);  // two full cycles
  check("plan even/two cycles: everyone plays each rival twice",
    [even6b.balanced, even6b.playsMin, even6b.playsMax], [true, 2, 2]);
  const even6u = h2hSchedulePlan(6, 7);   // one cycle + 2 leftover
  check("plan even/leftover: uneven, some pairs meet twice",
    [even6u.balanced, even6u.leftover, even6u.playsMin, even6u.playsMax, even6u.byesMax],
    [false, 2, 1, 2, 0]);
  check("plan even/leftover: nearest clean round counts", [even6u.nearestDown, even6u.nearestUp], [5, 10]);
  // Odd N: cycle = N rounds, one bye per manager per cycle.
  const odd5 = h2hSchedulePlan(5, 5);
  check("plan odd/exact: one bye each, balanced",
    [odd5.balanced, odd5.cycle, odd5.byesMin, odd5.byesMax], [true, 5, 1, 1]);
  const odd5u = h2hSchedulePlan(5, 7);   // one cycle + 2 leftover
  check("plan odd/leftover: 2 managers get an extra bye",
    [odd5u.balanced, odd5u.managersWithExtraBye, odd5u.byesMin, odd5u.byesMax], [false, 2, 1, 2]);
  // Rumble folds the leftover into all-play-all → head-to-head portion balanced.
  const odd5r = h2hSchedulePlan(5, 7, { rumble: true });
  check("plan rumble: leftover becomes rumbles, byes even again",
    [odd5r.balanced, odd5r.rumble, odd5r.rumbleRounds, odd5r.byesMin, odd5r.byesMax, odd5r.rumbleFrom],
    [true, true, 2, 1, 1, 6]);
  // Rumble does nothing when the season already divides evenly.
  check("plan rumble/exact: no rumble rounds when balanced",
    h2hSchedulePlan(6, 10, { rumble: true }).rumble, false);
  // Guards.
  check("plan invalid: <2 managers", h2hSchedulePlan(1, 10).valid, false);
  check("plan invalid: 0 rounds", h2hSchedulePlan(6, 0).valid, false);

  // Rumble rounds in the actual fixtures: round ≥ rumbleFrom is all-play-all.
  const rumFix = h2hFixturesFor(["a", "b", "c", "d"], 5, { rumbleFrom: 4 });
  const rr4 = rumFix.filter((f) => f.round === 4);
  check("h2hFixturesFor rumble: round 4 pairs everyone (C(4,2)=6)", rr4.length, 6);
  check("h2hFixturesFor rumble: rumble rounds are flagged", rr4.every((f) => f.rumble), true);
  check("h2hFixturesFor rumble: pre-rumble rounds stay 2-fixture",
    rumFix.filter((f) => f.round === 3).length, 2);

  /* Placement-scored rumble rounds. */
  // Top-3 points 3-2-1: a>b>c>d → 3,2,1,0.
  const place = rumblePlacement({ a: 90, b: 70, c: 60, d: 40 }, [3, 2, 1]);
  check("rumblePlacement: 3-2-1 by rank", [place.a, place.b, place.c, place.d], [3, 2, 1, 0]);
  // Tie for 1st splits places 1+2: (3+2)/2 = 2.5 each; next gets place 3 = 1.
  const tie = rumblePlacement({ a: 80, b: 80, c: 50 }, [3, 2, 1]);
  check("rumblePlacement: tie for 1st splits the top two places", [tie.a, tie.b, tie.c], [2.5, 2.5, 1]);
  check("rumblePlacement: managers with no score are excluded",
    Object.keys(rumblePlacement({ a: 10 }, [3, 2, 1])).sort(), ["a"]);
  // h2hTable placement path: round 3 scored by placement, not fixtures.
  const pScores = { a: [0, 0, 90], b: [0, 0, 70], c: [0, 0, 40] };
  const pTable = h2hTable(["a", "b", "c"], pScores, [], { win: 3, draw: 1, loss: 0, score_bonus: 999, losing_margin: 0 },
    { rounds: [3], points: [3, 2, 1] });
  check("h2hTable placement: rank points land in logPts",
    [pTable.rows.a.logPts, pTable.rows.b.logPts, pTable.rows.c.logPts], [3, 2, 1]);
  check("h2hTable placement: tracked separately in rumblePts + P counts the round",
    [pTable.rows.a.rumblePts, pTable.rows.a.P, pTable.rows.a.PF], [3, 1, 90]);
  check("h2hTable placement: order follows placement points", pTable.order, ["a", "b", "c"]);
}

/* Scoring-balance validation (positional fairness of a candidate scoring system). */
{
  const rules = [{ stat: "goals.total", mode: "each", perPosition: false, points: 4 }];
  check("rowPointsWith: goals × points", rowPointsWith({ appeared: true, raw: { "goals.total": 2 } }, "FWD", rules), 8);
  check("rowPointsWith: no appearance scores 0", rowPointsWith({ appeared: false, raw: { "goals.total": 2 } }, "FWD", rules), 0);
  const ss = statSummary([2, 4, 6]);
  check("statSummary: mean + population sd", [ss.n, ss.mean, Math.round(ss.sd * 1000) / 1000], [3, 4, 1.633]);
  check("statSummary: empty → zeros", statSummary([]), { n: 0, mean: 0, sd: 0 });
  // Six games each for two FWDs + two DEFs; a third FWD with only 3 games is excluded.
  const g = (pid, goals) => ({ player_id: pid, appeared: true, raw: { "goals.total": goals } });
  const rows = [];
  for (let i = 0; i < 6; i++) { rows.push(g("f1", 1), g("f2", 0), g("d1", 0), g("d2", 1)); }
  for (let i = 0; i < 3; i++) rows.push(g("f3", 5));
  const posOf = { f1: "FWD", f2: "FWD", f3: "FWD", d1: "DEF", d2: "DEF" };
  const bal = scoringBalance(rows, posOf, rules, 5);
  check("scoringBalance: only 5+ game players counted", bal.count, 4);
  check("scoringBalance: FWD avg (24 & 0 → 12 ±12)", [bal.perPos.FWD.n, bal.perPos.FWD.mean, bal.perPos.FWD.sd], [2, 12, 12]);
  check("scoringBalance: DEF avg", [bal.perPos.DEF.n, bal.perPos.DEF.mean], [2, 12]);
  check("scoringBalance: GK/MID empty", [bal.perPos.GK.n, bal.perPos.MID.n], [0, 0]);
  check("scoringBalance: position means equal → zero spread", [bal.spread, bal.relSpread], [0, 0]);
  check("scoringBalance: top scorer total", bal.top[0].points, 24);
  check("scoringBalance: sub-threshold player excluded", bal.top.some((e) => e.pid === "f3"), false);
  // A FWD-heavy ruleset should show a non-zero spread (FWDs pull ahead).
  const skew = scoringBalance(rows, posOf,
    [{ stat: "goals.total", mode: "each", perPosition: true, points: { GK: 0, DEF: 1, MID: 1, FWD: 10 } }], 5);
  check("scoringBalance: per-position rule skews the spread", skew.spread > 0, true);

  // pointsHistogram: shared bins across positions (the ridgeline overlay data).
  const hp = [
    { pos: "FWD", points: 0 }, { pos: "FWD", points: 10 }, { pos: "FWD", points: 20 },
    { pos: "DEF", points: 0 }, { pos: "DEF", points: 0 },
  ];
  const h = pointsHistogram(hp, 2);
  check("pointsHistogram: shared min/max across all positions", [h.min, h.max, h.binW], [0, 20, 10]);
  check("pointsHistogram: FWD split across both bins", h.series.FWD, [1, 2]);   // 0 in bin0; 10,20 in bin1
  check("pointsHistogram: DEF both in the first bin", h.series.DEF, [2, 0]);
  check("pointsHistogram: empty positions are zero-filled", h.series.GK, [0, 0]);
  check("pointsHistogram: no players → safe empty shape",
    [pointsHistogram([], 4).series.MID.length, pointsHistogram([], 4).max], [4, 0]);
}

/* buildFixtureStatRows: one fixture's API player block → stat rows (shared by
   the admin daily pull and the on-demand competition-history pull). */
{
  const f = {
    teams: { home: { id: 10, name: "Home" }, away: { id: 20, name: "Away" } },
    goals: { home: 2, away: 0 },
    fixture: { id: 1, date: "2026-03-01T15:00:00+00:00", status: { short: "FT" } },
    league: { round: "Regular Season - 27" },
  };
  const teamBlocks = [
    { team: { id: 10, name: "Home" }, players: [
      { player: { id: 100, name: "Scorer" }, statistics: [{ games: { minutes: 90, number: 9, rating: "8.5" }, goals: { total: 2, assists: 1 }, passes: { total: 30 } }] },
      { player: { id: 101, name: "Keeper" }, statistics: [{ games: { minutes: 90, rating: "7.0" }, goals: { saves: 3 } }] },
    ] },
    { team: { id: 20, name: "Away" }, players: [
      { player: { id: 200, name: "Benchwarmer" }, statistics: [{ games: { minutes: 0 } }] },   // non-participant
    ] },
  ];
  const pidOf = (team, num, name, apiId) => "api_" + apiId;
  const skipped = [];
  const { rows, label, maxMin, cs } = buildFixtureStatRows(f, teamBlocks, { competition_key: "39-2024" }, (n) => n, pidOf, skipped);
  check("buildFixtureStatRows: match label", label, "Home vs Away (2026-03-01)");
  check("buildFixtureStatRows: non-participant dropped", rows.length, 2);
  check("buildFixtureStatRows: scorer id/goals/raw", [rows[0].player_id, rows[0].goals, rows[0].raw["goals.total"]], ["api_100", 2, 2]);
  check("buildFixtureStatRows: clean sheet (90', 0 conceded)", rows[0].clean_sheet, true);
  check("buildFixtureStatRows: MOTM = top rating ≥7.5", rows[0].motm, true);
  check("buildFixtureStatRows: rows scoped by competition key", rows[0].competition_key, "39-2024");
  check("buildFixtureStatRows: maxMin + clean-sheet diagnostics", [maxMin, cs], [90, 2]);
  // Phase 0 (ROUNDS_DESIGN.md): the writer stamps the matchweek it knows NOW.
  check("buildFixtureStatRows: the matchweek is stamped on every row",
    rows.map((r) => r.round), [27, 27]);
  const cupF = { ...f, league: { round: "Round of 16" } };
  check("buildFixtureStatRows: a cup round name stamps null, not a number",
    buildFixtureStatRows(cupF, teamBlocks, {}, (n) => n, pidOf, []).rows[0].round, null);
}

/* The matchday card: which stage of the week is it, and what's the one thing
   to do about it? */
{
  const H = 3600e3, base = { started: true, nowMs: 1000, matchweek: "24", todo: [] };
  check("matchday: before the draft there is no card",
    matchdayPlan({ started: false }).stage, "preseason");
  // Both windows open → transfers, and the trade close is the deadline.
  const tr = matchdayPlan({ ...base, tradeOpen: true, lineupOpen: true,
    tradeClosesAt: 5000, lineupLockAt: 9000 });
  check("matchday: both windows open → transfers",
    [tr.stage, tr.deadlineAt, tr.cta.act], ["transfers", 5000, "trades"]);
  // …unless the lineup still needs attention — that outranks browsing players.
  const trTodo = matchdayPlan({ ...base, tradeOpen: true, lineupOpen: true,
    tradeClosesAt: 5000, todo: ["Captain not set"] });
  check("matchday: an unset lineup outranks transfers", trTodo.cta.act, "lineup");
  // Trade shut, lineup still open → last chance, deadline is the lock.
  const ln = matchdayPlan({ ...base, tradeOpen: false, lineupOpen: true, lineupLockAt: 9000 });
  check("matchday: trade closed but lineup open → lineup",
    [ln.stage, ln.deadlineAt, ln.deadlineLabel], ["lineup", 9000, "Lineup locks"]);
  // Everything shut, kick-off ahead → locked.
  const lk = matchdayPlan({ ...base, tradeOpen: false, lineupOpen: false, kickoffAt: 12000 });
  check("matchday: everything shut → locked", [lk.stage, lk.deadlineAt], ["locked", 12000]);
  // Everything shut but the window reopens later → the round just finished.
  const rs = matchdayPlan({ ...base, tradeOpen: false, lineupOpen: false, tradeOpensAt: 8000 });
  check("matchday: waiting for the window to reopen → results",
    [rs.stage, rs.cta.act], ["results", "recap"]);
  // Games in progress beats everything.
  check("matchday: live games win",
    matchdayPlan({ ...base, live: true, lineupOpen: true }).stage, "live");
  check("matchday: live has no countdown",
    matchdayPlan({ ...base, live: true }).deadlineAt, null);

  check("countdown: days", fmtCountdown(2 * 86400e3 + 4 * H + 11 * 60e3), "2d 04h 11m");
  check("countdown: hours", fmtCountdown(3 * H + 12 * 60e3 + 40e3), "3h 12m 40s");
  check("countdown: minutes", fmtCountdown(4 * 60e3 + 9e3), "4m 09s");
  check("countdown: past deadline", fmtCountdown(-5), "now");
  // A passed deadline used to refetch on EVERY tick — a full reload and
  // re-render once a second, which crawled and disrupted live drafts.
  const D = 1000;
  check("deadline: fires as it passes", deadlineCrossed(D, D, null), true);
  check("deadline: does not fire again for the same deadline",
    deadlineCrossed(D, D + 60000, D), false);
  check("deadline: silent before it passes", deadlineCrossed(D, D - 1, null), false);
  check("deadline: a NEW deadline fires again", deadlineCrossed(2000, 2000, D), true);
  check("deadline: no deadline never fires", deadlineCrossed(null, 9e9, null), false);
}

/* Navigation: eight destinations collapse into four, and a knockout bracket
   is only offered to competitions that actually have one. */
{
  S.league = { competition: { apiLeagueId: 39, season: 2024 } };   // Premier League
  check("nav: a league season has no bracket", navGroups().league, ["lb", "rosters"]);
  check("nav: league competition is not a cup", isCupCompetition(), false);
  S.league = { competition: { apiLeagueId: 1, season: 2026 } };    // World Cup
  check("nav: a cup keeps the bracket", navGroups().league, ["lb", "rosters", "bracket"]);
  S.league = {};                                                   // legacy WC league
  check("nav: legacy leagues keep the bracket", isCupCompetition(), true);
  check("nav: four destinations", Object.keys(navGroups()), ["team", "league", "players", "activity"]);
  check("nav: trades and chat share one destination", navGroups().activity, ["trades", "chat"]);
  check("nav: each pane maps to a destination",
    ["home", "lb", "rosters", "bracket", "stats", "trades", "chat"].map(groupOfTab),
    ["team", "league", "league", "league", "players", "activity", "activity"]);
  S.league = null;
}

/* Create-league presets: one tap to a working league, with everything else
   still reachable behind "Customise settings". */
{
  CREATE_PRESETS.classic.apply();
  check("preset classic: plain points tally, instant trades",
    [S._createH2H, S._createWaiver, S._createCaptain, S._createAutoWin],
    [false, false, false, false]);
  CREATE_PRESETS.h2h.apply();
  check("preset h2h: head-to-head, waivers, captain, fixture-driven windows",
    [S._createH2H, S._createWaiver, S._createCaptain, S._createAutoWin],
    [true, true, true, true]);
  const before = [S._createH2H, S._createWaiver, S._createCaptain, S._createAutoWin].join();
  CREATE_PRESETS.custom.apply();
  check("preset custom: changes nothing on its own",
    [S._createH2H, S._createWaiver, S._createCaptain, S._createAutoWin].join(), before);
  check("every preset explains itself",
    Object.values(CREATE_PRESETS).every((p) => (p.blurb || "").length > 30), true);
  CREATE_PRESETS.classic.apply();
}

/* Form, awards and the transfer roundup — the things a league argues about. */
{
  const st = managerStreaks([40, 55, 60, 70], [3, 1, 1, 1]);
  check("streaks: best and worst round", [st.bestRound, st.worstRound], [70, 40]);
  check("streaks: counts a run of round wins", [st.currentWinStreak, st.longestWinStreak], [3, 3]);
  check("streaks: rising run", st.longestRisingRun, 3);
  check("streaks: hot needs a clear margin over your own baseline",
    managerStreaks([10, 10, 10, 50, 60, 55]).hot, true);
  check("streaks: cold is the mirror", managerStreaks([90, 80, 70, 10, 12, 14]).cold, true);
  // The bug this replaced: "below your own average" is true about half the
  // time, so ordinary variation was flagging most of the league as cold.
  check("streaks: ordinary variation is not a form flag",
    [managerStreaks([50, 60, 40, 55, 45, 48]).cold,
     managerStreaks([50, 60, 40, 55, 45, 48]).hot], [false, false]);
  check("streaks: a short season never flags form",
    [managerStreaks([10, 10, 90, 95, 99]).played,
     managerStreaks([10, 90, 95, 99]).hot], [5, false]);
  check("streaks: no rounds is safe", managerStreaks([]).played, 0);

  const aw = seasonAwards([
    { id: "a", name: "You",    rounds: [30, 90, 40], benchPts: [2, 3] },
    { id: "b", name: "Sam",    rounds: [50, 52, 51], benchPts: [40, 30] },
    { id: "c", name: "Marcus", rounds: [20, 40, 95], benchPts: [1, 1] },
  ]);
  const by = Object.fromEntries(aw.map((a) => [a.label, a]));
  check("awards: best single round", [by["Best single round"].manager, by["Best single round"].value], ["Marcus", 95]);
  check("awards: most consistent is the smallest spread", by["Most consistent"].manager, "Sam");
  check("awards: unluckiest bench", by["Unluckiest bench"].manager, "Sam");
  check("awards: slowest start", by["Slowest start"].manager, "Marcus");
  check("awards: strongest finish", by["Strongest finish"].manager, "Marcus");
  check("awards: nothing played yields nothing", seasonAwards([{ name: "x", rounds: [] }]), []);

  // A trade moving the same points as a free-agent pickup should outrank it.
  const round = transferRoundup([
    { kind: "swap",  manager: "You", inName: "Cheap", outName: "Old", inPts: 40, outPts: 5 },
    { kind: "trade", manager: "Sam", with: "Priya", inName: "Star", outName: "Rock", inPts: 30, outPts: 10 },
    { kind: "waiver", manager: "Marcus", inName: "Punt", outName: "Dud", inPts: 3, outPts: 0 },
    { kind: "swap",  manager: "Priya", inName: "Nobody", outName: "Nobody2", inPts: 0, outPts: 0 },
  ]);
  check("roundup: trades are favoured over equivalent free-agent moves",
    round[0].manager, "Sam");
  check("roundup: a trade's swing counts both sides", round[0].swing, 40);
  check("roundup: pointless moves are dropped", round.length, 3);
  check("roundup: respects the limit", transferRoundup(round, 2).length, 2);
  check("roundup: empty input is safe", transferRoundup([]), []);
}

/* Round recap: the results moment, composed from one round's items. */
{
  const it = (name, pts, sub) => ({ entry: { player_id: "p" + name, player_name: name, is_sub: !!sub }, pts });
  const round = { n: 7, subtotal: 41,
    items: [it("Saka", 22), it("Rice", 5), it("Raya", 14), it("Sub A", 9, true), it("TEAM", null)] };
  const league = { me: 41, a: 55, b: 30, c: 20 };
  const r = roundRecap(round, league, { oppName: "Sam", mine: 41, theirs: 30 });
  check("recap: score + round rank", [r.n, r.score, r.rank, r.of], [7, 41, 2, 4]);
  check("recap: league average", Math.round(r.avg), 37);
  check("recap: best starter", r.best.entry.player_name, "Saka");
  check("recap: quietest starter", r.worst.entry.player_name, "Rice");
  check("recap: points left on the bench", r.benchPts, 9);
  check("recap: head-to-head win", r.result, "W");
  check("recap: no h2h → no result", roundRecap(round, league, null).result, null);
  check("recap: a draw reads as a draw",
    roundRecap(round, league, { oppName: "Sam", mine: 41, theirs: 41 }).result, "D");
  check("recap: no round → null", roundRecap(null, league, null), null);
}

/* The board's rules footer is generated from the league's own config — it used
   to be static World Cup text, which was wrong for any custom league. */
{
  S.league = {};   // defaults: TEAM pick on, no captain, fixed formation
  const def = boardRulesNote();
  check("rulesNote: default league describes stage bonuses", /stage bonuses/.test(def), true);
  check("rulesNote: default league describes the sub rule", /sub scores only/.test(def), true);
  check("rulesNote: no captain mention when captain is off", /captain/.test(def), false);
  // A custom league: no TEAM pick, captain on, capped subs, H2H, waivers.
  S.league = { config: { quota: { TEAM: 0 }, captain: true, maxSubs: 1,
                         h2hEnabled: true, fa_defer_to_close: true } };
  const cus = boardRulesNote();
  check("rulesNote: custom league drops the TEAM stage-bonus copy", /stage bonuses/.test(cus), false);
  check("rulesNote: mentions the captain when enabled", /captain scores double/.test(cus), true);
  check("rulesNote: states the per-round sub cap", /up to 1 per round/.test(cus), true);
  check("rulesNote: mentions the head-to-head log", /head-to-head log/.test(cus), true);
  check("rulesNote: mentions waiver order", /waiver order/.test(cus), true);
  S.league = null;
}

/* Account-aware identity: a signed-in user is matched to their manager by
   user_id (follows them across devices); admin falls to the league owner. */
{
  S.authUser = { id: "uX" };
  S.managers = [{ id: "mA", user_id: "uX" }, { id: "mB", user_id: null }];
  S.league = null;
  check("myManager: signed-in user matched by user_id", myManager()?.id, "mA");
  S.authUser = { id: "nobody" };
  S.managers = [{ id: "m1", user_id: null }];   // session managerId is "m1" (harness)
  check("myManager: no account link falls back to the device session", myManager()?.id, "m1");
  S.authUser = null;
  check("myManager: not signed in uses the device session", myManager()?.id, "m1");
  S.authUser = { id: "owner1" };
  S.league = { owner_id: "owner1", admin_token: "tok" };
  check("isAdmin: the league owner (by account) is admin", isAdmin(), true);
  S.authUser = { id: "someone-else" };
  check("isAdmin: a non-owner without the token is not admin", isAdmin(), false);
  S.authUser = null; S.league = null; S.managers = [];
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
}
/* Per-window free-agent cap (instant + waiver): count moves since the window
   opened. Manual mode → the newest lineup snapshot marks the window start. */
{
  S.league = { config: { max_fa_per_window: 2 } };
  S.snapshots = [{ manager_id: "m1", created_at: "2026-03-01T10:00:00Z" }];  // last lock
  S.transactions = [
    { manager_id: "m1", kind: "swap",   created_at: "2026-03-01T09:00:00Z" },  // previous window
    { manager_id: "m1", kind: "swap",   created_at: "2026-03-01T11:00:00Z" },  // this window
    { manager_id: "m1", kind: "waiver", created_at: "2026-03-01T12:00:00Z" },  // this window
    { manager_id: "m1", kind: "trade",  created_at: "2026-03-01T13:00:00Z" },  // not a FA move
    { manager_id: "m2", kind: "swap",   created_at: "2026-03-01T11:30:00Z" },  // another manager
  ];
  check("fa/window: counts only this window's FA moves", faMovesThisWindow("m1"), 2);
  check("fa/window: cap 2 reached → 0 left", faMovesLeft("m1"), 0);
  check("fa/window: a different manager is unaffected", faMovesLeft("m2"), 1);
  check("fa/window: window start = newest snapshot", faWindowStartMs(), Date.parse("2026-03-01T10:00:00Z"));
  S.league = { config: {} };   // no cap configured
  check("fa/window: no cap → unlimited moves left", faMovesLeft("m1") === Infinity, true);
  S.league = null; S.snapshots = []; S.transactions = [];
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
// Any position for any position: a keeper for a striker is a legal deal,
// and the hole it leaves is caught when that manager next picks an XI.
check("DEF ⇄ MID is allowed", pairValid(pick("a", "DEF"), pick("b", "MID")), true);
check("GK ⇄ FWD is allowed", pairValid(pick("a", "GK"), pick("b", "FWD")), true);
check("TEAM never tradable", pairValid(pick("a", "TEAM"), pick("b", "TEAM")), false);

/* trading: whole-trade validity */
const P = (id, slot) => pick(id, slot);
check("empty trade rejected", tradeError([]) !== null, true);
check("valid single pair", tradeError([{ mine: P("a", "MID"), theirs: P("b", "SUB_MID") }]), null);
check("valid multi pair", tradeError([
  { mine: P("a", "GK"), theirs: P("b", "GK") },
  { mine: P("c", "FWD"), theirs: P("d", "SUB_FWD") },
]), null);
check("cross-position pair accepted", tradeError([
  { mine: P("a", "DEF"), theirs: P("b", "FWD") },
]), null);
check("a TEAM pick is still refused", tradeError([
  { mine: P("a", "TEAM"), theirs: P("b", "FWD") },
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
/* History is grouped by MATCHWEEK now, not by lock period. Both clubs here are
   playing their FIRST game, so the two matchdays are one round of the
   competition -- and the round has to carry BOTH the player held for the first
   game and the one held for the second, or its subtotal would not match what
   was banked. */
check("both first games are one matchweek",
  managerHistory("m1").rounds.map((r) => r.n), [1]);
check("the round banks the whole week, across a mid-week change",
  managerHistory("m1").rounds[0].subtotal, 10);
check("both the old and the new player are itemised",
  managerHistory("m1").rounds[0].items.map((it) => it.entry.player_id).sort(),
  ["bra_2", "fra_5"]);
check("the round covers both matchdays",
  managerHistory("m1").rounds[0].dates, ["2026-06-12", "2026-06-16"]);

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
// A shortlist is a queue: auto-pick takes the top one still available, so the
// draft room can honestly tell you what you'll get. (It used to pick at random,
// which contradicted what the app told managers.)
apMgr.shortlist = ["bra_1", "fra_1", "esp_1"];   // bra_1 is knocked out → skipped
const pv = autoPickPreview(apMgr);
check("auto-pick preview takes the top available shortlist entry",
  [pv.entry.player_id, pv.fromShortlist], ["fra_1", true]);
check("auto-pick preview is deterministic",
  autoPickPreview(apMgr).entry.player_id, "fra_1");
apMgr.shortlist = [];
check("auto-pick preview falls back to the pool when the shortlist is empty",
  autoPickPreview(apMgr).fromShortlist, false);

// Bots: practice-draft opponents. They must respect the same eligibility rules
// as auto-pick (open quota, not knocked out, not already taken).
{
  apMgr.shortlist = [];
  const picks = new Set();
  for (let i = 0; i < 25; i++) {
    const e = botChoice(apMgr);
    if (!e) { picks.add("NONE"); break; }
    picks.add(e.player_id);
  }
  check("bot: only ever drafts eligible players",
    [...picks].every((id) => id !== "NONE" && id !== "bra_1"), true);
  check("bot: spreads picks rather than always taking the same player",
    picks.size > 1, true);
  check("bot think time is deterministic per pick",
    [botThinkMs(1), botThinkMs(1), botThinkMs(2) !== botThinkMs(1)], [botThinkMs(1), botThinkMs(1), true]);
  // ~5s: fast enough to keep a practice draft moving, slow enough that picks
  // land one at a time instead of the board filling itself in.
  check("bot think time is about five seconds",
    [botThinkMs(7) >= 4000, botThinkMs(7) <= 6000], [true, true]);
}

/* The draft queue: what stays, what greys out, what disappears. Without this
   the list grew all draft long and told you your shortlist was "empty" when it
   was really full of players who no longer fit. */
{
  const taken = {
    old:   { pick_number: 3,  manager_id: "rival" },   // gone before my last pick
    fresh: { pick_number: 12, manager_id: "rival" },   // gone since — worth flagging
  };
  const eligible = new Set(["keep1", "keep2"]);
  const plan = queuePlan(["keep1", "old", "fresh", "nofit", "keep2"], taken, 9, eligible);
  check("queue: drops players taken before your last pick",
    plan.rows.some((r) => r.pid === "old"), false);
  check("queue: keeps a recent loss visible, greyed",
    plan.rows.filter((r) => r.gone).map((r) => r.pid), ["fresh"]);
  check("queue: hides players who no longer fit, and counts them",
    [plan.rows.some((r) => r.pid === "nofit"), plan.hiddenNoFit], [false, 1]);
  check("queue: available count ignores the greyed row", plan.available, 2);
  check("queue: keeps your priority order",
    plan.rows.filter((r) => !r.gone).map((r) => r.pid), ["keep1", "keep2"]);
  // The case from the screenshot: a full shortlist, none of it eligible.
  const none = queuePlan(["a", "b", "c"], {}, 0, new Set());
  check("queue: a full but unusable shortlist is not 'empty'",
    [none.rows.length, none.hiddenNoFit, none.available], [0, 3, 0]);
  check("queue: an actually empty shortlist", queuePlan([], {}, 0, new Set()).hiddenNoFit, 0);
}

/* The pick flash: a small card announcing each pick. It disappeared once when
   a region rewrite silently deleted it, so pin the behaviour. */
{
  const saveM = S.managers, saveP = S.picks, saveL = S.league, saveById = S.playerById;
  S.managers = [{ id: "mA", name: "Ada" }, { id: "mB", name: "Bo" }];
  S.playerById = { px: { player_id: "px", name: "New Guy", position: "FWD", team: "Spurs" } };
  S.league = { id: "L1", current_pick: 3 };
  const pick = (n, mgr) => ({ id: "k" + n, manager_id: mgr, pick_number: n,
    player_id: "px", player_name: "New Guy", position: "FWD", slot: "FWD", team: "Spurs" });

  appended.length = 0;
  S.picks = [pick(1, "mA")];
  announceNewPicks();                       // first render just seeds the marker
  check("flash: silent on the first render", appended.length, 0);

  S.picks = [pick(1, "mA"), pick(2, "mB")];
  announceNewPicks();
  check("flash: fires for a new pick", appended.length, 1);
  check("flash: names the drafter and the player",
    /Bo picked/.test(appended[0].innerHTML) && /New Guy/.test(appended[0].innerHTML), true);

  announceNewPicks();                       // same picks again — e.g. a re-render
  check("flash: does not repeat on a re-render", appended.length, 1);

  S.picks = [pick(1, "mA"), pick(2, "mB"), pick(3, "mA")];
  announceNewPicks();
  check("flash: fires again for the next pick", appended.length, 2);

  S.managers = saveM; S.picks = saveP; S.league = saveL; S.playerById = saveById;
}

// How many picks until you're up — the draft room's "3 picks away" cue.
{
  const saveM = S.managers, saveL = S.league, saveP = S.picks;
  S.managers = [1, 2, 3, 4].map((i) => ({ id: "m" + i, name: "M" + i, draft_position: i }));
  S.league = { num_managers: 4, current_pick: 2 };
  S.picks = [];
  check("picksUntilTurn: on the clock now", picksUntilTurn("m2"), 0);
  check("picksUntilTurn: two away", picksUntilTurn("m4"), 2);
  check("picksUntilTurn: snake turn back for M1", picksUntilTurn("m1"), 6);
  S.managers = saveM; S.league = saveL; S.picks = saveP;
}
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
  const seenUrls = [];
  global.fetch = async (url) => {
    const u = new URL(url);
    seenUrls.push(u.href);
    // Requests go through the server-side proxy (?path=teams); fall back to the
    // direct endpoint shape so both routes are covered.
    const path = u.searchParams.get("path") || u.pathname.replace(/^\//, "");
    let response = [];
    if (path === "teams")
      response = [{ team: { id: 10, name: "Arsenal", code: "ARS" } }, { team: { id: 11, name: "Chelsea", code: null } }];
    else if (path === "players/squads")
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
  check("apiFootball routes through the server-side proxy",
    /\/functions\/v1\/api-football\?path=teams/.test(seenUrls[0]), true);
  check("apiFootball never puts the API key in the proxy URL",
    /x-apisports|apisports-key=/.test(seenUrls[0]), false);
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

  /* ---- shortlist depth: how far a board actually covers you ---- */
  // Snake draft. Pick 1 of 4 managers: your picks are #1, #8, #9, #16, ...
  // so a one-name board covers exactly your first pick and nothing more.
  check("one name covers only pick 1", shortlistCoverage(1, 4, 14, 1).through, 1);
  check("a name per round is nowhere near enough",
    shortlistCoverage(14, 4, 14, 1).through, 3);
  // Snaking means the last manager's first two picks are back to back, so an
  // equally deep board reaches further for them than for the first seed.
  check("snake favours the turn: last seed reaches further",
    shortlistCoverage(14, 4, 14, 4).through > shortlistCoverage(14, 4, 14, 1).through, true);
  check("depth needed for the whole draft scales with league size",
    shortlistCoverage(0, 8, 15, 3).target, 115);
  check("bigger league needs a deeper board for the same rounds",
    shortlistCoverage(0, 12, 15, 1).target > shortlistCoverage(0, 6, 15, 1).target, true);
  check("empty board covers nothing", shortlistCoverage(0, 4, 14, 1).through, 0);
  check("a full-depth board covers every round",
    shortlistCoverage(shortlistCoverage(0, 4, 14, 1).target, 4, 14, 1).through, 14);
  check("needForNext is the gap to the next covered round", (() => {
    const c = shortlistCoverage(5, 4, 14, 1);
    return shortlistCoverage(5 + c.needForNext, 4, 14, 1).through;
  })(), shortlistCoverage(5, 4, 14, 1).through + 1);
  // Degenerate inputs must not loop or return nonsense.
  check("solo league, no draft position", shortlistCoverage(3, 1, 3, 0).through, 3);
  check("draft position beyond the league is clamped",
    shortlistCoverage(9, 4, 5, 99).through, shortlistCoverage(9, 4, 5, 4).through);
  check("hint names the round you reach",
    coverageHint(shortlistCoverage(14, 4, 14, 1), 14).startsWith("covers picks 1\u20133 of 14"), true);
  check("hint celebrates a complete board",
    coverageHint(shortlistCoverage(999, 4, 14, 1), 14), "covers all 14 picks \u2b50");

  /* ---- dragging a row in a filtered list must not disturb the hidden ones ---- */
  // The draft queue hides shortlisted players who are gone or no longer fit,
  // so a drag reorders a SUBSET and the rest have to stay where they are.
  check("visible reorder leaves hidden entries in their slots",
    applyVisibleOrder(["a", "h1", "b", "h2", "c"], ["c", "a", "b"]),
    ["c", "h1", "a", "h2", "b"]);
  check("no hidden entries → the visible order is the order",
    applyVisibleOrder(["a", "b", "c"], ["c", "b", "a"]), ["c", "b", "a"]);
  check("an unchanged drag is a no-op",
    applyVisibleOrder(["a", "h", "b"], ["a", "b"]), ["a", "h", "b"]);
  check("ids not in the full list are ignored rather than inserted",
    applyVisibleOrder(["a", "b"], ["b", "a", "ghost"]), ["b", "a"]);
  check("dragging the last visible row to the top",
    applyVisibleOrder(["p1", "p2", "p3", "p4"], ["p4", "p1", "p2", "p3"]),
    ["p4", "p1", "p2", "p3"]);
  check("the full list is not mutated", (() => {
    const full = ["a", "b", "c"];
    applyVisibleOrder(full, ["c", "b", "a"]);
    return full;
  })(), ["a", "b", "c"]);

  /* ---- a local edit must outlive a slow, stale read ---- */
  // A read issued before our write is processed BEFORE our write, so it carries
  // the old value however long the response then takes to arrive. Ours wins
  // until the server hands back what we actually wrote.
  const rec = (v, at) => ({ value: v, at });
  check("stale read while our write is in flight → ours wins",
    overrideStillWins(["a", "b"], rec(["b", "a"], 0), true, 500), true);
  check("stale read long after the write, still unconfirmed → ours wins",
    overrideStillWins(["a", "b"], rec(["b", "a"], 0), false, 9000), true);
  check("server hands back what we wrote → stop overriding",
    overrideStillWins(["b", "a"], rec(["b", "a"], 0), false, 9000), false);
  check("confirmation wins even while another write is queued",
    overrideStillWins(["b", "a"], rec(["b", "a"], 0), true, 100), false);
  check("an unconfirmable write gives up rather than shadowing forever",
    overrideStillWins(["a", "b"], rec(["b", "a"], 0), false, 60000), false);
  check("a pending write is never abandoned on age alone",
    overrideStillWins(["a", "b"], rec(["b", "a"], 0), true, 60000), true);
  check("null and missing compare equal",
    overrideStillWins(null, rec(undefined, 0), false, 100), false);
  check("no record → nothing to override",
    overrideStillWins(["a"], null, false, 100), false);
  // The exact reported sequence: star appends, drag promotes, a read from
  // before the drag arrives late. It must not undo the drag.
  check("star-then-drag survives a late read of the star order",
    overrideStillWins(["p5", "p9", "p20"], rec(["p20", "p5", "p9"], 0), false, 5000), true);

  /* ---- the draft must not rewind, and a lost auto-pick must be retried ---- */
  // A read issued before our advance landed reports the previous pick. Applying
  // it puts the room back on an expired clock, which fires auto-pick twice.
  check("a read reporting an earlier pick is stale", keepLocalPick(23, 22, false), true);
  check("a read that agrees is accepted", keepLocalPick(23, 23, false), false);
  check("a read that has moved further ahead is accepted", keepLocalPick(23, 24, false), false);
  check("losing the compare-and-swap hands the position back",
    keepLocalPick(23, 22, true), false);
  check("no local pick yet → take the server's", keepLocalPick(0, 5, false), false);
  check("undefined local pick is not treated as ahead",
    keepLocalPick(undefined, 3, false), false);

  // The guard is set before the write; if the write never lands nothing clears it.
  check("guard held on the current pick past the retry window is stale",
    autoPickStale(23, 23, -10), true);
  check("still inside the retry window → leave it alone",
    autoPickStale(23, 23, -9), false);
  check("the clock has not even expired → not stale",
    autoPickStale(23, 23, 12), false);
  check("guard belongs to an older pick → the room has moved on",
    autoPickStale(22, 23, -30), false);
  check("no guard set → nothing to clear", autoPickStale(0, 23, -30), false);

  /* ---- a pick we just made must not vanish and come back ---- */
  const srv = (n, pid) => ({ id: "srv" + n, pick_number: n, player_id: pid });
  const opt = (n, pid, at) => ({ id: "local-" + n, pick_number: n, player_id: pid, _at: at });
  // The read was issued before our insert committed, so it comes back without
  // it. Replacing the list wholesale is what made the pick disappear from
  // Recent picks and the player reappear in the queue.
  check("our pending pick survives a read that predates it",
    mergeOptimisticPicks([srv(1, "a")], [srv(1, "a"), opt(2, "b", 1000)], 2000)
      .map((p) => p.player_id), ["a", "b"]);
  check("and it lands in pick order, not appended at the end",
    mergeOptimisticPicks([srv(1, "a"), srv(3, "c")], [opt(2, "b", 1000)], 2000)
      .map((p) => p.pick_number), [1, 2, 3]);
  check("once the server returns it, the server's row wins",
    mergeOptimisticPicks([srv(1, "a"), srv(2, "b")], [opt(2, "b", 1000)], 2000)
      .map((p) => p.id), ["srv1", "srv2"]);
  check("a confirmed list is passed through untouched",
    mergeOptimisticPicks([srv(1, "a")], [srv(1, "a")], 2000).length, 1);
  // Only our own optimistic rows are ever preserved, so a redraft or a removed
  // manager genuinely clearing picks is never undone.
  check("a server-side deletion is not resurrected",
    mergeOptimisticPicks([], [srv(1, "a"), srv(2, "b")], 2000), []);
  check("a stale ghost is dropped once it is too old to be in flight",
    mergeOptimisticPicks([srv(1, "a")], [opt(2, "b", 0)], 60000).length, 1);
  check("a different player on the same pick number is still ours to keep",
    mergeOptimisticPicks([srv(2, "z")], [opt(2, "b", 1000)], 2000).length, 2);

  /* ---- which seasons a league may be created on ---- */
  const utc = (y, m, d) => Date.UTC(y, m - 1, d);
  // A domestic season key is its START year, so 2026 = 2026/27. From June the
  // key ticks over to the season about to begin.
  check("July 2026 → the 2026/27 season", currentSeasonFor("league", utc(2026, 7, 30)), 2026);
  check("June is the rollover", currentSeasonFor("league", utc(2026, 6, 1)), 2026);
  check("May is still last season's key", currentSeasonFor("league", utc(2026, 5, 31)), 2025);
  check("January is mid-season, not a new one",
    currentSeasonFor("league", utc(2027, 1, 15)), 2026);
  // A finished season must not be offered — this is the whole point.
  check("only the unfinished season is offered",
    seasonOptions("league", utc(2026, 7, 30)), [2026]);
  check("2025 is not offered once 2026/27 has come round",
    seasonOptions("league", utc(2026, 7, 30)).includes(2025), false);
  // Tournaments are keyed by their own year and scheduled ahead.
  check("cups offer this year and next",
    seasonOptions("cup", utc(2026, 7, 30)), [2026, 2027]);
  check("a cup key is the plain year", currentSeasonFor("cup", utc(2026, 1, 5)), 2026);

  check("domestic seasons read as a split year", seasonLabel("league", 2026), "2026/27");
  check("the century wraps", seasonLabel("league", 2099), "2099/00");
  check("a cup reads as one year", seasonLabel("cup", 2026), "2026");
  // Balance for an unplayed season is judged on the one before it.
  check("backtest against the previous season", backtestSeason(2026), 2025);

  /* ---- a squad refresh, and what it may change about a drafted pick ---- */
  const pk_ = (id, pid, team, pos, slot) =>
    ({ id, player_id: pid, player_name: pid, team, position: pos, slot: slot || pos });
  const pl_ = (pid, team, pos) => ({ player_id: pid, team, position: pos });

  check("a transfer is picked up", pickReconciliation(
    [pk_("k1", "a", "Newcastle", "FWD")], [pl_("a", "Liverpool", "FWD")]).moves,
    [{ id: "k1", name: "a", from: "Newcastle", to: "Liverpool" }]);
  check("an unchanged club is not a move", pickReconciliation(
    [pk_("k1", "a", "Liverpool", "FWD")], [pl_("a", "Liverpool", "FWD")]).moves, []);
  // Someone sold out of the competition drops out of the pool. Blanking their
  // club would break the fixture lookups that still reference it.
  check("a player who left the competition keeps his club", pickReconciliation(
    [pk_("k1", "a", "Newcastle", "FWD")], []).moves, []);
  check("TEAM picks are not players", pickReconciliation(
    [pk_("k1", "team:Spurs", "Spurs", "TEAM", "TEAM")], [pl_("team:Spurs", "Other", "TEAM")]).moves, []);
  // Position is reported, never applied — the squad quota and every past round
  // were built on the position the player was drafted at.
  check("a position change is reported", pickReconciliation(
    [pk_("k1", "a", "Liverpool", "DEF")], [pl_("a", "Liverpool", "MID")]).repositioned,
    [{ name: "a", from: "DEF", to: "MID" }]);
  check("a position change is not a move", pickReconciliation(
    [pk_("k1", "a", "Liverpool", "DEF")], [pl_("a", "Liverpool", "MID")]).moves, []);
  check("a club AND position change reports both", (() => {
    const r = pickReconciliation([pk_("k1", "a", "Newcastle", "DEF")], [pl_("a", "Liverpool", "MID")]);
    return [r.moves.length, r.repositioned.length];
  })(), [1, 1]);
  check("only the moved picks come back", (() => {
    const r = pickReconciliation(
      [pk_("k1", "a", "Newcastle", "FWD"), pk_("k2", "b", "Arsenal", "MID"),
       pk_("k3", "c", "Chelsea", "DEF")],
      [pl_("a", "Liverpool", "FWD"), pl_("b", "Arsenal", "MID"), pl_("c", "Everton", "DEF")]);
    return r.moves.map((m) => m.id);
  })(), ["k1", "k3"]);
  check("empty inputs are safe", pickReconciliation(null, null).moves, []);

  /* Rounds are indexed per club, so rewriting a pick's team on transfer used to
     orphan every match the player had already played for the old club: their
     bench cover stopped counting and the per-round views went blank. */
  const xferSetup = (subTeam) => {
    S.fixtures = []; S.snapshots = []; S.stages = []; S.config = null;
    S.managers = [{ id: "m1", name: "M1", draft_position: 1 }];
    S.picks = [
      { manager_id: "m1", player_id: "fra_5", player_name: "Starter Def", position: "DEF",
        team: "France", slot: "DEF", is_sub: false, pick_number: 2 },
      { manager_id: "m1", player_id: "arg_3", player_name: "Sub Def", position: "DEF",
        team: subTeam, slot: "SUB_DEF", is_sub: true, pick_number: 12 },
    ];
    S.stats = [
      row({ player_id: "fra_9", match_label: "France vs Brazil (2026-06-13)", appeared: true, goals: 0 }),
      row({ player_id: "arg_3", match_label: "Argentina vs Chile (2026-06-16)", appeared: true, goals: 1 }),
    ];
  };
  const subPts = () => computeScores()[0].items.find((i) => i.pick.is_sub)?.pts;

  xferSetup("Argentina");
  check("sub covers a no-show starter (baseline)", subPts(), 6);
  check("per-round rows resolve at the old club", statsScopedRows("arg_3", "Argentina", 1).length, 1);

  xferSetup("Uruguay");   // reconciled to the new club after a transfer
  check("a transferred sub still scores its earlier match", subPts(), 6);
  check("a transferred player's history ties out", managerHistory("m1").total, computeScores()[0].total);
  check("per-round rows follow the player, not the new club",
    statsScopedRows("arg_3", "Uruguay", 1).map((r) => r.match_label),
    ["Argentina vs Chile (2026-06-16)"]);

  /* The fallback must not manufacture appearances: a round the player sat out
     stays empty, and a sub with no no-show to cover still scores nothing. */
  xferSetup("Uruguay");
  check("a round the player sat out stays empty", statsScopedRows("arg_3", "Uruguay", 2), []);
  // statsDerived() memoizes on the S.stats array identity, so replace it rather
  // than mutating in place (the app swaps the array wholesale on every refetch).
  S.stats = [...S.stats,
    row({ player_id: "fra_5", match_label: "France vs Brazil (2026-06-13)", appeared: true, goals: 0 })];
  check("no no-show means the transferred sub earns nothing", subPts(), 0);

  /* Matchweeks. Counting a club's fixtures only works if every club plays once
     per round; a domestic league breaks that with blanks and doubles, and the
     clubs' counts then drift so "round 3" means a different week per club. */
  const mwFx = (home, away, date, mw, status) => ({
    home, away, kickoff_utc: date + "T14:00:00Z", date,
    round: "Regular Season - " + mw, status: status || "FT" });
  const mwLeague = (fixtures, picks, stats) => {
    S.snapshots = []; S.stages = []; S.config = null;
    S.league = { id: "L1", competition: { apiLeagueId: 39, season: 2026, name: "Premier League" } };
    S.managers = [{ id: "m1", name: "M1", draft_position: 1 }];
    S.fixtures = fixtures; S.picks = picks; S.stats = stats;
  };
  const DEF_ST = { manager_id: "m1", player_id: "liv_1", player_name: "Starter", position: "DEF",
    team: "Liverpool", slot: "DEF", is_sub: false, pick_number: 1 };
  const DEF_SUB = { manager_id: "m1", player_id: "che_1", player_name: "Bench", position: "DEF",
    team: "Chelsea", slot: "SUB_DEF", is_sub: true, pick_number: 9 };

  // Liverpool blank in MW2; Chelsea play and the bench player scores.
  mwLeague(
    [mwFx("Liverpool", "Everton", "2026-08-01", 1), mwFx("Arsenal", "Chelsea", "2026-08-01", 1),
     mwFx("Chelsea", "City", "2026-08-08", 2),
     mwFx("Liverpool", "Spurs", "2026-08-15", 3)],
    [DEF_ST, DEF_SUB],
    [row({ player_id: "liv_1", match_label: "Liverpool vs Everton (2026-08-01)", appeared: true }),
     row({ player_id: "che_1", match_label: "Chelsea vs City (2026-08-08)", appeared: true, goals: 1 }),
     row({ player_id: "liv_1", match_label: "Liverpool vs Spurs (2026-08-15)", appeared: true })]);
  check("a blank gameweek lets the bench come on", computeScores()[0].total, 6);
  check("points land in the real matchweek, not the club's game count",
    Object.keys(computeScores()[0].roundPts).filter((k) => computeScores()[0].roundPts[k] > 0), ["2"]);

  // Same shape, but Liverpool's MW2 game merely hasn't kicked off yet.
  mwLeague(
    [mwFx("Liverpool", "Everton", "2026-08-01", 1), mwFx("Arsenal", "Chelsea", "2026-08-01", 1),
     mwFx("Chelsea", "City", "2026-08-08", 2), mwFx("Liverpool", "Wolves", "2026-08-09", 2, "NS")],
    [DEF_ST, DEF_SUB],
    [row({ player_id: "liv_1", match_label: "Liverpool vs Everton (2026-08-01)", appeared: true }),
     row({ player_id: "che_1", match_label: "Chelsea vs City (2026-08-08)", appeared: true, goals: 1 })]);
  check("a fixture still to be played is not a no-show", computeScores()[0].total, 0);

  // Double gameweek: a starter's club plays twice in MW2, so both games count.
  mwLeague(
    [mwFx("Liverpool", "Everton", "2026-08-08", 2), mwFx("Liverpool", "Wolves", "2026-08-11", 2)],
    [DEF_ST],
    [row({ player_id: "liv_1", match_label: "Liverpool vs Everton (2026-08-08)", appeared: true, goals: 1 }),
     row({ player_id: "liv_1", match_label: "Liverpool vs Wolves (2026-08-11)", appeared: true, goals: 1 })]);
  check("a double gameweek scores both games", computeScores()[0].total, 12);
  check("both games bucket into the same matchweek", computeScores()[0].roundPts, { 2: 12 });

  // Drift: Arsenal play twice in MW2 while Liverpool blank, so a count-based
  // round would call Liverpool's MW3 game "round 2" and misalign the two.
  mwLeague(
    [mwFx("Arsenal", "Chelsea", "2026-08-01", 1), mwFx("Liverpool", "Everton", "2026-08-01", 1),
     mwFx("Arsenal", "Spurs", "2026-08-08", 2), mwFx("Arsenal", "City", "2026-08-11", 2),
     mwFx("Liverpool", "Wolves", "2026-08-15", 3)],
    [{ ...DEF_ST, player_id: "ars_1", team: "Arsenal" }],
    [row({ player_id: "ars_1", match_label: "Arsenal vs City (2026-08-11)", appeared: true, goals: 1 })]);
  check("a club's third fixture can still be matchweek 2", computeScores()[0].roundPts, { 2: 6 });

  /* match_stats.team places a player in rounds they MISSED, which appearance
     inference cannot do. Starter transfers Everton -> Liverpool after MW1 and
     is then dropped for MW2; Liverpool played, so the bench must cover. */
  mwLeague(
    [mwFx("Everton", "Spurs", "2026-08-01", 1), mwFx("Arsenal", "Chelsea", "2026-08-01", 1),
     mwFx("Liverpool", "Wolves", "2026-08-08", 2), mwFx("Chelsea", "City", "2026-08-08", 2)],
    [{ ...DEF_ST, team: "Liverpool" }, DEF_SUB],
    [row({ player_id: "liv_1", match_label: "Everton vs Spurs (2026-08-01)", appeared: true, team: "Everton" }),
     row({ player_id: "che_1", match_label: "Arsenal vs Chelsea (2026-08-01)", appeared: true, team: "Chelsea" }),
     row({ player_id: "che_1", match_label: "Chelsea vs City (2026-08-08)", appeared: true, goals: 1, team: "Chelsea" })]);
  check("a transferred starter who then sits out is covered", computeScores()[0].total, 6);

  // Same rounds, but the starter's OLD club is the one playing in MW2 and he
  // is still there, so his absence is a plain no-show at Everton.
  mwLeague(
    [mwFx("Everton", "Spurs", "2026-08-01", 1), mwFx("Arsenal", "Chelsea", "2026-08-01", 1),
     mwFx("Everton", "Wolves", "2026-08-08", 2), mwFx("Chelsea", "City", "2026-08-08", 2)],
    [{ ...DEF_ST, team: "Everton" }, DEF_SUB],
    [row({ player_id: "liv_1", match_label: "Everton vs Spurs (2026-08-01)", appeared: true, team: "Everton" }),
     row({ player_id: "che_1", match_label: "Chelsea vs City (2026-08-08)", appeared: true, goals: 1, team: "Chelsea" })]);
  check("a plain no-show is still covered", computeScores()[0].total, 6);

  // With no team column (legacy rows) the pick's club is used, unchanged.
  mwLeague(
    [mwFx("Liverpool", "Everton", "2026-08-08", 2), mwFx("Liverpool", "Wolves", "2026-08-11", 2)],
    [DEF_ST],
    [row({ player_id: "liv_1", match_label: "Liverpool vs Everton (2026-08-08)", appeared: true, goals: 1 }),
     row({ player_id: "liv_1", match_label: "Liverpool vs Wolves (2026-08-11)", appeared: true, goals: 1 })]);
  check("legacy rows without a club still score", computeScores()[0].total, 12);

  // A cup keeps the count-based fallback: no competition => isCupCompetition().
  S.league = { id: "L1" };
  check("a cup still counts each club's own fixtures",
    (() => { const { roundByLabel } = roundResolvers({}, { France: ["France vs Brazil (2026-06-13)"] });
             return roundByLabel("France vs Brazil (2026-06-13)"); })(), 1);

  /* Draft order: random stays the default, manual keeps what the admin set. */
  S.league = { id: "L1", num_managers: 3, config: {} };
  check("draft order defaults to random", draftOrderMode(), "random");
  S.league.config = { draftOrder: "manual" };
  check("draft order can be set to manual", draftOrderMode(), "manual");
  S.league.config = { draftOrder: "nonsense" };
  check("an unknown order falls back to random", draftOrderMode(), "random");

  // Unplaced managers fall in BEHIND placed ones, so a late joiner cannot
  // silently take pick one out from under an order the admin already set.
  S.managers = [
    { id: "m3", name: "Zoe" },
    { id: "m1", name: "Ann", draft_position: 2 },
    { id: "m2", name: "Bob", draft_position: 1 },
  ];
  check("placed managers lead, unplaced follow",
    lobbyOrderManagers().map((m) => m.name), ["Bob", "Ann", "Zoe"]);
  S.managers = [{ id: "m2", name: "Bob" }, { id: "m1", name: "Ann" }];
  check("with nobody placed the order is stable by name",
    lobbyOrderManagers().map((m) => m.name), ["Ann", "Bob"]);

  // A shuffle is a permutation — same managers, no losses or duplicates.
  S.managers = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  check("shuffle keeps every manager exactly once",
    shuffled(S.managers).map((m) => m.id).sort(), ["a", "b", "c", "d"]);
  check("shuffle does not mutate the source",
    S.managers.map((m) => m.id), ["a", "b", "c", "d"]);

  // The rules card has to say which of the two modes is in force.
  S.league = { id: "L1", num_managers: 2, config: { draftOrder: "manual" }, current_pick: 0 };
  S.managers = [{ id: "m1", name: "Ann" }, { id: "m2", name: "Bob" }];
  S.picks = [];
  const orderCard = () => draftFactCards().find((c) => c[0] === "🐍");
  check("manual order is named in the rules", orderCard()[1], "Snake order · set by the admin");
  check("manual with nobody placed explains the lobby step",
    /admin arranges the order in the lobby/.test(orderCard()[2]), true);
  S.league.config = {};
  check("random order is named in the rules", orderCard()[1], "Snake order · drawn at random");
  check("random explains the draw",
    /drawn at random when the draft starts/.test(orderCard()[2]), true);
  S.managers = [{ id: "m1", name: "Ann", draft_position: 1 },
                { id: "m2", name: "Bob", draft_position: 2 }];
  check("once positions exist the rules name who picks first",
    /Ann → Bob/.test(orderCard()[2]), true);

  /* Auto-window waiver resolution. fixtureWindows() only ever reports the
     window currently OPEN, so once it shuts nothing described it — which is
     why an auto-window league's claims were never resolved at all. */
  const H = 3600e3, DAY = 24 * H;
  const wkFx = (round, firstMs) => [
    { round, kickoff_utc: new Date(firstMs).toISOString() },
    { round, kickoff_utc: new Date(firstMs + 2 * H).toISOString() },
  ];
  // MW1 ends day 0, MW2 starts day 7 → window opens +1h, closes 24h before MW2.
  const season = [...wkFx("Regular Season - 1", 0), ...wkFx("Regular Season - 2", 7 * DAY),
                  ...wkFx("Regular Season - 3", 14 * DAY)];
  const openAt1 = 2 * H + H, closeAt1 = 7 * DAY - 24 * H;

  check("no window has closed yet → nothing due",
    lastClosedTradeWindow(season, openAt1 + H, {}), null);
  check("after it shuts the closed window is found",
    lastClosedTradeWindow(season, closeAt1 + H, {})?.closeAt, closeAt1);
  check("the window is reported the instant it shuts",
    lastClosedTradeWindow(season, closeAt1, {})?.closeAt, closeAt1);
  check("later on, the most recent closed window wins",
    lastClosedTradeWindow(season, 14 * DAY, {})?.to, "Regular Season - 3");
  check("no fixtures → nothing to resolve", lastClosedTradeWindow([], Date.now(), {}), null);
  check("a single matchweek has no window", lastClosedTradeWindow(wkFx("R1", 0), 99 * DAY, {}), null);
  // Matchweeks closer together than the configured hours are not a window.
  check("a degenerate window is not a window",
    lastClosedTradeWindow([...wkFx("R1", 0), ...wkFx("R2", 3 * H)], 99 * DAY, {}), null);

  const w1 = lastClosedTradeWindow(season, closeAt1 + H, {});
  check("an unprocessed window is due", waiverDue(w1, null), true);
  check("a window already processed is not due again", waiverDue(w1, closeAt1), false);
  check("a window processed later is not due", waiverDue(w1, closeAt1 + 1), false);
  check("only an OLDER processed mark leaves it due", waiverDue(w1, closeAt1 - 1), true);
  check("no window means nothing is due", waiverDue(null, null), false);

  /* Forward-stamping. Nothing here depends on something running punctually:
     a change is written when it happens and stamped with the lock it takes
     effect at, so the clock does the applying. */
  const LK = (t) => t - 1 * H;                       // default lineupLockBeforeH
  const sea = [...wkFx("Regular Season - 1", 0), ...wkFx("Regular Season - 2", 7 * DAY),
               ...wkFx("Regular Season - 3", 14 * DAY)];

  check("an edit before MW1 is stamped at MW1's lock", nextLockMs(sea, -5 * H, {}), LK(0));
  // The heart of it: mid-matchweek edits must not touch the round in progress.
  check("an edit DURING MW1 is stamped at MW2's lock", nextLockMs(sea, 12 * H, {}), LK(7 * DAY));
  check("inside the lock, the edit lands on the next one", nextLockMs(sea, LK(0) + 60e3, {}), LK(7 * DAY));
  check("after the last fixture there is no lock left", nextLockMs(sea, 99 * DAY, {}), null);
  check("no fixtures, no lock", nextLockMs([], 0, {}), null);

  // Waiver awards attach to the lock AFTER their window closed — the same
  // expression whether the run is on time or days late.
  const wClose = 7 * DAY - 24 * H;
  check("awards attach to the lock after the window", lockAfterWindow(sea, wClose, {}), LK(7 * DAY));
  check("a late run resolves to the SAME lock, now in the past",
    lockAfterWindow(sea, wClose, {}), LK(7 * DAY));
  check("a window with no lock after it yields null", lockAfterWindow(sea, 99 * DAY, {}), null);

  /* Re-stamping when fixtures move. Only stamps still in the future may be
     re-pointed; a past one describes a round already played. */
  const snapAt = (id, t) => ({ id, effective_from: new Date(t).toISOString() });
  const moved = [...wkFx("Regular Season - 1", 0), ...wkFx("Regular Season - 2", 9 * DAY)];
  check("a snapshot follows its matchweek when it is postponed",
    restampPlan([snapAt("s1", LK(7 * DAY))], moved, 3 * DAY, {}),
    [{ id: "s1", effective_from: new Date(LK(9 * DAY)).toISOString() }]);
  check("an unmoved fixture needs no rewrite",
    restampPlan([snapAt("s1", LK(7 * DAY))], sea, 3 * DAY, {}), []);
  check("a stamp already in force is never rewritten",
    restampPlan([snapAt("s1", LK(0))], moved, 3 * DAY, {}), []);
  check("a bad timestamp is ignored rather than throwing",
    restampPlan([{ id: "s1", effective_from: "nonsense" }], moved, 0, {}), []);
  check("no fixtures means nothing to re-point",
    restampPlan([snapAt("s1", LK(7 * DAY))], [], 0, {}), []);

  /* A forward-stamped snapshot is a PLAN, not a record. Everything that reads
     snapshots has to know the difference, or a line-up for a round still to
     come starts describing rounds already played. */
  const NOWMS = Date.now(), DYY = 864e5;
  const snapRow = (id, effMs, createdMs, roster) => ({
    id, league_id: "L1", manager_id: "m1",
    effective_from: new Date(effMs).toISOString(),
    created_at: new Date(createdMs ?? effMs).toISOString(),
    roster: roster || [],
  });

  // History tab: the window cut is the last lock IN FORCE, not the last edit.
  S.snapshots = [snapRow("a", NOWMS - 5 * DYY), snapRow("b", NOWMS + 3 * DYY, NOWMS - 60e3)];
  check("the window cut ignores a line-up saved for a future lock",
    txWindowStarts()[0], NOWMS - 5 * DYY);
  check("a future lock never starts a window",
    txWindowStarts().some((t) => t > NOWMS), false);
  S.snapshots = [snapRow("a", NOWMS + DYY, NOWMS)];
  check("with only future stamps there is no window cut yet", txWindowStarts(), []);

  // Scoring: a past match must never resolve to a future line-up.
  S.managers = [{ id: "m1", name: "M1" }];
  S.picks = [{ id: "pk1", manager_id: "m1", player_id: "CUR", player_name: "Current",
    position: "FWD", team: "A", slot: "FWD", is_sub: false }];
  S.snapshots = [snapRow("f1", NOWMS + 3 * DYY, NOWMS,
    [{ player_id: "PLAN", player_name: "Planned", position: "FWD", team: "A", slot: "FWD", is_sub: false }])];
  check("a past match never uses a line-up that has not locked yet",
    rosterAtFor("m1", NOWMS - 2 * DYY, "2020-01-01").map((e) => e.player_id), ["CUR"]);
  // A past-dated snapshot is still the right fallback for an earlier match.
  S.snapshots = [snapRow("p1", NOWMS - DYY, NOWMS - DYY,
    [{ player_id: "OLD", player_name: "Older", position: "FWD", team: "A", slot: "FWD", is_sub: false }])];
  check("a past-dated snapshot is still used as the fallback",
    rosterAtFor("m1", NOWMS - 2 * DYY, "2020-01-01").map((e) => e.player_id), ["OLD"]);

  // "Starters yet to play" counts from the last lock in force, not the plan.
  S.league = { id: "L1", config: {} };
  const kickMs = NOWMS - 12 * 36e5;
  const kickDay = new Date(kickMs).toISOString().slice(0, 10);
  S.stats = [row({ player_id: "CUR", match_label: `A vs B (${kickDay})`, appeared: true })];
  S.fixtures = [{ home: "A", away: "B", kickoff_utc: new Date(kickMs).toISOString() }];
  S.snapshots = [snapRow("p1", NOWMS - DYY), snapRow("f1", NOWMS + 3 * DYY, NOWMS)];
  check("a future stamp does not blank the played counter",
    computeYetToPlay().m1.played, 1);
  S.snapshots = [snapRow("f1", NOWMS + 3 * DYY, NOWMS)];
  check("with no lock in force the counter reports none",
    computeYetToPlay().m1.hasSnapshot, false);

  /* An owned league is admin-by-account only. admin_token is readable by every
     signed-in user (invite lookup needs a broad SELECT), so if it still granted
     admin, anyone could read another league's token and take the league over. */
  S.authUser = { id: "owner-1" };
  S.league = { id: "L1", owner_id: "owner-1", admin_token: "tok" };
  check("the owner is admin", isAdmin(), true);
  S.authUser = { id: "someone-else" };
  check("a stranger holding the token is NOT admin", isAdmin(), false);
  S.authUser = null;
  check("a signed-out visitor with the token is NOT admin", isAdmin(), false);
  // Pre-account leagues have no owner, so the token is all they ever had.
  S.league = { id: "L1", owner_id: null, admin_token: "tok" };
  setSession({ ...getSession(), adminToken: "tok" });
  check("a legacy unowned league still accepts its token", isAdmin(), true);
  setSession({ ...getSession(), adminToken: "wrong" });
  check("a wrong token on a legacy league is refused", isAdmin(), false);
  S.league = null;
  check("no league means no admin", isAdmin(), false);

  /* Waivers resolve while nobody is watching and can leave an XI that does not
     add up -- a keeper claimed into an outfielder's place. The close repairs it
     rather than leaving someone to play the week with an illegal side. */
  const rp_ = (id, pos, sub) => ({ id, position: pos, is_sub: !!sub, slot: sub ? "SUB_" + pos : pos });
  const F = { mins: { GK: 1, DEF: 3, MID: 2, FWD: 1 },
              maxs: { GK: 1, DEF: 5, MID: 5, FWD: 3 }, total: 11 };
  // A legal side already: nothing should move.
  const legal = [rp_("g1","GK"), ...[1,2,3,4].map(i=>rp_("d"+i,"DEF")),
                 ...[1,2,3,4].map(i=>rp_("m"+i,"MID")), rp_("f1","FWD"), rp_("f2","FWD"),
                 rp_("b1","DEF",true), rp_("b2","MID",true)];
  const keep = repairStarters(legal, F.mins, F.maxs, F.total);
  check("a legal XI is left exactly as it is",
    [...keep].sort().join(","), legal.filter(p=>!p.is_sub).map(p=>p.id).sort().join(","));

  // Two keepers starting and only two defenders: illegal, and repairable.
  const broken = [rp_("g1","GK"), rp_("g2","GK"), ...[1,2].map(i=>rp_("d"+i,"DEF")),
                  ...[1,2,3,4].map(i=>rp_("m"+i,"MID")), rp_("f1","FWD"), rp_("f2","FWD"),
                  rp_("d3","DEF",true), rp_("d4","DEF",true)];
  const fixed = repairStarters(broken, F.mins, F.maxs, F.total);
  const cnt = (set) => { const c = { GK:0,DEF:0,MID:0,FWD:0 };
    for (const p of broken) if (set.has(p.id)) c[p.position]++; return c; };
  check("the repaired XI is the right size", fixed.size, 11);
  check("it fields exactly one keeper", cnt(fixed).GK, 1);
  check("it meets the defensive minimum", cnt(fixed).DEF >= 3, true);
  check("it stays inside every ceiling",
    ["GK","DEF","MID","FWD"].every((g) => cnt(fixed)[g] <= F.maxs[g]), true);
  check("a bench defender was promoted to cover the shortfall",
    fixed.has("d3") || fixed.has("d4"), true);
  check("bench order decides who comes up first", fixed.has("d3"), true);

  // Too few players, or none of a required position: refuse rather than write
  // something half-repaired.
  check("a squad too small to field an XI is left alone",
    repairStarters(legal.slice(0, 5), F.mins, F.maxs, F.total), null);
  const noKeeper = [...[1,2,3,4,5].map(i=>rp_("d"+i,"DEF")),
                    ...[1,2,3,4].map(i=>rp_("m"+i,"MID")), rp_("f1","FWD"), rp_("f2","FWD")];
  check("a squad with no keeper cannot be repaired",
    repairStarters(noKeeper, F.mins, F.maxs, F.total), null);
  check("TEAM picks are never counted as outfielders",
    repairStarters([...legal, { id:"t1", position:"TEAM", slot:"TEAM" }],
      F.mins, F.maxs, F.total).has("t1"), false);

  /* Rumbles fill LEFTOVER rounds at the end of a season. Substituting "rounds
     played so far" for the season length made round one leftover -- so a whole
     league became a rumble from the first week, with no wins, no losses and a
     log that never moved. */
  S.managers = ["m1","m2","m3","m4","m5"].map((id) => ({ id, name: id }));
  S.league = { id: "L1", config: { h2hEnabled: true,
    h2h: { win: 3, draw: 1, loss: 0, rumble: true, rumble_scoring: "placement" } } };
  // Round 1 played, season length never configured.
  S.picks = []; S.stats = []; S.snapshots = []; S.fixtures = [];
  const planNoRounds = h2hSchedulePlan(5, 1, { rumble: true });
  check("one round of a five-manager cycle IS leftover", planNoRounds.rumble, true);
  check("...and would rumble from round one", planNoRounds.rumbleFrom, 1);
  // Which is why an unset round count must not reach the planner at all.
  check("a full cycle leaves nothing over", h2hSchedulePlan(5, 5, { rumble: true }).rumble, false);
  check("only the genuine remainder rumbles",
    h2hSchedulePlan(5, 7, { rumble: true }).rumbleFrom, 6);

  // Placement with no points configured used to award nobody anything.
  check("empty placement points award nothing",
    Object.values(rumblePlacement({ a: 10, b: 5 }, [])), [0, 0]);
  check("the 3-2-1 fallback actually separates them",
    rumblePlacement({ a: 10, b: 5, c: 1 }, [3, 2, 1]).a, 3);

  /* A Dream XI has to be a formation someone could actually field. Counting to
     eleven is not enough: the fluid places used to go to the best outfielders
     regardless of position, so a big week for defenders produced seven of them. */
  S.league = { id: "L1", config: { formationMode: "flex", squadSize: 15,
    formation: { GK: [1, 1], DEF: [3, 5], MID: [2, 5], FWD: [1, 3], starters: 11 } } };
  S.managers = []; S.picks = []; S.snapshots = []; S.fixtures = [];
  // Twelve defenders scoring heavily, and just enough of everyone else.
  const dpl = (id, pos) => ({ player_id: id, name: id, position: pos, team: "A" });
  S.players = [dpl("gk1", "GK"), dpl("gk2", "GK"),
    ...Array.from({ length: 12 }, (_, i) => dpl("d" + i, "DEF")),
    ...Array.from({ length: 6 }, (_, i) => dpl("m" + i, "MID")),
    ...Array.from({ length: 4 }, (_, i) => dpl("f" + i, "FWD"))];
  S.playerById = Object.fromEntries(S.players.map((p) => [p.player_id, p]));
  S.stats = S.players.map((p, i) => row({ player_id: p.player_id,
    match_label: "A vs B (2026-08-01)", appeared: true,
    goals: p.position === "DEF" ? 3 : 0, minutes: 90 }));
  const xi = dreamTeam(0, false, false);
  const xiCnt = { GK: xi.GK.length, DEF: xi.DEF.length, MID: xi.MID.length, FWD: xi.FWD.length };
  for (const x of xi.FLEX) xiCnt[x.p.position]++;
  check("the Dream XI is eleven players",
    xiCnt.GK + xiCnt.DEF + xiCnt.MID + xiCnt.FWD, 11);
  check("it never exceeds a position's ceiling, however well they scored",
    xiCnt.DEF <= 5 && xiCnt.MID <= 5 && xiCnt.FWD <= 3 && xiCnt.GK <= 1, true);
  check("it is a formation that would actually pass validation",
    formationValid(xiCnt, { GK: [1, 1], DEF: [3, 5], MID: [2, 5], FWD: [1, 3], starters: 11 }), true);
  const worst = dreamTeam(0, false, true);
  const wc = { GK: worst.GK.length, DEF: worst.DEF.length, MID: worst.MID.length, FWD: worst.FWD.length };
  for (const x of worst.FLEX) wc[x.p.position]++;
  check("the Nightmare XI is legal too",
    formationValid(wc, { GK: [1, 1], DEF: [3, 5], MID: [2, 5], FWD: [1, 3], starters: 11 }), true);

  /* The per-window free-agent cap must not be moved by the fixtures moving.
     Counting timestamps against a boundary derived from the fixture list meant
     a rescheduled game dragged an earlier window's moves into the current one,
     and a manager who had made none was told they had used their cap. */
  const CAPH = 36e5, CAPD = 24 * CAPH;
  const capWk = (r, first) => [
    { round: "Regular Season - " + r, kickoff_utc: new Date(first).toISOString() },
    { round: "Regular Season - " + r, kickoff_utc: new Date(first + 2 * CAPH).toISOString() }];
  S.league = { id: "L1", config: { autoWindows: true, max_fa_per_window: 2, windows: {} } };
  S.managers = [{ id: "m1", name: "M1" }];
  S.snapshots = []; S.picks = []; S.stats = [];
  const NOWM = Date.now();
  // MW3 finished two days ago, MW4 is five days out: the window is open now.
  S.fixtures = [...capWk(3, NOWM - 2 * CAPD), ...capWk(4, NOWM + 5 * CAPD)];
  const openKey = faWindowKey();
  check("the window key names the matchweek it leads into", openKey, "Regular Season - 4");

  // A move made in the PREVIOUS window, stamped as such.
  S.transactions = [{ manager_id: "m1", kind: "swap", window_key: "Regular Season - 3",
    created_at: new Date(NOWM - 3 * CAPD).toISOString() }];
  check("a previous window's move does not count", faMovesThisWindow("m1"), 0);
  check("...so the full cap is available", faMovesLeft("m1"), 2);

  // Two made in THIS window do count.
  S.transactions.push(
    { manager_id: "m1", kind: "swap", window_key: openKey, created_at: new Date(NOWM).toISOString() },
    { manager_id: "m1", kind: "waiver", window_key: openKey, created_at: new Date(NOWM).toISOString() });
  check("this window's moves count", faMovesThisWindow("m1"), 2);
  check("...and exhaust the cap", faMovesLeft("m1"), 0);

  // Now reschedule MW4 later. The boundary moves; the count must not.
  S.fixtures = [...capWk(3, NOWM - 2 * CAPD), ...capWk(4, NOWM + 9 * CAPD)];
  check("rescheduling does not change the window key", faWindowKey(), openKey);
  check("...nor the count", faMovesThisWindow("m1"), 2);

  // A row written before the column existed still uses the old timestamp test.
  S.transactions = [{ manager_id: "m1", kind: "swap",
    created_at: new Date(NOWM - 9 * CAPD).toISOString() }];
  check("a legacy row outside the window is ignored", faMovesThisWindow("m1"), 0);

  /* Phase 0 of ROUNDS_DESIGN.md: a round recorded on the row when it was
     written beats every later inference. The point is that nothing that moves
     afterwards -- fixtures rescheduled, a player transferred, a club's game
     count drifting -- can relocate a match that already happened. */
  const p0fx = (home, away, date, mw, status) => ({
    home, away, kickoff_utc: date + "T14:00:00Z", date,
    round: "Regular Season - " + mw, status: status || "FT" });
  S.league = { id: "L1", competition: { apiLeagueId: 39, season: 2026, name: "Premier League" } };
  S.managers = [{ id: "m1", name: "M1", draft_position: 1 }];
  S.snapshots = []; S.config = null; S.stages = [];
  S.picks = [{ id: "pk1", manager_id: "m1", player_id: "liv_1", player_name: "Starter",
    position: "FWD", team: "Liverpool", slot: "FWD", is_sub: false, pick_number: 1 }];

  // The row RECORDS round 2. The fixture list then gets rebuilt so the same
  // label would derive as round 3. The recorded value must win.
  S.fixtures = [p0fx("Liverpool", "Everton", "2026-08-01", 1),
                p0fx("Arsenal", "Spurs", "2026-08-05", 2),
                p0fx("Liverpool", "Wolves", "2026-08-08", 3)];
  S.stats = [row({ player_id: "liv_1", match_label: "Liverpool vs Wolves (2026-08-08)",
                   appeared: true, goals: 1, team: "Liverpool", round: 2 })];
  check("a recorded round beats a rescheduled fixture list",
    computeScores()[0].roundPts, { 2: 4 });
  check("manager history agrees with it",
    managerHistory("m1").rounds.map((r) => r.n), [2]);

  // No fixture list at all: the recorded round still buckets correctly, where
  // the count-based fallback would have said round 1.
  S.fixtures = [];
  S.stats = [row({ player_id: "liv_1", match_label: "Liverpool vs Wolves (2026-08-08)",
                   appeared: true, goals: 1, team: "Liverpool", round: 5 })];
  check("a recorded round needs no fixture list", computeScores()[0].roundPts, { 5: 4 });

  // A transferred SUB with recorded rounds: no inference required at all.
  S.picks = [
    { id: "pk1", manager_id: "m1", player_id: "fra_5", player_name: "Starter", position: "DEF",
      team: "France", slot: "DEF", is_sub: false, pick_number: 1 },
    { id: "pk2", manager_id: "m1", player_id: "arg_3", player_name: "Sub", position: "DEF",
      team: "Uruguay", slot: "SUB_DEF", is_sub: true, pick_number: 2 }];
  S.fixtures = [p0fx("France", "Brazil", "2026-08-01", 1), p0fx("Argentina", "Chile", "2026-08-02", 1)];
  S.stats = [
    row({ player_id: "fra_9", match_label: "France vs Brazil (2026-08-01)", appeared: true, team: "France", round: 1 }),
    row({ player_id: "arg_3", match_label: "Argentina vs Chile (2026-08-02)", appeared: true, goals: 1, team: "Argentina", round: 1 })];
  check("a transferred sub with recorded rounds still covers",
    computeScores()[0].items.find((i) => i.pick.is_sub)?.pts, 6);

  // Legacy rows (no round) must go on using inference -- proven by the whole
  // suite above this line, but pinned here explicitly for the cup path.
  S.league = { id: "L1" };   // no competition => cup => count-based
  const rr = roundResolvers(
    { p1: [{ match_label: "France vs Brazil (2026-06-13)", appeared: true }] },
    { France: ["France vs Brazil (2026-06-13)"] });
  check("a legacy row without a round still counts club games",
    rr.roundByLabel("France vs Brazil (2026-06-13)"), 1);
  const rr2 = roundResolvers(
    { p1: [{ match_label: "France vs Brazil (2026-06-13)", appeared: true, round: 4 }] },
    { France: ["France vs Brazil (2026-06-13)"] });
  check("a recorded round wins even on the cup path",
    rr2.roundByLabel("France vs Brazil (2026-06-13)"), 4);

  /* Phase 1: which round's settlement is due. Pure companion to the
     advanceRound() transition; the IO half is covered in the browser. */
  const rsWk = (r, first) => [
    { round: "Regular Season - " + r, kickoff_utc: new Date(first).toISOString() },
    { round: "Regular Season - " + r, kickoff_utc: new Date(first + 2 * CAPH).toISOString() }];
  const rsSeason = [...rsWk(3, 0), ...rsWk(4, 7 * CAPD)];
  const rsClose = 7 * CAPD - 24 * CAPH;
  check("nothing closed yet → nothing to settle",
    roundToSettle(rsSeason, 3 * CAPH, {}), null);
  check("a closed window names the round it led into",
    roundToSettle(rsSeason, rsClose + CAPH, {})?.roundNo, 4);
  check("...and carries the window boundaries for the row",
    roundToSettle(rsSeason, rsClose + CAPH, {})?.win.closeAt, rsClose);
  check("cup round names never produce a settlement round",
    roundToSettle([
      { round: "Quarter-finals", kickoff_utc: new Date(0).toISOString() },
      { round: "Round of 16", kickoff_utc: new Date(7 * CAPD).toISOString() },
    ], 30 * CAPD, {}), null);
  check("no fixtures, nothing due", roundToSettle([], 99 * CAPD, {}), null);

  /* ...but "no round to record" is NOT "no settlement owed". roundToSettle()
     returning null covers two different leagues, and only one of them has
     nothing to do; conflating them is what stopped waivers resolving in auto
     leagues, and every World Cup knockout round is the other case. */
  const koSeason = [
    { round: "Quarter-finals", kickoff_utc: new Date(0).toISOString() },
    { round: "Round of 16", kickoff_utc: new Date(7 * CAPD).toISOString() },
  ];
  check("nothing closed → no settlement owed at all",
    closedWindowRound(rsSeason, 3 * CAPH, {}), null);
  check("a knockout window HAS closed...",
    !!closedWindowRound(koSeason, 30 * CAPD, {}), true);
  check("...it just has no round number to record it under",
    closedWindowRound(koSeason, 30 * CAPD, {}).roundNo, null);
  check("...and it still carries the window, so the legacy path can settle it",
    closedWindowRound(koSeason, 30 * CAPD, {}).win.to, "Round of 16");
  check("a numbered round reports its number here too",
    closedWindowRound(rsSeason, rsClose + CAPH, {}).roundNo, 4);
  check("no fixtures, nothing owed", closedWindowRound([], 99 * CAPD, {}), null);

  process.exit(fails ? 1 : 0);
})();
