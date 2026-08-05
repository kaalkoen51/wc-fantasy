const { test, expect } = require("@playwright/test");
const { openLeague, sweepAllViews, expectCleanSweep, expectScreensAgree,
        expectLineupOnScreen } = require("./lib");

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
  await expectScreensAgree(page);
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

  /* ...and the SCREEN says so too. Everything above reads what the functions
     return; a render can drop a player while every number behind it stays
     right, and only the DOM catches that. */
  const names = await page.evaluate(([inId, outId]) => ({
    inName: S.playerById[inId]?.name, outName: S.playerById[outId]?.name,
  }), [moved.inId, moved.outId]);
  const home = await expectLineupOnScreen(page, null, [names.inName]);
  /* The player who left may still appear -- but only under "Former players
     (traded out)", where the app shows the points they banked while you had
     them. That is correct, and asserting a bare absence called it a bug. So
     assert WHERE the name appears: anywhere before that heading means they
     are still being shown as part of the squad. */
  const formerAt = home.indexOf("Former players");
  const outAt = home.indexOf(names.outName);
  if (outAt !== -1)
    expect(formerAt !== -1 && outAt > formerAt,
      `"${names.outName}" was transferred away but still appears in the squad itself`)
      .toBe(true);

  expectCleanSweep(await sweepAllViews(page));
  await expectScreensAgree(page);
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
  await expectScreensAgree(page);
});

test("a double gameweek does not break any screen", async ({ page }) => {
  await openLeague(page, { managers: 2, played: 3, quirk: "double" });
  const rounds = await page.evaluate(() =>
    managerHistory(myManager().id).rounds.map((r) => r.n));
  expect(rounds, "a double week split into an extra round").toEqual([1, 2, 3]);
  expectCleanSweep(await sweepAllViews(page));
  await expectScreensAgree(page);
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
  await expectScreensAgree(page);
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
  await expectScreensAgree(page);
});

test("a head-to-head league renders its fixtures and standings", async ({ page }) => {
  // h2h adds a whole tab that only exists in that mode, so it is only ever
  // exercised by a league configured for it.
  await openLeague(page, { managers: 2, played: 3, h2h: true });
  const has = await page.evaluate(() =>
    Object.values(navGroups()).flat().includes("fixtures"));
  expect(has, "a head-to-head league is not offering its fixtures tab").toBe(true);
  expectCleanSweep(await sweepAllViews(page));
  await expectScreensAgree(page);
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
  await expectScreensAgree(page);
});

test("a manager removed mid-season keeps a frozen score, and every screen copes", async ({ page }) => {
  /* Removal is its own scoring path: player points stop at the moment of
     removal and are banked, while a kept TEAM pick carries on earning as the
     country advances. It is rare, so it is exactly the sort of state that
     renders somewhere nobody looked. */
  await openLeague(page, { managers: 2, played: 3 });

  const before = await page.evaluate(() =>
    computeScores().map((r) => [r.manager.id, r.total]));

  const after = await page.evaluate(async ([victim]) => {
    const row = computeScores().find((r) => r.manager.id === victim);
    await S.sb.from("managers").update({
      eliminated: true, frozen_points: row.total,
      eliminated_at: new Date().toISOString(),
    }).eq("id", victim);
    await refetchAll();
    return computeScores().map((r) => [r.manager.id, r.total, !!r.eliminated]);
  }, [before[1][0]]);

  const victimNow = after.find((r) => r[0] === before[1][0]);
  expect(victimNow[2], "the removed manager is not marked eliminated").toBe(true);
  expect(victimNow[1], "a removed manager's score should be frozen at removal")
    .toBe(before[1][1]);
  // ...and the manager still playing is untouched by any of it.
  expect(after.find((r) => r[0] === before[0][0])[1]).toBe(before[0][1]);

  expectCleanSweep(await sweepAllViews(page));
});

