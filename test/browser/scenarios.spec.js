const { test, expect } = require("@playwright/test");
const { openLeague, sweepAllViews, expectCleanSweep } = require("./lib");

/* Real-league scenarios, each checked across EVERY screen.
 *
 * A bug here is usually right where you are looking and wrong somewhere else:
 * the transfer that kept appearing in rounds 4 and 5 was correct in the
 * current line-up the entire time, which is why it survived. So each scenario
 * sets up a state, asserts the specific thing, and then opens every tab,
 * sub-tab, pager round and overlay to check nothing else broke.
 */

test("a mid-season league renders every screen it offers", async ({ page }) => {
  await openLeague(page, { managers: 2, played: 3 });
  expectCleanSweep(await sweepAllViews(page));
});

test("a transfer shows on the new squad and never on the rounds before it", async ({ page }) => {
  const seed = await openLeague(page, { managers: 2, played: 3 });

  const moved = await page.evaluate(async () => {
    const me = myManager();
    const out = managerPicks(me.id).find((p) => !p.is_sub && p.position === "MID");
    /* Someone nobody owns, at a club nobody owns, and definitely not the player
       being replaced. The first version of this quietly selected the SAME
       player as both sides of the transfer, so every assertion below compared
       a thing to itself and the test proved nothing -- it only failed because
       "not in the squad" and "in the squad" cannot both hold. Assert the setup
       instead of trusting it. */
    const owned = new Set(S.picks.map((p) => p.player_id));
    const ownedClubs = new Set(S.picks.map((p) => p.team));
    const inP = S.players.find((p) => p.position === "MID"
      && !owned.has(p.player_id) && !ownedClubs.has(p.team));
    if (!inP || inP.player_id === out.player_id)
      throw new Error("could not pick a distinct incoming player for the transfer");
    // Read the outgoing id BEFORE the write, not after.
    const outId = out.player_id;
    /* Through the app's OWN swap, not a raw update to the picks table. Writing
       straight to the database skips pinHistory(), which is what records the
       squad that played the rounds already gone -- so the first version of
       this failed with "round 1 lost the player who played it", describing a
       shortcut in the test rather than a fault in the app. A scenario has to
       take the path a person takes. */
    S.league.config = { ...S.league.config, fa_defer_to_close: false };
    await doSwap(out, inP);
    await refetchAll();
    return { outId, inId: inP.player_id };
  });
  expect(moved.inId, "the transfer must move between two different players")
    .not.toBe(moved.outId);

  const view = await page.evaluate(([outId, inId]) => {
    const me = myManager();
    const h = managerHistory(me.id);
    return {
      current: managerPicks(me.id).map((p) => p.player_id),
      rounds: h.rounds.map((r) => ({
        n: r.n, ids: r.items.map((i) => i.entry.player_id),
      })),
      outId, inId,
    };
  }, [moved.outId, moved.inId]);

  // The squad you hold now is the new one...
  expect(view.current, "the transferred-in player is not in the squad").toContain(view.inId);
  expect(view.current, "the transferred-out player is still in the squad").not.toContain(view.outId);

  /* ...and every round already played still shows the player who actually
     played it. This is the assertion that was failing in the bench: rounds
     after the transfer were reverting to the pre-transfer squad. */
  expect(view.rounds.length, "no played rounds to check").toBeGreaterThan(0);
  for (const r of view.rounds) {
    expect(r.ids, `round ${r.n} lost the player who played it`).toContain(view.outId);
    expect(r.ids, `round ${r.n} was rewritten with a player signed afterwards`)
      .not.toContain(view.inId);
  }

  expectCleanSweep(await sweepAllViews(page));
});

test("a blank gameweek does not break any screen", async ({ page }) => {
  /* A club with no fixture in a round is the shape that broke round numbering
     before -- everything downstream keys off the round rather than a count of
     games, and this is what proves it stayed that way. */
  await openLeague(page, { managers: 2, played: 3, quirk: "blank" });
  const rounds = await page.evaluate(() =>
    managerHistory(myManager().id).rounds.map((r) => r.n));
  expect(rounds, "a blank week swallowed a round").toEqual([1, 2, 3]);
  expectCleanSweep(await sweepAllViews(page));
});

test("a double gameweek does not break any screen", async ({ page }) => {
  await openLeague(page, { managers: 2, played: 3, quirk: "double" });
  const rounds = await page.evaluate(() =>
    managerHistory(myManager().id).rounds.map((r) => r.n));
  expect(rounds, "a double week split into an extra round").toEqual([1, 2, 3]);
  expectCleanSweep(await sweepAllViews(page));
});

test("the leaderboard and the history pager agree on every manager", async ({ page }) => {
  await openLeague(page, { managers: 2, played: 3 });
  /* These are two code paths over the same facts, and they have disagreed
     before -- managerHistory kept its own copy of the roster rules and drifted
     once scoring started resolving by round. */
  const rows = await page.evaluate(() =>
    computeScores().map((r) => [r.manager.id, r.total, managerHistory(r.manager.id).total]));
  for (const [id, board, history] of rows)
    expect(history, `manager ${id}: leaderboard ${board} vs history ${history}`).toBe(board);
});

