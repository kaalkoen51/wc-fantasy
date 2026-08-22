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
  src + "\nreturn { S, pickInfo, myManager, isAdmin, boardRulesNote, calcPlayerPoints, calcTeamPoints, computeScores, stageBonuses, stageOrder, finalPickBonus, phaseOneQuota, phaseOneStarters, starterQuota, effectiveConfig, flexCounting, formationValid, DEFAULT_FORMATION, roundRobin, h2hResult, h2hTable, h2hFixturesFor, resolveFaClaims, h2hSchedulePlan, rumblePlacement, matchdayPlan, fmtCountdown, roundRecap, deadlineCrossed, managerStreaks, seasonAwards, transferRoundup, picksUntilTurn, autoPickPreview, navGroups, groupOfTab, isCupCompetition, CREATE_PRESETS, scoringBalance, pointsHistogram, statSummary, rowPointsWith, buildFixtureStatRows, fixtureWindows, matchweeksOf, maxFaPerWindow, faMovesThisWindow, faMovesLeft, faWindowStartMs, apiPosToSlot, teamCodeFrom, parseSquadPlayer, parseApiFixture, fetchCompetitionPool, fetchCompetitionFixtures, compKeyOf, competitionKey, scoringRules, rugbyMatchSettled, rugbyTeamKnown, firstArray, RUGBY_BENCH_POS, noCandidatesReason, lineupSwapValid, crestUrlFor, rugbyTeamCrest, rugbyPlayerCrest, crestFields, rugbyCrestUrl, rugbyTeamCode, clubHue, initialsOf, markSvg, teamCodeOf, teamCrestHtml, avatarHtml, loadedCompetitions, practiceCompetition, practiceNote, resolveRugbyPosition, canonicalTeamNames, crestBadgeHtml, leftCompetition, availBadges, availText, riskOf, lineupRisks, riskNames, lineupTodo, decodeEntities, cleanPlayerNames, esc, installHint, anyMatchLive, weekInPlay, MATCH_MS, roundsEndedBy, recappableRounds, roundStillPlaying, pushState, ALERT_KINDS, defaultAlertPrefs, subscriptionRow, urlBase64ToUint8Array, rugbySeasonWindow, rugbyDataWindow, rugbyRoundOrder, positionsCsv, parsePositionsCsv, csvSplit, positionRows, positionEvidence, applyPoolOverrides, poolEditsOf, scoredMatchCount, poolCsv, parsePoolCsv, mergePoolCsv, manualPlayerId, preDraftPoolNote, PHASE1_STARTERS, sportNeedsApiKey, summariseLineupSample, lineupObservationText, RUGBY_QUOTA, RUGBY_STARTERS, RUGBY_PLAY_GROUPS, RUGBY_PITCH_BANDS, RUGBY_RULES, RUGBY_STAT_CATALOG, RUGBY_SLOTS, slotMapsFor, sumGroups, zeroByGroup, outfieldGroups, squadSize, flexComplete, flexLeft, fixedRoundSubs, SLOT_POS, SLOT_RANK, rugbyPosCode, isRugbyBenchSlot, parseRugbyPlayer, parseRugbyMatch, usableRugbyMatches, rugbyStatRows, rugbyStatsOf, RUGBY_STAT_KEYS, RUGBY_COMPETITIONS, rugbyBody, parseCompKey, competitionsFor, SPORTS, sportOf, sportDef, posGroups, playGroups, slotPosMap, slotRankMap, slotGroup, pairValid, tradeError, quotaLeft, leagueFlex, slotForNewPick, posQuota, picksPerManager, totalPicks, playerBreakdown, playerPoints, passAccuracyPct, rawStatsOf, suspendedNext, yellowBanCount, yellowWindow, injuryFeedNote, effectiveCaptain, resilientWrite, playerStatTotal, teamMatchLabels, entryForManagerAt, ownerEntryAt, slotLabel, managerHistory, poolEntries, availableForGroup, isEliminated, computeYetToPlay, showView, plannerChoiceRank, choiceStatus, plannerPickPool, autoPickCandidates, entryForId, botChoice, botThinkMs, queuePlan, queueWindow, freshQueueIds, moveShortlistTop, scoringHtml, smallPrintHtml, CRESTS, CRESTS_MORE, MGR_COLORS, authErrorText, flashPick, announceNewPicks, renderDraftQueue, renderDraft, statsScopedRows, sumStatKey, sumMinutes, formAvg, formLog, dreamTeam, formDotColor, shortlistCleaned, standingsMovement, roundMVPs, seasonSeries, headToHead, currentRoundNo, currentRoundDreamIds, chatThreads, messagesForThread, threadUnread, markThreadSeen, koRoundOf, knockoutBracket, needsSummary, lineupValid, pitchHtml, pitchFacingHtml, pitchRowsHtml, squadBoardHtml, historyViewHtml, benchInOrder, moveBench, orderedRoster, flipRows, wireLineupControls, markQueueMoved, matchdayCtaAct, matchdayCardHtml, renderLineup, renderHomeTab, openH2HPreview, openH2HFixture, lineupRowHtml, dugoutHtml, renderFixturesTab, h2hRoundFixtures, h2hTotalRounds, h2hFormOf, h2hStandingsHtml, seasonChartHtml, renderScoutList, renderStatsTab, renderPredraftShortlist, preDraftBrowsing, shortlistCoverage, coverageHint, scoringByPositionHtml, openScoringSheet, animateReorder, applyLocalOverrides, queueManagerWrite, wireStars, starHtml, draftFactCards, draftRulesHtml, lobbyRulesHtml, scoringHtml, applyVisibleOrder, makeReorderable, refetchAll, markConnection, enterLeagueWithFeedback, route, showView, dragActive, afterDrag, overrideStillWins, queueManagerWrite, applyLocalOverrides, keepLocalPick, autoPickStale, autoPickTurn, makePick, autoPick, tickTimer, mergeOptimisticPicks, pickKey, queueFieldWrite, OVERRIDE_TABLES, setPlanner, saveLineup, toggleKeeper, setFinalPick, txWindowStarts, txWhen, txShell, txAvatar, txMgrChip, tradeTxCard, swapTxCard, transactionsLogHtml, renderTrades, builderHtml, faClaimsSectionHtml, waiverOrderHtml, shortlistSectionHtml, plannerSectionHtml, plannerMoveHtml, squadChooserHtml, tradeSectionHtml, setClaimOrder, reorderClaim, tradeForShortlisted, submitTrade, TRADE_TABS, tradeTabBodyHtml, faClaimRowHtml, faClaimRowsHtml, renderClaimList, wireClaimControls, ROW_ATTRS, plannerMoveChoice, plannerSetChoiceOrder, plannerPickPool, renderPlannerPick, setWindowMode, toggleLineups, squadPitchHtml, squadShape, renderDreamTeam, dreamTeam, renderChat, chatThreads, interacting, markInteracting, scheduleDeferredFlush, INTERACT_MS, animateReorder, flipRows, flushDeferredRender, currentSeasonFor, seasonOptions, seasonLabel, backtestSeason, createCompKind, createPreviewSeason, loadScoringPreviewData, pullCreateHistory, renderCreateBalance, updateCreatePullStatus, renderCreateForm, pickReconciliation, reconcilePicksToPool, mapApiPlayer, loadCompetition, roundResolvers, roundIndex, mwNo, FINAL_STATUS, draftOrderMode, lobbyOrderManagers, shuffled, setDraftOrder, renderLobbyOrder, lastClosedTradeWindow, waiverDue, maybeProcessAutoWaivers, processWaiversNow, nextLockMs, lockAfterWindow, snapshotAt, snapshotForNextLock, rosterAtFor, setSession, getSession, repairStarters, lineupShape, repairLineupFor, faWindowKey, roundToSettle, closedWindowRound, closedWindowRounds, closedTradeWindows, roundsOwedSettlement, isRoundSettled, matchFixture, matchTimeFor, computeScoresUncached, bustScores, roundKeyLockedAt, roundKeyOfLabel, roundLabelShort, roundIndex, rosterAtFor, snapshotsByManager, advanceRound, maybeAdvanceRounds };"
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
        overrideStillWins, keepLocalPick, autoPickStale, autoPickTurn, mergeOptimisticPicks,
        maxFaPerWindow, faMovesThisWindow, faMovesLeft, faWindowStartMs,
        apiPosToSlot, teamCodeFrom, parseSquadPlayer, parseApiFixture,
        fetchCompetitionPool, fetchCompetitionFixtures, compKeyOf, competitionKey,
        rugbyPosCode, isRugbyBenchSlot, parseRugbyPlayer, parseRugbyMatch, usableRugbyMatches, rugbyStatRows, rugbyStatsOf, RUGBY_STAT_KEYS, RUGBY_COMPETITIONS, rugbyBody, 
        parseCompKey, competitionsFor, SPORTS, sportOf, sportDef, posGroups, playGroups, slotPosMap, slotRankMap, scoringRules, pitchRowsHtml, 
        rugbyMatchSettled, rugbyTeamKnown, firstArray, RUGBY_BENCH_POS, noCandidatesReason, lineupSwapValid, crestUrlFor, rugbyTeamCrest, rugbyPlayerCrest, crestFields, rugbyCrestUrl, rugbyTeamCode, clubHue, initialsOf, markSvg, teamCodeOf, teamCrestHtml, avatarHtml, loadedCompetitions, practiceCompetition, practiceNote, resolveRugbyPosition, canonicalTeamNames, crestBadgeHtml, leftCompetition, availBadges, availText, riskOf, lineupRisks, riskNames, lineupTodo, decodeEntities, cleanPlayerNames, esc, installHint, anyMatchLive, weekInPlay, MATCH_MS, roundsEndedBy, recappableRounds, roundStillPlaying, pushState, ALERT_KINDS, defaultAlertPrefs, subscriptionRow, urlBase64ToUint8Array, rugbySeasonWindow, rugbyDataWindow, rugbyRoundOrder, positionsCsv, parsePositionsCsv, csvSplit, positionRows, positionEvidence, applyPoolOverrides, poolEditsOf, scoredMatchCount, poolCsv, parsePoolCsv, mergePoolCsv, manualPlayerId, preDraftPoolNote, PHASE1_STARTERS, sportNeedsApiKey, summariseLineupSample, lineupObservationText,
        RUGBY_QUOTA, RUGBY_STARTERS, RUGBY_PLAY_GROUPS, RUGBY_PITCH_BANDS, RUGBY_RULES, RUGBY_STAT_CATALOG, RUGBY_SLOTS, slotMapsFor, sumGroups, zeroByGroup, outfieldGroups, squadSize, flexComplete, flexLeft, fixedRoundSubs, SLOT_POS, SLOT_RANK, 
        slotGroup, pairValid, tradeError, quotaLeft, leagueFlex, slotForNewPick,
        posQuota, picksPerManager, totalPicks,
        playerBreakdown, playerPoints, passAccuracyPct, rawStatsOf, suspendedNext, yellowBanCount, yellowWindow, injuryFeedNote, effectiveCaptain, resilientWrite,
        playerStatTotal, teamMatchLabels, entryForManagerAt, ownerEntryAt,
        slotLabel, managerHistory, poolEntries, availableForGroup,
        isEliminated, computeYetToPlay, showView,
        plannerChoiceRank, choiceStatus, plannerPickPool,
        autoPickCandidates, entryForId, botChoice, botThinkMs, queuePlan, queueWindow, freshQueueIds, moveShortlistTop, scoringHtml, smallPrintHtml, CRESTS, CRESTS_MORE, MGR_COLORS, authErrorText, flashPick, announceNewPicks, renderDraftQueue, renderDraft,
        statsScopedRows, sumStatKey, sumMinutes, formAvg, formLog,
        dreamTeam, formDotColor, shortlistCleaned, standingsMovement, roundMVPs,
        seasonSeries, headToHead,
        currentRoundNo, currentRoundDreamIds,
        chatThreads, messagesForThread, threadUnread, markThreadSeen,
        koRoundOf, knockoutBracket, needsSummary, lineupValid,
        roundResolvers, roundIndex, mwNo, draftOrderMode, lobbyOrderManagers,
        shuffled, setDraftOrder, renderLobbyOrder, draftFactCards,
        lastClosedTradeWindow, waiverDue, maybeProcessAutoWaivers, processWaiversNow,
        nextLockMs, lockAfterWindow, snapshotAt, snapshotForNextLock,
        txWindowStarts, rosterAtFor, setSession, getSession, faWindowKey, roundToSettle,
        closedWindowRound, closedWindowRounds, closedTradeWindows, roundsOwedSettlement, isRoundSettled,
        matchFixture, matchTimeFor, computeScoresUncached, bustScores,
        roundKeyLockedAt, roundKeyOfLabel, roundLabelShort,
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
  /* Level on points: difference decides, not the meeting between them.
     Reported from the app -- "the league table is sorted on points first
     (correct) but if tied, the points difference should be used". It was
     points, then head-to-head, then points for; difference was in the table
     and in the sort menu but not in the ranking.

     a, b and c all finish on 3. a BEAT b head-to-head (41-40), which is what
     used to put a above them -- but a was then beaten 80-30 by c, so a's
     difference is -49 against b's +69. The table has to read b, c, a. */
  const tbCfg = { win: 3, draw: 1, loss: 0, score_bonus: 999, losing_margin: -1 };
  const tbFx = [
    { round: 1, home_manager_id: "a", away_manager_id: "b" },
    { round: 2, home_manager_id: "a", away_manager_id: "c" },
    { round: 3, home_manager_id: "b", away_manager_id: "d" },
  ];
  const tbScores = { a: [41, 30], b: [40, undefined, 90], c: [undefined, 80], d: [undefined, undefined, 20] };
  const tbTable = h2hTable(["a", "b", "c", "d"], tbScores, tbFx, tbCfg);
  check("h2hTable: everyone in the tie is genuinely level on points",
    [tbTable.rows.a.logPts, tbTable.rows.b.logPts, tbTable.rows.c.logPts], [3, 3, 3]);
  check("h2hTable: difference is what it should be",
    [tbTable.rows.a.PF - tbTable.rows.a.PA, tbTable.rows.b.PF - tbTable.rows.b.PA], [-49, 69]);
  check("h2hTable: level on points, difference orders the table", tbTable.order, ["b", "c", "a", "d"]);
  /* ...and the order no longer depends on which pair the sort happened to
     compare first. met() compares ONE pair, and here a beat b, b beat nobody
     relevant, c beat a -- a cycle, so a non-transitive comparator could and
     did return different tables for the same data. Difference is a plain
     number every manager has one of. */
  const tbAgain = h2hTable(["d", "c", "b", "a"], tbScores, tbFx, tbCfg);
  check("h2hTable: the same table whichever order the managers arrive in",
    tbAgain.order, tbTable.order);
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
  check("buildFixtureStatRows: a clean sheet means nothing conceded, for everyone",
    rows.map((r) => r.raw["goals.conceded"]), [0, 0]);
  check("buildFixtureStatRows: MOTM = top rating ≥7.5", rows[0].motm, true);
  check("buildFixtureStatRows: rows scoped by competition key", rows[0].competition_key, "39-2024");
  check("buildFixtureStatRows: maxMin + clean-sheet diagnostics", [maxMin, cs], [90, 2]);
  // Phase 0 (ROUNDS_DESIGN.md): the writer stamps the matchweek it knows NOW.
  check("buildFixtureStatRows: the matchweek is stamped on every row",
    rows.map((r) => r.round), [27, 27]);
  const cupF = { ...f, league: { round: "Round of 16" } };
  check("buildFixtureStatRows: a cup round name stamps null, not a number",
    buildFixtureStatRows(cupF, teamBlocks, {}, (n) => n, pidOf, []).rows[0].round, null);
  // Phase 1.5: ...but the round KEY is there for the cup too, which is the
  // whole reason the number stopped being the key.
  check("buildFixtureStatRows: the round key is stamped for a cup round",
    buildFixtureStatRows(cupF, teamBlocks, {}, (n) => n, pidOf, []).rows[0].round_key,
    "Round of 16");
  /* Phase 3: and WHICH MATCH it was, by the API's own id. match_label
     describes the match; this names it. The label is what ~31 read sites
     parse back apart, and a rename or a corrected date breaks every one of
     them without the match having changed at all. */
  check("buildFixtureStatRows: the fixture id is stamped on every row",
    rows.map((r) => r.fixture_id), [1, 1]);

  /* Goals conceded is what their CLUB let in, not the API's per-player field.

     Reported from the app: "goals conceded does not seem to be working
     properly". The league scores -1 per 2 conceded for GK, DEF and MID, and
     only the keepers were ever charged. raw["goals.conceded"] was reading
     stat_goals.conceded, which API-Football fills in for goalkeepers and
     leaves at 0 for everyone else -- so the rule fired for one player per
     club per match and silently did nothing for the other ten.

     It survived because the LEGACY `conceded` column had always used the team
     total, and so does sim.js -- which is why the simulator scored this
     correctly and only the real feed did not. The three now agree.

     The away forward carries a deliberately absurd per-player value: if it
     ever leaks back into the row, this says so rather than passing because
     the two numbers happened to match. */
  const cf = {
    teams: { home: { id: 10, name: "Home" }, away: { id: 20, name: "Away" } },
    goals: { home: 1, away: 3 },
    fixture: { id: 7, date: "2026-03-08T15:00:00+00:00", status: { short: "FT" } },
    league: { round: "Regular Season - 28" },
  };
  const cBlocks = [
    { team: { id: 10, name: "Home" }, players: [
      // The keeper: the API does report this one, and it agrees with the team.
      { player: { id: 300, name: "Keeper" }, statistics: [{ games: { minutes: 90 }, goals: { saves: 4, conceded: 3 } }] },
      // The defender: the API reports nothing, and he used to be charged nothing.
      { player: { id: 301, name: "Defender" }, statistics: [{ games: { minutes: 90 }, tackles: { total: 3 } }] },
    ] },
    { team: { id: 20, name: "Away" }, players: [
      { player: { id: 400, name: "Forward" }, statistics: [{ games: { minutes: 90 }, goals: { total: 2, conceded: 99 } }] },
    ] },
  ];
  const cRows = buildFixtureStatRows(cf, cBlocks, {}, (n) => n, pidOf, []).rows;
  const concededOf = (id) => cRows.find((r) => r.player_id === id).raw["goals.conceded"];
  check("buildFixtureStatRows: an outfielder is charged what his club let in", concededOf("api_301"), 3);
  check("buildFixtureStatRows: ...and so is the keeper, unchanged", concededOf("api_300"), 3);
  check("buildFixtureStatRows: the other club is charged its own goals against", concededOf("api_400"), 1);
  check("buildFixtureStatRows: the API's per-player figure is not consulted",
    cRows.every((r) => r.raw["goals.conceded"] !== 99), true);
  // The legacy column and the raw map must not drift apart again.
  check("buildFixtureStatRows: nobody on a conceding side has a clean sheet",
    cRows.map((r) => r.raw["clean_sheet"]), [0, 0, 0]);
  check("buildFixtureStatRows: no fixture id available stamps null, not a guess",
    buildFixtureStatRows({ ...f, fixture: { ...f.fixture, id: undefined } },
      teamBlocks, {}, (n) => n, pidOf, []).rows[0].fixture_id, null);
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
    tradeClosesAt: 5000, todo: [{ text: "No captain", act: "captain" }] });
  check("matchday: an unset lineup outranks transfers", trTodo.cta.act, "lineup");
  // Each warning carries the screen that FIXES it, so the row can be a button.
  check("matchday: the todo is passed through with its actions",
    trTodo.todo.map((t) => t.act), ["captain"]);
  // Trade shut, lineup still open → last chance, deadline is the lock.
  const ln = matchdayPlan({ ...base, tradeOpen: false, lineupOpen: true, lineupLockAt: 9000 });
  check("matchday: trade closed but lineup open → lineup",
    [ln.stage, ln.deadlineAt, ln.deadlineLabel], ["lineup", 9000, "Lineup locks"]);
  /* A round that has started but has no game on this minute -- the Sunday of a
     Friday-to-Monday matchweek. Reported from the app: the card offered "Last
     chance to set your team, Matchweek 2" while matchweek 1 was being played. */
  const mid = matchdayPlan({ ...base, inPlay: true, tradeOpen: false,
    lineupOpen: false, tradeOpensAt: 8000, kickoffAt: 99000 });
  check("matchday: a round under way is not 'complete'", mid.stage, "locked");
  check("...and says so", mid.title, "Matchweek under way");
  check("...with no countdown, because the next lock is a week away",
    mid.deadlineAt, null);
  check("...and no button that only apologises",
    mid.cta.act !== "lineup", true);
  // A live game still outranks it: that is the more specific fact.
  check("matchday: a game actually on beats the round-in-play state",
    matchdayPlan({ ...base, inPlay: true, live: true }).stage, "live");

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
/* The captain's club PLAYED and he was not in it -> the vice doubles instead.

   The evidence matters, and this test used not to supply it: with no France
   row at all the app has no way to know France played, and the old rule --
   "the captain has not appeared, so give the band to the vice" -- guessed.
   That guess is the bug reported from the app: on a Friday night no Sunday
   captain has appeared yet, so the armband fell to the vice the moment the
   vice's game kicked off. The France row below is another player, which is
   what tells the app the fixture happened. */