test("a champion pick pays out at the end of the season", async ({ page }) => {
  /* The final-pick bonus only exists once a winner has been recorded, so it is
     unreachable until the very end of a season -- and therefore never seen
     until the one week it matters. */
  await openLeague(page, { managers: 2, played: 3 });

  const res = await page.evaluate(async () => {
    const me = myManager();
    const champion = S.picks[0].team;
    await S.sb.from("managers").update({ final_pick: champion }).eq("id", me.id);
    await refetchAll();
    const withoutWinner = computeScores().find((r) => r.manager.id === me.id).total;

    // Now the tournament resolves and that country wins it.
    S.stages = [{ league_id: S.league.id, team: champion, stage: "winner" }];
    bustScores();
    const withWinner = computeScores().find((r) => r.manager.id === me.id).total;
    return { withoutWinner, withWinner, bonus: finalPickBonus() };
  });

  expect(res.withWinner, "calling the champion paid nothing")
    .toBe(res.withoutWinner + res.bonus);
  expectCleanSweep(await sweepAllViews(page));
  await expectScreensAgree(page);
});

test("a draft runs to completion and every squad comes out legal", async ({ page }) => {
  /* The draft is the one part of the app that is pure sequence: snake order,
     quotas, slot assignment, the clock. It is also the part nobody re-tests,
     because doing it by hand means sitting through a whole draft. */
  await openLeague(page, { managers: 2, played: 3, predraft: true });

  const result = await page.evaluate(async () => {
    const order = [];
    let guard = 0;
    while (S.league.current_pick <= totalPicks() && guard++ < 500) {
      const info = pickInfo(S.league.current_pick);
      order.push(info.manager.id);
      await autoPick(info);              // the app's own on-the-clock path
      await refetchAll();
    }
    const byMgr = {};
    for (const m of S.managers) {
      const picks = managerPicks(m.id);
      byMgr[m.id] = {
        size: picks.length,
        dupes: picks.length - new Set(picks.map((p) => p.player_id)).size,
        counts: picks.reduce((a, p) => (a[p.position] = (a[p.position] || 0) + 1, a), {}),
      };
    }
    const ids = S.picks.map((p) => p.player_id);
    return { order, byMgr, finished: S.league.current_pick > totalPicks(),
             leagueDupes: ids.length - new Set(ids).size,
             total: totalPicks(), each: picksPerManager() };
  });

  expect(result.finished, "the draft never completed").toBe(true);
  expect(result.leagueDupes, "the same player was drafted by two managers").toBe(0);

  /* Snake order: the manager picking first in round 1 picks LAST in round 2.
     This is the rule people notice immediately when it is wrong, and it has
     no other test. */
  const each = result.each;
  const round1 = result.order.slice(0, result.order.length / each);
  const round2 = result.order.slice(round1.length, round1.length * 2);
  expect(round2, "the draft did not snake back on the second round")
    .toEqual([...round1].reverse());

  for (const [id, sq] of Object.entries(result.byMgr)) {
    expect(sq.dupes, `manager ${id} drafted the same player twice`).toBe(0);
    expect(sq.size, `manager ${id} ended with ${sq.size} players, not ${each}`).toBe(each);
    expect(sq.counts.GK, `manager ${id} drafted no goalkeeper`).toBeGreaterThan(0);
  }

  expectCleanSweep(await sweepAllViews(page));
});

