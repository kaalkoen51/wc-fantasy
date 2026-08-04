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
