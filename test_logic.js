// Smoke tests for the rugby draft + scoring logic in index.html.
//   node test_logic.js
// Boots the app's <script> in a stubbed DOM and exercises the pure
// functions (draft order, position quotas, scoring, sub activation, stage
// bonuses, trades, redraft phases). Scoring parity with daily_pull.py is
// the key invariant — keep SCORING in the two files identical.
const fs = require("fs");
const src = fs.readFileSync("index.html", "utf8")
  .match(/<script>\n("use strict";[\s\S]*)<\/script>/)[1];

const stubDoc = {
  getElementById: () => null,
  querySelectorAll: () => [],
  querySelector: () => null,
  addEventListener: () => {},
};
const winStub = { scrollTo: () => {} };
const _session = JSON.stringify({ leagueId: "L1", managerId: "m1" });
const lsStub = { getItem: (k) => k === "wcf_session" ? _session : null,
                 setItem: () => {}, removeItem: () => {} };
const api = new Function(
  "document", "localStorage", "window", "crypto", "navigator",
  src + "\nreturn { S, pickInfo, calcPlayerPoints, calcTeamPoints, computeScores, slotGroup, pairValid, tradeError, quotaLeft, slotForNewPick, posQuota, picksPerManager, totalPicks, playerBreakdown, playerPoints, suspendedNext, playerStatTotal, isEliminated };"
)(stubDoc, lsStub, winStub, {}, {});

const { S, pickInfo, calcPlayerPoints, calcTeamPoints, computeScores,
        slotGroup, pairValid, tradeError, quotaLeft, slotForNewPick,
        posQuota, picksPerManager, totalPicks, playerBreakdown, playerPoints,
        suspendedNext, playerStatTotal, isEliminated } = api;

let fails = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fails++; console.log(`FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${label}`);
};

/* ---------- snake draft order: 4 managers ---------- */
S.managers = [1, 2, 3, 4].map((i) => ({ id: "m" + i, name: "M" + i, draft_position: i }));
S.league = { num_managers: 4 };
check("pick 1 -> M1", pickInfo(1).manager.name, "M1");
check("pick 4 -> M4", pickInfo(4).manager.name, "M4");
check("pick 5 -> M4 (snake)", pickInfo(5).manager.name, "M4");
check("pick 8 -> M1", pickInfo(8).manager.name, "M1");
check("pick 9 -> M1 (snake back)", pickInfo(9).manager.name, "M1");

/* ---------- position quotas & default starter/sub slotting ---------- */
// Phase-1 squad: FR4 SR3 BR4 HB3 CE3 B3:4 + TEAM1 = 22 picks; XV starts.
check("quota sums to 22", Object.values(posQuota()).reduce((a, b) => a + b, 0), 22);
check("picks per manager = 22", picksPerManager(), 22);
const roster = [];
const draftOne = (pos) => {
  const slot = slotForNewPick(roster, pos);
  roster.push({ position: pos, slot });
  return slot;
};
check("FR 1-3 start", [draftOne("FR"), draftOne("FR"), draftOne("FR")], ["FR", "FR", "FR"]);
check("4th FR is sub", draftOne("FR"), "SUB_FR");
check("FR quota now 0", quotaLeft(roster, "FR"), 0);
check("1st SR is starter", draftOne("SR"), "SR");
check("3rd SR is sub (2 starters)", [draftOne("SR"), draftOne("SR")], ["SR", "SUB_SR"]);
check("TEAM slot is TEAM", draftOne("TEAM"), "TEAM");
check("B3 quota untouched", quotaLeft(roster, "B3"), 4);

/* ---------- scoring (mirrors calculate_points in daily_pull.py) ---------- */
const row = (o) => ({
  appeared: true, tries: 0, try_assists: 0, conversions: 0, penalty_goals: 0,
  drop_goals: 0, tackles: 0, missed_tackles: 0, metres: 0, defenders_beaten: 0,
  clean_breaks: 0, offloads: 0, turnovers_won: 0, turnovers_conceded: 0,
  penalties_conceded: 0, yellow_cards: 0, red_cards: 0, motm: false, ...o });