S.stats = [
  row({ player_id: "arg_5", match_label: "Argentina vs Y (2026-06-13)", appeared: true, goals: 1 }),
  row({ player_id: "fra_9", match_label: "France vs X (2026-06-13)", appeared: true, team: "France" }),
];
check("captain: his club played without him, so the vice doubles (5→10)",
  computeScores()[0].total, 5 + 5);

/* And the case that was wrong: the vice has played, the captain's game is
   still to come. Nothing about France has been recorded yet, so his absence
   is not confirmed -- he keeps the band, and nothing is doubled early. */
S.stats = [row({ player_id: "arg_5", match_label: "Argentina vs Y (2026-06-13)", appeared: true, goals: 1 })];
check("captain: a vice who plays first does not steal the armband",
  computeScores()[0].total, 5);
// ...and once the captain does play, HE doubles, not the vice.
S.stats = [
  row({ player_id: "arg_5", match_label: "Argentina vs Y (2026-06-13)", appeared: true, goals: 1 }),
  row({ player_id: "fra_5", match_label: "France vs X (2026-06-14)", appeared: true, goals: 1 }),
];
check("captain: once he plays, the double is his", computeScores()[0].total, 5 + 6 + 6);

/* The decision itself, in isolation. Both scoring paths call this, because
   they have drifted before by exactly this bonus. */
check("armband: the captain keeps it while his game is still to come",
  effectiveCaptain("cap", "vice", false), "cap");
check("armband: confirmed absent hands it to the vice",
  effectiveCaptain("cap", "vice", true), "vice");
check("armband: no captain set falls to the vice",
  effectiveCaptain(null, "vice", false), "vice");
check("armband: neither set is nobody",
  effectiveCaptain(null, null, true), null);
check("armband: confirmed absent with no vice doubles nobody",
  effectiveCaptain("cap", null, true), null);

S.league = {}; S.managers = []; S.picks = []; S.stats = [];

/* player stats breakdown: per-category points sum to the player total */
S.stats = [
  row({ player_id: "ger_1", match_label: "Germany vs X (2026-06-20)", saves: 5, clean_sheet: true }),
  row({ player_id: "ger_1", match_label: "Germany vs Y (2026-06-24)", saves: 3 }),
  row({ player_id: "ger_5", match_label: "Germany vs X (2026-06-20)", defensive_actions: 5, goals: 1, yellow_cards: 1 }),
];
/* Pass accuracy. Reported from the app: "Pass accuracy % x52" for a
   midfielder who played 76 minutes of a 3-0 win -- 52% would be a dreadful
   afternoon, 52 accurate passes out of about sixty an ordinary one. The feed
   puts a COUNT in a field called accuracy. */
check("a count of accurate passes becomes a real percentage",
  passAccuracyPct({ "passes.accuracy": 52, "passes.total": 63 }), 83);
check("...rounded, not truncated",
  passAccuracyPct({ "passes.accuracy": 5, "passes.total": 8 }), 63);
check("a perfect afternoon is 100, not 100-something",
  passAccuracyPct({ "passes.accuracy": 30, "passes.total": 30 }), 100);
/* A count can never exceed the total, so anything larger is already a
   percentage -- taken as one rather than divided into nonsense. This is the
   half that makes the derivation right whichever way the feed behaves. */
check("a value that cannot be a count is treated as the percentage it is",
  passAccuracyPct({ "passes.accuracy": 87, "passes.total": 20 }), 87);
check("nobody who touched the ball nought times has an accuracy",
  passAccuracyPct({ "passes.accuracy": 0, "passes.total": 0 }), 0);
check("a row with no pass data at all", passAccuracyPct({}), 0);
// The raw count keeps its own key, so a league scoring on it is unaffected.
check("the count is still there under its own name",
  rawStatsOf({ raw: { "passes.accuracy": 52, "passes.total": 63 } })["passes.accuracy"], 52);
check("...and the percentage sits beside it",
  rawStatsOf({ raw: { "passes.accuracy": 52, "passes.total": 63 } })["passes.pct"], 83);

check("GK breakdown sums to playerPoints",
  playerBreakdown("ger_1", "GK").reduce((s, r) => s + r.pts, 0),
  playerPoints("ger_1", "GK"));
check("GK saves floor per match (2+1, not 4)",
  playerBreakdown("ger_1", "GK").find((r) => r.label.startsWith("Save")).pts, 3);
/* Two rules on the same stat have to read as two rules. Both minutes rules
   were thresholds with no minMinutes and no `per`, so the qualifier fell
   through to the MODE and printed "Minute played (threshold)" twice against
   different numbers -- which reads as the app having a bug rather than as a
   league having two rules. Seen in the app. */
{
  const wasLeague = S.league, wasStats = S.stats;
  S.league = { config: { scoring: [
    { stat: "minutes", mode: "threshold", gte: 45, points: 1 },
    { stat: "minutes", mode: "threshold", gte: 60, points: 1 },
  ] } };
  S.stats = [row({ player_id: "px", match_label: "A vs B (2026-06-20)",
                   minutes: 76, raw: { minutes: 76 } })];
  const labels = playerBreakdown("px", "MID").map((r) => r.label);
  check("two thresholds on one stat are told apart by their thresholds",
    labels, ["Minute played (≥45)", "Minute played (≥60)"]);
  check("...and neither falls back to the word 'threshold'",
    labels.some((l) => /threshold/.test(l)), false);
  S.league = wasLeague; S.stats = wasStats;
}

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

/* The accumulation rule belongs to the COMPETITION, not to the app.
   Reported from the live app: a Premier League squad lit up SUSP on every
   player's second yellow, because FIFA's two was hardcoded. */
const _leagueWas = S.league;
check("no competition at all is a legacy World Cup league", yellowBanCount(), 2);
S.league = { competition: { sport: "football", apiLeagueId: 39, season: 2026 } };
check("the Premier League bans on five", yellowBanCount(), 5);
S.league = { competition: { sport: "football", apiLeagueId: 2, season: 2026 } };
check("UEFA club competitions ban on three", yellowBanCount(), 3);
S.league = { competition: { sport: "rugby", apiLeagueId: 1068, season: 202501 } };
check("a rugby yellow is a sin-bin, not an accumulating booking",
  yellowBanCount(), null);
S.league = { competition: { sport: "football", apiLeagueId: 999, season: 2026 } };
check("an unrecognised competition claims no rule rather than guessing one",
  yellowBanCount(), null);

// Five bookings, one per matchweek, no reds anywhere.
S.stats = [1, 2, 3, 4, 5].map((i) =>
  row({ player_id: "pl1", match_label: `A vs B${i} (2026-09-0${i})`, yellow_cards: 1 }));
S.league = { competition: { sport: "football", apiLeagueId: 39, season: 2026 } };
check("five Premier League yellows is a ban", suspendedNext("pl1"), "5 yellows");
S.stats = S.stats.slice(0, 2);
check("two Premier League yellows is NOT — this is the bug that shipped",
  suspendedNext("pl1"), null);
S.stats = S.stats.slice(0, 1);
check("nor is one", suspendedNext("pl1"), null);

/* A domestic season has no stage boundaries. The old code fell through to the
   hardcoded World Cup reset dates, which would split one season in two. */
S.stats = [
  row({ player_id: "pl2", match_label: "A vs B (2026-06-20)", yellow_cards: 1 }),
  row({ player_id: "pl2", match_label: "A vs C (2026-08-20)", yellow_cards: 1 }),
];
check("a league season is one accumulation window, not three",
  yellowWindow("2026-06-20"), yellowWindow("2026-08-20"));

/* Where there is no accumulation rule the yellow half must be silent, however
   many bookings pile up. Sin-bins are served in the match they happen in. */
S.stats = [1, 2, 3, 4, 5, 6].map((i) =>
  row({ player_id: "ru1", match_label: `A vs B${i} (2026-09-0${i})`, yellow_cards: 1 }));
S.league = { competition: { sport: "rugby", apiLeagueId: 1068, season: 202501 } };
check("six rugby yellows still suspend nobody", suspendedNext("ru1"), null);
S.league = { competition: { sport: "football", apiLeagueId: 999, season: 2026 } };
check("an unknown competition badges nobody rather than assuming FIFA's rule",
  suspendedNext("ru1"), null);

// A red is a red in any competition, including one with no yellow rule.
S.stats = [row({ player_id: "r1", match_label: "A vs B (2026-09-01)", red_cards: 1 })];
S.league = { competition: { sport: "rugby", apiLeagueId: 1068, season: 202501 } };
check("a red still suspends where yellows do not accumulate",
  suspendedNext("r1"), "red card");
S.league = _leagueWas; S.fixtures = []; S.stats = [];

/* The injury feed, told on itself. A feed keyed on ids the pool never uses
   looks exactly like a feed with nobody injured, which is how it stayed broken
   for every non-World-Cup league without anyone being able to see it. */
check("a feed that has not loaded says so",
  /not loaded/.test(injuryFeedNote(undefined, {})), true);
check("an empty feed names the reasons it could be empty",
  /no current reports/.test(injuryFeedNote({}, {})), true);
{
  const feed = { api_1: { status: "out", as_of: "2026-08-20" },
                 api_2: { status: "doubtful", as_of: "2026-08-19" } };
  const note = injuryFeedNote(feed, { api_1: { player_id: "api_1" } });
  check("a working feed counts the reports that land in this pool",
    /2 current reports, 1 in this competition's pool/.test(note), true);
  check("...and dates itself by the freshest entry", /Last built 2026-08-20/.test(note), true);
  check("a feed that matches something does not cry wolf",
    /different competition/.test(note), false);
  // The whole point: reports exist, none of them are for anybody here.
  check("a feed keyed for another competition says which failure this is",
    /different competition/.test(injuryFeedNote(feed, { mex_9: {} })), true);
}

/* The alerts panel, as a decision.

   Six answers, and each needs its own sentence: "you are not getting
   notifications" looks identical in all six and the fix is different every
   time. The one that matters most is the iPhone-in-a-tab case, where the
   honest answer is not "turn them on" -- Safari will not deliver to a tab, so
   a button there would be dead forever. */
{
  const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Safari/604.1";
  const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126.0 Mobile";
  const ready = { supported: true, configured: true, signedIn: true, ua: ANDROID };

  check("a browser with everything in place is offered the switch",
    pushState(ready).state, "off");
  check("...and once subscribed, says so",
    pushState({ ...ready, subscribed: true }).state, "on");
  check("a browser that cannot do it says so rather than offering",
    pushState({ ...ready, supported: false }).state, "unsupported");
  check("no signing key yet is the owner's problem, and says so",
    pushState({ ...ready, configured: false }).state, "unconfigured");
  check("alerts follow an account, so a signed-out device is told to sign in",
    pushState({ ...ready, signedIn: false }).state, "signed-out");
  check("a refusal cannot be re-asked, so the panel says who can undo it",
    pushState({ ...ready, permission: "denied" }).state, "blocked");
  check("...and names the place it has to be undone",
    /site settings/.test(pushState({ ...ready, permission: "denied" }).body), true);

  /* iOS FIRST, ahead of every other check. Permission cannot even be requested
     from a Safari tab, so any other message shown there would be a lie -- and
     the one that would get shown is "Turn on alerts", a button that can never
     work however many times it is tapped. */
  check("an iPhone in a tab is told to install, not to turn anything on",
    pushState({ ...ready, ua: IPHONE }).state, "needs-install");
  check("...even when the state would otherwise look ready",
    pushState({ ...ready, ua: IPHONE, subscribed: true }).state, "needs-install");
  check("...and even when it would otherwise be blocked",
    pushState({ ...ready, ua: IPHONE, permission: "denied" }).state, "needs-install");
  check("an INSTALLED iPhone behaves like anything else",
    pushState({ ...ready, ua: IPHONE, standalone: true }).state, "off");
  check("Android is never told to install — a tab can be notified there",
    pushState({ ...ready, ua: ANDROID }).state !== "needs-install", true);
  /* Every branch has to SAY something. A state that returns an empty title is
     a panel that renders a blank box, which is the one outcome worse than the
     wrong message. */
  const branches = [ready, { ...ready, supported: false },
    { ...ready, configured: false }, { ...ready, signedIn: false },
    { ...ready, permission: "denied" }, { ...ready, subscribed: true },
    { ...ready, ua: IPHONE }];
  check("every branch returns a title and a reason",
    branches.every((o) => { const r = pushState(o);
      return r && r.title.length > 0 && r.body.length > 0; }), true);
  check("...and all seven are distinct states",
    new Set(branches.map((o) => pushState(o).state)).size, 7);

  // Defaults: the ones that are about YOU are on; the one that fires whenever
  // anybody speaks is not.
  const d = defaultAlertPrefs();
  check("a new device opts in to what concerns it",
    [d.turn, d.deadline, d.waivers], [true, true, true]);
  check("...and not to every message in the league", d.chatAll, false);
  check("every kind has a default", ALERT_KINDS.every((k) => k.id in d), true);
  check("no kind is listed twice",
    new Set(ALERT_KINDS.map((k) => k.id)).size, ALERT_KINDS.length);

  /* The row the sender reads. The two keys are base64url, not base64: three
     characters of difference, and no push service says which one is wrong. */
  const bytes = (n, fill) => new Uint8Array(n).fill(fill);
  const fake = { endpoint: "https://push.example/abc",
    getKey: (n) => (n === "p256dh" ? bytes(65, 251) : bytes(16, 255)).buffer };
  const row = subscriptionRow(fake, "u-1", { turn: true }, "iPhone");
  check("the row is keyed by the browser's own address",
    row.endpoint, "https://push.example/abc");
  check("the encryption keys are base64URL, not base64",
    /[+/=]/.test(row.p256dh + row.auth_secret), false);
  check("...and are not empty", row.p256dh.length > 0 && row.auth_secret.length > 0, true);
  check("the device is labelled for a human", row.label, "iPhone");

  // The Push API refuses a string; it wants the raw bytes of the public key.
  const arr = urlBase64ToUint8Array("BJPwkz9kQXXz8P4jpbWw6UVj0giN1viJ1XJ0yr4XSb0QQMY5q5ErhQP_0hs0722GlqXt_vtrLzdCblKHPdRaGro");
  check("the signing key decodes to an uncompressed P-256 point", [arr.length, arr[0]], [65, 4]);
}

/* Nudging people to install, and only where it buys them something.

   iPhone only: on Android a notification reaches a plain browser tab, so
   asking for an install is asking a favour that gains the user nothing. On an
   iPhone, Safari will not deliver to a tab at all -- Home Screen or nothing. */
{
  const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) "
    + "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
  const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 "
    + "(KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
  const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
    + "(KHTML, like Gecko) Version/17.4 Safari/605.1.15";

  check("an iPhone in a browser tab is asked to install",
    !!installHint({ ua: IPHONE }), true);
  check("...and told how, in the words Safari uses",
    /Add to Home Screen/.test(installHint({ ua: IPHONE }).body), true);
  check("an iPhone that already installed is not asked again",
    installHint({ ua: IPHONE, standalone: true }), null);
  check("someone who said no is not asked again",
    installHint({ ua: IPHONE, dismissed: true }), null);
  check("Android gets nothing — a tab can be notified there",
    installHint({ ua: ANDROID }), null);
  check("nor does a desktop", installHint({ ua: MAC }), null);
  /* iPadOS reports itself as a Macintosh. Without the touch-point check every
     iPad in the league is told nothing at all. */
  check("an iPad is an iPhone as far as this is concerned",
    !!installHint({ ua: MAC, touchPoints: 5 }), true);
  check("...but a Mac with a drawing tablet is not",
    installHint({ ua: MAC, touchPoints: 0 }), null);
  check("no information at all asks nobody", installHint(), null);
}