test("a trade between two managers swaps the squads and leaves history alone", async ({ page }) => {
  /* Two managers, one accepted trade. The swap itself is done by a Postgres
     function that the stub MODELS rather than runs (see supabase-stub.js), so
     what this proves is that the app proposes, pins history, refreshes and
     renders correctly around it -- not that the real function is right. That
     is schema.sql's business. */
  await openLeague(page, { managers: 2, played: 3 });

  /* Compare the ROSTERS of past rounds, not their subtotals. Every player of a
     position scores identically in this seed, so swapping two midfielders
     leaves the subtotal untouched -- the first version of this asserted on
     subtotals and passed happily with the history pin removed. */
  const before = await page.evaluate(() =>
    managerHistory(myManager().id).rounds.map((r) =>
      [r.n, r.subtotal, r.items.map((i) => i.entry.player_id).sort().join(",")]));

  const moved = await page.evaluate(async () => {
    window.confirm = () => true;                 // the accept dialog
    const [me, them] = S.managers;
    const mine = managerPicks(me.id).find((p) => !p.is_sub && p.position === "MID");
    const theirs = managerPicks(them.id).find((p) => !p.is_sub && p.position === "MID");

    S.league.trading_open = true;
    S.league.config = { ...S.league.config, autoWindows: false };
    await S.sb.from("leagues").update({ trading_open: true, config: S.league.config })
      .eq("id", S.league.id);

    const t = await S.sb.from("trades").insert({
      league_id: S.league.id, proposer_manager_id: me.id,
      target_manager_id: them.id, status: "proposed",
    }).select("id");
    const tradeId = t.data[0].id;
    await S.sb.from("trade_items").insert({
      trade_id: tradeId, offered_pick_id: mine.id, requested_pick_id: theirs.id,
    });
    await refetchAll();

    const row = S.trades.find((x) => x.id === tradeId);
    await acceptTrade({ ...row, trade_items: [
      { offered_pick_id: mine.id, requested_pick_id: theirs.id }] });
    await refetchAll();
    return { mineWas: mine.player_id, theirsWas: theirs.player_id,
             mineId: mine.id, theirsId: theirs.id };
  });

  const now = await page.evaluate(([mineId, theirsId]) => ({
    mine: S.picks.find((p) => p.id === mineId)?.player_id,
    theirs: S.picks.find((p) => p.id === theirsId)?.player_id,
  }), [moved.mineId, moved.theirsId]);

  expect(now.mine, "the trade did not bring the other manager's player in")
    .toBe(moved.theirsWas);
  expect(now.theirs, "the trade did not send my player the other way")
    .toBe(moved.mineWas);

  // ...and the rounds already played are untouched by any of it.
  const after = await page.evaluate(() =>
    managerHistory(myManager().id).rounds.map((r) =>
      [r.n, r.subtotal, r.items.map((i) => i.entry.player_id).sort().join(",")]));
  expect(after, "a trade rewrote a round that had already been played").toEqual(before);

  expectCleanSweep(await sweepAllViews(page));
  await expectScreensAgree(page);
});

test("a sub who came on is shown on the pitch, not left on the bench", async ({ page }) => {
  /* A named starter never turns out, so the bench cover in that position is
     what actually scored. Before this, the only sign was a number against a
     bench player -- the round view drew the squad that was NAMED rather than
     the one that played, and there was no way to tell the two apart. */
  const seed = await openLeague(page, { managers: 2, played: 3, benchSub: true });

  const round = await page.evaluate(() => {
    const h = managerHistory(myManager().id);
    const r = h.rounds[h.rounds.length - 1];
    return { n: r.n, cameOn: r.cameOn, missed: r.missed,
             subs: managerPicks(myManager().id).filter((p) => p.is_sub).map((p) => p.player_id) };
  });

  expect(round.cameOn.length, "no sub was recorded as coming on").toBeGreaterThan(0);
  expect(round.missed, "the starter who never played was not recorded as missing")
    .toContain(seed.benchStarter);
  for (const id of round.cameOn)
    expect(round.subs, "a player marked as coming on is not actually a sub").toContain(id);

  // ...and the pitch draws them, with the marker.
  const pitch = await page.evaluate(([rn]) => {
    showView("board"); setBoardTab("lb");
    const me = myManager().id;
    const h = managerHistory(me);
    // The pager is keyed per manager, and 0 is the live view: index 1 is the
    // most recent locked round, so a round's index counts back from the end.
    S.histIdxByMgr[me] = h.rounds.length - h.rounds.findIndex((r) => r.n === rn);
    renderBoard();
    /* Scope to MY card. The Table tab draws a history pager per manager, each
       with its own pitch and dugout, so the first .pitch on the page belongs
       to whoever happens to be top of the table. */
    const el = document.getElementById("hist-lb-" + me);
    const pitchEl = el.querySelector(".pitch");
    const names = [...(pitchEl?.querySelectorAll(".pp-name") || [])].map((n) => n.textContent.trim());
    const dug = el.querySelector(".dugout");
    const bench = [...(dug?.querySelectorAll(".sub-chip") || [])].map((c) => ({
      name: c.querySelector(".sub-name")?.textContent.trim(),
      mark: c.querySelector(".sub-no")?.textContent.trim(),
      title: c.getAttribute("title") || "",
    }));
    return { names, html: pitchEl?.innerHTML || "", bench, benchText: el.textContent };
  }, [round.n]);

  const nameOf = (ids) => page.evaluate((xs) =>
    xs.map((id) => shortName(S.playerById[id]?.name || "")), ids);
  const cameOnNames = await nameOf(round.cameOn);
  const [missedName] = await nameOf([seed.benchStarter]);
  // The tooltip names them in full; the chips are shortened to fit.
  const [cameOnFull] = await page.evaluate((xs) =>
    xs.map((id) => S.playerById[id]?.name || ""), round.cameOn);

  for (const n of cameOnNames)
    expect(pitch.names, `"${n}" came on but is not on the pitch`).toContain(n);
  expect(pitch.html, "the sub who came on carries no marker").toContain("▲");
  expect(pitch.benchText, "the bench does not say a substitution happened")
    .toMatch(/1 substitution/);

  /* The other half of the swap. A ▲ on its own says someone came up without
     ever saying who for -- so the starter who did not turn out has to come
     DOWN to the bench, and be marked as such rather than numbered, since "3rd
     off the bench" is a lie about a player who was picked to start. */
  expect(pitch.names, `"${missedName}" never played but is still on the pitch`)
    .not.toContain(missedName);
  const chip = pitch.bench.find((b) => b.name === missedName);
  expect(chip, `"${missedName}" left the pitch but is not on the bench either`)
    .toBeTruthy();
  expect(chip.mark, "the dropped starter is numbered like a sub, not marked")
    .toBe("▼");
  expect(chip.title, "the bench chip does not say who replaced him")
    .toBe(`Did not play — replaced by ${cameOnFull}`);

  expectCleanSweep(await sweepAllViews(page));
  await expectScreensAgree(page);
});