test("waiver claims resolve when the window shuts, and the squad changes", async ({ page }) => {
  /* The scenario this whole harness was built for: claims queued in an open
     window, the window shuts, the round settles, and the players actually
     move. It was diagnosed by hand over five rounds because every failure on
     the way was silent. */
  const seed = await openLeague(page, { managers: 2, played: 3, claims: 2 });

  const before = await page.evaluate(() => ({
    pending: S.faClaims.filter((c) => c.status === "pending").length,
    squad: managerPicks(myManager().id).map((p) => p.player_id).sort(),
  }));
  expect(before.pending, "the scenario queued no claims").toBe(2);

  const after = await page.evaluate(async () => {
    await advanceRound();              // what a refetch triggers when a window has shut
    await refetchAll();
    return {
      pending: S.faClaims.filter((c) => c.status === "pending").length,
      squad: managerPicks(myManager().id).map((p) => p.player_id).sort(),
      settled: (S.rounds || []).filter((r) => r.status === "settled").length,
    };
  });

  expect(after.settled, "no round was recorded as settled").toBeGreaterThan(0);
  expect(after.pending, "claims were left pending after the window shut").toBe(0);
  expect(after.squad, "the squad did not change, so no claim was actually awarded")
    .not.toEqual(before.squad);

  expectCleanSweep(await sweepAllViews(page));
});

test("editing the line-up does not rescore the rounds already played", async ({ page }) => {
  /* Bug row 4 of ROUNDS_DESIGN.md. An edit writes forward; the rounds behind
     it keep the squad that played them, which is what pinHistory() exists to
     guarantee when a manager has never touched their team before. */
  await openLeague(page, { managers: 2, played: 3 });

  const before = await page.evaluate(() =>
    managerHistory(myManager().id).rounds.map((r) => [r.n, r.subtotal]));

  await page.evaluate(async () => {
    const me = myManager();
    // Bench a starter and promote the sub who covers the same position.
    const starter = managerPicks(me.id).find((p) => !p.is_sub && p.position === "MID");
    const sub = managerPicks(me.id).find((p) => p.is_sub && p.position === "MID");
    await pinHistory(me.id);
    await S.sb.from("picks").update({ is_sub: true, slot: "SUB_MID" }).eq("id", starter.id);
    await S.sb.from("picks").update({ is_sub: false, slot: "MID" }).eq("id", sub.id);
    await refetchAll();
  });

  const after = await page.evaluate(() =>
    managerHistory(myManager().id).rounds.map((r) => [r.n, r.subtotal]));

  expect(after, "a line-up edit rewrote the score of a round already played")
    .toEqual(before);
  expectCleanSweep(await sweepAllViews(page));
});

test("a head-to-head league renders its fixtures and standings", async ({ page }) => {
  // h2h adds a whole tab that only exists in that mode, so it is only ever
  // exercised by a league configured for it.
  await openLeague(page, { managers: 2, played: 3, h2h: true });
  const has = await page.evaluate(() =>
    Object.values(navGroups()).flat().includes("fixtures"));
  expect(has, "a head-to-head league is not offering its fixtures tab").toBe(true);
  expectCleanSweep(await sweepAllViews(page));
});

test("a knockout competition settles its rounds and renders everywhere", async ({ page }) => {
  /* The World Cup path, which has never been driven end to end. Every round
     here is a name with no matchweek number, so round_no is null throughout --
     the case that Phase 1.5 exists for, and the one where `rounds.round_no int
     not null` made settlement impossible until the SQL harness caught it. */
  const seed = await openLeague(page, { managers: 2, played: 3, knockout: true });
  expect(seed.roundNames.some((r) => /Regular Season/.test(r)),
    "the knockout seed still produced numbered rounds").toBe(false);

  /* Clear anything settled during setup. The app loads public/fixtures.json --
     the real World Cup calendar, all of it now past -- before the scenario
     replaces S.fixtures, so a round settles on its own and assertions about
     "the recorded round" would be reading that one instead. Sabotaging the
     round key went green until this line existed. */
  const rows = await page.evaluate(async (names) => {
    window.__db.tables.rounds = []; S.rounds = [];
    await advanceRound();
    await refetchAll();
    return (S.rounds || [])
      .map((r) => ({ key: r.round_key, no: r.round_no, status: r.status }))
      // ...and only look at rounds from THIS competition's calendar.
      .filter((r) => names.includes(r.key) || r.key == null);
  }, seed.roundNames);

  expect(rows.length, "a knockout round could not be recorded at all").toBeGreaterThan(0);
  expect(rows[0].key, "the round was recorded without its label").toBeTruthy();
  expect(seed.roundNames, "the recorded key is not one of this competition's rounds")
    .toContain(rows[0].key);
  expect(rows[0].no, "a knockout round should have no matchweek number").toBeNull();
  expectCleanSweep(await sweepAllViews(page));
});