check("try + conversion", calcPlayerPoints(row({ tries: 1, conversions: 1 }), "B3"), 10 + 2);
check("kicker: 3 pens + 1 drop", calcPlayerPoints(row({ penalty_goals: 3, drop_goals: 1 }), "HB"), 9 + 3);
check("B3 metres floor per match (25 -> 2)", calcPlayerPoints(row({ metres: 25 }), "B3"), 2);
check("SR metres weighted (10 -> 5)", calcPlayerPoints(row({ metres: 10 }), "SR"), 5);
check("FR metres weighted (12 -> 3)", calcPlayerPoints(row({ metres: 12 }), "FR"), 3);
check("tackles + missed tackle", calcPlayerPoints(row({ tackles: 4, missed_tackles: 1 }), "BR"), 4 - 1);
check("turnover bonus (3 won = 15 + 2)", calcPlayerPoints(row({ turnovers_won: 3 }), "BR"), 15 + 2);
check("metres bonus (100m: 10 + 3)", calcPlayerPoints(row({ metres: 100 }), "B3"), 10 + 3);
check("tackle bonus (15 tackles: 15 + 2)", calcPlayerPoints(row({ tackles: 15 }), "BR"), 15 + 2);
check("red card", calcPlayerPoints(row({ red_cards: 1 }), "FR"), -8);
check("motm + try assist", calcPlayerPoints(row({ motm: true, try_assists: 1 }), "CE"), 5 + 4);
check("DNP scores 0", calcPlayerPoints(row({ appeared: false, tries: 3 }), "B3"), 0);

/* ---------- per-category breakdown sums to the player total ---------- */
S.stats = [
  row({ player_id: "eng_5", match_label: "England vs Fiji (2026-07-04)", tries: 1, tackles: 3, yellow_cards: 1 }),
  row({ player_id: "eng_9", match_label: "England vs Japan (2026-07-04)", metres: 25 }),
  row({ player_id: "eng_9", match_label: "England vs NZ (2026-07-11)", metres: 33 }),
];
check("breakdown sums to playerPoints (FR)",
  playerBreakdown("eng_5", "FR").reduce((s, r) => s + r.pts, 0),
  playerPoints("eng_5", "FR"));
check("FR breakdown categories", playerBreakdown("eng_5", "FR")
  .map((r) => [r.label, r.count, r.pts]),
  [["Tries", 1, 10], ["Tackles", 3, 3], ["Yellow cards", 1, -3]]);
check("metres floor per match (2 + 3, not 5.8 -> 5)",
  playerBreakdown("eng_9", "B3").find((r) => r.label === "Metres made").pts, 5);
check("season stat total counts raw metres", playerStatTotal("eng_9", "metres"), 58);

/* ---------- sub activation: covers a no-show starter, by round ---------- */
S.fixtures = []; S.snapshots = []; S.stages = [];
S.managers = [{ id: "m1", name: "M1", draft_position: 1 }];
S.league = { num_managers: 1 };
S.picks = [
  { manager_id: "m1", player_id: "fra_5", player_name: "Starter FR", position: "FR", team: "France", slot: "FR", is_sub: false, pick_number: 1 },
  { manager_id: "m1", player_id: "arg_3", player_name: "Sub FR", position: "FR", team: "Argentina", slot: "SUB_FR", is_sub: true, pick_number: 12 },
];
S.stats = [
  // Round 1 (07-04): France played (fra_9), but the starter has no row -> the sub's R1 game counts.
  row({ player_id: "fra_9", match_label: "France vs New Zealand (2026-07-04)", appeared: true }),
  row({ player_id: "arg_3", match_label: "Argentina vs Italy (2026-07-04)", appeared: true, tries: 1 }),
  // Round 2 (07-11): the starter featured -> the sub's R2 game does not count.
  row({ player_id: "fra_5", match_label: "France vs South Africa (2026-07-11)", appeared: true, tackles: 3 }),
  row({ player_id: "arg_3", match_label: "Argentina vs Wales (2026-07-11)", appeared: true, tries: 1 }),
];
const sc = computeScores()[0];
const subItem = sc.items.find((i) => i.pick.is_sub);
const startItem = sc.items.find((i) => !i.pick.is_sub);
check("starter FR tackles pts", startItem.pts, 3);
check("sub active only R1 (try 10)", [subItem.pts, subItem.note], [10, "sub"]);
check("manager total", sc.total, 13);

/* ---------- team stage bonuses (pool -> final -> winner) ---------- */
check("stage pool = 0", calcTeamPoints("pool"), 0);
check("stage final = 15", calcTeamPoints("final"), 15);
check("stage winner = 35", calcTeamPoints("winner"), 35);
check("unknown stage = 0", calcTeamPoints("nonsense"), 0);

/* ---------- TEAM pick in the leaderboard total ---------- */
S.picks.push({ manager_id: "m1", player_id: "team:France", player_name: "France",
  position: "TEAM", team: "France", slot: "TEAM", is_sub: false, pick_number: 10 });