/* Which round a past match belonged to, on the player's own card.
 *
 * A match log reading "vs Spain 2–1 · Starter · 90'" says everything except
 * the one thing you need to place it in the season. Both halves are checked
 * because they are different code paths: a numbered round is shortened, and a
 * knockout tie is not -- reducing "Round of 16" to a number is the exact
 * mistake mwNo() exists to refuse, and it would be a silent one here.
 */
const matchLogRounds = (page) => page.evaluate(() => {
  const pid = managerPicks(myManager().id).find((p) => !p.is_sub).player_id;
  openPlayerDetail(pid);
  const body = document.getElementById("player-sheet-body");
  return [...body.querySelectorAll(".space-y-1 > .rounded-lg")]
    .map((row) => row.textContent.replace(/\s+/g, " ").trim());
});

test("a player's match log says which round each game was", async ({ page }) => {
  await openLeague(page, { managers: 2, played: 3 });

  const rows = await matchLogRounds(page);
  expect(rows.length, "the match log drew no rows at all").toBeGreaterThan(1);
  for (const row of rows)
    expect(row, `a match log row names no round: "${row}"`).toMatch(/MW \d+/);

  /* Every row carrying the SAME round would also satisfy the loop above, and
     would mean the label was being read from somewhere that does not vary --
     the current round, say, rather than the match's own. */
  const seen = new Set(rows.map((r) => r.match(/MW \d+/)[0]));
  expect(seen.size, `every game claims the same round: ${[...seen]}`)
    .toBeGreaterThan(1);

  expectCleanSweep(await sweepAllViews(page));
});

test("...and a knockout tie is named, not numbered", async ({ page }) => {
  await openLeague(page, { managers: 2, played: 3, knockout: true });

  const rows = await matchLogRounds(page);
  expect(rows.length, "the match log drew no rows at all").toBeGreaterThan(1);
  for (const row of rows) {
    expect(row, `a knockout row names no round: "${row}"`)
      .toMatch(/Round of 16|Quarter-finals|Semi-finals|Final/);
    expect(row, `"Round of 16" was reduced to a matchweek: "${row}"`)
      .not.toMatch(/MW \d+/);
  }

  expectCleanSweep(await sweepAllViews(page));
});