/* Who in the named XI is not going to turn out. One model, because the pitch
   rings them from it and the front page counts them from it, and those two
   must never disagree about who is at risk. */
{
  const was = { league: S.league, players: S.players, byId: S.playerById,
                picks: S.picks, stats: S.stats, inj: S.injuryByPid,
                managers: S.managers, fixtures: S.fixtures };
  S.league = { competition: { sport: "football", apiLeagueId: 39, season: 2026 } };
  S.fixtures = []; S.stats = []; S.managers = [{ id: "m1", name: "Me" }];
  const pool = ["p1", "p2", "p3", "p4", "p5"].map((id) => ({ player_id: id, team: "Arsenal" }));
  S.players = pool;
  S.playerById = Object.fromEntries(pool.map((p) => [p.player_id, p]));
  S.injuryByPid = {
    p1: { status: "out", reason: "Hamstring Injury" },
    p2: { status: "doubtful", reason: "Knock" },
    p5: { status: "out", reason: "Knee Injury" },     // on the bench
  };
  check("a reported absence is a fact", riskOf("p1").level, "out");

/* Feed text arrives HTML-escaped and the app escapes again at render.
   Reported from the app: the players list printed "N. O&apos;Reilly", exactly
   like that. esc() emits &#39; and never &apos;, so the entity on screen could
   only have come from the data -- which is what pins this on ingest. */
{
  check("the reported name", decodeEntities("N. O&apos;Reilly"), "N. O'Reilly");
  check("numeric entities too", decodeEntities("O&#39;Reilly"), "O'Reilly");
  check("hex entities too", decodeEntities("O&#x27;Reilly"), "O'Reilly");
  check("an ampersand is itself", decodeEntities("Wolves &amp; Co"), "Wolves & Co");
  check("plain text is left exactly alone", decodeEntities("Kanté"), "Kanté");
  check("an unknown entity is not guessed at",
    decodeEntities("A&bogus;B"), "A&bogus;B");
  check("nothing decodes to nothing", decodeEntities(null), "");

  /* THE safety property. One pass, never a loop to a fixed point: a feed
     saying a name literally contains "&lt;script&gt;" sends "&amp;lt;script&gt;",
     and decoding twice would turn that into a live tag. */
  check("one layer only — a double-encoded tag stays inert",
    decodeEntities("&amp;lt;script&amp;gt;"), "&lt;script&gt;");
  // Each entity is decoded exactly once, independently: the doubly-encoded
  // half comes back as an entity, the singly-encoded half as its character.
  check("...one layer means one layer, per entity",
    decodeEntities("&amp;lt;script&gt;"), "&lt;script>");
  check("...and neither survives esc() as a tag",
    /<script/.test(esc(decodeEntities("&amp;lt;script&gt;"))), false);
  // The whole round trip: what the feed sent, decoded once, escaped once, is
  // what a browser will print.
  check("decode-then-escape restores the entity the page needs",
    esc(decodeEntities("N. O&apos;Reilly")), "N. O&#39;Reilly");
  check("a raw tag in a name never survives to the page",
    /<b>/.test(esc(decodeEntities("Bobby &lt;b&gt;Tables"))), false);

  // Applied to rows, so a new call site cannot quietly skip a field.
  const rows = cleanPlayerNames([
    { player_id: "a", name: "N. O&apos;Reilly", team: "Nott&apos;m Forest" },
    { player_id: "b", player_name: "D&apos;Ambrosio", team: "Inter" },
    { player_id: "c" },
  ]);
  check("names, pick-name copies and clubs all get it",
    [rows[0].name, rows[0].team, rows[1].player_name], ["N. O'Reilly", "Nott'm Forest", "D'Ambrosio"]);
  check("a row with no text is passed through untouched", rows[2].player_id, "c");
  check("already-plain data is unchanged by a second pass",
    cleanPlayerNames(rows)[0].name, "N. O'Reilly");

  /* At the boundary, so a fresh pull STORES plain text and the next league to
     load this competition never sees the entity at all. The read-side clean is
     the repair for pools already sitting in the database; this is the fix. */
  check("a squad pull decodes the name it stores",
    parseSquadPlayer({ id: 7, name: "N. O&apos;Reilly", position: "Defender" },
      "Man City", "MCI", 50).name, "N. O'Reilly");
  check("...and the club it was pulled under",
    parseApiFixture({ fixture: { id: 1, date: "2026-08-23T14:00:00+00:00", status: {} },
      teams: { home: { name: "Nott&apos;m Forest" }, away: { name: "Wolves" } },
      league: {} }).home, "Nott'm Forest");
  check("rugby names go through the same door",
    parseRugbyPlayer({ id: 3, known: "S. O&apos;Brien", positionId: 9 },
      "Munster", "MUN", 11).name, "S. O'Brien");
}

  check("...and carries the reason, lowercased for a sentence",
    riskOf("p1").why, "hamstring injury");
  check("a doubt is its own tier, not the same alarm", riskOf("p2").level, "doubt");
  check("a fit player is not a risk", riskOf("p3"), null);
  // Nobody in the pool at all -- sold abroad. Outranks any injury report,
  // because "he is not in this competition" is the more final fact.
  check("a player who has left the competition outranks a knock",
    riskOf("gone")?.why, "left the competition");

  S.picks = [
    { id: "k1", manager_id: "m1", player_id: "p1", player_name: "Alpha One",
      position: "FWD", team: "Arsenal", slot: "FWD", is_sub: false },
    { id: "k2", manager_id: "m1", player_id: "p2", player_name: "Beta Two",
      position: "MID", team: "Arsenal", slot: "MID", is_sub: false },
    { id: "k3", manager_id: "m1", player_id: "p3", player_name: "Gamma Three",
      position: "DEF", team: "Arsenal", slot: "DEF", is_sub: false },
    { id: "k5", manager_id: "m1", player_id: "p5", player_name: "Eps Five",
      position: "FWD", team: "Arsenal", slot: "SUB_FWD", is_sub: true },
    { id: "kt", manager_id: "m1", player_id: "team:Arsenal", player_name: "Arsenal",
      position: "TEAM", team: "Arsenal", slot: "TEAM", is_sub: false },
  ];
  const risks = lineupRisks("m1");
  check("the XI's absentees are counted", risks.bad.map((r) => r.name), ["Alpha One"]);
  check("...and its doubts kept apart from them",
    risks.doubt.map((r) => r.name), ["Beta Two"]);
  /* An injured player ON THE BENCH is doing exactly the job a bench is for.
     Warning about him would teach people to ignore the warning. */
  check("an injured substitute is not a problem",
    [...risks.bad, ...risks.doubt].some((r) => r.name === "Eps Five"), false);
  // A club pick is not a person and cannot be injured.
  check("the TEAM pick is not treated as a player",
    [...risks.bad, ...risks.doubt].some((r) => /Arsenal/.test(r.name)), false);

  /* Shortened the same way the pitch labels them, so the name in the warning
     is the name you then go looking for on the shirt. */
  check("names read as a sentence, matching the pitch",
    riskNames(risks.bad), "One (hamstring injury)");
  const many = [1, 2, 3, 4, 5].map((i) => ({ name: `Name ${i}`, why: "injured" }));
  check("...and are capped, because the line is 11px",
    riskNames(many).endsWith("+2 more"), true);

  // The front page says it, from the same model.
  const rows = lineupTodo(S.managers[0]);
  check("the front page warns about the absentee",
    rows.some((r) => r.level === "bad" && /1 starter won't play/.test(r.text)), true);
  check("...and about the doubt, at the lower tier",
    rows.some((r) => !r.level && /1 starter is doubtful/.test(r.text)), true);
  S.injuryByPid = {};
  check("a clean XI raises neither",
    lineupTodo(S.managers[0]).some((r) => /starter/.test(r.text)), false);

  Object.assign(S, { league: was.league, players: was.players, playerById: was.byId,
    picks: was.picks, stats: was.stats, injuryByPid: was.inj,
    managers: was.managers, fixtures: was.fixtures });
}

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

/* A round happened to the LEAGUE, not to one manager. A manager whose whole
   squad had a blank week used to get no round entry at all -- the pager never
   appeared for them and their card sat on "season to date" while everyone else
   advanced through round 1. The round must exist for them too, worth zero. */
S.managers = [{ id: "m1", name: "Koen" }, { id: "m2", name: "Ada" }];
S.picks = [...S.picks, { id: "p9", manager_id: "m2", player_id: "arg_9",
  player_name: "Bench Warmer", position: "FWD", team: "Argentina", slot: "FWD",
  is_sub: false, pick_number: 2 }];
S.playerById.arg_9 = { player_id: "arg_9", name: "Bench Warmer",
  position: "FWD", team: "Argentina" };
check("a manager whose players did not feature still has the round",
  managerHistory("m2").rounds.map((r) => r.n), [1]);
check("...worth zero, rather than missing",
  managerHistory("m2").rounds[0].subtotal, 0);
check("...and it carries the league's matchdays, not that manager's",
  managerHistory("m2").rounds[0].dates, ["2026-06-12", "2026-06-16"]);
check("the scoring manager is unaffected",
  managerHistory("m1").rounds[0].subtotal, 10);
S.managers = [{ id: "m1", name: "Koen" }];
S.picks = S.picks.filter((p) => p.manager_id === "m1");
delete S.playerById.arg_9;

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

  /* A draft OPENING, which is where this is actually watched from. The marker
     has to be seeded on this render, with no picks on the board yet — seeding
     it on the first render that HAS a pick instead means that pick is taken for
     the backlog, and the draft's opening pick is the one pick that never
     announces. */
  S.picks = [];
  announceNewPicks();
  check("flash: nothing to announce before the draft starts", appended.length, 0);

  S.picks = [pick(1, "mA")];
  announceNewPicks();
  check("flash: the draft's opening pick announces", appended.length, 1);

  S.picks = [pick(1, "mA"), pick(2, "mB")];
  announceNewPicks();
  check("flash: fires for a new pick", appended.length, 2);
  check("flash: names the drafter and the player",
    /Bo picked/.test(appended[1].innerHTML) && /New Guy/.test(appended[1].innerHTML), true);

  announceNewPicks();                       // same picks again — e.g. a re-render
  check("flash: does not repeat on a re-render", appended.length, 2);

  S.picks = [pick(1, "mA"), pick(2, "mB"), pick(3, "mA")];
  announceNewPicks();
  check("flash: fires again for the next pick", appended.length, 3);

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
  // Phase 3: the fixture id survives the parse, so a stat row's fixture_id has
  // something on the fixture side to join to.
  check("parseApiFixture keeps the API's fixture id", fx.fixture_id, 9);

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
  /* `upcoming` rolls forward as soon as the current week's first game starts.
     That is right for "which round is next" and WRONG as a lock: this test
     used to be called "lineup reopens for MW3 once MW2 has kicked off" and
     asserted only the round name, which is how the reopening went unnoticed.
     The round name is still correct; what it must not do any more is unlock. */
  check("the next round is named as soon as this one kicks off",
    fixtureWindows(awFx, mw2a + awH).upcoming.round, "Regular Season - 3");
  check("...but naming it does not reopen the line-up",
    fixtureWindows(awFx, mw2a + awH).lineupOpen, false);

  /* Reported from the app: matchweek 1 live on screen, the card offering
     "Last chance to set your team, Matchweek 2", and an editable XI. MW1 here
     is a double-game week, so it also covers the gap BETWEEN two games of the
     same round -- the case where nothing is on but the round is not over. */
  check("line-ups stay locked once the round has kicked off",
    fixtureWindows(awFx, mw1a + awH).lineupOpen, false);
  check("...and while its last game is still being played",
    fixtureWindows(awFx, mw1b + 30 * 60e3).lineupOpen, false);
  check("...reopening only once the round is actually over",
    fixtureWindows(awFx, mw1b + 4 * awH).lineupOpen, true);
  check("the round in play is reported, so the card can say so",
    fixtureWindows(awFx, mw1a + awH).inPlay.round, "Regular Season - 1");
  check("...and is null between rounds", fixtureWindows(awFx, awMidGap).inPlay, null);

  /* A real Premier League round runs Friday night to Monday night, so most of
     it is quiet hours with no game on at all. Those hours are the ones that
     matter: nothing is live, the round is half-played, and this is exactly
     when a manager would otherwise be able to rewrite their XI having already
     seen Saturday's results. */
  const friNight = Date.UTC(2026, 7, 14, 19, 0);
  const satAfter = Date.UTC(2026, 7, 15, 14, 0);
  const monNight = Date.UTC(2026, 7, 17, 19, 0);
  const spread = [
    { round: "Regular Season - 1", kickoff_utc: friNight },
    { round: "Regular Season - 1", kickoff_utc: satAfter },
    { round: "Regular Season - 1", kickoff_utc: monNight },
    { round: "Regular Season - 2", kickoff_utc: Date.UTC(2026, 7, 22, 12, 0) },
  ];
  check("locked on the Sunday, with no game on and the round unfinished",
    fixtureWindows(spread, Date.UTC(2026, 7, 16, 10, 0)).lineupOpen, false);
  check("...still locked an hour after the Monday game kicks off",
    fixtureWindows(spread, monNight + awH).lineupOpen, false);
  check("...open once the Monday game has finished",
    fixtureWindows(spread, monNight + 3 * awH).lineupOpen, true);

  /* Whether a match is on RIGHT NOW, which is a different question from
     whether the round is in play. Two sources because neither is right alone:
     the pull runs on a schedule, so a fixture can still read "NS" an hour
     after kick-off -- which is how the matchday card said "Last chance to set
     your team" while the banner directly above it said LIVE. */
  const liveKo = Date.UTC(2026, 7, 15, 12, 0);
  const ns = [{ round: "R1", kickoff_utc: liveKo, status: "NS" }];
  check("the clock alone knows a game has started before the feed does",
    anyMatchLive(ns, liveKo + awH), true);
  check("...and that it is over, once enough time has passed",
    anyMatchLive(ns, liveKo + 4 * awH), false);
  check("a feed that has caught up is believed",
    anyMatchLive([{ kickoff_utc: liveKo, status: "1H" }], liveKo + awH), true);
  check("a finished game is not live however the clock reads it",
    anyMatchLive([{ kickoff_utc: liveKo, status: "FT" }], liveKo + awH), false);
  // Extra time runs past the clock's allowance; the status is what knows.
  check("extra time is live even past the allowance",
    anyMatchLive([{ kickoff_utc: liveKo, status: "ET" }], liveKo + 3 * awH), true);
  check("nothing scheduled is nothing live", anyMatchLive([], liveKo), false);

  /* Which rounds a recap may offer. A round enters a manager's history as soon
     as ANY match in it has been scored, which is not the same as the round
     being over -- and the recap took the newest one and announced it complete.
     Reported from the app: "Round 1 complete" on a Friday night with the
     round's own opening game still playing behind the sheet. */
  const rWeeks = [
    { round: "Regular Season - 1", first: Date.UTC(2026, 7, 14, 19, 0),
      last: Date.UTC(2026, 7, 17, 19, 0) },
    { round: "Regular Season - 2", first: Date.UTC(2026, 7, 21, 19, 0),
      last: Date.UTC(2026, 7, 24, 19, 0) },
  ];
  const rRounds = [{ n: 1, subtotal: 10 }, { n: 2, subtotal: 6 }];
  const midR2 = Date.UTC(2026, 7, 21, 20, 30);           // R2's first game is on
  check("a round that is still being played is not 'complete'",
    [...roundsEndedBy(rWeeks, midR2)], [1]);
  check("...so the recap offers the last FINISHED round, not the newest one",
    recappableRounds(rRounds, rWeeks, midR2).map((r) => r.n), [1]);
  check("...and once it ends, it is offered",
    recappableRounds(rRounds, rWeeks, Date.UTC(2026, 7, 24, 23, 0)).map((r) => r.n),
    [1, 2]);
  // A round's last game still being played is not the round being over.
  check("the last game of the round still counts as the round",
    [...roundsEndedBy(rWeeks, Date.UTC(2026, 7, 24, 20, 0))], [1]);
  // Nothing to compare against: keep the old behaviour rather than never
  // recapping at all.
  check("a round the calendar cannot place is still offered",
    recappableRounds([{ n: 9 }], rWeeks, midR2).map((r) => r.n), [9]);
  check("no fixtures at all changes nothing",
    recappableRounds(rRounds, [], midR2).map((r) => r.n), [1, 2]);
  check("nothing finished yet offers nothing",
    recappableRounds(rRounds, rWeeks, Date.UTC(2026, 7, 14, 20, 0)).map((r) => r.n), []);

  /* Whether the league table is still moving. A table built on a round being
     played reads exactly like a final one, which is how somebody tells their
     group chat they have won on a Saturday night. */
  check("a round in progress makes the standings provisional",
    roundStillPlaying(2, rWeeks, midR2), true);
  check("...including the quiet hours inside it",
    roundStillPlaying(2, rWeeks, Date.UTC(2026, 7, 23, 9, 0)), true);
  check("...and while its last game is on",
    roundStillPlaying(2, rWeeks, Date.UTC(2026, 7, 24, 20, 0)), true);
  check("a finished round is final", roundStillPlaying(1, rWeeks, midR2), false);
  check("...and so is the newest one once it ends",
    roundStillPlaying(2, rWeeks, Date.UTC(2026, 7, 24, 23, 0)), false);
  // Nothing to place it against: say nothing rather than guess.
  check("a round the calendar cannot place claims nothing",
    roundStillPlaying(9, rWeeks, midR2), false);
  check("no fixtures at all claims nothing", roundStillPlaying(2, [], midR2), false);
  check("before any round has been played there is nothing to qualify",
    roundStillPlaying(0, rWeeks, midR2), false);
  check("a game not yet kicked off is not live", anyMatchLive(ns, liveKo - awH), false);

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

  /* ---- who fires the auto-pick, and when ----
     Three tiers, because two left a hole exactly one manager wide: when the
     admin IS the manager on the clock both tiers are the same person, so an
     admin who stepped away froze the room while every other manager's turn
     auto-picked normally. The third tier is any watching client. */
  check("clock still running → nobody picks (manager)",
    autoPickTurn(3, { mine: true, admin: false }), false);
  check("clock still running → nobody picks (admin)",
    autoPickTurn(3, { mine: false, admin: true }), false);
  check("clock still running → nobody picks (bystander)",
    autoPickTurn(3, { mine: false, admin: false }), false);

  check("the manager on the clock fires the moment it expires",
    autoPickTurn(0, { mine: true, admin: false }), true);
  check("an absent manager's own client cannot fire, so the admin waits 4s",
    autoPickTurn(-1, { mine: false, admin: true }), false);
  check("the admin covers a manager who is gone, from 4s",
    autoPickTurn(-4, { mine: false, admin: true }), true);

  // The hole: admin on the clock. Their own phone is the one that is gone, so
  // both of the old tiers were dead and the draft simply stopped.
  check("an absent admin on their own clock leaves nobody at 4s",
    autoPickTurn(-4, { mine: false, admin: false }), false);
  check("any watching client covers everyone from 8s",
    autoPickTurn(-8, { mine: false, admin: false }), true);
  check("a bystander does not jump the admin's turn at 7s",
    autoPickTurn(-7, { mine: false, admin: false }), false);

  // 8s is inside the 10s retry window, so the third tier gets its shot before
  // autoPickStale clears the guard and the cycle restarts.
  check("the last tier fires before the guard goes stale",
    autoPickStale(23, 23, -8), false);
  check("missing flags default to a bystander",
    autoPickTurn(-8), true);

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

  /* restampPlan()'s tests lived here. It kept a future snapshot pointing at
     whatever the current lock was, so a postponed matchweek dragged its
     line-up along; the round was never recorded, so it had to be re-derived
     and re-derived. What it was buying is now a property of the data, and
     these are the assertions for the property rather than for the machinery.

     backfillSnapshotRounds() stamps the round; roundKeyLockedAt() decides
     which one (tested with the other pure round helpers below). */
  const moved = [...wkFx("Regular Season - 1", 0), ...wkFx("Regular Season - 2", 9 * DAY)];
  check("a stamped snapshot names its round, postponement or not",
    roundKeyLockedAt(moved, LK(9 * DAY)), "Regular Season - 2");
  check("...and the SAME snapshot names the same round on the original calendar",
    roundKeyLockedAt(sea, LK(7 * DAY)), "Regular Season - 2");
  check("a lock the calendar cannot place keeps a null key, and the timestamp path",
    roundKeyLockedAt([], LK(7 * DAY)), null);

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
  check("...it just has no round NUMBER",
    closedWindowRound(koSeason, 30 * CAPD, {}).roundNo, null);
  /* Phase 1.5: ...which is why the number was the wrong key. The label is
     always there, so a knockout round is as recordable as any other and
     settles through the ritual rather than the fallback. */
  check("...but it has a round KEY, so it is recordable after all",
    closedWindowRound(koSeason, 30 * CAPD, {}).roundKey, "Round of 16");
  check("a numbered round reports both",
    closedWindowRound(rsSeason, rsClose + CAPH, {}).roundNo, 4);
  check("...its key being the label, not the number",
    closedWindowRound(rsSeason, rsClose + CAPH, {}).roundKey, "Regular Season - 4");
  check("no fixtures, nothing owed", closedWindowRound([], 99 * CAPD, {}), null);

  /* A backlog. lastClosedTradeWindow names only the NEWEST closed window, so a
     league nobody opened for a fortnight settled one round and skipped the
     rest for good -- today that loses their waivers, and once Phase 2 scores
     from recorded rounds it would lose their points. */
  const bl = [...rsWk(1, 0), ...rsWk(2, 7 * CAPD), ...rsWk(3, 14 * CAPD),
              ...rsWk(4, 21 * CAPD)];
  const late = 21 * CAPD;          // stood at week 4's kickoff: three windows shut
  check("every closed window is enumerated, oldest first",
    closedTradeWindows(bl, late, {}).map((w) => w.to),
    ["Regular Season - 2", "Regular Season - 3", "Regular Season - 4"]);
  check("...and the newest is still what the display asks for",
    closedWindowRound(bl, late, {}).roundKey, "Regular Season - 4");

  /* Bounded on purpose: with nothing recorded, only the newest is owed. Phase 1
     chose not to backfill old seasons, and a first run against a season already
     under way must not settle a dozen historical rounds. */
  S.rounds = [];
  check("nothing recorded → only the newest settles, no backfill",
    roundsOwedSettlement(bl, late, {}).map((r) => r.roundKey),
    ["Regular Season - 4"]);

  // ...but once a round HAS been recorded, everything after it is owed.
  S.rounds = [{ round_key: "Regular Season - 2", round_no: 2, status: "settled" }];
  check("after a recorded round, the ones behind it are caught up",
    roundsOwedSettlement(bl, late, {}).map((r) => r.roundKey),
    ["Regular Season - 3", "Regular Season - 4"]);

  S.rounds = [{ round_key: "Regular Season - 4", round_no: 4, status: "settled" }];
  check("the newest already settled → nothing owed",
    roundsOwedSettlement(bl, late, {}).map((r) => r.roundKey), []);

  // A pre-1.5 row carries no key, so it has to match on the number instead.
  S.rounds = [{ round_key: null, round_no: 3, status: "settled" }];
  check("a keyless legacy row still counts as recorded",
    roundsOwedSettlement(bl, late, {}).map((r) => r.roundKey), ["Regular Season - 4"]);

  // A fresh claim by another client is not owed; a stale one is retaken.
  S.rounds = [{ round_key: "Regular Season - 3", round_no: 3, status: "settled" },
              { round_key: "Regular Season - 4", round_no: 4, status: "settling",
                claimed_at: new Date(Date.now() - 60e3).toISOString() }];
  check("a live claim by someone else is left alone",
    roundsOwedSettlement(bl, late, {}).map((r) => r.roundKey), []);
  S.rounds = [{ round_key: "Regular Season - 3", round_no: 3, status: "settled" },
              { round_key: "Regular Season - 4", round_no: 4, status: "settling",
                claimed_at: new Date(Date.now() - 40 * 60e3).toISOString() }];
  check("a claim whose client died is retaken",
    roundsOwedSettlement(bl, late, {}).map((r) => r.roundKey), ["Regular Season - 4"]);
  S.rounds = [];

  /* Phase 1.5: the round a lock is FOR, stamped by the writer that knows it
     rather than recovered later by matching timestamps to the nearest lock. */
  const lkFx = [
    { round: "Group Stage - 1", kickoff_utc: new Date(0).toISOString() },
    { round: "Round of 16", kickoff_utc: new Date(7 * CAPD).toISOString() },
    { round: "Final", kickoff_utc: new Date(14 * CAPD).toISOString() },
  ];
  check("a lock an hour before kickoff names the round it locks",
    roundKeyLockedAt(lkFx, 7 * CAPD - CAPH), "Round of 16");
  check("...knockout labels included — that is the point",
    roundKeyLockedAt(lkFx, 14 * CAPD - CAPH), "Final");
  check("a zero-hour lock names its own round, not the next",
    roundKeyLockedAt(lkFx, 7 * CAPD), "Round of 16");
  check("a lock just after a kickoff belongs to the round ahead",
    roundKeyLockedAt(lkFx, 7 * CAPD + CAPH), "Final");
  check("past the last fixture, the last round is the answer",
    roundKeyLockedAt(lkFx, 99 * CAPD), "Final");
  check("no fixtures → no stamp, and the timestamp path takes over",
    roundKeyLockedAt([], 5 * CAPD), null);

  /* The keyed roster read. A snapshot that says which round it was for is
     immune to the fixture list moving underneath it -- which is the whole
     reason restampSnapshots() exists, and why Phase 2 can delete it. */
  const kSnaps = [
    { effective_from: new Date(6 * CAPD).toISOString(), round_key: "Round of 16",
      roster: [{ player_id: "keyed" }] },
    { effective_from: new Date(13 * CAPD).toISOString(), round_key: "Final",
      roster: [{ player_id: "final" }] },
  ];
  check("the round-keyed snapshot answers directly",
    rosterAtFor("m1", 7 * CAPD, "", kSnaps, "Round of 16")[0].player_id, "keyed");
  check("...and a reschedule moving the match cannot change that",
    rosterAtFor("m1", 99 * CAPD, "", kSnaps, "Round of 16")[0].player_id, "keyed");
  check("...while the timestamp path alone would have drifted to the later one",
    rosterAtFor("m1", 99 * CAPD, "", kSnaps)[0].player_id, "final");
  check("a round with no snapshot of its own falls back to the timestamps",
    rosterAtFor("m1", 13 * CAPD, "", kSnaps, "Quarter-finals")[0].player_id, "final");
  const unstamped = [{ effective_from: new Date(6 * CAPD).toISOString(),
    roster: [{ player_id: "old" }] }];
  check("an unstamped snapshot degrades to exactly the pre-1.5 behaviour",
    rosterAtFor("m1", 7 * CAPD, "", unstamped, "Round of 16")[0].player_id, "old");

  /* The label→key map has to cover cups, or knockout rounds stay invisible.
     roundIndex's numeric maps deliberately do not, so this is its own check. */
  S.fixtures = [
    { home: "Brazil", away: "France", kickoff_utc: "2026-07-05T14:00:00Z",
      date: "2026-07-05", round: "Round of 16", status: "FT" },
    { home: "Spain", away: "Italy", kickoff_utc: "2026-06-15T14:00:00Z",
      date: "2026-06-15", round: "Group Stage - 2", status: "FT" },
  ];
  check("a knockout match resolves to its round key",
    roundKeyOfLabel("Brazil vs France (2026-07-05)"), "Round of 16");
  check("a numbered match resolves to its label, not its number",
    roundKeyOfLabel("Spain vs Italy (2026-06-15)"), "Group Stage - 2");
  check("the numeric index still skips cup rounds, as it always did",
    roundIndex().byLabel["Brazil vs France (2026-07-05)"], undefined);
  check("a match with no fixture row has no key, and keeps the timestamp path",
    roundKeyOfLabel("Nobody vs Nobody (2026-01-01)"), null);
  S.fixtures = [];

  /* The short form shown on a player's match log. A knockout tie must survive
     intact: "Round of 16" abbreviated to its digits is the exact mistake
     mwNo() exists to refuse, and it would read as matchweek 16 here too. */
  check("a league round drops the prefix that says nothing",
    roundLabelShort("Regular Season - 4"), "MW 4");
  check("a named group round keeps its name",
    roundLabelShort("Group Stage - 1"), "Group Stage 1");
  check("a knockout tie is shown verbatim, never reduced to a number",
    roundLabelShort("Round of 16"), "Round of 16");
  check("...including the ones with no digits at all",
    roundLabelShort("Quarter-finals"), "Quarter-finals");
  check("no round key means no label, not a guess",
    roundLabelShort(null), "");

  /* ---- Phase 2: the settled/live split ----
     The whole value of this is that it moves NO number. settled + live must be
     the player score exactly, whatever the settlement state, or the split is
     not a split -- it is a second, disagreeing scoring engine. */
  const p2fx = (home, away, date, mw) => ({
    home, away, kickoff_utc: date + "T14:00:00Z", date,
    round: "Regular Season - " + mw, status: "FT" });
  S.league = { id: "L1", competition: { apiLeagueId: 39, season: 2026, name: "PL" } };
  S.managers = [{ id: "m1", name: "M1", draft_position: 1 }];
  S.snapshots = []; S.config = null; S.stages = []; S.transactions = [];
  S.playerById = { liv_1: { player_id: "liv_1", name: "Fwd", position: "FWD", team: "Liverpool" } };
  S.picks = [{ id: "pk1", manager_id: "m1", player_id: "liv_1", player_name: "Fwd",
    position: "FWD", team: "Liverpool", slot: "FWD", is_sub: false, pick_number: 1 }];
  S.fixtures = [p2fx("Liverpool", "Everton", "2026-08-01", 1),
                p2fx("Liverpool", "Wolves", "2026-08-08", 2)];
  S.stats = [
    row({ player_id: "liv_1", match_label: "Liverpool vs Everton (2026-08-01)",
          appeared: true, goals: 1, team: "Liverpool", round: 1 }),
    row({ player_id: "liv_1", match_label: "Liverpool vs Wolves (2026-08-08)",
          appeared: true, goals: 1, team: "Liverpool", round: 2 }),
  ];

  S.rounds = [];
  const none = computeScores()[0];
  check("nothing recorded → every point is live",
    [none.settledTotal, none.liveTotal === none.total], [0, true]);

  S.rounds = [{ round_key: "Regular Season - 1", round_no: 1, status: "settled" }];
  const one = computeScores()[0];
  check("the split is exhaustive", one.settledTotal + one.liveTotal, one.total);
  check("...and the total did not move", one.total, none.total);
  check("the settled round carries its own points, not zero and not everything",
    one.settledTotal > 0 && one.settledTotal < one.total, true);

  S.rounds = [{ round_key: "Regular Season - 1", round_no: 1, status: "settled" },
              { round_key: "Regular Season - 2", round_no: 2, status: "settled" }];
  const both = computeScores()[0];
  check("both rounds settled → nothing left live", both.liveTotal, 0);
  check("...still the same total", both.total, none.total);

  /* A round claimed but not finished is NOT settled. Live is the safe
     direction: a live round is recomputed, a frozen one never moves again. */
  S.rounds = [{ round_key: "Regular Season - 1", round_no: 1, status: "settling",
                claimed_at: new Date().toISOString() }];
  check("a claim still in flight does not count as settled",
    computeScores()[0].settledTotal, 0);
  S.rounds = [{ round_key: null, round_no: 1, status: "settled" }];
  check("a pre-1.5 row with no key still settles its round by number",
    computeScores()[0].settledTotal, one.settledTotal);
  check("isRoundSettled ignores a round nobody recorded",
    isRoundSettled("Regular Season - 9", 9), false);

  /* The key recorded on the stat ROW beats the fixture list, so a settled
     round stays settled through a reschedule -- and a knockout round, whose
     `round` int is null, can be settled at all. Both are the point of
     stamping round_key on stats rather than only the number. */
  S.stats = [
    row({ player_id: "liv_1", match_label: "Liverpool vs Everton (2026-08-01)",
          appeared: true, goals: 1, team: "Liverpool", round: null,
          round_key: "Round of 16" }),
    row({ player_id: "liv_1", match_label: "Liverpool vs Wolves (2026-08-08)",
          appeared: true, goals: 1, team: "Liverpool", round: null,
          round_key: "Quarter-finals" }),
  ];
  S.fixtures = [];                       // no fixture list at all
  S.rounds = [{ round_key: "Round of 16", round_no: null, status: "settled" }];
  const ko = computeScores()[0];
  check("a knockout round settles off the row's own key",
    ko.settledTotal > 0 && ko.settledTotal < ko.total, true);
  check("...and the split still adds up with no fixtures in sight",
    ko.settledTotal + ko.liveTotal, ko.total);
  S.rounds = []; S.stats = []; S.fixtures = []; S.picks = [];

  /* ---- Phase 2c: the settled side is PURE ----
     The doc claims settled scoring uses no `Date.now()` and no fixture list.
     That was a claim about how the code reads; these make it a property, and
     they are what breaks first if a later change reintroduces a derivation. */
  S.league = { id: "L1", competition: { apiLeagueId: 39, season: 2026, name: "PL" } };
  S.managers = [{ id: "m1", name: "M1", draft_position: 1 }];
  S.snapshots = []; S.config = null; S.stages = []; S.transactions = [];
  S.playerById = { liv_1: { player_id: "liv_1", name: "Fwd", position: "FWD", team: "Liverpool" } };
  S.picks = [{ id: "pk1", manager_id: "m1", player_id: "liv_1", player_name: "Fwd",
    position: "FWD", team: "Liverpool", slot: "FWD", is_sub: false, pick_number: 1 }];
  S.stats = [
    row({ player_id: "liv_1", match_label: "Liverpool vs Everton (2026-08-01)",
          appeared: true, goals: 1, team: "Liverpool", round: 1, round_key: "Regular Season - 1" }),
    row({ player_id: "liv_1", match_label: "Liverpool vs Wolves (2026-08-08)",
          appeared: true, goals: 2, team: "Liverpool", round: 2, round_key: "Regular Season - 2" }),
  ];
  S.rounds = [{ round_key: "Regular Season - 1", round_no: 1, status: "settled" }];

  S.fixtures = [
    { home: "Liverpool", away: "Everton", kickoff_utc: "2026-08-01T14:00:00Z",
      date: "2026-08-01", round: "Regular Season - 1", status: "FT" },
    { home: "Liverpool", away: "Wolves", kickoff_utc: "2026-08-08T14:00:00Z",
      date: "2026-08-08", round: "Regular Season - 2", status: "FT" },
  ];
  const withFx = computeScores()[0].settledTotal;
  S.fixtures = [];
  check("settled points do not need the fixture list",
    computeScores()[0].settledTotal, withFx);
  check("...and are non-zero, so that is not a vacuous pass", withFx > 0, true);

  /* Rescheduling every game -- the failure this whole design exists to stop --
     must not move a settled round by a point. */
  S.fixtures = [
    { home: "Liverpool", away: "Everton", kickoff_utc: "2027-01-01T14:00:00Z",
      date: "2027-01-01", round: "Regular Season - 2", status: "FT" },
    { home: "Liverpool", away: "Wolves", kickoff_utc: "2026-05-01T14:00:00Z",
      date: "2026-05-01", round: "Regular Season - 1", status: "FT" },
  ];
  check("a reschedule that swaps the rounds around cannot move settled points",
    computeScores()[0].settledTotal, withFx);

  // ...and neither can the clock.
  S.fixtures = [];
  const realNow = Date.now;
  Date.now = () => realNow() + 365 * CAPD;
  const shifted = computeScores()[0].settledTotal;
  Date.now = realNow;
  check("settled points do not move when the clock does", shifted, withFx);
  S.rounds = []; S.fixtures = []; S.stats = []; S.picks = [];

  /* ---- Phase 2.5: round ORDER comes from the competition, not the clock ----
     Sorting rounds by earliest kickoff means a rescheduled tie can reorder the
     season -- and the trade window between two rounds is arithmetic on
     CONSECUTIVE ones, so a flipped pair silently moves a deadline. */
  const koFx = [
    { home: "A", away: "B", kickoff_utc: "2026-07-10T14:00:00Z", date: "2026-07-10",
      round: "Round of 16" },
    { home: "C", away: "D", kickoff_utc: "2026-07-20T14:00:00Z", date: "2026-07-20",
      round: "Quarter-finals" },
    // Postponed group game, replayed AFTER the Round of 16 has been played.
    { home: "E", away: "F", kickoff_utc: "2026-07-15T14:00:00Z", date: "2026-07-15",
      round: "Group Stage - 3" },
  ];
  S.roundOrder = [];
  check("without a recorded order, kickoff dates decide — and get it wrong",
    matchweeksOf(koFx).map((w) => w.round),
    ["Round of 16", "Group Stage - 3", "Quarter-finals"]);

  S.roundOrder = ["Group Stage - 3", "Round of 16", "Quarter-finals", "Final"];
  check("the competition's own order wins over the dates",
    matchweeksOf(koFx).map((w) => w.round),
    ["Group Stage - 3", "Round of 16", "Quarter-finals"]);
  check("...and the kickoff bounds each round still carries are untouched",
    matchweeksOf(koFx)[0].first, Date.parse("2026-07-15T14:00:00Z"));

  // A round the recorded order never heard of (hand-added in the bench) sorts
  // after the ones it knows, by kickoff, rather than vanishing or leading.
  S.roundOrder = ["Group Stage - 3", "Round of 16"];
  check("an unknown round sorts last rather than jumping the queue",
    matchweeksOf(koFx).map((w) => w.round),
    ["Group Stage - 3", "Round of 16", "Quarter-finals"]);
  S.roundOrder = [];

  /* ---- Phase 3b: a match is resolved by its id, not by its description ----
     match_label describes a match; fixture_id names it. The label breaks on a
     club rename or a corrected date, neither of which changes the match. */
  S.fixtures = [
    { fixture_id: 501, home: "Wolverhampton", away: "Brighton",
      kickoff_utc: "2026-09-05T14:00:00Z", date: "2026-09-05", round: "Regular Season - 4" },
    { fixture_id: 502, home: "Arsenal", away: "Chelsea",
      kickoff_utc: "2026-09-06T16:30:00Z", date: "2026-09-06", round: "Regular Season - 4" },
  ];
  // The row was written when the club was still called "Wolves", so its label
  // no longer matches any fixture -- but it carries the id.
  S.stats = [row({ player_id: "p1", fixture_id: 501,
                   match_label: "Wolves vs Brighton (2026-09-05)", appeared: true })];
  check("a renamed club breaks the label but not the identity",
    matchFixture("Wolves vs Brighton (2026-09-05)")?.fixture_id, 501);
  check("...so the kickoff time still resolves, rather than falling to end-of-day",
    matchTimeFor("Wolves vs Brighton (2026-09-05)"),
    Date.parse("2026-09-05T14:00:00Z"));

  // A row with no id at all still resolves the old way.
  S.stats = [row({ player_id: "p1", match_label: "Arsenal vs Chelsea (2026-09-06)",
                   appeared: true })];
  check("a row with no recorded id falls back to the label",
    matchFixture("Arsenal vs Chelsea (2026-09-06)")?.fixture_id, 502);
  check("...and a label matching nothing at all resolves to null",
    matchFixture("Nobody vs Nobody (2026-01-01)"), null);
  check("...whose kickoff falls back to end of day, exactly as before",
    matchTimeFor("Nobody vs Nobody (2026-01-01)"),
    Date.parse("2026-01-01T23:59:59Z"));
  S.fixtures = []; S.stats = [];

  /* ---- A transfer must not haunt the rounds that came after it ----
     Reported from the bench: two players transferred after round 3 still
     appeared in the round 4 and round 5 line-ups, while the current line-up
     was right. Two causes, both here.

     The line-up saved at the transfer is stamped for the round it takes
     effect in (4). Round 5 has no snapshot of its own, and matching only on
     the round's own key sent it back to the timestamp path -- where a stamp
     for a lock still in the future is ignored and the PRE-transfer snapshot
     wins. A line-up persists until it is changed, so round 5 must inherit
     round 4's. */
  S.roundOrder = ["Regular Season - 3", "Regular Season - 4", "Regular Season - 5"];
  S.fixtures = [
    { home: "A", away: "B", kickoff_utc: "2026-08-01T14:00:00Z", date: "2026-08-01",
      round: "Regular Season - 3" },
    { home: "A", away: "C", kickoff_utc: "2026-08-08T14:00:00Z", date: "2026-08-08",
      round: "Regular Season - 4" },
    { home: "A", away: "D", kickoff_utc: "2026-08-15T14:00:00Z", date: "2026-08-15",
      round: "Regular Season - 5" },
  ];
  const before = [{ player_id: "sold", player_name: "Sold", position: "MID",
    team: "A", is_sub: false, slot: "MID" }];
  const after = [{ player_id: "bought", player_name: "Bought", position: "MID",
    team: "A", is_sub: false, slot: "MID" }];
  const tSnaps = [
    { id: "s3", effective_from: "2026-07-31T13:00:00Z", created_at: "2026-07-31T13:00:00Z",
      round_key: "Regular Season - 3", roster: before },
    // Saved at the transfer, stamped for the round it takes effect in. Its
    // effective_from is a lock that, on the calendar as it stands, has not
    // arrived -- which is exactly what hid it from the timestamp path.
    { id: "s4", effective_from: "2026-08-20T13:00:00Z", created_at: "2026-08-04T09:00:00Z",
      round_key: "Regular Season - 4", roster: after },
  ];
  const who = (rk) => rosterAtFor("m9", Date.parse("2026-08-15T14:00:00Z"), "2026-08-15",
    tSnaps, rk)[0].player_id;
  check("round 3 keeps the player who was actually there",
    who("Regular Season - 3"), "sold");
  check("round 4 has the transfer, from its own snapshot",
    who("Regular Season - 4"), "bought");
  check("round 5 inherits round 4's line-up rather than reverting",
    who("Regular Season - 5"), "bought");
  // A snapshot for a LATER round is a plan, not a record of an earlier one.
  check("a line-up saved for round 5 does not leak back into round 3",
    rosterAtFor("m9", 0, "2026-08-01", [...tSnaps,
      { id: "s5", effective_from: "2026-08-25T13:00:00Z", created_at: "2026-08-14T13:00:00Z",
        round_key: "Regular Season - 5", roster: after }],
      "Regular Season - 3")[0].player_id, "sold");
  S.roundOrder = []; S.fixtures = []; S.stats = [];

  /* ---- The scores memo must never disagree with the real thing ----
     computeScores() is memoised because a full season measured 75ms a call
     and almost all of it recomputes rounds that are settled and frozen. A
     scoring cache that goes stale is the worst bug this app can have, so the
     assertion is not "the cache is fast" but "the cache cannot lie". */
  const totals = (rows) => rows.map((r) => [r.manager.id, r.total, r.settledTotal, r.liveTotal]);
  S.league = { id: "L1", competition: { apiLeagueId: 39, season: 2026, name: "PL" } };
  S.managers = [{ id: "m1", name: "M1", draft_position: 1 },
                { id: "m2", name: "M2", draft_position: 2 }];
  S.snapshots = []; S.config = null; S.stages = []; S.transactions = []; S.roundOrder = [];
  S.playerById = { a1: { player_id: "a1", name: "A", position: "FWD", team: "A" } };
  S.picks = [{ id: "p1", manager_id: "m1", player_id: "a1", player_name: "A",
    position: "FWD", team: "A", slot: "FWD", is_sub: false, pick_number: 1 }];
  S.fixtures = [
    { home: "A", away: "B", kickoff_utc: "2026-08-01T14:00:00Z", date: "2026-08-01",
      round: "Regular Season - 1", status: "FT" },
    { home: "A", away: "C", kickoff_utc: "2026-08-08T14:00:00Z", date: "2026-08-08",
      round: "Regular Season - 2", status: "FT" },
  ];
  S.stats = [
    row({ player_id: "a1", match_label: "A vs B (2026-08-01)", appeared: true,
          goals: 1, team: "A", round: 1, round_key: "Regular Season - 1" }),
    row({ player_id: "a1", match_label: "A vs C (2026-08-08)", appeared: true,
          goals: 2, team: "A", round: 2, round_key: "Regular Season - 2" }),
  ];

  S.rounds = [];
  bustScores();
  check("memo agrees with the real thing, nothing settled",
    totals(computeScores()), totals(computeScoresUncached()));

  // Same arrays, second call: this is the one that comes from the cache.
  check("...and a repeat call gives the same answer, not a stale one",
    totals(computeScores()), totals(computeScoresUncached()));

  /* The dangerous case. S.rounds is REPLACED, so the key changes and the memo
     must miss. If it ever hits here, settling a round would stop moving the
     numbers -- silently, and only on the second render. */
  S.rounds = [{ round_key: "Regular Season - 1", round_no: 1, status: "settled" }];
  check("settling a round is seen immediately, not after the next refetch",
    totals(computeScores()), totals(computeScoresUncached()));
  check("...and settled is now non-zero, so that compared something real",
    computeScores()[0].settledTotal > 0, true);

  // A roster change replaces S.picks; same requirement.
  S.picks = [...S.picks, { id: "p2", manager_id: "m2", player_id: "a1",
    player_name: "A", position: "FWD", team: "A", slot: "FWD", is_sub: false, pick_number: 2 }];
  check("a roster change is seen immediately",
    totals(computeScores()), totals(computeScoresUncached()));

  // ...and a row mutated IN PLACE, where identity cannot help and only an
  // explicit bust can. This is what the backfills do.
  S.rounds[0].status = "settling";
  bustScores();
  check("an in-place change is seen once the cache is cleared",
    totals(computeScores()), totals(computeScoresUncached()));
  S.rounds = []; S.fixtures = []; S.stats = []; S.picks = []; bustScores();

  /* The memo's real hazard: a row mutated IN PLACE. S.picks is then the same
     array it was, so the key is unchanged and the cache hits -- serving the
     score from before the change. saveLineup() and repairLineupFor() both do
     exactly this (pk.is_sub = ...), which is why they clear it by hand. */
  S.league = { id: "L1", competition: { apiLeagueId: 39, season: 2026, name: "PL" } };
  S.managers = [{ id: "m1", name: "M1", draft_position: 1 }];
  S.snapshots = []; S.stages = []; S.rounds = []; S.transactions = [];
  S.playerById = { a1: { player_id: "a1", name: "A", position: "FWD", team: "A" },
                   a2: { player_id: "a2", name: "B", position: "FWD", team: "A" } };
  S.picks = [
    { id: "p1", manager_id: "m1", player_id: "a1", player_name: "A", position: "FWD",
      team: "A", slot: "FWD", is_sub: false, pick_number: 1 },
    { id: "p2", manager_id: "m1", player_id: "a2", player_name: "B", position: "FWD",
      team: "A", slot: "SUB_FWD", is_sub: true, pick_number: 2 },
  ];
  S.fixtures = [{ home: "A", away: "B", kickoff_utc: "2026-08-01T14:00:00Z",
    date: "2026-08-01", round: "Regular Season - 1", status: "FT" }];
  S.stats = [
    row({ player_id: "a1", match_label: "A vs B (2026-08-01)", appeared: true,
          goals: 1, team: "A", round: 1, round_key: "Regular Season - 1" }),
    row({ player_id: "a2", match_label: "A vs B (2026-08-01)", appeared: true,
          goals: 3, team: "A", round: 1, round_key: "Regular Season - 1" }),
  ];
  bustScores();
  const startersOnly = computeScores()[0].total;

  // Bench the starter and promote the sub, the way saveLineup does it.
  S.picks[0].is_sub = true;  S.picks[0].slot = "SUB_FWD";
  S.picks[1].is_sub = false; S.picks[1].slot = "FWD";
  check("an in-place line-up change is invisible to the memo's key",
    computeScores()[0].total, startersOnly);      // still the OLD answer
  bustScores();
  check("...and clearing it, which those paths now do, gives the new one",
    computeScores()[0].total, computeScoresUncached()[0].total);
  check("...which is genuinely a different number",
    computeScores()[0].total === startersOnly, false);
  S.picks = []; S.stats = []; S.fixtures = []; bustScores();


  /* ---------- the sport seam ---------- */

  /* The key format is asymmetric on purpose: football's keys are already
     written into competition_pools and competition_stats and must not move,
     so only other sports carry the qualifier. */
  S.league = null;
  check("a football competition keys exactly as it always did",
    compKeyOf({ apiLeagueId: 39, season: 2024 }), "39-2024");
  check("...and still does when it says so out loud",
    compKeyOf({ apiLeagueId: 39, season: 2024, sport: "football" }), "39-2024");
  check("another sport qualifies its key, so a shared id is not a shared row",
    compKeyOf({ apiLeagueId: 1068, season: 202501, sport: "rugby" }), "rugby-1068-202501");
  check("a rugby id that collides with a football one stays separate",
    compKeyOf({ apiLeagueId: 39, season: 2024, sport: "rugby" })
      === compKeyOf({ apiLeagueId: 39, season: 2024 }), false);

  // The admin list used to split on "-" and read "rugby" as the league id.
  check("a plain key parses as football", parseCompKey("39-2024").sport, "football");
  check("...with the league id intact", parseCompKey("39-2024").apiLeagueId, 39);
  check("a qualified key gives its sport back", parseCompKey("rugby-1068-202501").sport, "rugby");
  check("...and does NOT read the sport as the league id",
    parseCompKey("rugby-1068-202501").apiLeagueId, 1068);
  check("...and keeps the season", parseCompKey("rugby-1068-202501").season, 202501);

  /* The registry has to actually switch something. A seam that every accessor
     ignores would pass every test above and still leave the app hardcoded, so
     this registers a throwaway sport and checks the accessors follow it. */
  SPORTS.__probe = {
    label: "Probe",
    groups: () => ["A", "B", "TEAM"],
    playGroups: () => ["A", "B"],
    slotPos: () => ({ A: "A", SUB_A: "A" }),
    slotRank: () => ({ A: 0, B: 1 }),
    quota: () => ({ A: 5, B: 6, TEAM: 1 }),
    starters: () => ({ A: 2, B: 3 }),
    formation: () => ({ A: [1, 2], B: [2, 4], starters: 5 }),
    statCatalog: () => [{ key: "probe.stat", label: "Probe stat" }],
    rules: () => [{ stat: "probe.stat", mode: "each", points: 7 }],
    competitions: () => [{ name: "Probe Cup", apiLeagueId: 9001, kind: "cup" }],
  };
  check("with no league at all the app is football",
    sportOf(), "football");
  S.league = { id: "L1", competition: { apiLeagueId: 9001, season: 1, sport: "__probe" } };
  check("a league's competition decides the sport", sportOf(), "__probe");
  check("...and the position groups follow it", playGroups().join(","), "A,B");
  check("...including the club pick in the full list", posGroups().join(","), "A,B,TEAM");
  check("...the quota", phaseOneQuota().A, 5);
  check("...the starters", phaseOneStarters().B, 3);
  check("...the scoring rules", scoringRules()[0].points, 7);
  check("...and the competition list", competitionsFor()[0].name, "Probe Cup");
  check("an unknown sport falls back to football rather than throwing",
    sportDef("nonesuch").playGroups().join(","), "GK,DEF,MID,FWD");
  delete SPORTS.__probe;
  S.league = null;


  /* ---------- the rugby feed ---------- */

  // Shirt number IS the position. 1 and 3 are both props; 11, 14 and 15 are
  // all outside backs. This is the mapping the whole preset rests on.
  check("a loosehead is a prop", rugbyPosCode(1), "PR");
  check("...and so is a tighthead", rugbyPosCode(3), "PR");
  check("2 hooks", rugbyPosCode(2), "HK");
  check("4 and 5 lock", rugbyPosCode(4) + rugbyPosCode(5), "LKLK");
  check("6, 7 and 8 are the loose forwards",
    rugbyPosCode(6) + rugbyPosCode(7) + rugbyPosCode(8), "LFLFLF");
  check("9 and 10 are the halves", rugbyPosCode(9) + rugbyPosCode(10), "SHFH");
  check("12 and 13 are the centres", rugbyPosCode(12) + rugbyPosCode(13), "CECE");
  check("the wings and the fullback are all outside backs",
    rugbyPosCode(11) + rugbyPosCode(14) + rugbyPosCode(15), "OBOBOB");
  check("a starting XV is fifteen shirts",
    [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15].map((n) => rugbyPosCode(n)).filter(Boolean).length, 15);
  check("...covering every one of the eight groups",
    new Set([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15].map((n) => rugbyPosCode(n))).size, 8);

  /* The bench is 16-23 and the feed does NOT say what a substitute plays, so
     the number must resolve to nothing rather than to a guess. */
  check("a bench slot has no position of its own", rugbyPosCode(16), null);
  check("...and is recognised as bench", isRugbyBenchSlot(16), true);
  check("...to the end of the bench", isRugbyBenchSlot(23), true);
  check("a starter is not bench", isRugbyBenchSlot(7), false);

  // The squad roster's shape is undocumented, so a named position resolves too.
  check("a named position still resolves", rugbyPosCode(null, "Scrum Half"), "SH");
  check("...however it is punctuated", rugbyPosCode(null, "scrum-half"), "SH");
  check("...including a No. 8", rugbyPosCode(null, "Number 8"), "LF");
  check("...and a fullback", rugbyPosCode(null, "Full Back"), "OB");
  check("an unknown position is null, not a guess", rugbyPosCode(null, "Water Carrier"), null);

  // `known` is the feed's resolved display name; first+last is the fallback.
  check("a player uses the name the feed has already resolved",
    parseRugbyPlayer({ id: 77, known: "Rieko Ioane", firstName: "Rieko",
      lastName: "Ioane", positionId: 13 }, "Blues", "BLU", 2907).name, "Rieko Ioane");
  check("...falling back to first + last when it has none",
    parseRugbyPlayer({ id: 78, firstName: "Jordie", lastName: "Barrett",
      positionId: 12 }, "Blues", "BLU", 2907).name, "Jordie Barrett");
  check("a rugby player id cannot collide with a football one",
    parseRugbyPlayer({ id: 153, positionId: 10 }, "Leinster", "LEI", 5356).player_id, "rug_153");

  /* status "result" has to arrive as FT: the app's round and settlement code
     keys off FINAL_STATUS, and a played match that says "result" would be
     treated as unplayed for ever. */
  const rm = { id: 9, status: "result", date: "2026-05-31T17:00:00Z", round: 18,
    homeTeam: { name: "Leinster", score: 36 }, awayTeam: { name: "Vodacom Bulls", score: 7 } };
  check("a played match arrives as FT", parseRugbyMatch(rm).status, "FT");
  check("...with the score", parseRugbyMatch(rm).home_score, 36);
  check("...and a round label the app can read", parseRugbyMatch(rm).round, "Round 18");
  check("an unplayed match is NS",
    parseRugbyMatch({ ...rm, status: "fixture" }).status, "NS");
  check("a knockout uses its title, having no round number",
    parseRugbyMatch({ ...rm, round: null, title: "Grand Final" }).round, "Grand Final");

  /* The search endpoint ignores season, status, round and sort, so this filter
     is the only thing standing between the app and a list of TBC placeholders
     sorted above the real results. */
  /* Every entry carries real sides, because the feed's own placeholders are
     recognised by their TEAMS rather than by the tbc flag -- so a fixture with
     no teams at all is not a case this filter should be judged on. */
  const sides = { homeTeam: { id: 5356, name: "Leinster" },
                  awayTeam: { id: 4377, name: "Munster" } };
  const feedList = [
    { id: 1, status: "fixture", tbc: 1, date: "2027-06-01T00:00:00Z", ...sides },
    { id: 2, status: "result",  tbc: 0, date: "2026-05-31T17:00:00Z", ...sides },
    { id: 3, status: "result",  tbc: 0, date: "2026-05-24T17:00:00Z", ...sides },
    { id: 4, status: "fixture", tbc: 0, date: "2026-06-07T17:00:00Z", ...sides },
    { id: 5, status: "result",  tbc: 1, date: "2026-05-30T17:00:00Z", ...sides },
    // ...and the shape the feed really uses for an undecided tie.
    { id: 6, status: "fixture", tbc: 0, date: "2026-06-14T17:00:00Z",
      homeTeam: { id: 0, name: "TBC" }, awayTeam: { id: 0, name: "TBC" } },
  ];
  check("only completed matches come back",
    usableRugbyMatches(feedList).map((m) => m.id).join(","), "3,2");
  check("...oldest first, because the feed's own order is the reverse",
    usableRugbyMatches(feedList)[0].id, 3);
  check("a tbc match is never usable, even with a result",
    usableRugbyMatches(feedList).some((m) => m.id === 5), false);
  check("upcoming fixtures can be asked for by name",
    usableRugbyMatches(feedList, { status: "fixture" }).map((m) => m.id).join(","), "4");
  check("...and the tbc placeholder is still refused",
    usableRugbyMatches(feedList, { status: "fixture" }).some((m) => m.id === 1), false);
  check("...as is an undecided tie the flag calls settled",
    usableRugbyMatches(feedList, { status: "fixture" }).some((m) => m.id === 6), false);
  check("a date window keeps only the round just finished",
    usableRugbyMatches(feedList, { sinceMs: Date.parse("2026-05-28T00:00:00Z") })
      .map((m) => m.id).join(","), "2");

  /* Stat rows. The football-shaped columns are deliberately absent -- every
     one is nullable with a default -- and the scoring engine reads `raw`. */
  const detail = {
    id: 9, date: "2026-05-31T17:00:00Z", round: 18,
    homeTeam: { name: "Leinster", score: 36, players: [
      { id: 101, known: "A Starter", positionId: 10,
        stats: { minutesPlayedTotal: 80, tries: 1, conversionGoals: 4, tackles: 7 } },
      { id: 102, known: "A Sub", positionId: 19,
        stats: { minutesPlayedTotal: 12, tries: 1 } },
      { id: 103, known: "Unused Sub", positionId: 23, stats: { minutesPlayedTotal: 0 } },
    ] },
    awayTeam: { name: "Vodacom Bulls", score: 7, players: [
      { id: 201, known: "Away Player", positionId: 8,
        stats: { minutesPlayedTotal: 80, tackles: 14 } },
    ] },
  };
  const pidOf = (team, p) => "rug_" + p.id;
  const rrows = rugbyStatRows(detail, { competition_key: "rugby-1068-202501" }, pidOf, []);
  check("both sides are scored", rrows.length, 3);
  check("a player who never came on is left out",
    rrows.some((r) => r.player_id === "rug_103"), false);
  check("a bench player who scored is kept",
    rrows.some((r) => r.player_id === "rug_102"), true);
  check("the competition key is carried through", rrows[0].competition_key, "rugby-1068-202501");
  check("the match is labelled the way every other row is",
    rrows[0].match_label, "Leinster vs Vodacom Bulls (2026-05-31)");
  check("the round key is stamped", rrows[0].round_key, "Round 18");
  check("...and the round number parsed from it", rrows[0].round, 18);
  check("the stats land in raw, where the scoring engine reads them",
    rrows[0].raw.tries, 1);
  check("...with every populated field present even at zero",
    RUGBY_STAT_KEYS.every((k) => rrows[0].raw[k] != null), true);
  check("minutes are set for the minutes gate", rrows[0].minutes, 80);

  /* Stats might sit on the player or under `stats`; the guide does not say
     which, and reading only one of them scores everybody zero in silence. */
  check("stats nested under `stats` are found", rugbyStatsOf({ stats: { tries: 2 } }).tries, 2);
  check("...and stats sitting on the player are too", rugbyStatsOf({ tries: 3 }).tries, 3);
  const flat = { ...detail, homeTeam: { ...detail.homeTeam,
    players: [{ id: 301, known: "Flat", positionId: 9, minutesPlayedTotal: 80, tries: 2 }] } };
  check("a flat player object still scores",
    rugbyStatRows(flat, {}, pidOf, [])[0].raw.tries, 2);

  // The feed answers 200 with {"status":"error"} rather than an HTTP error.
  check("a feed error is thrown, not parsed", (() => {
    try { rugbyBody({ message: "No match exists with the id [X]", status: "error" }); return "no throw"; }
    catch (e) { return "threw"; }
  })(), "threw");
  check("...and a good body passes through", rugbyBody({ data: [1, 2] }).data.length, 2);

  /* Two spellings of a matchweek and no third: football writes "Regular
     Season - 7" and the rugby adapter writes "Round 7" from the number the
     feed gives it. Both anchored, which is the whole point -- a loose
     "trailing digits" rule reads "Round of 16" as matchweek 16 and files a
     knockout tie as a league round.

     Rugby's label used to return null here, which was a consequence of the
     football-only pattern rather than a decision: it left every rugby fixture
     unnumbered, so blank weeks, double weeks and "locks before Matchweek N"
     had nothing to work with. */
  check("a knockout label is not a matchweek number", mwNo("Round of 16"), null);
  check("...and neither is a round named rather than numbered", mwNo("Semi-final"), null);
  check("football's matchweek is read", mwNo("Regular Season - 7"), "7");
  check("...and so is rugby's", mwNo("Round 18"), "18");
  check("...but not with anything after it", mwNo("Round 18 replay"), null);
  check("a real matchweek still parses", mwNo("Regular Season - 18"), "18");

  // Split-year competitions must be the ones that actually run across two.
  check("the URC is a split-year season",
    RUGBY_COMPETITIONS.find((c) => c.apiLeagueId === 1068).kind, "league");
  check("Super Rugby is a calendar-year one",
    RUGBY_COMPETITIONS.find((c) => c.apiLeagueId === 1020).kind, "cup");


  /* ---------- the rugby preset ---------- */

  /* The slot maps are generated. Football's are still written out as literals,
     so generating them from the same groups and getting the same object back
     is the proof that the generator is the shape the app has always used. */
  const fbSlots = slotMapsFor(["GK", "DEF", "MID", "FWD"]);
  check("the generator reproduces football's slot positions exactly",
    JSON.stringify(Object.entries(fbSlots.pos).sort()),
    JSON.stringify(Object.entries(SLOT_POS).sort()));
  check("...and its slot ordering exactly",
    JSON.stringify(Object.entries(fbSlots.rank).sort()),
    JSON.stringify(Object.entries(SLOT_RANK).sort()));

  // The XV is the shirt-number mapping counted up; the two cannot disagree.
  check("the starting XV is fifteen players",
    Object.values(RUGBY_STARTERS).reduce((a, b) => a + b, 0), 15);
  const fromShirts = {};
  for (let n = 1; n <= 15; n++) {
    const c = rugbyPosCode(n);
    fromShirts[c] = (fromShirts[c] || 0) + 1;
  }
  /* Compared per group rather than by serialising, because the two are built
     in different orders on purpose: shirt 11 is a wing, so walking 1-15 meets
     an outside back before a centre, while the group list is in team-sheet
     order. The counts are the claim; the order is not. */
  check("...and it matches the shirt numbers exactly, position by position",
    RUGBY_PLAY_GROUPS.every((g) => (fromShirts[g] || 0) === RUGBY_STARTERS[g]), true);
  check("...with no position invented by one and not the other",
    Object.keys(fromShirts).sort().join(","), RUGBY_PLAY_GROUPS.slice().sort().join(","));

  // A quota below the XV would let a manager draft a squad they cannot field.
  check("no position is quota'd below its starters",
    RUGBY_PLAY_GROUPS.every((g) => RUGBY_QUOTA[g] >= RUGBY_STARTERS[g]), true);
  check("the squad is the XV plus a four-man bench",
    RUGBY_PLAY_GROUPS.reduce((a, g) => a + RUGBY_QUOTA[g], 0), 19);
  check("...and one club pick on top", RUGBY_QUOTA.TEAM, 1);

  /* Four rows, not eight -- and every group has to appear in exactly one of
     them, or players in a missing group would simply not be drawn. */
  const banded = RUGBY_PITCH_BANDS.flat();
  check("the pitch draws four bands", RUGBY_PITCH_BANDS.length, 4);
  check("...covering every position group", banded.slice().sort().join(","),
    RUGBY_PLAY_GROUPS.slice().sort().join(","));
  check("...each exactly once", banded.length, new Set(banded).size);

  /* Scoring may only name stats the feed actually populates. A rule on one of
     its permanently-null fields scores zero for ever and never errors. */
  const catalogKeys = new Set(RUGBY_STAT_CATALOG.map((c) => c.key));
  check("every catalogue entry is a field the feed populates",
    RUGBY_STAT_CATALOG.every((c) => RUGBY_STAT_KEYS.includes(c.key)), true);
  check("...and every populated field is offered", RUGBY_STAT_KEYS.every((k) => catalogKeys.has(k)), true);
  check("every default rule names a real stat",
    RUGBY_RULES.every((r) => catalogKeys.has(r.stat)), true);
  check("there is no assist rule, because the feed has no assists",
    RUGBY_RULES.some((r) => /assist/i.test(r.stat)), false);
  check("...and no rule on `points`, which would pay for a try twice",
    RUGBY_RULES.some((r) => r.stat === "points"), false);
  check("a try is worth more than a penalty goal",
    RUGBY_RULES.find((r) => r.stat === "tries").points
      > RUGBY_RULES.find((r) => r.stat === "penaltyGoals").points, true);

  /* Now with a rugby league actually loaded. */
  S.league = { id: "L1", competition: { apiLeagueId: 1068, season: 2025, sport: "rugby" } };
  check("the league is rugby", sportOf(), "rugby");
  check("the squad size follows the sport", squadSize(), 19);
  check("the pitch bands follow it too", sportDef().pitchBands().length, 4);
  check("nothing is fixed to an exact count", sportDef().exactGroups().length, 0);
  check("...so every group is 'outfield'", outfieldGroups().length, 8);
  check("a zeroed tally has a key per position, not four",
    Object.keys(zeroByGroup()).join(","), "PR,HK,LK,LF,SH,FH,CE,OB");
  check("...and every one of them starts at zero",
    Object.values(zeroByGroup()).every((v) => v === 0), true);
  check("summing a quota adds up all eight", sumGroups(RUGBY_QUOTA), 19);
  check("the scoring rules are rugby's", scoringRules()[0].stat, "tries");
  check("a try scores what the preset says",
    rowPointsWith({ appeared: true, raw: { tries: 1 } }, "OB", scoringRules()), 10);
  check("...and a tackle count scores per five, rounding down",
    rowPointsWith({ appeared: true, raw: { tackles: 12 } }, "LF", scoringRules()), 2);
  check("a card costs points", rowPointsWith({ appeared: true, raw: { yellowCards: 1 } }, "PR", scoringRules()), -3);

  /* A full XV is a complete line-up; one short is not. This is the check that
     would have failed silently on a four-key literal tally. */
  const xv = { ...RUGBY_STARTERS };
  check("a full XV is a valid line-up", flexComplete(xv, RUGBY_STARTERS, 0), true);
  check("...and one short is not",
    flexComplete({ ...xv, OB: 2 }, RUGBY_STARTERS, 0), false);

  /* Fixed-mode auto-subs across eight groups. The no-show tally used to be an
     object literal of four keys, so every rugby position read undefined and
     `undefined++` gave NaN -- which compares false against every threshold, so
     no substitution ever activated and nothing ever errored. */
  const roster = [
    { player_id: "p1", position: "FH", is_sub: false },
    { player_id: "p2", position: "OB", is_sub: false },
    { player_id: "b1", position: "FH", is_sub: true },
    { player_id: "b2", position: "PR", is_sub: true },
  ];
  const labelFor = () => "R1";
  const played = new Set(["p2", "b1", "b2"]);          // p1 did not play
  const subs = fixedRoundSubs(roster, 1, labelFor, (pid) => played.has(pid), 3, null);
  check("a bench player of the same position covers a no-show", subs.has("b1"), true);
  check("...and one of a different position does not", subs.has("b2"), false);

  /* And the pitch actually draws in bands. Without this, reverting the band
     loop to one row per group passes every other assertion here and only
     shows up as eight rows on a phone. */
  const rugbyByPos = {};
  RUGBY_PLAY_GROUPS.forEach((g, i) => {
    rugbyByPos[g] = [{ player_id: "rp" + i, name: "Player" + i, team: "Leinster" }];
  });
  const rowsHtml = pitchRowsHtml(rugbyByPos, {});
  check("eight position groups are drawn in four rows",
    (rowsHtml.match(/class="pitch-row"/g) || []).length, 4);
  check("...with nobody dropped on the way",
    RUGBY_PLAY_GROUPS.every((g, i) => rowsHtml.includes("Player" + i)), true);
  S.league = null;

  // ...and football still draws its four, one group each.
  const fbByPos = { GK: [{ player_id: "f0", name: "Keeper", team: "A" }],
                    DEF: [{ player_id: "f1", name: "Back", team: "A" }],
                    MID: [{ player_id: "f2", name: "Middle", team: "A" }],
                    FWD: [{ player_id: "f3", name: "Front", team: "A" }] };
  check("football still draws one row per position",
    (pitchRowsHtml(fbByPos, {}).match(/class="pitch-row"/g) || []).length, 4);


  /* ---------- reading a pre-match line-up ---------- */

  /* The point of this is to find out what the feed does, so the summary has to
     report an ABSENT line-up as clearly as a present one -- "no players yet"
     is the answer we are most likely to get, and it must not look like an
     error or like a squad of nobody. */
  const NOW = Date.parse("2026-05-28T12:00:00Z");
  const bare = summariseLineupSample({
    id: 41, date: "2026-05-31T17:00:00Z", status: "fixture",
    homeTeam: { name: "Leinster" }, awayTeam: { name: "Munster" },
  }, NOW);
  check("a fixture with no line-up reports no players", bare.players, 0);
  check("...but is still recognised as a match", bare.sides, 2);
  check("...and says how far ahead it is", bare.hoursAhead, 77);
  check("...with no positions invented", bare.positionIds.length, 0);

  /* A full matchday squad: shirts 1-15 named and 16-23 on the bench. Both
     halves are counted separately because starters-without-a-bench is a real
     possible answer and would change what can be badged. */
  const named = summariseLineupSample({
    id: 42, date: "2026-05-31T17:00:00Z", status: "fixture",
    homeTeam: { name: "Leinster", players: Array.from({ length: 23 }, (_, i) =>
      ({ id: 100 + i, known: "P" + i, positionId: i + 1 })) },
    awayTeam: { name: "Munster", players: Array.from({ length: 15 }, (_, i) =>
      ({ id: 200 + i, known: "Q" + i, positionId: i + 1 })) },
  }, NOW);
  check("both sides' players are counted", named.players, 38);
  check("the starting shirts are recognised", named.starters, 15);
  check("...and the bench separately", named.bench, 8);
  check("a home side with only an XV would show no bench",
    summariseLineupSample({ id: 43, homeTeam: { players: [{ id: 1, positionId: 7 }] } }, NOW).bench, 0);

  /* The field NAMES are the actual finding here: the guide does not document a
     pre-match player object, so recording which keys turned up is the thing
     that answers whether badges can be built at all. */
  check("the player fields seen are reported",
    named.playerKeys.join(","), "id,known,positionId");
  check("...merged across players rather than taken from the first",
    summariseLineupSample({ id: 44, homeTeam: { players: [
      { id: 1, positionId: 1 }, { id: 2, positionId: 2, shirtNumber: 2 },
    ] } }, NOW).playerKeys.join(","), "id,positionId,shirtNumber");

  // The report has to say plainly which way the answer went.
  check("an empty result says so, and does not claim the feed is broken",
    /does not publish them|named closer to kick-off/.test(
      lineupObservationText({ upcoming: 3, samples: [bare] })), true);
  check("...and a populated one says the badges can be built",
    /badges can be built/.test(
      lineupObservationText({ upcoming: 3, samples: [named] })), true);
  check("a failed fetch is reported as an error, not as an empty line-up",
    /ERROR/.test(lineupObservationText({ upcoming: 1,
      samples: [{ matchId: 9, error: "timeout" }] })), true);


  /* ---------- loading a pool reaches the right provider ---------- */

  /* The rugby fetchers existed for two commits without anything calling them:
     both loaders asked API-Football regardless of sport, so a rugby league
     could be designed in the create form and then never loaded. These pin the
     dispatch itself rather than the fetchers it dispatches to. */
  check("football needs a key", sportNeedsApiKey({ sport: "football" }), true);
  check("...and a competition that does not say defaults to football",
    sportNeedsApiKey({}), true);
  check("rugby needs none, because its feed is unauthenticated",
    sportNeedsApiKey({ sport: "rugby" }), false);

  /* A pool row must be keyed the way compKeyOf spells it. ensureCompetitionPool
     built that string by hand, so a rugby competition would have looked up --
     and written to -- football's row for the same id. */
  check("a rugby pool is keyed apart from a football one with the same id",
    compKeyOf({ apiLeagueId: 1068, season: 2025, sport: "rugby" })
      !== compKeyOf({ apiLeagueId: 1068, season: 2025 }), true);


  /* ---------- what the feed actually sent ----------
     Trimmed from the first real response this app ever got back, so these
     assertions are pinned to observed behaviour rather than to the written
     guide -- which was wrong about the one that mattered. */
  const REAL = {
    id: 291618, compId: 2146, compName: "Nations Championship",
    date: "2026-11-29T16:40:00.000Z", round: 7, roundTypeId: 2, title: "TF",
    season: 202600, status: "fixture",
    tbc: 0,                                  // ...and yet:
    homeTeam: { id: 0, name: "TBC", shortName: "TBC", players: null, score: null },
    awayTeam: { id: 0, name: "TBC", shortName: "TBC", players: null, score: null },
    venue: { id: 3320, name: "Allianz Stadium" },
  };
  const REAL_PLAYED = {
    ...REAL, id: 291600, status: "result", round: 3, title: null,
    date: "2026-11-14T15:00:00.000Z",
    homeTeam: { id: 4, name: "Ireland", score: 21 },
    awayTeam: { id: 5, name: "France", score: 17 },
  };

  /* The guide said tbc:1 marks an undetermined tie. The feed says otherwise:
     a placement match carries tbc:0 and two teams called TBC with id 0,
     because who plays in it depends on a table nobody has finished. Believing
     the flag would have put a club called TBC into a draft pool. */
  check("a placement match says tbc:0 even though nobody is in it", REAL.tbc, 0);
  check("...so the teams are what decide it", rugbyMatchSettled(REAL), false);
  check("a real fixture between two named sides is settled",
    rugbyMatchSettled({ ...REAL, homeTeam: { id: 4, name: "Ireland" },
                                 awayTeam: { id: 5, name: "France" } }), true);
  check("a TBC side is not a known team", rugbyTeamKnown({ id: 0, name: "TBC" }), false);
  check("...nor is one with a name but no id", rugbyTeamKnown({ id: 0, name: "Ireland" }), false);
  check("...and the flag still counts when it IS set",
    rugbyMatchSettled({ ...REAL_PLAYED, tbc: 1 }), false);

  check("an undetermined fixture never reaches the app",
    usableRugbyMatches([REAL], { status: "fixture" }).length, 0);
  check("...while a played match between named sides does",
    usableRugbyMatches([REAL_PLAYED]).length, 1);

  // The envelope: { data, metadata, status:"success" }.
  check("the real response envelope yields its list",
    firstArray({ data: [REAL], metadata: { totalItems: 42 }, status: "success" },
      ["data", "matches"], "probe").length, 1);
  check("...and `status: success` is not mistaken for an error", (() => {
    try { rugbyBody({ data: [], status: "success" }); return "fine"; } catch { return "threw"; }
  })(), "fine");

  // Parsing a real played match.
  const parsed = parseRugbyMatch(REAL_PLAYED);
  check("a real result parses as FT", parsed.status, "FT");
  check("...with both sides named", `${parsed.home} v ${parsed.away}`, "Ireland v France");
  check("...the date taken off the timestamp", parsed.date, "2026-11-14");
  check("...and the round numbered", parsed.round, "Round 3");


  /* The feed's second error shape, straight from a real response. `status` is
     a NUMBER here, not the string "error", which is how a 400 slipped past the
     check and came out the other end as an empty squad. */
  const badReq = { timestamp: "2026-08-09T15:24:38.310Z", status: 400,
                   error: "Bad Request", path: "/v1/teams/4/players" };
  check("an HTTP-shaped error envelope throws", (() => {
    try { rugbyBody(badReq); return "no throw"; } catch (e) { return e.message; }
  })().includes("400"), true);
  check("...and names the path that failed", (() => {
    try { rugbyBody(badReq); return ""; } catch (e) { return e.message; }
  })().includes("/v1/teams/4/players"), true);
  check("the other error shape still throws", (() => {
    try { rugbyBody({ status: "error", message: "No match exists" }); return "no throw"; }
    catch { return "threw"; }
  })(), "threw");
  check("a success envelope is untouched",
    rugbyBody({ data: [1], status: "success" }).data.length, 1);
  check("...and a body with no status at all passes through",
    rugbyBody({ data: [] }).data.length, 0);


  /* ---------- a real player object, verbatim from the feed ---------- */
  const HANEKOM = {
    captain: null, firstName: "Cameron", id: 240452, known: "Cameron Hanekom",
    lastName: "Hanekom", motm: null, name: "Cameron Hanekom",
    position: "flanker", positionId: 7, positionName: null,
    stats: { carries: 8, cleanBreaks: 1, defendersBeaten: 4, metres: 19,
             minutesPlayedTotal: 46, missedTackles: 2, tackles: 9,
             tackleSuccess: 0.75, tries: 0, turnoversConceded: 1, points: 0,
             yellowCards: 0, redCards: 0, penaltiesConceded: 0 },
  };
  const parsedP = parseRugbyPlayer(HANEKOM, "South Africa", "SOU", 8);
  check("a real player's id is namespaced", parsedP.player_id, "rug_240452");
  check("...and named from `known`", parsedP.name, "Cameron Hanekom");
  check("...at the position its shirt says", parsedP.position, "LF");
  check("...for the club it played for", parsedP.team, "South Africa");
  check("the feed carries no photo, so none is invented", parsedP.photo, null);

  // Stats really are nested, which is the branch that would score zero if wrong.
  check("the nested stats block is the one read", rugbyStatsOf(HANEKOM).tackles, 9);
  const realRows = rugbyStatRows(
    { id: 291579, date: "2026-07-04T15:00:00Z", round: 1,
      homeTeam: { name: "South Africa", score: 30, players: [HANEKOM] },
      awayTeam: { name: "England", score: 12, players: [] } },
    { competition_key: "rugby-2146-2026" }, (t, p) => "rug_" + p.id, []);
  check("a real player produces one stat row", realRows.length, 1);
  check("...with the tackles the feed reported", realRows[0].raw.tackles, 9);
  check("...and the minutes", realRows[0].minutes, 46);
  check("nine tackles is one point at per-5, rounded down",
    rowPointsWith({ appeared: true, raw: realRows[0].raw }, "LF", RUGBY_RULES), 
    // 9 tackles -> 1, 19 metres -> 0, 1 clean break -> 2, 4 beaten -> 4,
    // 1 turnover conceded -> -1
    1 + 0 + 2 + 4 - 1);

  /* motm sits on the PLAYER, not in stats -- a rule on it reads nothing unless
     the stats view is widened, which is the sort of thing that scores zero
     forever without erroring. */
  check("man of the match is picked up from the player object",
    rugbyStatRows({ id: 1, date: "2026-07-04T15:00:00Z", round: 1,
      homeTeam: { name: "A", players: [{ ...HANEKOM, motm: true }] } },
      {}, (t, p) => "p" + p.id, [])[0].raw.motm, 1);
  check("...and is zero when it is null", realRows[0].raw.motm, 0);

  /* Bench shirts are a convention, not a fact, and must never beat a start. */
  check("shirt 16 conventionally hooks", RUGBY_BENCH_POS[16], "HK");
  check("shirt 21 is the reserve scrum-half", RUGBY_BENCH_POS[21], "SH");
  check("a bench shirt still has no position of its own", rugbyPosCode(21), null);


  /* Why auto-pick found nobody. The old message named the quota, which sent
     the reader to look at the one thing that is usually correct. */
  check("a complete squad says so plainly",
    noCandidatesReason([], [], {}).includes("complete"), true);
  check("an exhausted position is named",
    noCandidatesReason([], ["HK", "SH"], { HK: 0, SH: 0 }).includes("no players left at HK, SH"), true);
  check("...and one with players left says they are taken, not missing",
    noCandidatesReason([], ["OB"], { OB: 3 }).includes("OB: 3"), true);
  check("...distinguishing the two in one message", (() => {
    const m = noCandidatesReason([], ["HK", "OB"], { HK: 0, OB: 3 });
    return m.includes("no players left at HK") && m.includes("OB: 3");
  })(), true);
  check("the old wording, which pointed at the quota, is gone",
    /open quota/.test(noCandidatesReason([], ["HK"], { HK: 0 })), false);


  /* ---------- swapping one player for another ---------- */

  /* The editor used to give every player a + or a −, so filling one hole could
     put three players in a row before you noticed -- and on a fifteen-a-side
     pitch the row ran off the screen. A swap cannot do that. The rule is asked
     of the resulting COUNTS, so it needs no opinion about the sport or the
     formation mode. */
  S.league = { id: "L1", competition: { apiLeagueId: 2146, season: 2026, sport: "rugby" },
               config: null };
  const swapXV = { ...RUGBY_STARTERS };
  check("like for like is always allowed", lineupSwapValid(swapXV, "LF", "LF"), true);
  check("a fixed formation refuses a different position",
    lineupSwapValid(swapXV, "LF", "OB"), false);
  check("...in either direction", lineupSwapValid(swapXV, "OB", "LF"), false);
  check("the starting XV itself is legal", lineupValid(swapXV), true);

  /* Flex is the case the rule exists for: the same swap that a fixed league
     refuses is fine when the bounds allow it. */
  S.league.config = { formationMode: "flex",
    formation: { PR: [2, 3], HK: [1, 2], LK: [2, 2], LF: [2, 3], SH: [1, 2],
                 FH: [1, 2], CE: [2, 2], OB: [3, 4], starters: 15 } };
  check("a flex league allows a swap its bounds permit",
    lineupSwapValid(swapXV, "LF", "OB"), true);
  check("...and still refuses one they do not",
    lineupSwapValid(swapXV, "CE", "OB"), false);
  S.league = null;

  /* Football is unchanged: one keeper, and only another keeper can take that
     shirt. The numbers are the app's own PHASE1_STARTERS -- a side of nine,
     not eleven, which is what this league has always fielded. */
  S.league = { id: "L1", competition: null, config: null };
  const swapXI = { ...PHASE1_STARTERS };
  check("a football XI is legal", lineupValid(swapXI), true);
  check("a defender cannot take the keeper's shirt", lineupSwapValid(swapXI, "GK", "DEF"), false);
  check("...nor can the keeper take a defender's", lineupSwapValid(swapXI, "DEF", "GK"), false);
  check("but a defender for a defender is fine", lineupSwapValid(swapXI, "DEF", "DEF"), true);
  check("...and a defender for a midfielder breaks the shape",
    lineupSwapValid(swapXI, "DEF", "MID"), false);
  S.league = null;

  /* Crests come from the sport, so a second source is one function away. */
  SPORTS.__crest = { ...SPORTS.football, label: "Probe",
    crestUrl: (team) => `https://example.test/${team}.png` };
  S.league = { id: "L1", competition: { apiLeagueId: 1, season: 1, sport: "__crest" } };
  check("a sport with its own crest source is used",
    crestUrlFor("Ireland"), "https://example.test/Ireland.png");
  delete SPORTS.__crest;
  S.league = null;

  /* Rugby's crests, off the feed. The DEFAULT/ON_DARK pair is the whole point:
     the feed draws one badge for a light ground and one for a dark one, and
     the app has exactly those two themes. */
  check("both variants are kept",
    rugbyTeamCrest({ imageUrls: { DEFAULT: "a.png", ON_DARK: "b.png" } }),
    { light: "a.png", dark: "b.png" });
  check("a single URL serves both",
    rugbyTeamCrest({ imageUrl: "one.png" }), { light: "one.png", dark: "one.png" });
  check("the pair wins over the single",
    rugbyTeamCrest({ imageUrl: "one.png", imageUrls: { DEFAULT: "a.png", ON_DARK: "b.png" } }).dark,
    "b.png");
  check("a side with no images has no crest", rugbyTeamCrest({ id: 4, name: "Ireland" }), null);
  check("...and neither does nothing at all", rugbyTeamCrest(null), null);

  check("a player carries its club's crest",
    rugbyPlayerCrest({ teamImageUrls: { DEFAULT: "a.png", ON_DARK: "b.png" } }),
    { light: "a.png", dark: "b.png" });
  /* The trap: `imageUrl` on a PLAYER is that player's face. Reading it as a
     crest would badge every club with a photograph of one of its players. */
  check("a player's own photo is never a crest",
    rugbyPlayerCrest({ imageUrl: "face.png", imageUrls: { DEFAULT: "face.png" } }), null);
  check("a team's crest is not read off a player's team fields",
    rugbyTeamCrest({ teamImageUrl: "crest.png" }), null);

  /* With no crest in the feed, the code IS the badge, so it is worth getting
     right: the feed's own shortName beats three letters off a sponsored name. */
  check("the feed's own short code wins",
    rugbyTeamCode({ name: "Vodacom Bulls", shortName: "BUL" }), "BUL");
  check("...upper-cased", rugbyTeamCode({ name: "Leinster", shortName: "lei" }), "LEI");
  check("a short name that is really a name is not a code",
    rugbyTeamCode({ name: "Hollywoodbets Sharks", shortName: "Sharks" }), "HOL");
  check("and no short name still derives one",
    rugbyTeamCode({ name: "Munster" }), "MUN");

  check("no crest stores no fields", crestFields(null), {});
  check("a crest stores both", crestFields({ light: "a.png", dark: "b.png" }),
    { team_crest: "a.png", team_crest_dark: "b.png" });

  S.players = [
    { player_id: "rug_1", team: "Leinster", team_crest: "l.png", team_crest_dark: "l-dark.png" },
    { player_id: "rug_2", team: "Munster", team_crest: "m.png" },
    { player_id: "rug_3", team: "Ulster" },
  ];
  S.league = { id: "L1", competition: { apiLeagueId: 1068, season: 2025, sport: "rugby" } };
  stubDoc.documentElement.dataset.theme = "";        // "" and undefined both mean dark
  check("dark takes the on-dark badge", rugbyCrestUrl("Leinster"), "l-dark.png");
  stubDoc.documentElement.dataset.theme = "sticker";
  check("a light theme takes the default badge", rugbyCrestUrl("Leinster"), "l.png");
  check("one variant serves both themes", rugbyCrestUrl("Munster"), "m.png");
  check("a club with no crest gets none, not a football one",
    rugbyCrestUrl("Ulster"), null);
  check("and the sport's crest source is what the app asks",
    crestUrlFor("Leinster"), "l.png");

  /* The club mark: what a club looks like when its sport's feed ships no
     crest, which today is every rugby club. */
  check("a club's hue is stable", clubHue("Leinster"), clubHue("Leinster"));
  check("...and in range", clubHue("Vodacom Bulls") >= 0 && clubHue("Vodacom Bulls") < 360, true);
  check("...and two clubs are not the same colour",
    clubHue("Leinster") === clubHue("Munster"), false);
  check("nothing has no hue rather than a broken one", clubHue(null), 0);

  check("initials are first and last", initialsOf("Cameron Hanekom"), "CH");
  check("...a single name gives one", initialsOf("Ronaldo"), "R");
  check("...three names skip the middle", initialsOf("Jamison Gibson Park"), "JP");
  check("...and nothing gives nothing", initialsOf("   "), "");

  /* Sized in an SVG viewBox rather than in pixels, because these boxes run
     from 16px in a table row to 56px on the player sheet. */
  check("a two-letter mark is drawn large", markSvg("CH").includes('font-size="48"'), true);
  check("...and a four-letter one smaller", markSvg("ABCD").includes('font-size="27"'), true);
  check("a longer code is cut to four", markSvg("ABCDEFG").includes(">ABCD<"), true);
  check("an empty mark draws nothing", markSvg(""), "");
  /* Uppercasing alone hid this: an unescaped "<b>" becomes "<B>", so a test
     looking for the lower-case tag passed with the escape deleted. */
  check("and a club's name cannot inject markup",
    markSvg("<b>").includes("&lt;"), true);

  S.players = [{ player_id: "rug_1", team: "Ulster", team_code: "ULS", name: "A Hooker" }];
  S.playerById = Object.fromEntries(S.players.map((p) => [p.player_id, p]));
  const chip = teamCrestHtml("Ulster", "w-4 h-4");
  check("a club with no crest still gets its own mark", chip.includes("club-tint"), true);
  check("...carrying the code the pool knows", chip.includes(">ULS<"), true);
  check("...and its own hue", chip.includes(`--club-h:${clubHue("Ulster")}`), true);
  check("the code is still findable as a code", chip.includes("data-crest-fallback"), true);
  const face = avatarHtml("rug_1", "Ulster", "w-7 h-7");
  check("a player with no photo gets initials", face.includes(">AH<"), true);
  check("...tinted to their club", face.includes(`--club-h:${clubHue("Ulster")}`), true);
  check("a player the pool has never heard of stays blank",
    avatarHtml("rug_999", "Ulster").includes("club-tint"), false);
  check("a club not in the pool still derives a code",
    teamCodeOf("Glasgow Warriors"), "GLA");
  S.playerById = {};

  /* The practice draft's pool menu, built from nothing but stored keys. The
     asymmetry is the whole difficulty: football's keys have two segments and
     every other sport's have three. */
  const pools = loadedCompetitions(["39-2024", "rugby-1068-2025", "rugby-2146-2026", "", "junk"]);
  check("only real keys become options", pools.length, 3);
  check("a football key keeps its name and season",
    pools.find((c) => c.key === "39-2024").label, "Premier League 2024/25");
  check("...and its sport", pools.find((c) => c.key === "39-2024").sport, "football");
  check("a rugby league season spans two years",
    pools.find((c) => c.key === "rugby-1068-2025").label,
    "United Rugby Championship 2025/26");
  check("...and a rugby cup does not",
    pools.find((c) => c.key === "rugby-2146-2026").label, "Nations Championship 2026");
  check("the sport is named for the menu",
    pools.find((c) => c.key === "rugby-2146-2026").sportLabel, "Rugby union");
  check("a pool the catalogue no longer lists is still offered",
    loadedCompetitions(["rugby-9999-2026"])[0].label, "League 9999 2026");
  check("...and an unknown sport does not throw",
    loadedCompetitions(["cricket-1-2026"])[0].sport, "cricket");
  check("football sorts before rugby", pools[0].sport, "football");
  check("nothing loaded is an empty menu, not a crash", loadedCompetitions(null), []);

  check("the league row gets the four fields it reads later",
    practiceCompetition(pools.find((c) => c.key === "rugby-2146-2026")),
    { name: "Nations Championship", apiLeagueId: 2146, season: 2026, sport: "rugby" });
  check("and the built-in pool is no competition at all",
    practiceCompetition(undefined), null);

  /* The button used to say nothing about what it would deal, and always dealt
     World Cup footballers. */
  check("the note describes a football draft",
    practiceNote(null), "Football · 14 picks each, 9 to field.");
  check("...and a rugby one differently",
    practiceNote({ sport: "rugby" }), "Rugby union · 20 picks each, 15 to field.");

  /* Where a rugby position comes from. The first version kept the EARLIEST
     start forever, so a lock who covered flanker in round 1 was a Loose
     forward all season no matter how many times he packed down at 4. */
  check("the most-started shirt wins",
    resolveRugbyPosition({ LF: 1, LK: 6 }, null), { position: "LK", starts: 6 });
  check("...however the season began",
    resolveRugbyPosition({ LK: 6, LF: 1 }, null), { position: "LK", starts: 6 });
  /* Matches are walked oldest-first, so the LAST to reach a tied count is the
     most recent -- a player who genuinely moved ends up where he finished. */
  check("a tie goes to the later shirt",
    resolveRugbyPosition({ LF: 3, LK: 3 }, null), { position: "LK", starts: 3 });
  check("never started falls back to the bench convention",
    resolveRugbyPosition({}, "SH"), { position: "SH", starts: 0 });
  check("...and says so with zero starts",
    resolveRugbyPosition(null, "SH").starts, 0);
  check("neither one nor the other is nobody",
    resolveRugbyPosition({}, null), { position: null, starts: 0 });

  /* The feed sends one club under two names -- the sponsored one in some
     matches, the bare one in others -- and they arrive as two clubs, one with
     three players in it. The team ID says they are the same side. */
  check("the most-seen spelling wins",
    canonicalTeamNames({ 7: { "Fidelity Secure Drive Lions": 12, "Lions": 3 } }),
    { 7: "Fidelity Secure Drive Lions" });
  check("...and a tie goes to the one without the sponsor on the front",
    canonicalTeamNames({ 7: { "Fidelity Secure Drive Lions": 5, "Lions": 5 } }),
    { 7: "Lions" });
  check("a club spelled one way is left alone",
    canonicalTeamNames({ 4: { Leinster: 9 } }), { 4: "Leinster" });
  check("and nothing is nothing", canonicalTeamNames(null), {});

  /* The small print. It used to reprint every scoring rule as a flat
     "GK 8 / DEF 5 / MID 5 / FWD 4" string directly under the per-position
     matrix that exists BECAUSE that string is unreadable -- and then explain
     national team bonuses to leagues with no team pick, and redrafts and
     champion calls to a league season that has neither. */
  S.league = { id: "L1", competition: { apiLeagueId: 39, season: 2025, sport: "football" },
               config: null };
  const league = scoringHtml();
  check("the rules table is not printed a second time", /<table/.test(league), false);
  check("a league season is told nothing about redrafts", /Redrafts/.test(league), false);
  check("...nor about calling a champion", /champion/i.test(league), false);
  check("...nor about stages it does not have", /R16|QF|SF/.test(league), false);
  check("but subs are explained, because it has a bench", /Subs:/.test(league), true);

  S.league.competition = { apiLeagueId: 1, season: 2026, sport: "football", kind: "cup" };
  S.league = { ...S.league };
  check("a cup IS told about redrafts", /Redrafts/.test(scoringHtml()), true);
  check("...and about the final", /The final/.test(scoringHtml()), true);
  S.league = null;
  S.players = []; S.playerById = {};

  /* The queue's window. The list is capped because forty names inside the
     draft page is a wall -- but a cap that hides a row also hides the controls
     that move it, which is what made a name starred mid-draft unreachable:
     it joins at the bottom, and the bottom was never drawn. */
  const qrows = Array.from({ length: 25 }, (_, i) => ({ pid: "p" + i, idx: i, gone: false }));
  const w = queueWindow(qrows, {});
  check("the queue shows ten by default", w.shown.length, 10);
  check("...and says how many it is not showing", w.hidden, 15);
  const w2 = queueWindow(qrows, { newIds: new Set(["p22"]) });
  check("a name starred mid-draft is pulled into view",
    w2.shown.map((r) => r.pid).includes("p22"), true);
  check("...without displacing the ten above it", w2.shown.length, 11);
  check("...marked, so it is obvious why it is there",
    w2.shown[w2.shown.length - 1].isNew, true);
  check("...and not counted as hidden", w2.hidden, 14);
  check("a new name already inside the window is not pulled twice",
    queueWindow(qrows, { newIds: new Set(["p3"]) }).shown.length, 10);
  const w3 = queueWindow(qrows, { showAll: true, newIds: new Set(["p22"]) });
  check("show-all shows all of them", w3.shown.length, 25);
  check("...with nothing left over", w3.hidden, 0);
  check("an empty queue is an empty window", queueWindow([], {}).shown, []);

  /* And the mark expires. Tinting every mid-draft star and never unmarking
     would light up the whole queue by the middle rounds, and a signal that is
     on everywhere is not a signal. A name is news until you have had a turn to
     do something about it. */
  const marks = new Map([["a", 0], ["b", 1], ["c", 2]]);
  check("before your first pick, only what was starred then is new",
    [...freshQueueIds(marks, 0)], ["a", "b", "c"]);
  check("after one pick, what was starred before it is not news any more",
    [...freshQueueIds(marks, 1)], ["b", "c"]);
  check("...and after two, nor is the next",
    [...freshQueueIds(marks, 2)], ["c"]);
  check("...until nothing is", [...freshQueueIds(marks, 3)], []);
  /* >= rather than ===, so a refetch that has not caught up -- or a pick
     rolled back -- errs towards showing the highlight rather than eating it. */
  check("a pick count that goes backwards does not swallow the mark",
    [...freshQueueIds(new Map([["a", 4]]), 2)], ["a"]);
  check("no marks, nothing fresh", [...freshQueueIds(null, 0)], []);

  /* Straight to the front: the move you want mid-draft is "him next", and the
     nudge button twenty-one times is not that move. */
  S.managers = [{ id: "m1", name: "M1", shortlist: ["a", "b", "c", "d"] }];
  S.league = { id: "L1" };
  setSession({ leagueId: "L1", managerId: "m1" });
  moveShortlistTop("c");
  check("to-top moves it to the front", myManager().shortlist, ["c", "a", "b", "d"]);
  check("...and keeps everyone else in order",
    (moveShortlistTop("c"), myManager().shortlist), ["c", "a", "b", "d"]);
  moveShortlistTop("zz");
  check("someone not on the list changes nothing",
    myManager().shortlist, ["c", "a", "b", "d"]);
  S.managers = []; S.league = null;

  /* Supabase's built-in email sender is shared by every auth email a project
     sends and is capped per project, per hour -- so it fails exactly when
     eight managers sign up in ten minutes. "email rate limit exceeded" reads
     like the app is broken and tells nobody what to do. */
  check("a capped sender is explained, not quoted",
    authErrorText({ message: "email rate limit exceeded" }).includes("Too many emails"), true);
  check("...and says whose limit it is",
    authErrorText({ message: "email rate limit exceeded" }).includes("not yours"), true);
  check("Supabase's other wording for it is caught too",
    authErrorText({ message: "For security purposes, you can only request this after 51 seconds" })
      .includes("Too many emails"), true);
  /* Everything else is the user's to read and act on, and is passed through
     unchanged: "Invalid login credentials" is not a rate limit and must not be
     dressed up as one. */
  check("a real sign-in failure is reported as itself",
    authErrorText({ message: "Invalid login credentials" }), "Invalid login credentials");
  check("and a missing message still says something",
    authErrorText(null), "Something went wrong.");

  /* Manager accents. Eight ran out in a ten-manager league, so the ninth
     manager was handed a colour somebody already had.

     The claim being checked is not "all twenty are obvious at a glance" --
     twenty colours in this gamut cannot be, and saying so would be a lie the
     tests then have to protect. It is the one that is actually true and
     actually useful: no pair among the twenty is closer than the closest pair
     the app ALREADY shipped, so adding options made nothing harder to tell
     apart. Measured in OKLab, which is perceptual; RGB distance would call
     two greens far apart and two blues identical. */
  const _lin = (v) => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  const oklab = (hex) => {
    const c = [1, 3, 5].map((i) => _lin(parseInt(hex.slice(i, i + 2), 16) / 255));
    const l = Math.cbrt(0.4122214708 * c[0] + 0.5363325363 * c[1] + 0.0514459929 * c[2]);
    const m = Math.cbrt(0.2119034982 * c[0] + 0.6806995451 * c[1] + 0.1073969566 * c[2]);
    const s2 = Math.cbrt(0.0883024619 * c[0] + 0.2817188376 * c[1] + 0.6299787005 * c[2]);
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s2,
            1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s2,
            0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s2];
  };
  const apart = (a2, b2) => {
    const x = oklab(a2), y = oklab(b2);
    return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) * 100;
  };
  check("there are enough colours for a big league", MGR_COLORS.length >= 18, true);
  check("...and none of them is listed twice",
    new Set(MGR_COLORS).size, MGR_COLORS.length);
  check("...all well formed", MGR_COLORS.every((c) => /^#[0-9a-f]{6}$/.test(c)), true);
  /* The eight originals stay, and stay first: a manager who picked one has
     that hex on their row, and dropping it would leave them on a colour the
     picker no longer offers -- no ring, and no way back to it. */
  check("the original eight are still offered, in order",
    MGR_COLORS.slice(0, 8),
    ["#3987e5", "#d95926", "#199e70", "#c98500",
     "#a855f7", "#e5646a", "#14b8a6", "#f472b6"]);
  let closestPair = Infinity;
  for (let i = 0; i < MGR_COLORS.length; i++)
    for (let j = i + 1; j < MGR_COLORS.length; j++)
      closestPair = Math.min(closestPair, apart(MGR_COLORS[i], MGR_COLORS[j]));
  check("no two are closer than the closest pair that already shipped",
    closestPair >= 7.3, true);

  /* The crest picker. Duplicates would be two identical buttons, one of which
     silently does nothing you can see. */
  check("no crest is offered twice",
    new Set([...CRESTS, ...CRESTS_MORE]).size, CRESTS.length + CRESTS_MORE.length);
  check("the picker's rows stay whole", CRESTS_MORE.length % CRESTS.length, 0);
  check("and there is a beer", CRESTS_MORE.includes("🍺"), true);

  /* A player you drafted who has left the competition entirely. He stays in
     the squad -- nothing drops a pick for you -- and he stays a permanent
     no-show, so the bench covers him. The job here is only that he must not
     look like someone who is merely out of the XI this week. */
  S.players = [{ player_id: "api_1", name: "Still Here", team: "Arsenal", position: "MID" }];
  S.playerById = { api_1: S.players[0] };
  check("someone still in the pool has not left", leftCompetition("api_1"), false);
  check("someone the pool no longer has, has", leftCompetition("api_9"), true);
  check("...and it shows on every list", availBadges("api_9").includes("LEFT"), true);
  check("...in words too, for the trade builder",
    availText("api_9").includes("left the competition"), true);
  check("a club pick is not a player who left",
    leftCompetition("team:Arsenal"), false);
  /* Before the pool loads, every pick looks missing -- and a squad of eleven
     LEFT badges is a worse lie than the one this exists to fix. */
  S.players = []; S.playerById = {};
  check("with no pool loaded, nobody has left", leftCompetition("api_9"), false);
  check("...and no badge is drawn", availBadges("api_9"), "");
  S.players = []; S.playerById = {};

  /* Which matches belong to this season. The feed accepts a season parameter
     and ignores it, so this window is the only thing keeping a URC season
     apart from the one before it -- and asking for enough matches to reach
     September (the fixture list used to start in December) drags the whole
     previous campaign in with them. */
  const urcWin = rugbySeasonWindow({ season: 2025 }, "league");
  check("a league season runs July to July",
    [new Date(urcWin.from).toISOString().slice(0, 10),
     new Date(urcWin.to).toISOString().slice(0, 10)], ["2025-07-01", "2026-07-01"]);
  check("...so September is in it", Date.parse("2025-09-20") >= urcWin.from, true);
  check("...and so is the June final", Date.parse("2026-06-20") < urcWin.to, true);
  check("...and last season's May is not", Date.parse("2025-05-20") >= urcWin.from, false);
  const cupWin = rugbySeasonWindow({ season: 2026 }, "cup");
  check("a cup season is one calendar year",
    [new Date(cupWin.from).toISOString().slice(0, 10),
     new Date(cupWin.to).toISOString().slice(0, 10)], ["2026-01-01", "2027-01-01"]);
  check("no season, no window", rugbySeasonWindow({}, "league"), null);

  /* The fallback, for a season year that does not match what the feed holds.
     An empty fixture list is worse than a slightly wrong one: no rounds, no
     trade windows, no lock times, and nothing on screen saying why. */
  const dataWin = rugbyDataWindow([{ date: "2026-06-20T17:00:00Z" },
                                   { date: "2025-09-20T17:00:00Z" }]);
  check("the data's own window ends just after its newest match",
    new Date(dataWin.to).toISOString().slice(0, 10), "2026-06-21");
  check("...and reaches back a season", Date.parse("2025-09-20") >= dataWin.from, true);
  check("nothing to anchor on, no window", rugbyDataWindow([]), null);

  /* Round order from the feed's own numbers, not from kickoff times: one
     rescheduled tie would otherwise reorder the season, and the trade window
     between two rounds is arithmetic on "consecutive" ones. */
  check("rounds order by number, not by date",
    rugbyRoundOrder([
      { round: "Round 10", kickoff_utc: "2026-01-02T17:00:00Z" },
      { round: "Round 2", kickoff_utc: "2026-01-09T17:00:00Z" },   // rescheduled
      { round: "Round 1", kickoff_utc: "2025-09-20T17:00:00Z" },
    ]), ["Round 1", "Round 2", "Round 10"]);
  check("...and play-offs follow the numbered rounds, in date order",
    rugbyRoundOrder([
      { round: "Final", kickoff_utc: "2026-06-20T17:00:00Z" },
      { round: "Semi-final", kickoff_utc: "2026-06-13T17:00:00Z" },
      { round: "Round 18", kickoff_utc: "2026-05-30T17:00:00Z" },
    ]), ["Round 18", "Semi-final", "Final"]);
  check("a fixture with no round is not a round",
    rugbyRoundOrder([{ kickoff_utc: "2026-01-01T00:00:00Z" }]), []);

  check("evidence for a guess says it is one",
    positionEvidence({ pos_starts: 0 }), "never started · bench shirt");
  check("...and for an observation, how much",
    positionEvidence({ pos_starts: 1, position: "LK" }), "1 start at LK");
  check("...counted properly", positionEvidence({ pos_starts: 9, pos_feed: "LF" }), "9 starts at LF");
  check("a pool that records none says nothing", positionEvidence({ name: "x" }), "");

  /* The CSV round trip. A club really can contain a comma, which is why this
     is not split(","). */
  check("a quoted field survives the trip",
    csvSplit('rug_1,"Bath, England",LK'), ["rug_1", "Bath, England", "LK"]);
  check("...and a doubled quote is one quote",
    csvSplit('a,"say ""hi""",b'), ["a", 'say "hi"', "b"]);

  const csvPool = [
    { player_id: "rug_1", name: "A Lock", team: "Bath, England", position: "LK", pos_starts: 6 },
    { player_id: "rug_2", name: "A Sub", team: "Ulster", position: "SH", pos_starts: 0 },
  ];
  const sheet = positionsCsv(csvPool);
  check("the sheet has a header and a row each", sheet.trim().split("\n").length, 3);
  check("...and quotes what would break it", sheet.includes('"Bath, England"'), true);
  check("...and carries the evidence column", sheet.includes("player_id,name,team,position,starts"), true);

  const round = parsePositionsCsv(sheet, csvPool, RUGBY_PLAY_GROUPS);
  check("a sheet that changes nothing changes nothing", round.fixes, {});
  check("...and reports no problems", round.errors, []);

  const edited = parsePositionsCsv(
    'player_id,position\nrug_1,LF\nrug_2,SH\n', csvPool, RUGBY_PLAY_GROUPS);
  check("an edited row becomes a fix", edited.fixes, { rug_1: "LF" });
  /* Back to the feed's own value is a DELETION, not a no-op: otherwise a
     correction could never be undone by editing the sheet. */
  check("...and a row back at the feed's value clears one", edited.cleared, ["rug_2"]);

  const messy = parsePositionsCsv(
    'name,team,position\n"A Lock","Bath, England",lf\nA Sub,Ulster,GK\nNobody,Nowhere,LK\n',
    csvPool, RUGBY_PLAY_GROUPS);
  check("a sheet with no ids matches on name and club", messy.fixes, { rug_1: "LF" });
  check("...case-insensitively", parsePositionsCsv(
    "player_id,position\nrug_1,lk\n", csvPool, RUGBY_PLAY_GROUPS).cleared, ["rug_1"]);
  check("a position from another sport is refused, with a reason",
    messy.errors[0], 'Line 3: A Sub — "GK" is not a position');
  check("...and so is a player who is not in the pool",
    messy.errors[1], "Line 4: no such player (Nobody)");
  check("a file with no position column is refused whole",
    parsePositionsCsv("player_id,name\nrug_1,x\n", csvPool, RUGBY_PLAY_GROUPS).errors.length, 1);
  check("an empty file says so",
    parsePositionsCsv("", csvPool, RUGBY_PLAY_GROUPS).errors.length, 1);
  check("a blank cell means leave it alone",
    parsePositionsCsv("player_id,position\nrug_1,\n", csvPool, RUGBY_PLAY_GROUPS).fixes, {});

  /* The editor's list: least confident first, because those are the ones
     worth a human's attention. */
  const rowsPool = [
    { player_id: "a", name: "Zed Certain", team: "Ulster", position: "LK", pos_starts: 9 },
    { player_id: "b", name: "Al Guessed", team: "Leinster", position: "SH", pos_starts: 0 },
    { player_id: "c", name: "Bo Guessed", team: "Ulster", position: "FH", pos_starts: 0 },
    { player_id: "d", name: "A Club", team: "Ulster", position: "TEAM" },
  ];
  check("guesses come first, then by name",
    positionRows(rowsPool).map((p) => p.player_id), ["b", "c", "a"]);
  check("the club pick is not a player", positionRows(rowsPool).length, 3);
  check("search reads the club too",
    positionRows(rowsPool, { q: "leinster" }).map((p) => p.player_id), ["b"]);
  check("...and the name", positionRows(rowsPool, { q: "zed" }).map((p) => p.player_id), ["a"]);
  check("unconfirmed means zero starts, not 'no number'",
    positionRows(rowsPool, { guessOnly: true }).map((p) => p.player_id), ["b", "c"]);
  check("a pool that records no starts has no unconfirmed rows",
    positionRows([{ player_id: "f", name: "Footballer", team: "X", position: "MID" }],
      { guessOnly: true }).length, 0);

  /* The overrides themselves: laid over the pool on every load, and reversible,
     which is why the feed's own value is kept beside them. */
  S.players = [{ player_id: "rug_1", name: "A Lock", team: "Ulster", position: "LF" }];
  S._poolBase = null;
  S.league = { id: "L1", config: { positions: { rug_1: "LK" } },
               competition: { apiLeagueId: 1068, season: 2025, sport: "rugby" } };
  applyPoolOverrides();
  check("a correction is applied", S.players[0].position, "LK");
  check("...and what the feed said is kept", S.players[0].pos_feed, "LF");
  check("...and the index agrees", S.playerById.rug_1.position, "LK");
  applyPoolOverrides();
  check("applying twice changes nothing more", S.players[0].pos_feed, "LF");
  S.league.config = {};
  applyPoolOverrides();
  check("and removing it puts the feed's own back", S.players[0].position, "LF");
  /* Additions and removals are one league's opinion of a shared list, held in
     that league's own config -- so one admin's upload can never reach another
     league's draft. Rebuilt from the base each time, because a removal cannot
     be undone by re-running a function over a list it is already gone from. */
  S._poolBase = null;
  S.players = [
    { player_id: "rug_1", name: "A Lock", team: "Ulster", position: "LK" },
    { player_id: "rug_2", name: "A Leaver", team: "Ulster", position: "SH" },
  ];
  S.league = { id: "L1", competition: { apiLeagueId: 1068, season: 2025, sport: "rugby" },
    config: { poolDrop: ["rug_2"],
              poolAdd: [{ player_id: "man_x", name: "A Debutant", team: "Ulster", position: "FH" }],
              poolEdit: { rug_1: { team: "Leinster" } } } };
  applyPoolOverrides();
  check("a dropped player is gone", S.players.some((p) => p.player_id === "rug_2"), false);
  check("an added one is there", S.players.some((p) => p.player_id === "man_x"), true);
  check("...and is marked as added", S.playerById.man_x.added, true);
  check("an edit is laid over the shared row", S.playerById.rug_1.team, "Leinster");
  check("...without touching the position", S.playerById.rug_1.position, "LK");
  check("the club list follows", S.teams, ["Leinster", "Ulster"]);
  applyPoolOverrides();
  check("applying twice adds nobody twice", S.players.length, 2);
  S.league.config = {};
  applyPoolOverrides();
  check("and clearing the config restores the shared pool exactly",
    S.players.map((p) => p.player_id), ["rug_1", "rug_2"]);
  check("...including the club it really is", S.playerById.rug_1.team, "Ulster");

  /* The legacy store, read as a fallback so a league that used it before the
     two were merged does not silently lose its corrections. */
  S.league.config = { positions: { rug_1: "LF" } };
  check("an older positions map is still read", poolEditsOf(), { rug_1: { position: "LF" } });
  S.league.config = { positions: { rug_1: "LF" }, poolEdit: { rug_1: { position: "CE" } } };
  check("...and the newer store wins where both exist",
    poolEditsOf().rug_1.position, "CE");

  /* The flag that matters: this is the one change that reaches backwards. */
  S.stats = [{ player_id: "rug_1", appeared: true }, { player_id: "rug_1", appeared: true },
             { player_id: "rug_1", appeared: false }, { player_id: "rug_2", appeared: true }];
  check("a player's scored matches are counted", scoredMatchCount("rug_1"), 2);
  check("...and an appearance nobody made is not one", scoredMatchCount("rug_9"), 0);
  S.stats = [];

  S._poolBase = null;
  S.players = []; S.playerById = {}; S.league = null;

  /* The pool as a sheet. Two things the feed cannot do: name a squad for a
     season nobody has played yet, and know about a player who has not yet
     appeared. Both are the same job -- hand the list over and take it back. */
  const pool = [
    { player_id: "rug_1", name: "A Lock", team: "Ulster", team_code: "ULS",
      position: "LK", pos_starts: 6 },
    { player_id: "rug_2", name: "A Leaver", team: "Ulster", team_code: "ULS",
      position: "SH", pos_starts: 2 },
  ];
  const poolSheet = poolCsv(pool);
  check("the pool sheet has a remove column",
    poolSheet.split("\n")[0], "player_id,name,team,team_code,position,starts,remove");
  check("...and round-trips with no changes",
    parsePoolCsv(poolSheet, pool, RUGBY_PLAY_GROUPS),
    { added: [], updated: [], removed: [], errors: [] });

  const changes = parsePoolCsv(
    "player_id,name,team,team_code,position,remove\n"
    + "rug_1,A Lock,Leinster,LEI,LK,\n"                    // transferred
    + "rug_2,A Leaver,Ulster,ULS,SH,x\n"                   // gone
    + ",A Debutant,Ulster,ULS,FH,\n",                      // never played
    pool, RUGBY_PLAY_GROUPS);
  check("a changed club is an update", changes.updated.map((p) => p.team), ["Leinster"]);
  check("an x in the remove column is a removal", changes.removed, ["rug_2"]);
  check("a row with no id is a new player", changes.added.map((p) => p.name), ["A Debutant"]);
  /* Derived from name and club, not random, so re-uploading the same sheet
     updates that player rather than adding a second copy of them. */
  check("...with an id that is stable across uploads",
    changes.added[0].player_id, manualPlayerId("A Debutant", "Ulster"));
  check("...and namespaced apart from the feed's own",
    changes.added[0].player_id.startsWith("man_"), true);
  check("...and a club code derived when the sheet omits one",
    parsePoolCsv("name,team,position\nA Kid,Glasgow Warriors,FH\n", pool, RUGBY_PLAY_GROUPS)
      .added[0].team_code, "GLA");

  check("a row with no club is refused, with a reason",
    parsePoolCsv("name,team,position\nA Kid,,FH\n", pool, RUGBY_PLAY_GROUPS).errors[0],
    "Line 2: needs a name and a club");
  check("...and so is a position from another sport",
    parsePoolCsv("name,team,position\nA Kid,Ulster,GK\n", pool, RUGBY_PLAY_GROUPS).errors[0],
    'Line 2: A Kid — "GK" is not a position');
  check("the same player twice is a mistake worth naming",
    parsePoolCsv("name,team,position\nA Kid,Ulster,FH\nA Kid,Ulster,LK\n", pool,
      RUGBY_PLAY_GROUPS).errors[0], "Line 3: A Kid appears twice");
  check("a sheet missing a required column is refused whole",
    parsePoolCsv("name,team\nA Kid,Ulster\n", pool, RUGBY_PLAY_GROUPS).errors.length, 1);

  const merged = mergePoolCsv(pool, changes);
  check("the merge drops the leaver", merged.some((p) => p.player_id === "rug_2"), false);
  check("...moves the transfer", merged.find((p) => p.player_id === "rug_1").team, "Leinster");
  check("...keeps their evidence", merged.find((p) => p.player_id === "rug_1").pos_starts, 6);
  check("...and adds the debutant with none", merged[merged.length - 1].pos_starts, null);
  check("the pool is the right size afterwards", merged.length, 2);
  /* An edited position IS what the pool now says, so a league override that
     matched the OLD value must stop winning -- otherwise the correction in the
     sheet is silently undone by a correction made earlier. */
  const posEdit = mergePoolCsv(pool, parsePoolCsv(
    "player_id,name,team,position\nrug_1,A Lock,Ulster,LF\n", pool, RUGBY_PLAY_GROUPS));
  check("an edited position replaces what the feed said",
    posEdit.find((p) => p.player_id === "rug_1").pos_feed, "LF");

  /* Said in the lobby, where the decision is actually taken. */
  check("an empty pool says nothing", preDraftPoolNote([]), "");
  check("a clean pool still says the pool is about to be fixed",
    preDraftPoolNote([{ player_id: "rug_1", pos_starts: 3 }]),
    "The pool is fixed when the draft starts: 1 players. Positions and pool "
    + "changes are only possible until the first pick — finalise them in the "
    + "admin panel first.");
  check("...and counts what is worth a second look",
    preDraftPoolNote([{ player_id: "rug_1", pos_starts: 0 },
                      { player_id: "man_x", pos_starts: null }])
      .includes("1 with a guessed position, 1 added by hand"), true);
  stubDoc.documentElement.dataset.theme = "";
  S.players = []; S.league = null;

  process.exit(fails ? 1 : 0);
})();