S.stages = [{ team: "France", stage: "final" }];
const teamItem = computeScores()[0].items.find((i) => i.pick.slot === "TEAM");
check("TEAM pick final = 15", [teamItem.pts, teamItem.note], [15, "final"]);
S.stages = [];
const teamItem0 = computeScores()[0].items.find((i) => i.pick.slot === "TEAM");
check("no stage row = pool = 0", [teamItem0.pts, teamItem0.note], [0, "pool"]);

/* ---------- trades: slot position groups ---------- */
check("SUB_FR and FR same group", slotGroup("SUB_FR"), slotGroup("FR"));
check("SUB_B3 group is B3", slotGroup("SUB_B3"), "B3");
check("FR and SR differ", slotGroup("FR") === slotGroup("SR"), false);

/* ---------- trades: pair & whole-trade validity ---------- */
const pick = (id, slot) => ({ id, slot, player_name: id });
check("FR <-> SUB_FR valid", pairValid(pick("a", "FR"), pick("b", "SUB_FR")), true);
check("FR <-> SR invalid", pairValid(pick("a", "FR"), pick("b", "SR")), false);
check("TEAM never tradable", pairValid(pick("a", "TEAM"), pick("b", "TEAM")), false);
check("empty trade rejected", tradeError([]) !== null, true);
check("valid single pair", tradeError([{ mine: pick("a", "HB"), theirs: pick("b", "SUB_HB") }]), null);
check("mismatched pair rejected",
  tradeError([{ mine: pick("a", "CE"), theirs: pick("b", "B3") }]) !== null, true);
check("same pick twice rejected", tradeError([
  { mine: pick("a", "BR"), theirs: pick("b", "BR") },
  { mine: pick("a", "BR"), theirs: pick("c", "SUB_BR") },
]) !== null, true);

/* ---------- redraft phases: admin quota, kept players, eliminations ---------- */
S.league = { num_managers: 4, phase: 2,
  phase_quota: { FR: 1, SR: 1, BR: 1, HB: 1, CE: 1, B3: 1 },
  phase_starters: { FR: 1, SR: 1, BR: 1, HB: 1, CE: 1, B3: 1 } };
S.managers = [
  { id: "m1", name: "M1", draft_position: 1 },
  { id: "m2", name: "M2", draft_position: 2 },
  { id: "m3", name: "M3", draft_position: 3, eliminated: true, frozen_points: 42 },
];
S.picks = [];
check("phase 2 quota has no TEAM", posQuota().TEAM, 0);
check("picks per manager from phase quota", picksPerManager(), 6);
check("totalPicks counts active managers only", totalPicks(), 12);
check("kept player counts toward the quota",
  quotaLeft([{ position: "BR", kept: true }], "BR"), 0);
check("draft order skips eliminated managers",
  [pickInfo(1).manager.name, pickInfo(2).manager.name, pickInfo(3).manager.name],
  ["M1", "M2", "M2"]);

/* ---------- champion picks & frozen totals ---------- */
S.picks = []; S.stats = []; S.snapshots = [];
S.stages = [{ team: "France", stage: "winner" }];
S.managers = [
  { id: "m1", name: "M1", final_pick: "France" },
  { id: "m2", name: "M2", final_pick: "Ireland" },
  { id: "m3", name: "M3", eliminated: true, frozen_points: 42 },
];
const fin = computeScores();
check("correct champion pick +5", fin[0].total, 5);
check("wrong champion pick scores 0", fin[1].total, 0);
check("eliminated manager shows frozen points",
  [fin[2].total, fin[2].items.length], [42, 0]);
S.stages = [];

/* ---------- knocked-out teams & suspensions ---------- */
S.stages = [{ team: "Italy", stage: "pool", eliminated: true }];
check("eliminated team flagged", isEliminated("Italy"), true);
check("live team not flagged", isEliminated("Ireland"), false);
S.stages = [];
S.stats = [
  row({ player_id: "wal_7", match_label: "Wales vs Fiji (2026-07-04)", appeared: true, yellow_cards: 1 }),
  row({ player_id: "wal_7", match_label: "Wales vs Japan (2026-07-11)", appeared: true, red_cards: 1 }),
];
check("red card in latest game = suspended", suspendedNext("wal_7"), "red card");
S.stats = [row({ player_id: "wal_7", match_label: "Wales vs Fiji (2026-07-04)", appeared: true, yellow_cards: 1 })];
check("single yellow is not a ban (sin-bin only)", suspendedNext("wal_7"), null);

console.log(fails ? `\n${fails} check(s) FAILED` : "\nAll checks passed");
process.exit(fails ? 1 : 0);