test("a round nobody could be subbed into still draws a full XI", async ({ page }) => {
  /* The state a real knockout round produces, and the one that broke: most of
     a squad's clubs are out, so eight of the eleven named never turn out and a
     bench of four cannot cover them. Treating every no-show as substituted
     emptied the pitch -- two players on the field, fourteen on the bench,
     "10 did not play". A line-up you could not field is not a record of one.

     So a starter leaves the field only when somebody actually came ON for
     them; the rest stay out there on nil. The pitch is always the shape that
     was named. */
  await openLeague(page, { managers: 2, played: 3, missingStarters: 8 });

  const view = await page.evaluate(() => {
    const me = myManager().id;
    const h = managerHistory(me);
    const r = h.rounds[h.rounds.length - 1];
    S.histIdxByMgr[me] = 1;
    showView("board"); setBoardTab("lb"); renderBoard();
    // My card, not whoever is top of the table — see above.
    const el = document.getElementById("hist-lb-" + me);
    return {
      named: managerPicks(me).filter((p) => !p.is_sub && p.position !== "TEAM").length,
      missed: r.missed.length, cameOn: r.cameOn.length, swaps: r.swaps.length,
      onPitch: el.querySelectorAll(".pitch .pp-name").length,
      benchDown: [...el.querySelectorAll(".dugout .sub-no")]
        .filter((n) => n.textContent.trim() === "▼").length,
      // Still on the field, but visibly not part of the result.
      dimmed: el.querySelectorAll(".pitch .pp.opacity-50").length,
    };
  });

  expect(view.missed, "the scenario produced no absentees at all").toBeGreaterThan(4);
  expect(view.missed, "every named starter would have to be replaced")
    .toBeGreaterThan(view.cameOn);
  expect(view.onPitch, "the pitch is not the eleven that were named")
    .toBe(view.named);
  /* Exactly as many came down as went up. This is the assertion that fails on
     the old behaviour, where every absentee dropped to the bench. */
  expect(view.benchDown, "the bench shows more replaced starters than substitutions")
    .toBe(view.swaps);
  /* The ones nobody could come on for are still out there, and they have to
     LOOK it -- eight players drawn identically to the three who actually
     played would be a line-up that lies about the round. */
  expect(view.dimmed, "the starters who never played are drawn as if they had")
    .toBe(view.missed - view.swaps);

  expectCleanSweep(await sweepAllViews(page));
  await expectScreensAgree(page);
});

test("the head-to-head card reports the same match the standings do", async ({ page }) => {
  /* One fixture, two screens, and they disagreed. The card added up the
     STARTERS: a sub who came on scored for the log and not for the card, and
     a team bonus counted for neither. It also drew the squad that was named,
     so the substitution the round view now shows was invisible on the one
     screen whose entire job is "what happened in this match".

     benchSub makes a named starter miss, so there is a substitution to find. */
  const seed = await openLeague(page,
    { managers: 2, played: 3, h2h: true, benchSub: true });

  const view = await page.evaluate(() => {
    const me = myManager().id;
    const other = S.managers.find((m) => m.id !== me).id;
    const h = managerHistory(me);
    const rnd = h.rounds[h.rounds.length - 1].n;
    const round = h.rounds.find((r) => r.n === rnd);
    openH2HFixture(rnd, me, other);
    const body = document.getElementById("recap-body");
    // The bottom half of the facing pitch is the manager the card was opened
    // "for"; both halves are read, and the score line carries both numbers.
    return {
      rnd,
      subtotal: round.subtotal,
      swaps: round.swaps.length,
      score: body.querySelector(".scoreboard")?.textContent.trim() || "",
      pitchUp: body.querySelectorAll(".pitch .pp").length,
      badges: body.innerHTML.split("▲").length - 1,
      benchDown: [...body.querySelectorAll(".dugout .sub-no")]
        .filter((n) => n.textContent.trim() === "▼").length,
    };
  });

  expect(view.swaps, "the scenario produced no substitution to show")
    .toBeGreaterThan(0);
  /* The card's score for me is the round's own subtotal — the number the
     standings, the leaderboard and the history pager all use. */
  expect(view.score.split("–")[0].trim(), "the card scores the match differently from the log")
    .toBe(String(view.subtotal));
  expect(view.badges, "the substitute is not marked as having come on")
    .toBeGreaterThanOrEqual(view.swaps);
  expect(view.benchDown, "the replaced starter is not shown as replaced")
    .toBe(view.swaps);

  expectCleanSweep(await sweepAllViews(page));
});

test("the two ways of picking a player to bring in behave the same", async ({ page }) => {
  /* There were two screens answering one question — who do I bring in — and
     they disagreed about what a useful list is. The squad planner sorted by any
     stat, filtered to your shortlist and opened on it; the free-agent sheet had
     neither, so it listed whoever came first: a wall of 0p squad players in
     club order with no way to reorder them. Reported from the app. */
  await openLeague(page, { managers: 4, played: 3 });

  const setup = await page.evaluate(() => {
    const me = myManager();
    const owned = new Set(S.picks.map((p) => p.player_id));
    const free = S.players.filter((p) => p.position === "MID" && !owned.has(p.player_id));
    me.shortlist = free.slice(0, 3).map((p) => p.player_id);
    /* Give the free agents DIFFERENT scores. Without this every one of them is
       on zero, any order counts as sorted, and the ordering assertion below
       passes with the sort removed — which is exactly what happened the first
       time this was written. */
    const label = S.stats[0]?.match_label;
    const extra = free.slice(0, 8).map((p, i) => ({
      league_id: S.league.id, player_id: p.player_id, match_label: label,
      appeared: true, minutes: 90, goals: i % 4, assists: 0, clean_sheet: false,
      yellow_cards: 0, red_cards: 0, saves: 0, motm: false,
      penalty_saved: 0, penalty_missed: 0, team: p.team,
    }));
    S.stats = [...S.stats, ...extra];     // new array identity busts the memo
    bustScores();
    return { starred: me.shortlist, freeMids: free.length,
             spread: new Set(free.slice(0, 8)
               .map((p) => playerPoints(p.player_id, p.position))).size };
  });
  expect(setup.freeMids, "no free midfielders to choose between").toBeGreaterThan(5);
  expect(setup.spread, "the free agents all score the same, so order proves nothing")
    .toBeGreaterThan(1);

  const controls = (prefix) => page.evaluate((pre) => {
    const ids = ["search", "sort", "slfilter", "pos"];
    return ids.map((k) => !!document.getElementById(`${pre}-${k}`));
  }, prefix);

  // Both offer the same controls.
  expect(await controls("swap"), "the free-agent sheet is missing controls")
    .toEqual([true, true, true, true]);
  expect(await controls("planner"), "the planner is missing controls")
    .toEqual([true, true, true, true]);

  const open = await page.evaluate(() => {
    showView("board"); setBoardTab("home");
    openSwap(managerPicks(myManager().id).find((p) => !p.is_sub && p.position === "MID"));
    const rows = [...document.querySelectorAll("#swap-list [data-swapin]")];
    return { onShortlist: S.swapShortlistOnly, rows: rows.length,
             sortValue: document.getElementById("swap-sort").value };
  });
  /* It opens on your shortlist when you have starred a free agent in this
     position — the difference between landing on the players you were watching
     and landing on an alphabet of nobodies. */
  expect(open.onShortlist, "the sheet did not open on the shortlist").toBe(true);
  expect(open.rows, "the shortlist filter showed nothing").toBe(3);
  expect(open.sortValue, "the sheet did not default to sorting by points").toBe("points");

  // Turning the filter off widens it, and the list comes back sorted.
  const all = await page.evaluate(() => {
    document.getElementById("swap-slfilter").click();
    const val = (li) => Number(li.querySelector(".font-mono")?.textContent || 0);
    const items = [...document.querySelectorAll("#swap-list li")].filter((li) => li.querySelector("[data-swapin]"));
    return { n: items.length, vals: items.map(val) };
  });
  expect(all.n, "turning off the shortlist filter did not widen the list").toBeGreaterThan(3);
  const sorted = [...all.vals].sort((a, b) => b - a);
  expect(all.vals, "the free-agent list is not sorted by the chosen stat").toEqual(sorted);

  // And a star can be set from here, like everywhere else that lists players.
  const starred = await page.evaluate(() => {
    const before = myShortlist().length;
    document.querySelector("#swap-list [data-star]")?.click();
    return { before, after: myShortlist().length };
  });
  expect(starred.after, "rows carry no working shortlist star").not.toBe(starred.before);
});
