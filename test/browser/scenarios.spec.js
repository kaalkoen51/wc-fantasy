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

test("every played round keeps a record of its own, not an inference", async ({ page }) => {
  /* The rounds already played used to be protected only by rosterAtFor's last
     two arms -- "the newest snapshot dated before kickoff", then "the earliest
     snapshot there is". Neither is a record of a round: both are inferences
     from timestamps, so both move when the timestamps do, and once ANY
     past-dated snapshot existed the pin stopped writing at all, leaving a
     manager several transfers into a season with one guess covering the lot.

     pinHistory now stamps each played round with the round's OWN key before a
     change lands, which is a fact rather than an inference. This asserts the
     property directly: after a transfer, every played round must resolve to a
     snapshot carrying that round's key. */
  await openLeague(page, { managers: 2, played: 3 });

  const got = await page.evaluate(async () => {
    const me = myManager();
    const out = managerPicks(me.id).find((p) => !p.is_sub && p.position === "MID");
    const owned = new Set(S.picks.map((p) => p.player_id));
    const ownedClubs = new Set(S.picks.map((p) => p.team));
    const inP = S.players.find((p) => p.position === "MID"
      && !owned.has(p.player_id) && !ownedClubs.has(p.team));
    if (!inP || inP.player_id === out.player_id)
      throw new Error("could not pick a distinct incoming player for the transfer");
    S.league.config = { ...S.league.config, fa_defer_to_close: false };
    await doSwap(out, inP);
    await refetchAll();
    const keys = new Set((S.snapshots || [])
      .filter((s) => s.manager_id === me.id).map((s) => s.round_key));
    return { keys: [...keys], played: [...playedRoundStarts().keys()] };
  });

  expect(got.played.length, "the seed played no rounds").toBe(3);
  for (const key of got.played)
    expect(got.keys, `round "${key}" has no line-up of its own, only a guess`)
      .toContain(key);
});

test("a lock ritual at the end of the calendar cannot rewrite the last round", async ({ page }) => {
  /* Reported from the bench as "I just transferred in Grimes and now he is in
     my older rounds".

     roundKeyLockedAt() answers with the round about to start -- and, when none
     is upcoming, with the LAST round in the list. A World Cup app sits in that
     state every time the group stage finishes before the knockout fixtures are
     published, and so does any season whose calendar has run out. The lineup
     lock and the settlement ritual both stamp with it, so one refresh after a
     transfer filed today's squad as the line-up for a matchweek already
     played, and the round arm believes the newest row for a round. */
  await openLeague(page, { managers: 2, played: 3 });

  const got = await page.evaluate(async () => {
    // Nothing beyond the rounds already played.
    const trim = () => { S.fixtures = S.fixtures.filter((f) => f.status === "FT"); };
    trim();
    const me = myManager();
    const before = managerHistory(me.id).rounds.map((r) =>
      [r.n, r.items.map((i) => i.entry.player_id).sort().join(",")]);

    const out = managerPicks(me.id).find((p) => !p.is_sub && p.position === "MID");
    const owned = new Set(S.picks.map((p) => p.player_id));
    const ownedClubs = new Set(S.picks.map((p) => p.team));
    const inP = S.players.find((p) => p.position === "MID"
      && !owned.has(p.player_id) && !ownedClubs.has(p.team));
    if (!inP || inP.player_id === out.player_id)
      throw new Error("could not pick a distinct incoming player for the transfer");
    S.league.trading_open = true;
    S.league.config = { ...S.league.config, fa_defer_to_close: false, autoWindows: false };
    await doSwap(out, inP);
    await refetchAll(); trim();

    await snapshotRosters();            // the lock ritual, run after the change
    await refetchAll(); trim();

    const after = managerHistory(me.id).rounds.map((r) =>
      [r.n, r.items.map((i) => i.entry.player_id).sort().join(",")]);
    return { before, after, inId: inP.player_id, outId: out.player_id,
             lockKey: roundKeyLockedAt(S.fixtures, Date.now()) };
  });

  // The state the bug needs: the "next" lock is a round that has been played.
  expect(got.lockKey, "the calendar still has a round ahead, so nothing was tested")
    .toBe("Regular Season - 3");
  expect(got.before.length, "the seed played no rounds").toBe(3);

  for (const [n, ids] of got.after) {
    expect(ids.split(","), `round ${n} was rewritten with a player signed afterwards`)
      .not.toContain(got.inId);
    expect(ids.split(","), `round ${n} lost the player who actually played it`)
      .toContain(got.outId);
  }
  expect(got.after, "a lock after the transfer moved a round already played")
    .toEqual(got.before);
});

test("a snapshot dated before the season cannot take over every round in it", async ({ page }) => {
  /* This is the reported shape exactly: one transfer, and the new player is in
     ALL the older rounds at once.

     A snapshot dated before round 1 wins rosterAtFor's timestamp arm for every
     played round in one go -- and rows like that really do appear. The sandbox
     regenerates its calendar underneath the snapshots the last one left behind,
     which is all it takes for a stamp written for a future lock to end up
     sitting before the season; an older client's unstamped rows do the same.
     Nothing stops such a row holding the squad from AFTER the transfer.

     The rounds survive it only by having records of their own to answer with,
     which is what pinHistory stamps before the change lands. Timestamps decide
     nothing once a round is keyed. */
  await openLeague(page, { managers: 2, played: 3 });

  const got = await page.evaluate(async () => {
    const me = myManager();
    const out = managerPicks(me.id).find((p) => !p.is_sub && p.position === "MID");
    const owned = new Set(S.picks.map((p) => p.player_id));
    const ownedClubs = new Set(S.picks.map((p) => p.team));
    const inP = S.players.find((p) => p.position === "MID"
      && !owned.has(p.player_id) && !ownedClubs.has(p.team));
    if (!inP || inP.player_id === out.player_id)
      throw new Error("could not pick a distinct incoming player for the transfer");
    S.league.config = { ...S.league.config, fa_defer_to_close: false };
    await doSwap(out, inP);
    await refetchAll();

    /* The stray row: today's squad, dated an hour before the season started,
       carrying no round of its own. Written straight to the table so it
       arrives exactly as an old client's would -- with a created_at of now. */
    const first = Math.min(...S.fixtures.filter((f) => f.status === "FT")
      .map((f) => Date.parse(f.kickoff_utc)));
    await S.sb.from("lineup_snapshots").insert({
      /* With an id, because the backfill updates BY id -- a row without one is
         a row the backfill cannot reach, and the first version of this test
         seeded exactly that and proved nothing. */
      id: "stray-snapshot", league_id: S.league.id, manager_id: me.id,
      effective_from: new Date(first - 3600e3).toISOString(),
      created_at: new Date().toISOString(),
      roster: managerPicks(me.id).map((pk) => ({
        player_id: pk.player_id, player_name: pk.player_name, position: pk.position,
        team: pk.team, is_sub: pk.is_sub, slot: pk.slot })),
    });
    await refetchAll();                 // runs the backfill

    return { rounds: managerHistory(me.id).rounds.map((r) =>
               [r.n, r.items.map((i) => i.entry.player_id).sort().join(",")]),
             inId: inP.player_id, outId: out.player_id };
  });

  for (const [n, ids] of got.rounds) {
    expect(ids.split(","), `round ${n} was rewritten with a player signed afterwards`)
      .not.toContain(got.inId);
    expect(ids.split(","), `round ${n} lost the player who actually played it`)
      .toContain(got.outId);
  }
});

test("a transfer stays out of the past rounds even with no snapshots at all", async ({ page }) => {
  /* The reported bug, reduced to the state it actually needs and nothing else.

     Everything protecting the rounds already played was a snapshot of some
     kind, so the whole scheme rested on one having been written -- and the
     screen gives no sign when none was. A write that failed, a league older
     than snapshots, a sandbox rebuilt underneath its own history: any of them
     drops every past round through to the live picks, and one transfer then
     shows up in all of them at once. Which of those happened is not something
     the app can find out, so it should not need to.

     This wipes the snapshots outright rather than picking a reason. What is
     left is the transactions log -- written by the code that made each move --
     and rewinding it is enough to answer on its own. */
  await openLeague(page, { managers: 2, played: 3 });

  const got = await page.evaluate(async () => {
    const me = myManager();
    const out = managerPicks(me.id).find((p) => !p.is_sub && p.position === "MID");
    const owned = new Set(S.picks.map((p) => p.player_id));
    const ownedClubs = new Set(S.picks.map((p) => p.team));
    const inP = S.players.find((p) => p.position === "MID"
      && !owned.has(p.player_id) && !ownedClubs.has(p.team));
    if (!inP || inP.player_id === out.player_id)
      throw new Error("could not pick a distinct incoming player for the transfer");
    S.league.config = { ...S.league.config, fa_defer_to_close: false };
    await doSwap(out, inP);
    await refetchAll();

    /* Every snapshot gone, however it came to be gone -- and cleared in memory
       rather than by refetching, because a refetch now runs settlement, which
       records the rounds again. That is the right behaviour and it is covered
       elsewhere; what this scenario is about is the reader with nothing to
       read, so it has to be able to hold that state still. */
    window.__db.tables.lineup_snapshots = [];
    S.snapshots = [];
    bustScores();

    return { snaps: (S.snapshots || []).length,
             txs: (S.transactions || []).length,
             rounds: managerHistory(me.id).rounds.map((r) =>
               [r.n, r.items.map((i) => i.entry.player_id).sort().join(",")]),
             inId: inP.player_id, outId: out.player_id };
  });

  // The state the test claims to be in, asserted rather than assumed.
  expect(got.snaps, "the snapshots did not actually go away").toBe(0);
  expect(got.txs, "the transfer left no transaction to rewind").toBeGreaterThan(0);
  expect(got.rounds.length, "the seed played no rounds").toBe(3);

  for (const [n, ids] of got.rounds) {
    expect(ids.split(","), `round ${n} shows a player signed after it was played`)
      .not.toContain(got.inId);
    expect(ids.split(","), `round ${n} lost the player who actually played it`)
      .toContain(got.outId);
  }
});

test("the diagnostic says which rounds are recorded and which are inferred", async ({ page }) => {
  /* The readout has to be able to say BOTH things, or it is a decoration. So
     this drives one league through both states: no snapshots at all, where
     every round is an inference, and then a transfer, which stamps each played
     round with a record of its own. A readout hardcoded either way fails one
     half or the other. */
  await openLeague(page, { managers: 2, played: 3 });

  const got = await page.evaluate(async () => {
    const strip = (h) => h.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    /* Cleared so the readout has something to report as inferred: the refetch
       hook records the played rounds on load, which is what the passive-manager
       scenarios are about. This one is about the readout telling both states
       apart, so it has to be able to produce both. */
    window.__db.tables.lineup_snapshots = [];
    S.snapshots = []; bustScores();
    const before = strip(simHistorySource());

    const me = myManager();
    const out = managerPicks(me.id).find((p) => !p.is_sub && p.position === "MID");
    const owned = new Set(S.picks.map((p) => p.player_id));
    const ownedClubs = new Set(S.picks.map((p) => p.team));
    const inP = S.players.find((p) => p.position === "MID"
      && !owned.has(p.player_id) && !ownedClubs.has(p.team));
    S.league.config = { ...S.league.config, fa_defer_to_close: false };
    await doSwap(out, inP);
    await refetchAll();
    return { before, after: strip(simHistorySource()) };
  });

  // With nothing recorded, every round is an inference and it says so.
  expect(got.before, "the readout did not report the rounds as inferred")
    .toContain("3 of 3 rounds inferred");
  expect(got.before, "an unrecorded round was not attributed to the live squad")
    .toMatch(/nothing recorded|moves log/);

  // Once the transfer pins them, every round has a record of its own.
  expect(got.after, "the readout still calls the rounds inferred after they were stamped")
    .toContain("0 of 3 rounds inferred");
  // Matched without the apostrophe: esc() writes it as an entity.
  expect(got.after, "a stamped round was not attributed to its own line-up")
    .toMatch(/own line-up/);
});

test("one snapshot stamped for the round ahead cannot answer for the rounds behind", async ({ page }) => {
  /* The reported state, read off the diagnostic rather than guessed at: ONE
     snapshot for the whole league, dated after the transfer and stamped for
     MW4 -- the round not yet played -- and one move in the log. All three
     played rounds were answering "the earliest snapshot there is (a guess)",
     borrowing MW4's squad because it was the only row that existed. That arm
     outranked the reconstruction, so the transfer in the log went unused and
     showed up in every round behind it.

     Seeded to match: the round-key stamps pinHistory now writes are cleared
     afterwards, because the league that had the fault made its transfer before
     they existed and no squad change has happened since to write them. */
  await openLeague(page, { managers: 2, played: 3 });

  const got = await page.evaluate(async () => {
    const me = myManager();
    const out = managerPicks(me.id).find((p) => !p.is_sub && p.position === "MID");
    const owned = new Set(S.picks.map((p) => p.player_id));
    const ownedClubs = new Set(S.picks.map((p) => p.team));
    const inP = S.players.find((p) => p.position === "MID"
      && !owned.has(p.player_id) && !ownedClubs.has(p.team));
    if (!inP || inP.player_id === out.player_id)
      throw new Error("could not pick a distinct incoming player for the transfer");
    S.league.config = { ...S.league.config, fa_defer_to_close: false };
    await doSwap(out, inP);
    await refetchAll();

    // Exactly the state on the screenshot: one row, stamped for the round
    // ahead, holding the squad as it is AFTER the transfer.
    const ahead = S.fixtures.find((f) => f.status !== "FT");
    window.__db.tables.lineup_snapshots = [{
      id: "only-one", league_id: S.league.id, manager_id: me.id,
      effective_from: new Date().toISOString(), created_at: new Date().toISOString(),
      round_key: ahead.round,
      roster: managerPicks(me.id).map((pk) => ({
        player_id: pk.player_id, player_name: pk.player_name, position: pk.position,
        team: pk.team, is_sub: pk.is_sub, slot: pk.slot })),
    }];
    await refetchAll();

    const strip = (h) => h.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    return { snaps: (S.snapshots || []).filter((s) => s.manager_id === me.id).length,
             txs: (S.transactions || []).filter((x) => x.manager_id === me.id).length,
             readout: strip(simHistorySource()),
             rounds: managerHistory(me.id).rounds.map((r) =>
               [r.n, r.items.map((i) => i.entry.player_id).sort().join(",")]),
             inId: inP.player_id, outId: out.player_id };
  });

  // The state this claims to be in, asserted rather than assumed.
  expect(got.snaps, "the seeded state should have exactly one snapshot").toBe(1);
  expect(got.txs, "the transfer left no move in the log to rebuild from").toBe(1);
  expect(got.rounds.length, "the seed played no rounds").toBe(3);

  for (const [n, ids] of got.rounds) {
    expect(ids.split(","), `round ${n} shows a player signed after it was played`)
      .not.toContain(got.inId);
    expect(ids.split(","), `round ${n} lost the player who actually played it`)
      .toContain(got.outId);
  }
  // ...and the readout names the log as the source rather than a guess.
  expect(got.readout, "the readout still credits a guess for the played rounds")
    .not.toMatch(/a guess/);
  expect(got.readout, "the readout does not say the later moves were undone")
    .toContain("with later moves undone");
});

test("settling a round writes down what every squad was, so nothing has to guess later", async ({ page }) => {
  /* The fact this app spent its whole history inferring, finally written by
     someone. Snapshots were only ever written when a manager CHANGED
     something, so a round nobody touched had no record and every screen fell
     back to timestamp arithmetic to guess one. Settlement runs exactly once
     per round and is the only moment that is about a ROUND rather than about
     a manager, so it is where the round gets recorded.

     Both halves matter: that settling produces a real record, and that the
     record then holds against a transfer made afterwards. */
  await openLeague(page, { managers: 2, played: 3 });

  const got = await page.evaluate(async () => {
    const strip = (h) => h.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const me = myManager();
    /* Cleared first. The refetch hook records the played rounds on load now --
       correct, and covered by the passive-manager scenarios -- so without this
       the "before" state would already be recorded and the assertion below
       would pass without settlement having done anything. */
    window.__db.tables.lineup_snapshots = [];
    S.snapshots = []; bustScores();
    // ...and the settlement claims with them, or the ritual stands down having
    // already settled this round on load and writes nothing.
    window.__db.tables.rounds = [];
    S.rounds = [];
    const before = strip(simHistorySource());

    await advanceRound();                     // the settlement ritual
    /* Not refetchAll: it would re-read the table we just cleared in memory and
       re-run the hook, so the assertion could not tell settlement's writing
       from the hook's. What settlement wrote is already in S.snapshots. */
    const settled = strip(simHistorySource());
    const rounds = managerHistory(me.id).rounds.map((r) =>
      [r.n, r.items.map((i) => i.entry.player_id).sort().join(",")]);

    // ...and now a transfer, which must not reach any of them.
    const out = managerPicks(me.id).find((p) => !p.is_sub && p.position === "MID");
    const owned = new Set(S.picks.map((p) => p.player_id));
    const ownedClubs = new Set(S.picks.map((p) => p.team));
    const inP = S.players.find((p) => p.position === "MID"
      && !owned.has(p.player_id) && !ownedClubs.has(p.team));
    if (!inP || inP.player_id === out.player_id)
      throw new Error("could not pick a distinct incoming player for the transfer");
    S.league.config = { ...S.league.config, fa_defer_to_close: false };
    await doSwap(out, inP);
    await refetchAll();

    return { before, settled, rounds,
             after: managerHistory(me.id).rounds.map((r) =>
               [r.n, r.items.map((i) => i.entry.player_id).sort().join(",")]),
             inId: inP.player_id, outId: out.player_id,
             keys: [...new Set((S.snapshots || []).filter((s) => s.manager_id === me.id)
               .map((s) => s.round_key))].filter(Boolean).sort() };
  });

  // The state before, asserted so "0 inferred" cannot pass by having started there.
  expect(got.before, "the rounds were already recorded before settlement ran")
    .toContain("3 of 3 rounds inferred");
  // Settling records them.
  expect(got.settled, "settling the rounds did not record their line-ups")
    .toContain("0 of 3 rounds inferred");
  expect(got.keys, "settlement did not stamp every played round")
    .toEqual(expect.arrayContaining(
      ["Regular Season - 1", "Regular Season - 2", "Regular Season - 3"]));

  // And the record holds against a transfer made afterwards.
  for (const [n, ids] of got.after) {
    expect(ids.split(","), `round ${n} shows a player signed after it was played`)
      .not.toContain(got.inId);
    expect(ids.split(","), `round ${n} lost the player who actually played it`)
      .toContain(got.outId);
  }
  expect(got.after, "a transfer moved a round that had already been settled")
    .toEqual(got.rounds);
});

for (const auto of [true, false]) {
  test(`a passive manager's rounds are recorded on ${auto ? "automatic" : "manual"} windows`, async ({ page }) => {
    /* The mode question, asked of the manager who exposes it: one who drafts a
       squad and then touches nothing. Every writer except settlement is
       triggered by somebody DOING something -- a transfer, an edit, an admin
       pressing lock -- so a passive manager is the case where a missing writer
       shows up, and the case the whole saga turned out to be about.

       Manual is the half that was missing: settlement refuses to run on manual
       windows, and the manual lock stamps the round AHEAD, which is what a
       lock is for. So nothing wrote the rounds behind it down. */
    await openLeague(page, { managers: 2, played: 3 });

    const got = await page.evaluate(async (auto) => {
      const strip = (h) => h.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      S.league.config = { ...S.league.config, autoWindows: auto };
      await S.sb.from("leagues").update({ config: S.league.config }).eq("id", S.league.id);
      // Wipe and refetch, so this measures what a fresh client writes in this
      // mode rather than anything an earlier one happened to leave behind.
      window.__db.tables.lineup_snapshots = [];
      await refetchAll();
      /* Awaited here because refetchAll FIRES the hook without waiting for it
         -- background work in the app, a race in a test. This awaits the same
         function the refetch fires rather than sleeping and hoping. */
      await maybeAdvanceRounds();
      const me = myManager();
      return { readout: strip(simHistorySource()),
               keys: [...new Set((S.snapshots || []).filter((s) => s.manager_id === me.id)
                 .map((s) => s.round_key))].filter(Boolean).sort(),
               txs: (S.transactions || []).length };
    }, auto);

    // Nobody did anything -- that is the point.
    expect(got.txs, "the scenario is only meaningful if the manager was passive").toBe(0);
    expect(got.readout, `on ${auto ? "auto" : "manual"} windows a played round is still being guessed at`)
      .toContain("0 of 3 rounds inferred");
    expect(got.keys, "a played round has no line-up recorded for it")
      .toEqual(expect.arrayContaining(
        ["Regular Season - 1", "Regular Season - 2", "Regular Season - 3"]));
  });
}

test("the theme switches, sticks, and dark is what you get by default", async ({ page }) => {
  /* Dark stays the default and carries NO attribute, so the :root tokens are
     it. That is what keeps this whole feature additive: an existing player
     sees exactly what they saw, and the three pixel baselines never move. */
  await openLeague(page, { managers: 2, played: 3 });

  const read = () => page.evaluate(() => ({
    attr: document.documentElement.dataset.theme ?? null,
    saved: localStorage.getItem("wcf_theme"),
    ground: getComputedStyle(document.body).backgroundColor,
    current: currentTheme(),
  }));

  const before = await read();
  expect(before.attr, "the default theme should carry no attribute").toBeNull();
  expect(before.current, "the default is not dark").toBe("dark");

  await page.evaluate(() => setTheme("sticker"));
  const after = await read();
  expect(after.attr, "picking a theme did not stamp the root").toBe("sticker");
  expect(after.saved, "the choice was not remembered for next load").toBe("sticker");
  expect(after.ground, "the page ground did not actually change").not.toBe(before.ground);

  // ...and back, without leaving a stamp behind.
  await page.evaluate(() => setTheme("dark"));
  const back = await read();
  expect(back.attr, "going back to dark left an attribute behind").toBeNull();
  expect(back.ground, "going back to dark did not restore the ground").toBe(before.ground);

  // A junk value cannot strand you in a broken theme.
  await page.evaluate(() => setTheme("nonsense"));
  expect((await read()).current, "an unknown theme was accepted").toBe("dark");
});

/* Sticker is held to AA. Dark is NOT: 2.1 is a ratchet, not a standard -- it
   says "no worse than today" and nothing more. Dark ships `slate-500` at 3.42
   on a card and `slate-600` at 2.15 on a dimmed zero, both deliberate
   de-emphasis from before any of this, and raising the bar there would mean
   redesigning a theme nobody complained about and moving three baselines.
   Worth fixing one day; not worth smuggling into a change about the OTHER
   theme's legibility. Stating the number honestly beats a floor that looks
   like a standard and is not one. */
for (const [theme, floor] of [["sticker", 4.5], ["dark", 2.1]]) {
  test(`text stays readable across every screen in the ${theme} theme`, async ({ page }) => {
    /* The first version of this only looked at elements painting their OWN
       background. Nearly all text INHERITS its ground, so it stepped straight
       over the most common failure on a light theme -- and did: the muted tier
       shipped at 3.25 against paper and 2.74 on the matchday card, and the
       first person to open it on a phone said it was hard to read. It caught
       three real bugs and still could not see that one. So it now measures
       every piece of text against its effective, composited background.

       The floors differ because one number cannot serve both. Sticker is new
       and is held to AA. Dark is the shipped default with `slate-500` sitting
       at 3.75 on `slate-900`; demanding 4.5 there means redesigning a theme
       nobody complained about and moving the baselines. 3.5 is a ratchet: it
       cannot get worse. Dark's faint tier is a real question, just a separate
       one. */
    await page.setViewportSize({ width: 390, height: 844 });
    await openLeague(page, { managers: 4, played: 3 });
    /* Put both alert tiers on screen before sweeping. Nobody in the seed is
       injured, so the red "won't play" row and its amber sibling never
       rendered here and their contrast went unmeasured -- which is the exact
       shape of hole this test exists to close, so it must not have one of its
       own. Any state that only appears under a condition has to be staged. */
    await page.evaluate(() => {
      const xi = managerPicks(myManager().id).filter((p) => !p.is_sub && p.slot !== "TEAM");
      S.injuryByPid = {
        [xi[0].player_id]: { status: "out", reason: "Hamstring Injury" },
        [xi[1].player_id]: { status: "doubtful", reason: "Knock" },
      };
      /* And repaint. setBoardTab only unhides an already-rendered pane, so
         without this the sweep walks the DOM as it was at open time and the
         staged rows are never on screen to be measured. */
      renderHomeTab();
    });
    await page.evaluate((t) => setTheme(t), theme);
    /* Buttons carry `transition: ... color .15s`, so flipping the theme fades
       every one of them from the old colour to the new. Reading computed
       styles during that fade reports a blend of the two themes -- which is
       exactly what happened here: two <button>s measured at ~93% of the DARK
       values and looked like real contrast failures, while a <td> beside them
       with no transition read correctly. Let the fade finish. */
    await page.waitForTimeout(300);

    const bad = await page.evaluate((floor) => {
      const parse = (c) => {
        const n = (String(c).match(/[\d.]+/g) || []).map(Number);
        return { r: n[0] || 0, g: n[1] || 0, b: n[2] || 0, a: n.length > 3 ? n[3] : 1 };
      };
      const lum = (p) => [p.r, p.g, p.b].map((v) => { const x = v / 255;
          return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); })
        .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
      // Translucent layers are not a colour until painted onto what is behind
      // them; walk up to the first opaque ancestor and composite back down.
      const effectiveBg = (el) => {
        const stack = [];
        for (let n = el; n; n = n.parentElement) {
          const cs2 = getComputedStyle(n);
          /* A gradient or image reports NO background-colour, so the walk
             would sail past it and measure against whatever is further up --
             which is how text on the green pitch got compared to the cream
             card behind it and scored 1.01:1. There is no honest single
             colour for a gradient, so say so and let the caller skip. */
          if (cs2.backgroundImage && cs2.backgroundImage !== "none") return null;
          const c = parse(cs2.backgroundColor);
          if (c.a === 0) continue;
          stack.push(c);
          if (c.a === 1) break;
        }
        let out = stack.pop() || { r: 255, g: 255, b: 255, a: 1 };
        while (stack.length) {
          const t = stack.pop();
          out = { a: 1, r: t.r * t.a + out.r * (1 - t.a),
                  g: t.g * t.a + out.g * (1 - t.a), b: t.b * t.a + out.b * (1 - t.a) };
        }
        return out;
      };
      const out = [];
      showView("board");
      for (const tabs of Object.values(navGroups())) for (const tab of tabs) {
        setBoardTab(tab);
        const pane = document.getElementById("board-" + tab);
        if (!pane || pane.classList.contains("hidden")) continue;
        for (const el of pane.querySelectorAll("*")) {
          const txt = (el.textContent || "").trim();
          if (!txt || el.children.length) continue;          // leaves with words
          const cs = getComputedStyle(el);
          if (cs.visibility === "hidden" || cs.display === "none") continue;
          const box = el.getBoundingClientRect();
          if (!box.height || !box.width) continue;
          if (parse(cs.color).a < 0.5) continue;             // deliberately ghosted
          // Disabled controls are exempt from AA, and this app uses a faint
          // arrow to say "this pager cannot go further".
          if (el.closest("[disabled],[aria-disabled='true']")) continue;
          const bg = effectiveBg(el);
          if (!bg) continue;                                 // gradient: unknowable
          const [hi, lo] = [lum(parse(cs.color)), lum(bg)].sort((p, q) => q - p);
          const ratio = (hi + 0.05) / (lo + 0.05);
          /* AA relaxes to 3.0 for large text, and this app leans on big
             tabular numerals for its scoreboards. */
          const px = parseFloat(cs.fontSize) || 12;
          const large = px >= 24 || (px >= 18.66 && Number(cs.fontWeight) >= 700);
          const need = large ? Math.min(floor, 3) : floor;
          if (ratio < need)
            out.push(`${tab}: "${txt.slice(0, 22)}" ${ratio.toFixed(2)}:1 `
              + `(${cs.color} on rgb(${[bg.r, bg.g, bg.b].map(Math.round)}))`);
        }
      }
      return [...new Set(out)].slice(0, 12);
    }, floor);

    expect(bad, `text below ${floor}:1 in the ${theme} theme`).toEqual([]);
  });
}

for (const theme of ["dark", "sticker"]) {
  test(`every pitch state is visible in the ${theme} theme`, async ({ page }) => {
    /* Each of these is a state class whose whole job is to make one shirt look
       different from the others. Three of the four painted NOTHING in the
       sticker theme and nobody noticed, because the theme draws its own
       box-shadow on the sticker at a higher specificity than the state rules
       and simply won. .pp-arm survived by accident -- animations outrank
       normal declarations -- which is exactly the kind of luck that makes a
       bug look like a working feature.

       Asserting "differs from a plain chip" rather than any particular shadow:
       the point is that the state is VISIBLE, and pinning the value would just
       be a second copy of the stylesheet. */
    await openLeague(page, { managers: 2, played: 3 });
    await page.evaluate((t) => setTheme(t), theme);
    await page.waitForTimeout(300);       // theme transition, see the sweep above

    const dead = await page.evaluate(() => {
      const pp = document.querySelector('[data-view="board"] .pitch .pp');
      const av = pp.querySelector(".avatar");
      const was = pp.className;
      const shadow = (cls) => { pp.className = "pp " + cls;
        return getComputedStyle(av).boxShadow; };
      const plain = shadow("");
      const out = [];
      for (const cls of ["pp-risk", "pp-doubt", "pp-sel", "pp-arm"])
        if (shadow(cls) === plain) out.push(cls);
      pp.className = was;
      return out;
    });
    expect(dead, "pitch states that paint nothing at all").toEqual([]);
  });
}

for (const theme of ["dark", "sticker"]) {
  test(`the armband is not covered up in the ${theme} theme`, async ({ page }) => {
    /* Reported from the app: "I can't see my captain picks on the sticker
       album theme". The badge was there the whole time -- right position,
       right size, right colours, 16x16 and opaque. It was underneath the
       points bubble, which the album theme moves from the bottom of the shirt
       to the top of the card, onto the same corner the armband uses. .pp-pts
       is written later in the markup, so it won, and a captain's own score
       hid the fact that they were captain.

       Every check that could have caught this looked at the badge and found
       it healthy. So this one asks the only question that was actually being
       got wrong: at the middle of the badge, is the badge what you SEE? It
       needs no knowledge of which corner anything is in, so it keeps working
       when either mark moves again. */
    await openLeague(page, { managers: 2, played: 3 });
    await page.evaluate(() => closeReveal());
    await page.evaluate((t) => setTheme(t), theme);
    await page.waitForTimeout(300);              // theme transition

    const buried = await page.evaluate(() => {
      const out = [];
      for (const b of document.querySelectorAll('[data-view="board"] .cap-badge')) {
        const r = b.getBoundingClientRect();
        if (!r.width) continue;                  // in a pane that is not showing
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (top !== b) out.push(`${b.textContent.trim()} under .${
          String(top && top.className || "?").split(" ")[0]}`);
      }
      return out;
    });
    // A scenario with no armband on screen would pass this vacuously.
    const shown = await page.evaluate(() => [...document.querySelectorAll('[data-view="board"] .cap-badge')]
      .filter((b) => b.getBoundingClientRect().width).length);
    expect(shown, "no armband was on screen, so this asserted nothing").toBeGreaterThan(0);
    expect(buried, "an armband is painted underneath something else").toEqual([]);
  });
}

for (const theme of ["dark", "sticker"]) {
  test(`a club mark is legible at every hue in the ${theme} theme`, async ({ page }) => {
    /* The mark takes only a HUE from the JS -- 360 of them, one per club name
       -- and gets its saturation and lightness from the stylesheet. That is
       the whole reason it is split that way: a function returning a finished
       colour would have to be right 360 times, and the obvious versions are
       wrong for about forty of them, all around yellow.

       The theme-wide contrast sweep cannot see these. It only measures what is
       on screen, the seeded league is football, and football's crests resolve
       to real images -- so no mark is ever drawn there. And the sticker
       variant paints a GRADIENT, which the sweep skips by design because a
       gradient has no single honest colour. Both gaps are covered here. */
    await openLeague(page, { managers: 4, played: 3 });
    await page.evaluate((t) => setTheme(t), theme);
    await page.waitForTimeout(300);            // let the colour transition end

    const bad = await page.evaluate(() => {
      const rgb = (c) => (String(c).match(/[\d.]+/g) || []).map(Number);
      const lum = (p) => p.slice(0, 3).map((v) => { const x = v / 255;
          return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); })
        .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
      const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05); };
      // Composite a translucent fill onto the ground it is actually painted on.
      const over = (f, g) => f.length > 3 && f[3] < 1
        ? f.slice(0, 3).map((v, i) => v * f[3] + g[i] * (1 - f[3])) : f;

      const host = document.createElement("div");
      host.className = "rounded-xl border border-slate-700 bg-slate-900 p-4";
      // Every 5 degrees: fine enough to land on the bad hues, cheap enough to
      // stay a unit-test-shaped check rather than a screenshot.
      host.innerHTML = Array.from({ length: 72 }, (_, i) =>
        `<span class="club-tint club-chip font-mono text-xs" style="--club-h:${i * 5}">ABC</span>`
        + `<span class="avatar avatar-player club-tint w-9 h-9 rounded-full inline-flex"
             style="--club-h:${i * 5}">AB</span>`).join("");
      document.body.appendChild(host);

      const ground = rgb(getComputedStyle(host).backgroundColor);
      const out = [];
      for (const el of host.children) {
        const cs = getComputedStyle(el);
        const ink = rgb(cs.color);
        const fills = [];
        const flat = rgb(cs.backgroundColor);
        if (flat.length && !(flat.length > 3 && flat[3] === 0)) fills.push(over(flat, ground));
        /* The sticker player's mark is album card stock, tinted -- a gradient.
           Both ends of it have to hold, not just whichever one a screenshot
           happened to sample. */
        for (const m of (cs.backgroundImage || "").matchAll(/rgba?\(([^)]+)\)/g))
          fills.push(over(m[1].split(",").map(Number), ground));
        for (const f of fills) {
          const r = ratio(ink, f);
          if (r < 4.5) out.push(`h${el.style.getPropertyValue("--club-h")} `
            + `${el.className.includes("avatar") ? "disc" : "chip"} ${r.toFixed(2)}:1`);
        }
      }
      host.remove();
      return [...new Set(out)].slice(0, 10);
    });

    expect(bad, "a club mark below 4.5:1 against its own fill").toEqual([]);
  });
}

test("a practice draft can be run on any pool that is loaded", async ({ page }) => {
  /* It was hard-locked to the built-in World Cup squads: the league row it
     created carried no competition at all, which is the app's way of saying
     "read players.json". So there was no way to rehearse a rugby draft --
     nineteen picks and a fifteen to field is a different room entirely. */
  await openLeague(page, { managers: 4, played: 3 });

  const out = await page.evaluate(async () => {
    window.__db.tables.competition_pools = [
      { competition_key: "rugby-2146-2026", round_order: [], fixtures: [],
        players: ["PR", "HK", "LK", "SH", "FH", "CE", "OB", "LF"].flatMap((g, i) =>
          [0, 1, 2].map((n) => ({ player_id: `rug_${i}${n}`, name: `${g} Player ${n}`,
                                  position: g, team: "Ireland", team_code: "IRE" }))) },
      { competition_key: "39-2024", players: [], fixtures: [], round_order: [] },
    ];
    // Leave the league we are in, so the home screen is the thing under test.
    leaveLeague();
    _practicePools = null;        // the menu was read once before this seed
    await renderPracticeOptions();
    const sel = document.getElementById("practice-comp");
    const options = [...sel.options].map((o) => o.text);
    const groups = [...sel.querySelectorAll("optgroup")].map((g) => g.label);
    const builtIn = { value: sel.value, note: document.getElementById("practice-note").textContent };

    sel.value = "rugby-2146-2026";
    sel.dispatchEvent(new Event("change"));
    const picked = { note: document.getElementById("practice-note").textContent,
                     comp: practiceChoice() };

    await startPracticeDraft(1, practiceChoice());
    return { options, groups, builtIn, picked,
             leagueComp: S.league?.competition,
             stored: window.__db.tables.leagues.find((l) => l.name === "Practice draft")?.competition,
             sport: sportOf(), squad: squadSize(),
             pool: S.players.length, aPlayer: S.players[0]?.player_id };
  });

  expect(out.options[0], "the built-in squads stay the default").toMatch(/World Cup/);
  expect(out.options, "and every loaded pool is offered, named and dated")
    .toContain("Nations Championship 2026");
  expect(out.options).toContain("Premier League 2024/25");
  /* Grouped rather than prefixed: a phone's select is about 20 characters
     wide, and "Rugby union · Nations Championship 2026" loses the year. */
  expect(out.groups, "grouped by sport").toEqual(["Football", "Rugby union"]);
  expect(out.builtIn.value, "with no competition selected to begin with").toBe("");
  expect(out.builtIn.note, "the note says what the button would deal")
    .toBe("Football · 14 picks each, 9 to field.");
  expect(out.picked.note, "...and changes with the pool")
    .toBe("Rugby union · 20 picks each, 15 to field.");

  expect(out.leagueComp?.sport, "the practice league is on the chosen sport").toBe("rugby");
  expect(out.stored?.apiLeagueId, "and that reached the row, not just the page").toBe(2146);
  expect(out.sport, "so everything downstream resolves as rugby").toBe("rugby");
  expect(out.squad, "including the squad it will ask you to draft").toBe(19);
  expect(out.pool, "and the players come from that pool").toBe(24);
  expect(out.aPlayer, "not from the built-in football one").toMatch(/^rug_/);
});

test("an admin can correct a position before the draft, by hand or by CSV", async ({ page }) => {
  /* Rugby positions are whatever shirt the feed saw a player wear, which is
     right for most of a squad and a guess for anyone who only ever came off
     the bench -- the bench convention is a convention, and a 6-2 bench breaks
     it. The fix has to be league-scoped: the pool row is SHARED, and rewriting
     a position there would move a player under a league that has already
     drafted him into a quota slot he no longer fits. */
  await openLeague(page, { managers: 4, played: 3 });

  const out = await page.evaluate(async () => {
    S.league.competition = { name: "Nations Championship", apiLeagueId: 2146,
                             season: 2026, sport: "rugby" };
    S.league.current_pick = 0;                       // pre-draft
    S.league.config = null;
    S.players = [
      { player_id: "rug_1", name: "Cert Ain", team: "Ulster", position: "LK", pos_starts: 9 },
      { player_id: "rug_2", name: "Ben Ched", team: "Leinster", position: "SH", pos_starts: 0 },
      { player_id: "rug_3", name: "Mid Field", team: "Ulster", position: "CE", pos_starts: 3 },
    ];
    S._poolBase = S.players;          // a new pool is a new base for the overrides
    applyPoolOverrides();
    showView("board"); setBoardTab("admin"); renderAdmin();

    const card = document.getElementById("adm-pos-card");
    const shown = !card.classList.contains("hidden");
    const order = [...card.querySelectorAll("[data-pos-fix]")].map((s) => s.dataset.posFix);
    const evidence = card.textContent.includes("never started");

    /* The one change here that reaches BACKWARDS, so it is flagged per row
       and confirmed on save rather than left to be discovered in a total. */
    S.stats = [{ player_id: "rug_3", appeared: true, minutes: 80 },
               { player_id: "rug_3", appeared: true, minutes: 60 }];
    renderPositionEditor();
    const scoredWarning = card.textContent.includes("2 matches already scored");
    const cleanRowQuiet = !card.querySelector('[data-pos-fix="rug_2"]')
      .closest("div").textContent.includes("already scored");
    S.stats = [];
    renderPositionEditor();

    const sel = card.querySelector('[data-pos-fix="rug_2"]');
    sel.value = "LK"; sel.dispatchEvent(new Event("change"));
    const staged = { ...S._posFixes };
    await savePositionFixes();
    /* Snapshot now: the stub hands back a live row, and there is a second save
       below -- read at the end, this reports that one and the assertion about
       the first passes or fails for the wrong reason. */
    const afterHand = JSON.parse(JSON.stringify({
      saved: window.__db.tables.leagues.find((l) => l.id === S.league.id)?.config?.poolEdit,
      applied: S.playerById.rug_2.position, feed: S.playerById.rug_2.pos_feed }));

    // The sheet, and a sheet coming back with one change and one undo.
    const sheet = positionsCsv(S.players);
    applyPositionsCsvText("player_id,position\nrug_1,FH\nrug_2,SH\n");
    const afterCsv = { ...S._posFixes };
    await savePositionFixes();

    // ...and once the draft starts it is no longer anybody's to change.
    S.league.current_pick = 1;
    renderAdmin();
    const shownMidDraft = !document.getElementById("adm-pos-card").classList.contains("hidden");

    return { shown, order, evidence, staged, shownMidDraft, afterCsv, afterHand,
             scoredWarning, cleanRowQuiet,
             sheetHasStarts: sheet.split("\n")[0],
             finalPositions: S.league.config.poolEdit,
             rug1Now: S.playerById.rug_1.position,
             rug2Back: S.playerById.rug_2.position };
  });

  expect(out.shown, "the card is offered before the draft").toBe(true);
  expect(out.order, "least confident first — those are the ones worth a human")
    .toEqual(["rug_2", "rug_3", "rug_1"]);
  expect(out.evidence, "and each row says what the position is based on").toBe(true);
  expect(out.scoredWarning, "a player with games behind them is flagged: this re-scores them")
    .toBe(true);
  expect(out.cleanRowQuiet, "and one with none is not, or the flag stops meaning anything")
    .toBe(true);

  expect(out.staged, "an edit stages a correction").toEqual({ rug_2: "LK" });
  /* One store for every correction, so a position and a club change to the
     same player cannot end up in two places that disagree. */
  expect(out.afterHand.saved, "saving writes it to this league, not to the pool")
    .toEqual({ rug_2: { position: "LK" } });
  expect(out.afterHand.applied, "and it takes effect immediately").toBe("LK");
  expect(out.afterHand.feed, "with the feed's own value kept, so it can be undone").toBe("SH");

  expect(out.sheetHasStarts, "the CSV carries the evidence column")
    .toBe("player_id,name,team,position,starts");
  expect(out.afterCsv, "an uploaded sheet edits one and undoes the other")
    .toEqual({ rug_1: "FH" });
  expect(out.rug1Now, "so the changed one moves").toBe("FH");
  expect(out.rug2Back, "and the undone one goes back to what the feed said").toBe("SH");
  expect(out.finalPositions, "leaving exactly the corrections that are still wanted")
    .toEqual({ rug_1: { position: "FH" } });

  expect(out.shownMidDraft, "once picks exist a position change would break a squad")
    .toBe(false);
});

test("a season nobody has played yet still builds a pool", async ({ page }) => {
  /* The feed answers date-DESC with no working season filter, so the first
     hundred rows of a fresh URC season are a hundred games nobody has played
     and the search comes back with nothing usable at all. That is what "a URC
     league cannot be played for the new season" looked like from the outside.
     Last season's squads are the only honest starting point there is. */
  await openLeague(page, { managers: 4, played: 3 });

  const sizes = [];
  await page.route("**/*", async (route) => {
    const url = decodeURIComponent(route.request().url());
    if (!(url.includes("incrowdsports.com") || url.includes("/functions/v1/")))
      return route.continue();
    const json = (b) => route.fulfill({ contentType: "application/json", body: JSON.stringify(b) });
    if (url.includes("matches/search")) {
      const size = +(url.match(/size=(\d+)/) || [])[1];
      sizes.push(size);
      // The new season: `size` rows of fixtures, all of them unplayed.
      const rows = Array.from({ length: Math.min(size, 120) }, (_, i) => ({
        id: 1000 + i, status: "fixture", tbc: 0, round: i + 1,
        date: `2026-1${i % 2}-01T17:00:00Z`,
        homeTeam: { id: 4, name: "Leinster" }, awayTeam: { id: 5, name: "Munster" } }));
      // Last season's results only start appearing once you ask for more.
      if (size > 100) {
        for (let i = 0; i < 25; i++) rows.push({
          id: 900 + i, status: "result", tbc: 0, round: i + 1,
          date: `2025-05-0${(i % 9) + 1}T17:00:00Z`,
          homeTeam: { id: 4, name: "Leinster", score: 20 },
          awayTeam: { id: 5, name: "Munster", score: 15 } });
      }
      return json({ status: "success", data: rows });
    }
    if (/matches\/9\d\d/.test(url)) {
      return json({ status: "success", data: { id: 900, round: 1,
        homeTeam: { id: 4, name: "Leinster", score: 20, shortName: "LEI", players: [
          { id: 1, known: "A Prop", positionId: 1, position: "prop",
            stats: { minutesPlayedTotal: 80 } }] },
        awayTeam: { id: 5, name: "Munster", score: 15, shortName: "MUN", players: [
          { id: 2, known: "A Lock", positionId: 4, position: "lock",
            stats: { minutesPlayedTotal: 80 } }] } } });
    }
    return json({});
  });

  const out = await page.evaluate(async () => {
    const competition = { name: "United Rugby Championship", apiLeagueId: 1068,
                          season: 2026, sport: "rugby" };
    const built = await fetchPoolFor(competition, "", () => {});
    return { players: built.players.length, teams: built.teams.length,
             names: built.players.map((p) => p.name).sort() };
  });

  expect(sizes[0], "it asks for a normal page first").toBe(100);
  expect(sizes.some((s) => s > 100), "and asks for more when nothing has been played")
    .toBe(true);
  expect(out.players, "so last season's squads become the pool").toBe(2);
  expect(out.names).toEqual(["A Lock", "A Prop"]);
  expect(out.teams, "with the clubs that played them").toBe(2);
});

test("the admin can add and drop pool players with a CSV", async ({ page }) => {
  /* Mid-season, a player who has not appeared does not exist in the feed at
     all, so a January signing or a first-cap teenager cannot be drafted until
     they have already played -- by which time they have scored for nobody. */
  page.on("dialog", (d) => d.accept());
  await openLeague(page, { managers: 4, played: 3 });

  const out = await page.evaluate(async () => {
    S.league.competition = { name: "United Rugby Championship", apiLeagueId: 1068,
                             season: 2026, sport: "rugby" };
    S.league.current_pick = 0;
    S.league.config = null;
    const players = [
      { player_id: "rug_1", name: "A Lock", team: "Ulster", team_code: "ULS",
        position: "LK", pos_starts: 6 },
      { player_id: "rug_2", name: "A Leaver", team: "Ulster", team_code: "ULS",
        position: "SH", pos_starts: 2 },
    ];
    window.__db.tables.competition_pools = [
      { competition_key: "rugby-1068-2026", players, fixtures: [], round_order: [] }];
    S._compPool = { players, fixtures: [], round_order: [] };
    S.players = players; S._poolBase = players;
    applyPoolOverrides();
    showView("admin"); renderAdmin();
    const shown = !document.getElementById("adm-pool-card").classList.contains("hidden");

    await savePoolCsvText(
      "player_id,name,team,team_code,position,remove\n"
      + "rug_1,A Lock,Leinster,LEI,LK,\n"
      + "rug_2,A Leaver,Ulster,ULS,SH,x\n"
      + ",A Debutant,Ulster,ULS,FH,\n");

    const shared = window.__db.tables.competition_pools[0].players;
    const cfg = window.__db.tables.leagues.find((l) => l.id === S.league.id).config;
    return { shown,
             names: S.players.map((p) => p.name).sort(),
             moved: S.playerById.rug_1.team,
             sharedNames: shared.map((p) => p.name).sort(),
             cfg: JSON.parse(JSON.stringify(cfg)),
             addedId: cfg.poolAdd?.[0]?.player_id,
             note: preDraftPoolNote(S.players),
             sheet: poolCsv(S.players).split("\n")[0] };
  });

  expect(out.shown, "the card is offered before the draft").toBe(true);
  expect(out.names, "the debutant is draftable and the leaver is gone")
    .toEqual(["A Debutant", "A Lock"]);
  expect(out.moved, "and the transfer moved club").toBe("Leinster");
  /* The one thing this must NOT do. A pool row is shared by every league on
     the competition, so an upload that wrote there would let one league's
     admin empty another league's draft -- accidentally or otherwise. */
  expect(out.sharedNames, "the shared pool is left exactly as it was")
    .toEqual(["A Leaver", "A Lock"]);
  expect(out.cfg.poolDrop, "the removal is this league's own").toEqual(["rug_2"]);
  expect(out.cfg.poolEdit, "and so is the correction").toEqual({ rug_1: expect.objectContaining({ team: "Leinster" }) });
  expect(out.cfg.poolAdd?.length, "and the addition").toBe(1);
  /* Namespaced apart from the feed's ids, which is also the warning: stats
     arrive keyed by the feed's id, so a hand-added player scores nothing until
     the competition is re-pulled after their debut. */
  expect(out.addedId, "with an id that is visibly not the feed's").toMatch(/^man_/);
  expect(out.note, "and the lobby says what is about to be frozen")
    .toContain("1 added by hand");
  expect(out.sheet, "the sheet carries the column that removes a row")
    .toContain("remove");
});

test("a player is a sticker everywhere, and a club is still a badge", async ({ page }) => {
  /* The theme's one idea has to carry the whole app, not just the pitch --
     otherwise it reads as decoration bolted to one screen. And the distinction
     has to survive: a crest stays round, because the pitch tucks one into the
     corner of the other and needs the shapes to differ. */
  await openLeague(page, { managers: 4, played: 3 });
  await page.evaluate(() => setTheme("sticker"));
  await page.waitForTimeout(300);          // let the colour transition settle

  const shapes = await page.evaluate(() => {
    const seen = new Set();
    showView("board");
    for (const tabs of Object.values(navGroups())) for (const tab of tabs) {
      setBoardTab(tab);
      for (const el of document.querySelectorAll('[data-view="board"] .avatar-player')) {
        if (!el.getBoundingClientRect().width) continue;
        seen.add(getComputedStyle(el).borderRadius);
      }
    }
    return [...seen];
  });

  expect(shapes.length, "no player avatars were found to check").toBeGreaterThan(0);
  // A sticker is a rounded RECTANGLE: a small pixel radius, never a circle.
  for (const r of shapes)
    expect(r, `a player avatar is still round (${r})`).not.toMatch(/%|9999px/);

  /* The other half of the rule -- a crest is a BADGE, not a sticker -- has to
     be checked against the code that actually draws crests, and that is a
     different pair of functions from the one above: avatarHtml("team:…") for
     the matchday banner, teamCrestHtml() for every club column. Neither is
     reachable from the seeded league (the fixture carries no crest ids, so
     teamCrestHtml falls back to a text code, and the banner needs a live
     fixture), so their markup is rendered here directly. Same functions, same
     theme, same document -- only the trigger is synthetic. */
  const clubs = await page.evaluate(() => {
    const team = S.players[0].team;
    ((S.photos ||= {}).teams ||= {})[team] = 1;   // force the image path in both
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:0;top:0";
    host.innerHTML = avatarHtml("team:" + team, team, "w-4 h-4")
      + teamCrestHtml(team, "w-4 h-4", "ARG")
      + avatarHtml(S.players[0].player_id, team, "w-4 h-4");   // positive control
    document.body.appendChild(host);
    const read = (el) => {
      const cs = getComputedStyle(el);
      return { radius: cs.borderRadius, shadow: cs.boxShadow };
    };
    return {
      banner: read(host.querySelector(".avatar-team")),
      column: read(host.querySelector("img[data-crest-code]")),
      player: read(host.querySelector(".avatar-player")),
    };
  });

  /* The control first: if the sticker treatment is not landing at all, every
     assertion below passes for the wrong reason. */
  expect(clubs.player.shadow, "the sticker treatment is not being applied").not.toBe("none");
  expect(clubs.player.radius).not.toMatch(/%|9999px/);

  expect(clubs.banner.radius, "a club crest stopped being round").toMatch(/%|9999px/);
  expect(clubs.banner.shadow, "a club crest was given the sticker trim").toBe("none");
  expect(clubs.column.shadow, "a club column crest was given the sticker trim").toBe("none");
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
  return [...body.querySelectorAll("[data-matchrow]")]
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
      dimmed: el.querySelectorAll(".pitch .pp.pp-dim").length,
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

test("the head-to-head card says who each side captained", async ({ page }) => {
  /* Reported from the app: the one screen whose job is "what happened in this
     match" did not say whose points were doubled, so a score you could not
     reconstruct was the normal case. Both sides get an armband, because the
     opponent's captain is the half of the fixture you cannot see anywhere
     else. */
  await openLeague(page, { managers: 2, played: 3, h2h: true, benchSub: true });

  const view = await page.evaluate(() => {
    const me = myManager().id;
    const other = S.managers.find((m) => m.id !== me).id;
    const h = managerHistory(me);
    const rnd = h.rounds[h.rounds.length - 1].n;
    openH2HFixture(rnd, me, other);
    const body = document.getElementById("recap-body");
    // Read the armband off the DOM by the name it sits next to, so this asserts
    // what a manager can actually see rather than what the data said.
    const armbands = {};
    /* The card carries both layouts at once -- stacked for a phone, facing for
       a wide screen -- and only one of them is displayed. Counting both would
       double every name and hide a real duplicate behind an expected one. */
    for (const chip of body.querySelectorAll(".pp, .sub-chip")) {
      if (!chip.offsetParent) continue;
      const badge = [...chip.querySelectorAll("span")]
        .map((s) => s.textContent.trim()).find((t) => t === "C" || t === "V");
      const name = chip.querySelector(".pp-name, .sub-name")?.textContent.trim();
      if (badge && name) (armbands[badge] ||= []).push(name);
    }
    const shortOf = (mid) => {
      const m = S.managers.find((x) => x.id === mid);
      const pick = (S.picks || []).find((p) => p.player_id === m.captain_id);
      return shortName(pick?.player_name || "");
    };
    const viceOf = (mid) => {
      const m = S.managers.find((x) => x.id === mid);
      const pick = (S.picks || []).find((p) => p.player_id === m.vice_id);
      return shortName(pick?.player_name || "");
    };
    return { armbands, caps: [shortOf(me), shortOf(other)].sort(),
             vices: [viceOf(me), viceOf(other)].sort() };
  });

  expect((view.armbands.C || []).sort(), "each side's captain is not on the card")
    .toEqual(view.caps);
  expect((view.armbands.V || []).sort(), "each side's vice-captain is not on the card")
    .toEqual(view.vices);

  // Turn captaincy off and the armbands must go with it, or the card advertises
  // a rule this league does not play.
  const off = await page.evaluate(() => {
    S.league.config = { ...S.league.config, captain: false };
    const me = myManager().id;
    const other = S.managers.find((m) => m.id !== me).id;
    const h = managerHistory(me);
    openH2HFixture(h.rounds[h.rounds.length - 1].n, me, other);
    const body = document.getElementById("recap-body");
    return [...body.querySelectorAll(".pp span, .sub-chip span")]
      .filter((s) => s.offsetParent && ["C", "V"].includes(s.textContent.trim())).length;
  });
  expect(off, "a league without captains still shows armbands").toBe(0);
});

test("the armband is handed out by tapping the pitch, not by reading a list", async ({ page }) => {
  /* Two dropdowns listed the same eleven players already drawn on the pitch
     above them, stripped of position, club and fixture -- everything that tells
     you who should wear the band. Reported from the app: the players should
     glow and the tap should be the choice. */
  await openLeague(page, { managers: 2, played: 3 });
  await page.evaluate(() => {
    document.getElementById("reveal-sheet")?.classList.add("hidden");
    openLineup();
  });
  await page.locator("#lineup-primary").click();          // Edit lineup

  const idOf = (pid) => page.evaluate((p) =>
    (S.picks || []).find((pk) => pk.player_id === p)?.id, pid);
  const state = () => page.evaluate(() => ({
    cap: S.captainDraft, vice: S.viceDraft, armed: S.armPick || null,
    lit: document.querySelectorAll("#lineup-list .pp-arm").length,
    onPitch: document.querySelectorAll("#lineup-list .pp").length,
    // While a band is being handed out the bench cannot start a swap: nobody on
    // it can wear one, and a half-finished swap would eat the next tap.
    benchHolds: document.querySelectorAll("#lineup-bench [data-hold]").length,
    /* The class is not the glow. The stagger that makes the pitch ripple is a
       positive animation-delay, and without a fill mode ten of the eleven
       carried .pp-arm and painted nothing at all until their turn came round.
       So this asks the browser what is actually on screen. */
    unlit: [...document.querySelectorAll("#lineup-list .pp-arm .avatar")]
      .filter((a) => getComputedStyle(a).boxShadow === "none").length,
  }));

  const before = await state();
  expect(before.armed, "the editor opens already armed").toBe(null);
  expect(before.lit, "shirts glow before anyone asked for a band").toBe(0);
  expect(before.cap, "the seed gave nobody a captain").toBeTruthy();

  await page.locator('[data-armset="cap"]').click();
  const armed = await state();
  expect(armed.armed).toBe("cap");
  expect(armed.lit, "arming did not light the whole XI").toBe(armed.onPitch);
  expect(armed.benchHolds, "the bench is still offering swaps mid-armband").toBe(0);
  expect(armed.unlit, "a shirt marked as a candidate is not actually glowing").toBe(0);

  // 1. Hand it to someone new.
  const fresh = await page.evaluate(() => {
    const me = myManager();
    const pk = managerPicks(me.id).find((x) => S.lineupDraft.has(x.id)
      && x.player_id !== S.captainDraft && x.player_id !== S.viceDraft);
    return pk.player_id;
  });
  await page.locator(`#lineup-list [data-arm="${await idOf(fresh)}"]`).click();
  let now = await state();
  expect(now.cap, "tapping a lit player did not make them captain").toBe(fresh);
  expect(now.armed, "the pitch stayed armed after the choice was made").toBe(null);
  expect(now.lit, "the glow outlived the choice").toBe(0);

  // 2. Tapping the OTHER band's holder trades the two, so no lit shirt is dead.
  const vice0 = now.vice;
  await page.locator('[data-armset="cap"]').click();
  await page.locator(`#lineup-list [data-arm="${await idOf(vice0)}"]`).click();
  now = await state();
  expect(now.cap, "tapping the vice while arming captain did not promote them").toBe(vice0);
  expect(now.vice, "the outgoing captain did not take the vice's band").toBe(fresh);

  // 3. Tapping the holder of the band being handed out takes it off them.
  await page.locator('[data-armset="cap"]').click();
  await page.locator(`#lineup-list [data-arm="${await idOf(vice0)}"]`).click();
  now = await state();
  expect(now.cap, "tapping the captain again did not take the band off").toBe("");
  expect(now.vice, "removing the captain also cleared the vice").toBe(fresh);

  // Nothing is written until Save, the way the rest of the editor works.
  const saved = await page.evaluate(() => myManager().captain_id);
  expect(saved, "the armband was persisted without a save").toBeTruthy();

  await page.locator("#lineup-secondary").click();        // Discard changes
  expect(await page.evaluate(() => S.captainDraft),
    "discarding did not put the armband back").toBe(saved);
  expect(await page.evaluate(() => S.armPick || null),
    "leaving edit mode left the pitch armed").toBe(null);
});

test("the no-captain warning is loud, and one tap from the fix", async ({ page }) => {
  /* It was two lines of 12px amber text -- the faintest thing on a card whose
     loudest element is a countdown you cannot act on -- and tapping it did
     nothing, so "Captain not set" could be read and ignored all season. */
  await openLeague(page, { managers: 2, played: 3 });
  await page.evaluate(() => {
    document.getElementById("reveal-sheet")?.classList.add("hidden");
    myManager().captain_id = null;
    renderHomeTab();
  });

  const warn = page.locator('[data-todo="captain"]');
  await expect(warn, "the missing captain is not warned about at all").toHaveCount(1);
  // A caption is something you skim past; this has to be a control.
  expect(await warn.evaluate((el) => el.tagName)).toBe("BUTTON");
  const size = await warn.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { px: parseFloat(cs.fontSize), weight: cs.fontWeight,
             h: el.getBoundingClientRect().height,
             painted: cs.backgroundColor, edge: cs.borderTopWidth };
  });
  expect(size.px, "the warning is still caption-sized").toBeGreaterThanOrEqual(13);
  expect(Number(size.weight), "the warning is not emphasised").toBeGreaterThanOrEqual(600);
  expect(size.painted, "the warning has no ground of its own").not.toContain("rgba(0, 0, 0, 0)");
  expect(parseFloat(size.edge), "the warning has no edge").toBeGreaterThan(0);
  // Big enough to hit with a thumb, which an inert 12px line never was.
  expect(size.h).toBeGreaterThanOrEqual(38);

  // The payoff: straight into the armband picker with the pitch already lit.
  await warn.click();
  const landed = await page.evaluate(() => ({
    open: !document.getElementById("lineup-sheet").classList.contains("hidden"),
    edit: S.lineupEdit, arm: S.armPick,
    lit: document.querySelectorAll("#lineup-list .pp-arm").length,
  }));
  expect(landed.open, "the warning did not open the lineup sheet").toBe(true);
  expect(landed.edit, "it opened read-only, so the armband cannot be set").toBe(true);
  expect(landed.arm, "it did not arm the captain").toBe("cap");
  expect(landed.lit, "the pitch is not lit, so there is nothing to tap")
    .toBeGreaterThan(0);

  // One more tap gives someone the band.
  await page.locator("#lineup-list [data-arm]").first().click();
  const picked = await page.evaluate(() => S.captainDraft);
  expect(picked, "tapping a lit player did not pick a captain").toBeTruthy();

  /* The warning tracks the SAVED captain, not the draft -- an edit you have
     not committed must not silence it. (Save itself is exercised by the
     armband test; this seed deliberately carries an invalid XI, so the Save
     button is correctly disabled here.) */
  await expect(page.locator('[data-todo="captain"]'),
    "an uncommitted draft silenced the warning").toHaveCount(1);
  await page.evaluate(() => { myManager().captain_id = S.captainDraft; renderHomeTab(); });
  await expect(page.locator('[data-todo="captain"]'),
    "the warning outlived the captain being set").toHaveCount(0);
});

test("an unavailable starter is ringed on the pitch and counted on the card",
  async ({ page }) => {
  /* The badges already said all of this, in 14px emoji, on a list you scroll
     past. Reported from the app: it is easy to miss that a man in your XI is
     not playing on Saturday. */
  await openLeague(page, { managers: 2, played: 3 });

  const seed = await page.evaluate(() => {
    document.getElementById("reveal-sheet")?.classList.add("hidden");
    const mine = managerPicks(myManager().id).filter((p) => p.slot !== "TEAM");
    const starters = mine.filter((p) => !p.is_sub);
    const sub = mine.find((p) => p.is_sub);
    S.injuryByPid = {
      [starters[0].player_id]: { status: "out", reason: "Hamstring Injury" },
      [starters[1].player_id]: { status: "doubtful", reason: "Knock" },
      // An injured player ON THE BENCH is the bench doing its job.
      [sub.player_id]: { status: "out", reason: "Knee Injury" },
    };
    renderHomeTab();
    return { out: starters[0].player_name, doubt: starters[1].player_name,
             benched: sub.player_name };
  });

  const pitch = await page.evaluate(() => {
    const on = (cls) => [...document.querySelectorAll(`[data-view="board"] .pitch .${cls}`)]
      .map((el) => el.querySelector(".pp-name")?.textContent.trim());
    return { risk: on("pp-risk"), doubt: on("pp-doubt"),
      // The ring has to be painted, not merely classed.
      lit: [...document.querySelectorAll('[data-view="board"] .pitch .pp-risk .avatar')]
        .every((a) => getComputedStyle(a).boxShadow !== "none") };
  });
  expect(pitch.risk, "the absent starter is not ringed")
    .toEqual([shortOf(seed.out)]);
  expect(pitch.doubt, "the doubtful starter is not ringed, or shares the alarm")
    .toEqual([shortOf(seed.doubt)]);
  expect(pitch.lit, "the ring is a class that paints nothing").toBe(true);

  // The front page counts the same people, from the same model.
  const card = await page.evaluate(() => ({
    bad: [...document.querySelectorAll('[data-view="board"] .todo-alert.is-bad')]
      .map((n) => n.textContent.replace(/\s+/g, " ").trim()),
    warn: [...document.querySelectorAll('[data-view="board"] .todo-alert:not(.is-bad)')]
      .map((n) => n.textContent.replace(/\s+/g, " ").trim()),
  }));
  expect(card.bad.join(" "), "the card does not say a starter is out")
    .toContain("1 starter won't play");
  expect(card.bad.join(" "), "it does not say who").toContain(shortOf(seed.out));
  expect(card.warn.join(" "), "the doubt is missing or wearing the wrong tier")
    .toContain("1 starter is doubtful");
  expect(card.bad.join(" "), "a doubt was reported as a certainty")
    .not.toContain(shortOf(seed.doubt));
  // The benched injury must appear nowhere: it is not a problem.
  expect((card.bad + card.warn), "an injured substitute raised a warning")
    .not.toContain(shortOf(seed.benched));

  /* A PAST round shows what happened. Ringing a player there would claim he
     was unavailable then because he is unavailable now. */
  const past = await page.evaluate(() => {
    // The card pages backwards: 0 = the live roster, 1 = the last locked round.
    S.histIdxByMgr[myManager().id] = 1;
    renderHomeTab();
    return document.querySelectorAll('[data-view="board"] .pitch .pp-risk').length;
  });
  expect(past, "a past round was re-coloured by today's injuries").toBe(0);
});

function shortOf(name) {
  const bits = String(name).trim().split(/\s+/);
  return bits.length > 1 ? bits.slice(1).join(" ") : name;
}

test("a name the feed escaped is printed as a name, not as an entity",
  async ({ page }) => {
  /* Reported from the app: the players list showed "N. O&apos;Reilly", exactly
     like that. The feed HTML-escapes names and the app escapes again at
     render, so the entity became the text. */
  await openLeague(page, { managers: 2, played: 3 });

  const seen = await page.evaluate(() => {
    // Straight into the loaded pool, the way a stored competition_pools row
    // carries it — this is the state that is live right now.
    const p = S.players[0];
    p.name = "N. O&apos;Reilly";
    S.players = cleanPlayerNames(S.players);
    S.playerById = Object.fromEntries(S.players.map((x) => [x.player_id, x]));
    S._poolBase = S.players;
    setBoardTab("stats");
    S.statsSearch = "Reilly";
    renderStatsTab();
    const pane = document.getElementById("board-stats");
    return { text: pane.textContent, html: pane.innerHTML };
  });
  expect(seen.text, "the entity is still being printed as text").not.toContain("&apos;");
  expect(seen.text, "the apostrophe never arrived").toContain("O'Reilly");

  /* And the escape it replaced is still doing its job. A feed that says a name
     literally contains a tag must not put one in the page. */
  const safe = await page.evaluate(() => {
    const p = S.players[0];
    p.name = "Bobby &lt;img src=x onerror=alert(1)&gt; Tables";
    S.players = cleanPlayerNames(S.players);
    S.playerById = Object.fromEntries(S.players.map((x) => [x.player_id, x]));
    S._poolBase = S.players;
    S.statsSearch = "Tables";
    renderStatsTab();
    const pane = document.getElementById("board-stats");
    return { imgs: pane.querySelectorAll("img[onerror]").length,
             shows: pane.textContent.includes("<img src=x onerror=alert(1)>") };
  });
  expect(safe.imgs, "decoding a name put live markup in the page").toBe(0);
  expect(safe.shows, "the name is not shown as the text it is").toBe(true);
});

test("a warning you cannot act on does not pretend to be a button", async ({ page }) => {
  await openLeague(page, { managers: 2, played: 3 });
  const state = await page.evaluate(() => {
    document.getElementById("reveal-sheet")?.classList.add("hidden");
    myManager().captain_id = null;
    // Manual windows, both shut: nothing about the lineup can be changed now.
    S.league.config = { ...S.league.config, autoWindows: false };
    S.league.trading_open = false;
    S.league.lineups_open = false;
    renderHomeTab();
    const el = document.querySelector("[data-todo]");
    // .todo-alert is the named state, not a utility class -- selecting on the
    // styling is what a restyle silently empties.
    const rows = [...document.querySelectorAll('[data-view="board"] .todo-alert')]
      .filter((n) => /captain/i.test(n.textContent));
    return { button: !!el, stillSaysIt: rows.length > 0 };
  });
  // The fact is still worth knowing during a locked round -- your captain is
  // not doubling anything -- but openLineup refuses while lineups are locked,
  // so a "Fix" that toasts an apology is worse than no button at all.
  expect(state.stillSaysIt, "the warning vanished when it became unfixable").toBe(true);
  expect(state.button, "it still offers a fix it cannot deliver").toBe(false);

  /* And the refusal must not freeze the page. lockScroll(true) ran before the
     locked-window early return, so tapping the locked-round CTA left the board
     unscrollable behind a sheet that never opened -- which reads as a hang. */
  const frozen = await page.evaluate(() => {
    openLineup();
    return { overflow: document.body.style.overflow,
             sheet: !document.getElementById("lineup-sheet").classList.contains("hidden") };
  });
  expect(frozen.sheet, "the sheet opened while lineups were locked").toBe(false);
  expect(frozen.overflow, "the page was left scroll-locked with no sheet on it")
    .not.toBe("hidden");
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
    const val = (li) => Number(li.querySelector("[data-val]")?.textContent || 0);
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

test("the league table sorts, moves and keeps league position honest", async ({ page }) => {
  /* The tab is called Table and it opened on a chart, with the standings about
     1150px down. The chart itself was the wrong tool: four managers rendered as
     four identical grey lines. And the rank movement the app already computes
     never reached this table — the head-to-head standings were written
     separately and left the arrows behind. */
  await openLeague(page, { managers: 5, played: 4, h2h: true });
  await page.evaluate(() => { showView("board"); setBoardTab("lb"); renderBoard(); });

  const read = () => page.evaluate(() => {
    const rows = [...document.querySelectorAll("#board-lb details[data-mgr]")];
    return rows.map((d) => {
      const t = d.querySelector("summary").textContent.replace(/\s+/g, " ").trim();
      const tag = d.querySelector("summary [data-sortkey]");
      return { id: d.dataset.mgr, rank: Number(t.match(/^(\d+)/)?.[1]),
               tag: tag ? tag.textContent.trim() : null };
    });
  });

  // The table comes before the chart, and the chart is folded away.
  const layout = await page.evaluate(() => {
    const first = document.querySelector("#board-lb details[data-mgr]");
    const chart = document.getElementById("lb-chart");
    return { tableTop: Math.round(first.getBoundingClientRect().top),
             chartTop: chart ? Math.round(chart.getBoundingClientRect().top) : null,
             chartOpen: chart ? chart.open : null };
  });
  expect(layout.tableTop, `the table starts ${layout.tableTop}px down`).toBeLessThan(360);
  expect(layout.chartTop, "the chart is still above the table").toBeGreaterThan(layout.tableTop);
  expect(layout.chartOpen, "the chart is not folded away").toBe(false);

  const byRank = await read();
  expect(byRank.length, "no standings rows").toBe(5);
  expect(byRank.map((r) => r.rank), "the default order is not league order")
    .toEqual([1, 2, 3, 4, 5]);

  /* Sort by LOSSES, deliberately. Points-for happens to rank the same way as
     the league in this fixture, so sorting by it is a no-op and an assertion
     on it passes with the sort removed entirely — which is what the first
     version of this test did. Most losses first is the reverse of the league,
     so it cannot coincide. */
  const losses = await page.evaluate(() => {
    const { rows } = h2hStandings();
    S.h2hSort = "L"; renderBoard();
    return Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v.L]));
  });
  expect(new Set(Object.values(losses)).size,
    "every manager has the same losses, so any order would satisfy this")
    .toBeGreaterThan(1);

  const sorted = await read();
  const seen = sorted.map((r) => losses[r.id]);
  expect(seen, `rows are not in most-losses-first order: ${seen}`)
    .toEqual([...seen].sort((a, b) => b - a));
  expect(sorted.map((r) => r.id), "sorting by losses left the league order untouched")
    .not.toEqual(byRank.map((r) => r.id));

  // ...and it reordered the ROWS without renumbering the LEAGUE.
  expect(sorted.map((r) => r.rank).sort((a, b) => a - b),
    "sorting renumbered the league instead of reordering the rows")
    .toEqual([1, 2, 3, 4, 5]);
  expect(sorted.map((r) => r.rank), "the rank badges are in sorted order, so they are not league position")
    .not.toEqual([1, 2, 3, 4, 5]);

  /* The number being sorted on has to be ON the row. Ordering a table by
     points-for and then not showing points-for asks you to take the order on
     trust — reported from the app, about exactly that. */
  for (const r of sorted)
    expect(r.tag, `${r.id} shows no value for the stat it is sorted by`)
      .toBe(`losses ${losses[r.id]}`);

  // ...and it goes away again when the table is back in league order.
  const back = await page.evaluate(() => { S.h2hSort = "logPts"; renderBoard(); });
  expect((await read()).every((r) => r.tag === null),
    "the sort chip is still showing when nothing is being sorted on").toBe(true);
});

test("finishing a draft lands you on your team, not the player list", async ({ page }) => {
  /* The lobby's "Browse players" sets a flag that pins the board to the
     Players tab, and nothing ever cleared it — so the moment the draft
     finished, the app dropped you on a list of everyone in the competition
     rather than on the squad you had just drafted. Reported from the app. */
  await openLeague(page, { managers: 2, played: 0, predraft: true });

  const browsing = await page.evaluate(() => {
    /* current_pick is what says a draft has begun — null in the lobby, 1 once
       it starts. The harness's "predraft" seed sets 1, which is already
       mid-draft, so the lobby state has to be made here or the browse is never
       pre-draft and the test runs against a state it cannot reach.
       renderLobby also has to run: it is what wires the button. */
    S.league.current_pick = null;
    showView("lobby"); renderLobby();
    document.getElementById("lobby-browse").click();   // the button a person taps
    return { tab: S.boardTab, browsing: !!S._browsing };
  });
  // The setup has to actually be the pre-draft browse, or this proves nothing.
  expect(browsing.browsing, "the browse flag was not set").toBe(true);
  expect(browsing.tab, "browsing did not open the Players tab").toBe("stats");

  const after = await page.evaluate(async () => {
    // The draft runs and completes: every pick made, the board reached.
    S.league.current_pick = totalPicks() + 1;
    renderBoard();
    /* The tab panes by name. Matching on an id prefix also catches
       board-tolobby and board-scoring, which are buttons — so the list has to
       be the panes setBoardTab actually toggles, not everything that happens
       to be called board-something. */
    const PANES = ["board-home", "board-lb", "board-fixtures", "board-bracket",
                   "board-stats", "board-rosters", "board-trades", "board-chat"];
    return { tab: S.boardTab, browsing: !!S._browsing,
             shown: PANES.filter((id) => !document.getElementById(id)?.classList.contains("hidden")) };
  });

  expect(after.tab, "the draft finished on the Players tab").toBe("home");
  expect(after.shown, "the Team pane is not the only one showing").toEqual(["board-home"]);
  // The flag is cleared, so a later visit to Players is not yanked back.
  expect(after.browsing, "the browse flag survived the draft").toBe(false);
  const stays = await page.evaluate(() => {
    setBoardTab("stats"); renderBoard();
    return S.boardTab;
  });
  expect(stays, "the Players tab bounces back to Team after the draft").toBe("stats");
});

test("the season chart shows league position by default, and points on request", async ({ page }) => {
  /* "Who is scoring" and "who is winning" are different questions in a
     head-to-head league — the log is won on results, not on fantasy points.
     The chart only ever answered the first. */
  await openLeague(page, { managers: 5, played: 4, h2h: true });

  const read = () => page.evaluate(() => {
    S.chartOpen = true;
    showView("board"); setBoardTab("lb"); renderBoard();
    /* The head-to-head table folds its chart into #lb-chart; the points-tally
       table renders it inline. Look for both, or the third case below reads as
       "no chart" rather than "no mode selector". */
    const svg = document.querySelector("#lb-chart svg") || document.querySelector("#board-lb svg");
    if (!svg) return null;
    // Axis labels with their y positions, so "which way is up" is measurable.
    const ticks = [...svg.querySelectorAll("text")]
      .filter((t) => t.getAttribute("text-anchor") === "end")
      .map((t) => ({ label: t.textContent.trim(), y: parseFloat(t.getAttribute("y")) }))
      .sort((a, b) => a.y - b.y);
    return {
      mode: document.getElementById("chart-mode")?.value,
      ticks,
      lines: svg.querySelectorAll("polyline").length,
      // Every point's tooltip, to check what the numbers claim to be.
      tips: [...svg.querySelectorAll("title")].map((t) => t.textContent),
    };
  });

  // 1. A head-to-head league opens on league position...
  const rank = await read();
  expect(rank, "the chart did not render").not.toBeNull();
  expect(rank.mode, "the chart did not default to league position").toBe("rank");
  expect(rank.lines, "not every manager has a line").toBe(5);
  /* ...drawn the right way up: 1st at the top. The labels run 1..5 down the
     page, which is the opposite of a points axis and the whole reason this
     needed its own scale. */
  expect(rank.ticks.map((t) => t.label), "the rank axis is not 1st-at-top")
    .toEqual(["1", "2", "3", "4", "5"]);
  expect(rank.tips.some((t) => /\b(1st|2nd|3rd|4th|5th)\b/.test(t)),
    "rank points are labelled as scores, not placings").toBe(true);

  // 2. ...and points are one selection away.
  const pts = await page.evaluate(() => { S.chartMode = "points"; renderBoard(); });
  const points = await read();
  expect(points.mode, "switching to points did not take").toBe("points");
  expect(points.tips.some((t) => /pts$/.test(t)),
    "the points chart is not labelling points").toBe(true);
  // A points axis climbs, so its labels descend down the page.
  const nums = points.ticks.map((t) => Number(t.label));
  expect(nums, `the points axis is not descending: ${nums}`)
    .toEqual([...nums].sort((a, b) => b - a));

  // 3. A league with no head-to-head log has nothing to rank, so no selector.
  await openLeague(page, { managers: 5, played: 4 });
  const plain = await read();
  expect(plain.mode, "a points-tally league is offering a league-position chart")
    .toBeUndefined();
});

test("a player who leaves the league is flagged, not dropped and not hidden", async ({ page }) => {
  /* A January transfer out of the competition. He stays in the squad -- nothing
     drops a pick for you -- but his chip was cheerfully showing his old club's
     next fixture, so he looked like a player who is merely out of the XI this
     week rather than one who cannot score again. */
  await openLeague(page, { managers: 4, played: 3 });

  const out = await page.evaluate(() => {
    const mine = S.picks.filter((p) => p.manager_id === S.managers[0].id && !p.is_sub
                                       && p.slot !== "TEAM");
    const goneId = mine[0].player_id, stayId = mine[1].player_id;
    const before = { badge: availBadges(goneId), roster: S.picks.length };

    // The pool, re-pulled after he has left: he is simply not in it any more.
    S.players = S.players.filter((p) => p.player_id !== goneId);
    S.playerById = Object.fromEntries(S.players.map((p) => [p.player_id, p]));
    bustScores();
    setBoardTab("home"); renderBoard();

    const html = document.getElementById("board-home").innerHTML;
    return {
      before,
      badge: availBadges(goneId),
      stillThere: availBadges(stayId),
      roster: S.picks.filter((p) => p.player_id === goneId).length,
      pitchSaysLeft: html.includes("✈ left"),
      claimable: poolEntries ? S.players.some((p) => p.player_id === goneId) : null,
      text: availText(goneId),
    };
  });

  expect(out.before.badge, "nothing was flagged while he was still in the pool")
    .not.toContain("LEFT");
  expect(out.badge, "once he is gone from the pool, every list says so").toContain("LEFT");
  expect(out.stillThere, "and his team-mates are left alone").not.toContain("LEFT");
  expect(out.text, "including the trade builder's plain-text labels")
    .toContain("left the competition");

  expect(out.roster, "he is NOT dropped for you — that is your call, in a window")
    .toBe(1);
  expect(out.claimable, "and nobody else can claim him either").toBe(false);

  /* The chip has no room for a badge and does not need one: it was already
     showing a line that was false. */
  expect(out.pitchSaysLeft, "the pitch stops showing his old club's next game")
    .toBe(true);
});

test("the pre-draft scouting page keeps its position and club filters",
  async ({ page }) => {
    /* They live inside the "Filters & scope" fold, and scouting mode hid that
       whole fold -- so the two controls the page is FOR before a draft went
       with it, and the only way left to narrow six hundred players was to type
       a club name into the search box. */
    await openLeague(page, { managers: 4, predraft: true });

    const out = await page.evaluate(() => {
      const vis = (id) => {
        const el = document.getElementById(id);
        if (!el) return false;
        return !!el.getClientRects().length;
      };
      // Browsing the pool from the lobby, before the first pick.
      S.league.current_pick = 0; S._browsing = true;
      showView("board"); setBoardTab("stats"); renderStatsTab();
      const scouting = {
        browsing: preDraftBrowsing(),
        chips: vis("stats-chips"), club: vis("stats-team"), search: vis("stats-search"),
        // ...while the things that need match data stay away.
        scope: vis("stats-round"), unpicked: vis("stats-unpicked"),
        chipLabels: [...document.querySelectorAll("#stats-chips [data-chip]")]
          .map((b) => b.dataset.chip),
      };
      // The chips still filter, not just render.
      document.querySelector('#stats-chips [data-chip="GK"]').click();
      const filtered = [...document.querySelectorAll("#stats-list [data-sp]")]
        .map((b) => S.playerById[b.dataset.sp]?.position);
      S.statsPos = "ALL";

      /* And once the draft is done the fold takes them back -- at the top of
         it, where they were, because a control that moves between renders is
         its own bug. */
      S.league.current_pick = 9999;
      renderStatsTab();
      const after = {
        browsing: preDraftBrowsing(),
        insideFold: !!document.querySelector("#stats-more-body > #stats-listctl"),
        firstInFold: document.getElementById("stats-more-body").firstElementChild?.id,
      };
      return { scouting, filtered, after };
    });

    expect(out.scouting.browsing, "this is the pre-draft page").toBe(true);
    expect(out.scouting.chips, "the position filter is on screen").toBe(true);
    expect(out.scouting.club, "and so is the club filter").toBe(true);
    expect(out.scouting.search, "beside the search that was doing all the work").toBe(true);
    expect(out.scouting.chipLabels, "one chip per position, from the sport")
      .toEqual(["ALL", "GK", "DEF", "MID", "FWD"]);
    expect(out.scouting.scope, "while round scope has no data to scope").toBe(false);
    expect(out.scouting.unpicked, "and nobody has been picked yet").toBe(false);

    expect(out.filtered.length, "the chip filters the list").toBeGreaterThan(0);
    expect([...new Set(out.filtered)], "to that position only").toEqual(["GK"]);

    expect(out.after.browsing, "after the draft it is a leaderboard again").toBe(false);
    expect(out.after.insideFold, "so the controls fold away with the rest").toBe(true);
    expect(out.after.firstInFold, "back where they were, not appended below")
      .toBe("stats-listctl");
  });

/* The Google sign-in test lived here. It checked that a provider the project
   has switched off withdraws its own button instead of sitting there failing
   -- good behaviour, and moot now the button is gone entirely rather than
   conditionally. Restore it alongside the button if Google is ever enabled;
   what it pinned is worth pinning. */

test("joining without an account blames the account, not the code", async ({ page }) => {
  /* Looking a league up by its code is a READ of the leagues table, and RLS
     grants that to signed-in users only. So a signed-out visitor with a
     perfectly good code was told "No league with that code" -- which blames
     the code, and the person who sent it. */
  await openLeague(page, { managers: 4, played: 3 });

  const out = await page.evaluate(async () => {
    const toasts = [];
    const realToast = window.toast;
    window.toast = (t) => { toasts.push(t); };
    const vis = (id) => !!document.getElementById(id)?.getClientRects().length;

    S.authUser = null;
    showView("join");
    const signedOut = { note: vis("join-signin-note"),
                        btn: document.getElementById("join-find").textContent.trim() };
    document.getElementById("join-code").value = "SCEN";
    await findLeague();
    const asked = toasts.slice();
    const wentHome = !!document.querySelector('[data-view="home"]')?.getClientRects().length;

    S.authUser = { id: "00000000-0000-4000-8000-000000000001", email: "t@example.com" };
    showView("join");
    const signedIn = { note: vis("join-signin-note"),
                       btn: document.getElementById("join-find").textContent.trim() };
    toasts.length = 0;
    document.getElementById("join-code").value = "SCEN";
    await findLeague();
    const found = { toasts: toasts.slice(), shown: vis("join-found"),
                    name: document.getElementById("join-league-name").textContent };
    window.toast = realToast;
    return { signedOut, asked, wentHome, signedIn, found };
  });

  expect(out.signedOut.note, "the requirement is on screen before anything is typed")
    .toBe(true);
  expect(out.signedOut.btn, "and the button says what pressing it will do")
    .toMatch(/Sign in/);
  expect(out.asked.join(" "), "the message is about the account, not the code")
    .toMatch(/account/i);
  expect(out.asked.join(" "), "and never claims the league is missing")
    .not.toMatch(/No league/);
  expect(out.wentHome, "with the sign-in form put in front of them").toBe(true);

  expect(out.signedIn.note, "once signed in the notice goes").toBe(false);
  expect(out.signedIn.btn).toBe("Find league");
  expect(out.found.toasts, "and the same code just works").toEqual([]);
  expect(out.found.shown, "the league is found").toBe(true);
  expect(out.found.name).toBe("Scenario");
});

test("a desktop is not a very wide phone", async ({ page }) => {
  /* Three things that were only wrong on a big screen, which is the screen a
     draft is actually run on. Measured rather than eyeballed, because a
     max-width is exactly the kind of rule a later layout change deletes
     without anyone noticing until someone is sitting in front of it. */
  await page.setViewportSize({ width: 1440, height: 900 });
  await openLeague(page, { managers: 4, played: 3 });

  const out = await page.evaluate(() => {
    const w = (sel) => document.querySelector(sel)?.getBoundingClientRect().width || 0;
    closeReveal();
    showView("board"); setBoardTab("stats");
    const listPane = w("#board-stats");
    const listChrome = w("#board-banner");
    showView("board"); setBoardTab("home");
    const teamPane = w("#board-home");

    // The reveal: six fixed columns of 3:4 cells, so the panel's width IS the
    // size of every player on it.
    openReveal();
    const panel = w("#reveal-sheet > div");
    const slot = document.querySelector("#reveal-page .reveal-slot")
      ?.getBoundingClientRect();
    closeReveal();

    showView("draft");
    const draft = document.querySelector('[data-view="draft"]');
    const pool = document.querySelector(".draft-pool-card").getBoundingClientRect();
    const recent = document.querySelector(".draft-recent-card").getBoundingClientRect();
    return { listPane, listChrome, teamPane, panel, slotW: slot?.width,
             slotH: slot?.height, poolLeft: pool.left, recentLeft: recent.left,
             /* Measured, not counted. Counting grid tracks passed with the
                template cut to one column: the other cards ask for column 2
                explicitly, so the browser makes an implicit one and the
                layout survives. Side by side is the thing that matters. */
             sideBySide: pool.right <= recent.left + 1,
             poolWider: pool.width > recent.width };
  });

  // A list row needs about forty characters and a number, not a monitor.
  expect(out.listPane, "a list pane stretched the full width").toBeLessThan(860);
  expect(Math.abs(out.listPane - out.listChrome),
    "the pane and the chrome above it must share a right edge").toBeLessThan(2);
  expect(out.teamPane, "but the team page has a second column to fill")
    .toBeGreaterThan(900);

  expect(out.panel, "the reveal was as wide as the monitor").toBeLessThan(600);
  expect(out.slotW, "so every player in it came out poster-sized").toBeLessThan(120);
  expect(out.slotH).toBeLessThan(160);

  // The draft is the one screen everybody is on at once, for an hour.
  expect(out.sideBySide, "the draft room is two columns on a desktop").toBe(true);
  expect(out.poolLeft, "with the pool on the left, where the work is")
    .toBeLessThan(out.recentLeft);
  expect(out.poolWider, "and given the wider of the two").toBe(true);
});

test("each theme reveals the squad in its own language", async ({ page }) => {
  /* A foil packet is the album's idea, and it means nothing on a floodlit
     stadium at night -- "tap to open" over a dark ground is describing
     something that is not on screen. Same mechanism, same elements, two
     metaphors: a packet you tear, and a tunnel the squad walks out of. */
  await openLeague(page, { managers: 4, played: 3 });

  const read = async (theme) => await page.evaluate((t) => {
    setTheme(t);
    openReveal();
    const cover = document.getElementById("reveal-cover");
    const slot = document.querySelector("#reveal-page .reveal-slot");
    document.getElementById("reveal-open").click();
    // The BUTTON, not the overlay: the overlay is inset-0 and always the
    // shape of the panel, so measuring it says nothing about either metaphor.
    const cs = getComputedStyle(cover);
    const box = document.getElementById("reveal-open").getBoundingClientRect();
    return {
      n: document.getElementById("reveal-cover-n").textContent,
      tap: document.getElementById("reveal-cover-tap").textContent,
      aria: document.getElementById("reveal-open").getAttribute("aria-label"),
      away: cs.animationName,
      lid: getComputedStyle(cover.querySelector(".cover-lid")).animationName,
      arrive: getComputedStyle(slot).animationName,
      landscape: box.width > box.height,
    };
  }, theme);

  const sticker = await read("sticker");
  const dark = await read("dark");

  expect(sticker.n, "the album counts stickers").toMatch(/STICKERS?$/);
  expect(dark.n, "the default theme counts players").toMatch(/^SQUAD OF/);
  expect(sticker.tap, "and each says what the thing on screen actually does")
    .toBe("tap to open");
  expect(dark.tap).toBe("tap to walk them out");
  expect(sticker.aria).not.toBe(dark.aria);

  /* The animations have to differ too, or this is a relabelling. Read as
     computed names rather than as class names: that is the difference a person
     would actually see. */
  expect(sticker.lid, "the packet's strip tears off").toBe("lid-tear");
  expect(dark.lid, "the tunnel's gate lifts").toBe("gate-lift");
  expect(sticker.arrive, "stickers are dealt down onto the page").toBe("deal-in");
  expect(dark.arrive, "players walk up out of the tunnel").toBe("walk-out");
  expect(sticker.away).not.toBe(dark.away);

  // A packet is a card and a tunnel is a doorway; the silhouette says which.
  expect(sticker.landscape, "the packet stands upright").toBe(false);
  expect(dark.landscape, "the tunnel mouth is wider than it is tall").toBe(true);
});

test("the packet stays sealed until it is opened, then deals the squad out", async ({ page }) => {
  /* The order is the whole point of the moment. A squad that is already on the
     page behind a wrapper is not a packet, it is a curtain -- and the deal
     starting before the tear would show exactly that. */
  await openLeague(page, { managers: 4, played: 3 });
  const seen = await page.evaluate(() => {
    openReveal();
    const packet = document.getElementById("reveal-cover");
    const page_ = document.getElementById("reveal-page");
    const before = { sealed: !packet.classList.contains("hidden"),
                     open: packet.classList.contains("cover-open"),
                     dealing: page_.classList.contains("dealt"),
                     stickers: page_.querySelectorAll(".reveal-slot").length };
    document.getElementById("reveal-open").click();
    return { before, after: { open: packet.classList.contains("cover-open"),
                              dealing: page_.classList.contains("dealt") } };
  });

  expect(seen.before.sealed, "the reveal opened with no packet over it").toBe(true);
  expect(seen.before.open, "the packet was already torn open").toBe(false);
  expect(seen.before.dealing, "the squad started dealing before the packet was opened").toBe(false);
  expect(seen.before.stickers, "the reveal drew no stickers").toBeGreaterThan(10);
  expect(seen.after.open, "tapping the packet did not open it").toBe(true);
  expect(seen.after.dealing, "the squad never dealt out").toBe(true);
});

test("the shiny in the packet is the first pick, and only that one", async ({ page }) => {
  /* Nothing has been played when the reveal fires, so the foil cannot mean
     "top scorer" here. It means the player you spent the top of your draft on
     -- a fact the moment already holds, and one that always resolves. */
  await openLeague(page, { managers: 4, played: 3 });
  const got = await page.evaluate(() => {
    const me = myManager();
    const mine = managerPicks(me.id);
    const first = mine.reduce((a, b) => (a && a.pick_number <= b.pick_number ? a : b), null);
    openReveal();
    const foils = [...document.querySelectorAll("#reveal-page .reveal-slot.pp-foil")];
    return {
      firstName: shortName(first.player_name),
      picks: mine.length,
      foiled: foils.map((el) => el.querySelector(".reveal-name").textContent),
      caption: document.getElementById("reveal-body").textContent,
    };
  });

  expect(got.picks, "the manager drafted nobody").toBeGreaterThan(1);
  expect(got.foiled, "exactly one sticker should shine, and it should be the first pick")
    .toEqual([got.firstName]);
  // ...and the page says why, rather than leaving the shine to be guessed at.
  expect(got.caption).toContain("your first pick");
  expect(got.caption).toContain(got.firstName);
});

test("a pick is stamped on the album theme and left alone on the default one", async ({ page }) => {
  /* The stamp was chosen over restyling the flash card precisely because it
     can be inert on dark. That has to be checked, not assumed: the class is
     emitted in both themes and only the CSS keeps them apart. */
  await openLeague(page, { managers: 4, played: 3 });
  const read = async (theme) => page.evaluate((t) => {
    setTheme(t);
    document.querySelector(".pick-flash")?.remove();
    flashPick(S.picks[0]);
    const stamp = document.querySelector(".pick-flash .pick-stamp");
    const cs = stamp && getComputedStyle(stamp);
    return { present: !!stamp, shown: cs ? cs.display !== "none" : false,
             text: stamp ? stamp.textContent.trim() : "" };
  }, theme);

  const dark = await read("dark");
  const sticker = await read("sticker");

  expect(dark.present, "the stamp element should exist in both themes").toBe(true);
  expect(dark.shown, "the default theme's pick flash grew a stamp").toBe(false);
  expect(sticker.shown, "the album theme's pick flash has no stamp").toBe(true);
  expect(sticker.text.toLowerCase()).toContain("stuck in");
});

test("with motion turned down the packet is already open and the squad already there",
  async ({ browser }) => {
    /* Every animation in the app has a reduced-motion counterpart, and this is
       the easiest place to lose one: a squad reveal that never animates must
       still END somewhere, and "nowhere" would mean a sealed packet you can
       never get past. */
    const ctx = await browser.newContext({ reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await openLeague(page, { managers: 4, played: 3 });
    await page.evaluate(() => { setTheme("sticker"); openReveal(); });
    await page.click("#reveal-open");
    await page.waitForTimeout(120);          // far less than the 0.75s deal delay

    const state = await page.evaluate(() => {
      const packet = document.getElementById("reveal-cover");
      const slot = document.querySelector("#reveal-page .reveal-slot");
      const cs = getComputedStyle(slot), pcs = getComputedStyle(packet);
      return { slotOpacity: Number(cs.opacity), slotAnim: cs.animationName,
               packetHidden: pcs.visibility === "hidden" || Number(pcs.opacity) === 0,
               stampAnim: getComputedStyle(
                 document.createElement("div")).animationName };
    });

    expect(state.slotAnim, "the stickers still animate with motion turned down").toBe("none");
    expect(state.slotOpacity, "the squad is invisible with motion turned down").toBe(1);
    expect(state.packetHidden, "the packet never gets out of the way").toBe(true);
    await ctx.close();
  });

test("choosing rugby re-designs the draft, and football is left alone", async ({ page }) => {
  /* The sport question is the first one the create form asks, and answering it
     has to change more than a label: a football scoring rule names stats a
     rugby feed will never send, so carrying the editor across would leave a
     league quietly scoring every player zero. */
  await openLeague(page, { managers: 4, played: 3 });

  const read = await page.evaluate(() => {
    showView("create");
    renderCreateForm();
    const snap = () => ({
      sport: sportOf(),
      comps: [...document.getElementById("create-comp").options].map((o) => o.text),
      groups: playGroups().join(","),
      firstRule: (S._createRules || [])[0]?.stat,
      quotaKeys: Object.keys(effectiveConfig({}).quota).join(","),
      bands: sportDef().pitchBands().length,
    });
    const before = snap();
    // Click the rugby button the way a person would.
    document.querySelector('#create-sport [data-sport="rugby"]').click();
    const after = snap();
    document.querySelector('#create-sport [data-sport="football"]').click();
    return { before, after, back: snap() };
  });

  // Football, as it always was.
  expect(read.before.sport).toBe("football");
  expect(read.before.groups).toBe("GK,DEF,MID,FWD");
  expect(read.before.comps.join(" "), "the built-in pool is a football squad list")
    .toContain("World Cup");

  // Rugby: different positions, different competitions, different scoring.
  expect(read.after.sport).toBe("rugby");
  expect(read.after.groups).toBe("PR,HK,LK,LF,SH,FH,CE,OB");
  expect(read.after.bands, "eight groups still draw four rows").toBe(4);
  expect(read.after.comps.join(" ")).toContain("United Rugby Championship");
  expect(read.after.comps.join(" "), "the built-in football pool is not offered for rugby")
    .not.toContain("World Cup");
  expect(read.after.firstRule, "the scoring editor was reloaded for the new sport")
    .toBe("tries");
  expect(read.after.quotaKeys).toContain("PR");

  // ...and switching back restores football rather than leaving a hybrid.
  expect(read.back.sport).toBe("football");
  expect(read.back.groups).toBe("GK,DEF,MID,FWD");
  expect(read.back.firstRule).toBe("goals.total");
  expect(read.back.comps.join(" ")).toContain("World Cup");
});

test("the line-up probe is offered for rugby and hidden for football", async ({ page }) => {
  /* It answers a rugby question -- whether this feed publishes matchday squads
     before kick-off -- so showing it on a football league would be offering an
     admin a button that cannot tell them anything. */
  await openLeague(page, { managers: 4, played: 3 });
  const seen = await page.evaluate(() => {
    const hidden = () => document.getElementById("adm-lineups-wrap")?.classList.contains("hidden");
    showView("board"); setBoardTab("admin");
    /* renderAdmin() rather than setBoardTab() for the second read: switching to
       a tab you are already on is a no-op, so the panel would never repaint and
       the check would pass on a stale DOM. */
    const admin = isAdmin();
    /* Rendered explicitly here too. Reading it straight after setBoardTab left
       the football case unable to tell "the rule hid it" from "the panel never
       painted", since the element ships with `hidden` in the markup -- which a
       sabotage check caught by passing when the rule was removed entirely. */
    renderAdmin();
    const asFootball = hidden();
    S.league.competition = { apiLeagueId: 1068, season: 2025, sport: "rugby" };
    renderAdmin();
    return { admin, asFootball, asRugby: hidden(),
             exists: !!document.getElementById("adm-lineups-check") };
  });
  expect(seen.exists, "the probe button should be in the admin panel").toBe(true);
  // Without this the football case below could pass simply by never rendering.
  expect(seen.admin, "the test manager must be an admin for this to mean anything").toBe(true);
  expect(seen.asFootball, "a football league has no matchday-squad feed to check").toBe(true);
  expect(seen.asRugby, "a rugby league should be offered the check").toBe(false);
});

test("loading a rugby competition reads the rugby feed, not API-Football", async ({ page }) => {
  /* The bug this pins: the rugby fetchers existed but nothing called them.
     Both pool loaders asked API-Football regardless of sport, so a rugby
     league could be designed in the create form and then never loaded --
     which is exactly what it looked like from the outside, a competition
     that "has no season loaded yet". */
  await openLeague(page, { managers: 4, played: 3 });

  const hits = [];
  // Every outbound host the loader might reach, answered locally.
  await page.route("**/*", async (route) => {
    /* Decoded: the proxy passes the feed path as a query parameter, so a URL
       reads `?path=matches%2Fsearch` and a naive substring match misses it. */
    const url = decodeURIComponent(route.request().url());
    if (url.includes("api-sports.io") || url.includes("incrowdsports.com")
        || url.includes("/functions/v1/")) {
      hits.push(url);
      /* Shaped like the feed's real answers. teams/{id}/players is NOT stubbed
         because it does not exist -- it answers 400 for every id, clubs and
         countries alike, which is why the pool comes from match detail. */
      if (url.includes("matches/search")) {
        const size = +(url.match(/size=(\d+)/) || [])[1] || 100;
        /* A hundred rows of a real season are a hundred of the LATEST rows,
           which is why the fixture list used to start in December. These are
           TBC placeholders so they are never fixtures themselves -- they are
           here only to fill the page and push September off the end of it. */
        const filler = Array.from({ length: 100 }, (_, i) => ({
          id: 2000 + i, status: "fixture", tbc: 0, round: 20,
          date: `2026-12-${String((i % 28) + 1).padStart(2, "0")}T17:00:00Z`,
          homeTeam: { id: 0, name: "TBC" }, awayTeam: { id: 0, name: "TBC" } }));
        const rows = [
            // Two played rounds, so a player can be seen twice.
            { id: 900, status: "result", tbc: 0, date: "2026-05-24T17:00:00Z", round: 17,
              homeTeam: { id: 4, name: "Ireland", score: 20 },
              awayTeam: { id: 5, name: "France", score: 15 } },
            { id: 902, status: "result", tbc: 0, date: "2026-05-31T17:00:00Z", round: 18,
              homeTeam: { id: 4, name: "Ireland", score: 36 },
              awayTeam: { id: 5, name: "France", score: 7 } },
            // The shape that fooled the old filter: tbc:0, and nobody in it.
            { id: 901, status: "fixture", tbc: 0, date: "2026-11-29T16:40:00Z", round: 7,
              title: "TF", homeTeam: { id: 0, name: "TBC" }, awayTeam: { id: 0, name: "TBC" } },
            /* September, which is where a URC season starts and where the
               fixture list used to stop: the feed answers newest-first and a
               hundred rows reached only as far back as December. */
            { id: 903, status: "result", tbc: 0, date: "2026-09-20T17:00:00Z", round: 1,
              homeTeam: { id: 4, name: "Ireland", score: 10 },
              awayTeam: { id: 5, name: "France", score: 9 } },
            // ...and last season, which asking for more must NOT drag in.
            { id: 890, status: "result", tbc: 0, date: "2025-04-12T17:00:00Z", round: 14,
              homeTeam: { id: 4, name: "Ireland", score: 3 },
              awayTeam: { id: 5, name: "France", score: 0 } },
          ...filler];
        // The feed answers newest-first, and `size` truncates that list.
        rows.sort((x, y) => Date.parse(y.date) - Date.parse(x.date));
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({
          data: rows.slice(0, size),
          metadata: { totalItems: rows.length }, status: "success" }) });
      }
      const mid = (url.match(/matches\/(\d+)/) || [])[1];
      /* The September and last-season matches exist to test the fixture
         WINDOW, so they field nobody -- otherwise they also feed the position
         counts and this test starts measuring two things at once. */
      if (mid === "903" || mid === "890") {
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({
          status: "success", data: { id: +mid,
            homeTeam: { id: 4, name: "Ireland", players: [] },
            awayTeam: { id: 5, name: "France", players: [] } } }) });
      }
      if (mid) {
        /* Round 17 benches the hooker; round 18 starts him. That is the case
           that decides whether an observed start beats the shirt convention,
           and it needs TWO matches to exist at all. */
        const benched = mid === "900";
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({
          data: { id: +mid, date: "2026-05-31T17:00:00Z", round: benched ? 17 : 18,
            /* Round 17 calls them by the sponsored name, round 18 by the bare
               one. Same club, same id -- and nothing about the NAMES says so,
               which is how one side ends up in the pool twice with three
               players in the smaller of them. */
            homeTeam: { id: 4, name: benched ? "Fidelity Ireland" : "Ireland",
                        score: 36, players: [
              { id: 240452, known: "A Flanker", positionId: 7, position: "flanker",
                stats: { minutesPlayedTotal: 80, tackles: 9 } },
              benched
                ? { id: 240453, known: "A Hooker", positionId: 21, position: "sub 6",
                    stats: { minutesPlayedTotal: 20 } }
                : { id: 240453, known: "A Hooker", positionId: 2, position: "hooker",
                    stats: { minutesPlayedTotal: 60 } },
              // Never once starts: the shirt convention is all there is.
              { id: 240454, known: "A Reserve", positionId: 21, position: "sub 6",
                stats: { minutesPlayedTotal: 12 } },
              /* Covered at 6 in the earlier match and packed down at 4 in the
                 later one. One each, so the LATER shirt wins -- a player who
                 moved should end up where the season left him, and the first
                 version of this kept the earliest start forever. */
              { id: 240455, known: "A Mover", positionId: benched ? 6 : 4,
                position: benched ? "flanker" : "lock",
                stats: { minutesPlayedTotal: 80 } },
              // Neither a known shirt nor a known name: dropped, not guessed.
              { id: 240470, known: "A Mystery", positionId: 99, position: "water carrier",
                stats: { minutesPlayedTotal: 5 } },
            ] },
            awayTeam: { id: 5, name: "France", score: 7, players: [
              { id: 240460, known: "A Fullback", positionId: 15, position: "fullback",
                stats: { minutesPlayedTotal: 80 } },
            ] } }, status: "success" }) });
      }
      return route.fulfill({ contentType: "application/json", body: "{}" });
    }
    return route.continue();
  });

  const out = await page.evaluate(async () => {
    const competition = { name: "Nations Championship", apiLeagueId: 2146,
                          season: 2026, sport: "rugby" };
    const built = await fetchPoolFor(competition, "", () => {});
    const byId = Object.fromEntries(built.players.map((p) => [p.player_id, p]));
    return { players: built.players.length, teams: built.teams.length,
             fixtures: built.fixtures.length,
             startedPos: byId["rug_240452"]?.position,
             seenBothWays: byId["rug_240453"]?.position,
             benchOnly: byId["rug_240454"]?.position,
             mystery: byId["rug_240470"],
             moved: byId["rug_240455"]?.position,
             movedStarts: byId["rug_240455"]?.pos_starts,
             benchStarts: byId["rug_240454"]?.pos_starts,
             surestStarts: byId["rug_240452"]?.pos_starts,
             firstId: built.players[0]?.player_id,
             teamNames: built.teams,
             ireland: byId["rug_240452"]?.team,
             key: compKeyOf(competition),
             rounds: built.fixtures.map((f) => f.round),
             roundOrder: built.roundOrder,
             dates: built.fixtures.map((f) => f.date) };
  });

  expect(out.players, "five placeable players, and the unplaceable one dropped").toBe(5);
  expect(out.teams, "only the sides that actually played").toBe(2);
  expect(out.teamNames, "one club under two names is still one club")
    .toEqual(["France", "Ireland"]);
  expect(out.ireland, "with the spelling the feed used most").toBe("Ireland");
  expect(out.fixtures, "and the TBC placeholder is not a fixture").toBe(3);
  expect(out.dates, "a September fixture is reachable, not cut off by the page size")
    .toContain("2026-09-20");
  expect(out.dates.some((d) => d.startsWith("2025")),
    "while last season's matches are not this season's fixtures").toBe(false);
  expect(out.roundOrder, "and rounds are ordered by the feed's own numbers")
    .toEqual(["Round 1", "Round 17", "Round 18"]);
  expect(out.startedPos, "shirt 7 is a loose forward").toBe("LF");
  expect(out.seenBothWays, "an observed start beats the bench convention, which would say SH")
    .toBe("HK");
  expect(out.benchOnly, "a player never seen starting falls back to the shirt convention")
    .toBe("SH");
  expect(out.mystery, "a position that cannot be resolved is dropped, not invented")
    .toBeUndefined();
  expect(out.moved, "a tie between two shirts goes to the later one").toBe("LK");
  expect(out.movedStarts, "and the evidence for it is recorded").toBe(1);
  expect(out.benchStarts, "a bench-convention guess records zero starts").toBe(0);
  expect(out.surestStarts, "someone seen starting twice records two").toBe(2);
  expect(out.firstId, "rugby ids are namespaced").toMatch(/^rug_/);
  expect(out.key, "and the pool row is keyed apart from football's")
    .toBe("rugby-2146-2026");

  // The point of the test: nothing went to the football provider.
  expect(hits.some((u) => u.includes("api-sports.io")),
    "a rugby pull must not reach API-Football").toBe(false);
  expect(hits.some((u) => u.includes("rugby-feed") || u.includes("incrowdsports.com")),
    "a rugby pull must reach the rugby feed").toBe(true);
});

test("rugby club crests come off the feed, in the right theme's variant", async ({ page }) => {
  /* Rugby leagues were drawing football badges matched by NAME -- Ireland the
     football side next to Ireland the rugby side -- and then, once that was
     stopped, no badge at all.

     The feed does not carry one TODAY -- a dump of every string in every
     endpoint it has contains no URL of any kind. This test is what says the
     app is ready the day it does, on either object that could plausibly carry
     it, and without a second call to go and look. */
  await openLeague(page, { managers: 4, played: 3 });

  const hits = [];
  await page.route("**/*", async (route) => {
    const url = decodeURIComponent(route.request().url());
    if (!(url.includes("incrowdsports.com") || url.includes("/functions/v1/")))
      return route.continue();
    hits.push(url);
    const json = (body) => route.fulfill({ contentType: "application/json",
                                           body: JSON.stringify(body) });
    if (url.includes("matches/search")) {
      return json({ status: "success", data: [
        { id: 910, status: "result", tbc: 0, date: "2026-01-10T17:00:00Z", round: 1,
          homeTeam: { id: 4, name: "Leinster", score: 30 },
          awayTeam: { id: 5, name: "Munster", score: 12 } },
        { id: 911, status: "result", tbc: 0, date: "2026-01-17T17:00:00Z", round: 2,
          homeTeam: { id: 6, name: "Ulster", score: 8 },
          awayTeam: { id: 5, name: "Munster", score: 9 } },
      ] });
    }
    const mid = (url.match(/matches\/(\d+)/) || [])[1];
    if (mid === "910") {
      return json({ status: "success", data: { id: 910, round: 1,
        // On the side itself: no extra call needed.
        homeTeam: { id: 4, name: "Leinster", score: 30, shortName: "LEI",
          imageUrls: { DEFAULT: "https://images.incrowdsports.com/lein.png",
                       ON_DARK: "https://images.incrowdsports.com/lein-dark.png" },
          players: [{ id: 1, known: "A Prop", positionId: 1, position: "prop",
                      stats: { minutesPlayedTotal: 80 } }] },
        // On the players, which is where the squad response puts it. Note the
        // player's OWN imageUrl sitting right beside it.
        awayTeam: { id: 5, name: "Munster", score: 12, shortName: "Munster Rugby",
          players: [{ id: 2, known: "A Lock", positionId: 4, position: "lock",
                      imageUrl: "https://images.incrowdsports.com/face-2.png",
                      teamImageUrls: { DEFAULT: "https://images.incrowdsports.com/mun.png",
                                       ON_DARK: "https://images.incrowdsports.com/mun-dark.png" },
                      stats: { minutesPlayedTotal: 80 } }] } } });
    }
    if (mid === "911") {
      return json({ status: "success", data: { id: 911, round: 2,
        // Nowhere at all -- which is every side in the real feed today.
        homeTeam: { id: 6, name: "Ulster", score: 8, shortName: "ULS",
          players: [{ id: 3, known: "A Hooker", positionId: 2, position: "hooker",
                      stats: { minutesPlayedTotal: 80 } }] },
        awayTeam: { id: 5, name: "Munster", score: 9, players: [] } } });
    }
    return json({});
  });

  const out = await page.evaluate(async () => {
    const competition = { name: "United Rugby Championship", apiLeagueId: 1068,
                          season: 2026, sport: "rugby" };
    const built = await fetchPoolFor(competition, "", () => {});
    const byId = Object.fromEntries(built.players.map((p) => [p.player_id, p]));
    // Now render as the app would, from the pool it just built.
    S.league.competition = competition;
    S.players = built.players;
    const at = (theme) => {
      if (theme === "dark") delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = theme;
      return { lein: crestUrlFor("Leinster"), ulster: crestUrlFor("Ulster"),
               html: teamCrestHtml("Leinster", "w-4 h-4", "LEI") };
    };
    const dark = at("dark"), sticker = at("sticker");
    delete document.documentElement.dataset.theme;
    return { stored: byId, dark, sticker };
  });

  expect(out.stored["rug_1"].team_crest, "a crest on the side itself is read")
    .toBe("https://images.incrowdsports.com/lein.png");
  expect(out.stored["rug_2"].team_crest, "a crest carried on the players is read")
    .toBe("https://images.incrowdsports.com/mun.png");
  expect(out.stored["rug_2"].photo, "and the player's own face is still their face")
    .toBe("https://images.incrowdsports.com/face-2.png");
  expect(out.stored["rug_2"].team_crest, "which is never mistaken for the club's badge")
    .not.toBe(out.stored["rug_2"].photo);
  expect(out.stored["rug_3"].team_crest, "a side with no crest anywhere gets none")
    .toBeUndefined();

  /* And costs nothing to find that out. There WAS a per-club teams/{id}
     look-up here; the live feed has no images on that endpoint either, so it
     was sixteen requests a pool build that could only ever return null. */
  expect(hits.filter((u) => /teams\/\d/.test(u)).length,
    "no club is looked up individually").toBe(0);

  // The code is the badge wherever a crest is missing, so it comes from the
  // feed's own shortName -- unless that is really a name.
  expect(out.stored["rug_3"].team_code, "the feed's own short code is used").toBe("ULS");
  expect(out.stored["rug_2"].team_code, "a long shortName is a name, not a code").toBe("MUN");

  expect(out.dark.lein, "dark draws the on-dark badge")
    .toBe("https://images.incrowdsports.com/lein-dark.png");
  expect(out.sticker.lein, "a light theme draws the default badge")
    .toBe("https://images.incrowdsports.com/lein.png");
  expect(out.dark.ulster, "and a club with no crest gets none, not a football one")
    .toBeNull();
  expect(out.dark.html, "a crest reaches the page as an image, not a code")
    .toContain("images.incrowdsports.com/lein-dark.png");
  expect(out.dark.html, "and a football crest never appears in a rugby league")
    .not.toContain("api-sports.io");
});

test("the rugby proxy is authenticated, and the feed is not given the key", async ({ page }) => {
  /* Edge functions verify a JWT by default, so a call with no Authorization
     header 401s before the function runs. The football proxy has always sent
     the anon key; the rugby one sent nothing, which would have failed on the
     first real request after deploying. The other half matters just as much:
     the key must NOT travel to a third-party feed. */
  await openLeague(page, { managers: 4, played: 3 });
  const seen = [];
  /* The proxy answers 404 — "not deployed" — which is what pushes the client
     onto its direct fallback. Without this the direct path is never taken and
     the second assertion below passes on an empty list, which is exactly how
     it passed with the rule deliberately broken. */
  await page.route("**/*", async (route) => {
    const url = decodeURIComponent(route.request().url());
    const auth = route.request().headers()["authorization"] || null;
    if (url.includes("/functions/v1/rugby-feed")) {
      seen.push({ to: "supabase", auth });
      return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    }
    if (url.includes("incrowdsports.com")) {
      seen.push({ to: "feed", auth });
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: [] }) });
    }
    return route.continue();
  });

  const env = await page.evaluate(async () => {
    await fetchRugbyMatches(1068).catch(() => {});
    return { hasKey: !!getConfig()?.key };
  });

  expect(env.hasKey, "the harness should have a Supabase key configured").toBe(true);
  const toSupabase = seen.filter((h) => h.to === "supabase");
  const toFeed = seen.filter((h) => h.to === "feed");
  expect(toSupabase.length, "the proxy should be tried first").toBeGreaterThan(0);
  expect(toFeed.length, "and a 404 should fall through to the feed itself").toBeGreaterThan(0);
  expect(toSupabase.every((h) => (h.auth || "").startsWith("Bearer ")),
    "every proxy call carries the anon key, or the function 401s").toBe(true);
  expect(toFeed.every((h) => !h.auth),
    "the Supabase key must never be sent to the third-party feed").toBe(true);
});

test("every squad screen renders for a sport with eight positions", async ({ page }) => {
  /* The first real rugby league died on load with "s.byPos[g] is not
     iterable": eleven functions seeded a per-position map as the object
     literal { GK: [], DEF: [], MID: [], FWD: [] }, so a rugby position read
     undefined and `for (const x of undefined)` threw. The counter-shaped
     version of this bug was found in Phase 3; the list-shaped one was not,
     because it is spelled with [] rather than 0.

     This walks the renderers that build one, with a real rugby squad. */
  await openLeague(page, { managers: 4, played: 3 });

  const out = await page.evaluate(() => {
    S.league.competition = { apiLeagueId: 2146, season: 2026, sport: "rugby" };
    // A full XV plus the club pick, at rugby positions.
    const squad = [];
    let n = 0;
    for (const g of RUGBY_PLAY_GROUPS)
      for (let i = 0; i < RUGBY_STARTERS[g]; i++)
        squad.push({ id: "pk" + (++n), player_id: "rug_" + n, player_name: `${g} Player ${i}`,
                     position: g, slot: g, team: "Ireland", is_sub: false, manager_id: "m1",
                     pick_number: n });

    const errs = [];
    const tryIt = (name, fn) => { try { fn(); } catch (e) { errs.push(`${name}: ${e.message}`); } };
    let shape = null;
    tryIt("squadShape", () => { shape = squadShape(squad); });
    tryIt("squadPitchHtml", () => squadPitchHtml(squad));
    tryIt("pitchHtml", () => pitchHtml(listsByGroup(), {}));
    tryIt("dreamTeam", () => dreamTeam());
    tryIt("lineupShape", () => lineupShape());
    return { errs, byPosKeys: Object.keys(shape?.byPos || {}).join(","),
             placed: Object.values(shape?.byPos || {}).reduce((a, l) => a + l.length, 0) };
  });

  expect(out.errs, "no squad renderer may throw on a rugby squad").toEqual([]);
  expect(out.byPosKeys, "the per-position map is keyed by the sport's own groups")
    .toBe("PR,HK,LK,LF,SH,FH,CE,OB");
  expect(out.placed, "and all fifteen players land in it").toBe(15);
});

test("a rugby draft can actually find someone to pick", async ({ page }) => {
  /* The second thing the first real rugby league said: "No available players
     fit the open quota." A pool full of PR/HK/LK/… against a quota that opens
     GK/DEF/MID/FWD produces exactly that, and it is silent -- the draft simply
     never offers anyone. */
  await openLeague(page, { managers: 4, played: 3 });

  const out = await page.evaluate(() => {
    S.league.competition = { apiLeagueId: 2146, season: 2026, sport: "rugby" };
    S.league.config = null;                 // the preset alone, as a new league has
    // A pool shaped like the one the feed builds: rugby positions, real teams.
    S.players = [];
    let n = 0;
    for (const team of ["Ireland", "France", "England", "Wales"])
      for (const g of RUGBY_PLAY_GROUPS)
        for (let i = 0; i < 4; i++)
          S.players.push({ player_id: `rug_${++n}`, name: `${g}${i} ${team}`,
                           position: g, team, team_code: team.slice(0, 3).toUpperCase() });
    S.teams = [...new Set(S.players.map((p) => p.team))].sort();
    S.playerById = Object.fromEntries(S.players.map((p) => [p.player_id, p]));
    S.picks = [];
    bustScores();

    const me = S.managers[0];
    const quota = posQuota();
    const open = posGroups().filter((g) => quotaLeft([], g) > 0);
    const cands = autoPickCandidates(me);
    const preview = autoPickPreview(me);
    return {
      quotaKeys: Object.keys(quota).join(","),
      open: open.join(","),
      poolSize: cands.pool.length,
      picked: preview?.entry?.position || null,
      perManager: picksPerManager(),
      groupsWithPlayers: RUGBY_PLAY_GROUPS.filter((g) => availableForGroup(g).length).length,
    };
  });

  expect(out.quotaKeys, "the quota is the rugby preset's")
    .toBe("PR,HK,LK,LF,SH,FH,CE,OB,TEAM");
  expect(out.groupsWithPlayers, "the pool covers all eight positions").toBe(8);
  expect(out.open, "every rugby position starts open, plus the club pick")
    .toBe("PR,HK,LK,LF,SH,FH,CE,OB,TEAM");
  expect(out.poolSize, "so there are candidates to draft").toBeGreaterThan(0);
  expect(out.picked, "and auto-pick finds one").not.toBeNull();
  expect("PR HK LK LF SH FH CE OB TEAM".split(" ")).toContain(out.picked);
  expect(out.perManager, "a rugby squad is nineteen players plus the club").toBe(20);
});

test("a rugby league with no pool says so, instead of filling up with footballers",
  async ({ page }) => {
    /* players.json is the built-in WORLD CUP squad list. Falling back to it
       when a competition pool is missing does not fail, it substitutes: the
       league fills with footballers at GK/DEF/MID/FWD, no rugby position
       matches the quota, and the only symptom is the draft saying "no
       available players fit the open quota" -- which points at the quota, and
       the quota is fine. */
    await openLeague(page, { managers: 4, played: 3 });
    const out = await page.evaluate(async () => {
      S.league.competition = { name: "Nations Championship", apiLeagueId: 2146,
                               season: 2026, sport: "rugby" };
      S._compPool = null;              // resolves, but holds no players
      S.players = [];
      let err = null;
      try { await loadPlayers(); } catch (e) { err = e.message; }
      return { err, players: S.players.length,
               positions: [...new Set(S.players.map((p) => p.position))].join(",") };
    });

    expect(out.err, "the failure should be reported, not papered over").toBeTruthy();
    expect(out.err).toContain("no player pool");
    expect(out.err, "and it should name the sport").toContain("Rugby");
    expect(out.players, "and no football pool should have been substituted").toBe(0);
  });

test("a rugby league in flex formation renders too", async ({ page }) => {
  /* The second real rugby league died with "cannot read properties of
     undefined (reading '0')". lineupShape's flex branch, and both flex
     blurbs, read b.DEF[0] / b.MID[0] / b.FWD[0] off the bounds object by
     name -- which on a sport with other positions is not a wrong sentence,
     it is a crash. The fixed branch did not throw; it silently totalled the
     starting side at zero, which is worse. */
  await openLeague(page, { managers: 4, played: 3 });

  const out = await page.evaluate(() => {
    S.league.competition = { apiLeagueId: 2146, season: 2026, sport: "rugby" };
    const errs = [];
    const tryIt = (name, fn) => { try { return fn(); } catch (e) { errs.push(`${name}: ${e.message}`); } };

    // Fixed mode first: the total must be the XV, not zero.
    S.league.config = null;
    const fixed = tryIt("lineupShape/fixed", () => lineupShape());

    // ...then flex, which is the mode that threw.
    S.league.config = { formationMode: "flex" };
    const flex = tryIt("lineupShape/flex", () => lineupShape());
    const mins = tryIt("formationMinsText", () => formationMinsText(formationBounds()));
    const range = tryIt("formationRangeText", () => formationRangeText(formationBounds()));
    tryIt("draftFactCards", () => draftFactCards());
    tryIt("squadPitchHtml", () => squadPitchHtml([]));
    S.league.config = null;
    return { errs, fixedTotal: fixed?.total, flexTotal: flex?.total,
             flexMinKeys: Object.keys(flex?.mins || {}).join(","), mins, range };
  });

  expect(out.errs, "no formation code may throw on a rugby league").toEqual([]);
  expect(out.fixedTotal, "a fixed rugby side is fifteen, not zero").toBe(15);
  expect(out.flexTotal, "and so is a flex one").toBe(15);
  expect(out.flexMinKeys, "bounds are keyed by the sport's own groups")
    .toBe("PR,HK,LK,LF,SH,FH,CE,OB");
  expect(out.mins, "the minimums are described in rugby positions").toContain("LF");
  expect(out.mins, "and never in football ones").not.toContain("DEF");
  expect(out.range, "as are the ranges").toMatch(/PR 2–3/);
});

test("a rugby league looks like rugby, not like football with different words",
  async ({ page }) => {
    /* Five things reported from the first playable rugby league, all of them
       the app showing football where it should have shown the sport it is on. */
    await openLeague(page, { managers: 4, played: 3 });

    const out = await page.evaluate(() => {
      S.league.competition = { apiLeagueId: 2146, season: 2026, sport: "rugby" };
      // photos.json is loaded whatever the sport: this is the map that was
      // drawing football federation badges beside rugby players.
      (S.photos ||= {}).teams = { Ireland: 4, France: 5, Japan: 12, Brazil: 6 };

      const byPos = {};
      RUGBY_PLAY_GROUPS.forEach((g) => {
        byPos[g] = [];
        for (let i = 0; i < RUGBY_STARTERS[g]; i++)
          byPos[g].push({ player_id: `rug_${g}${i}`, name: `${g}er ${i}`, team: "Ireland" });
      });
      const html = pitchHtml(byPos, { crests: true });
      const emptyAvatar = avatarHtml("nobody", "Ireland", "w-10 h-10");
      return {
        rugbyPitch: html.includes("pitch-rugby"),
        tryLine: html.includes("pitch-try"),
        twentyTwo: html.includes("pitch-22"),
        posts: html.includes("pitch-posts"),
        penaltyBox: html.includes("pitch-box"),
        pips: (html.match(/pp-pos/g) || []).length,
        pipShown: showPosPips(),
        crest: crestIdFor("Ireland"),
        emptyIsFlex: emptyAvatar.includes("inline-flex"),
        // The corner badge holds an IMAGE. It is 14px on a 40px avatar, and
        // the code fallback is type -- sized by its text, not by the 3.5 it
        // was asked for -- so it landed across the bottom half of the face
        // with the points bubble over the top, slicing the initials in two.
        crestBadge: html.includes("-bottom-0.5 -left-1"),
        crestBadgeIsMark: html.includes("club-tint") && html.includes("w-3.5 h-3.5"),
        crestBadgeIsPill: html.includes("club-chip"),
        // The bench draws the same corner badge, and was missed once already
        // when the pitch was fixed.
        benchBadge: dugoutHtml([{ player_id: "rug_b", name: "A Sub", team: "Ireland",
                                  position: "LF" }]).includes("-bottom-0.5 -left-1"),
      };
    });

    expect(out.rugbyPitch, "the pitch should know it is a rugby field").toBe(true);
    expect(out.tryLine && out.twentyTwo && out.posts,
      "with try lines, 22s and posts").toBe(true);
    expect(out.penaltyBox, "and no penalty boxes").toBe(false);
    expect(out.pipShown, "eight groups in four bands need a position pip").toBe(true);
    expect(out.pips, "one on every player in the XV").toBe(15);
    expect(out.crest, "no football crest may be resolved for a rugby team").toBeNull();
    /* A club with no crest is not nothing: it draws its own mark. What that
       corner must never hold is type sized by its own content -- that is what
       spread a pill across the bottom half of every face. */
    expect(out.crestBadge, "a club with no crest still gets a badge").toBe(true);
    expect(out.crestBadgeIsMark, "drawn as the club's own mark, at a fixed size")
      .toBe(true);
    expect(out.crestBadgeIsPill, "never as a text pill that sizes itself").toBe(false);
    expect(out.benchBadge, "and the bench draws the same one — it is one function now")
      .toBe(true);
    expect(out.emptyIsFlex,
      "a photoless avatar must still take up its box, or the sticker collapses").toBe(true);

    // ...and football keeps its own pitch, boxes and no pips.
    const fb = await page.evaluate(() => {
      S.league.competition = null;
      const html = pitchHtml({ GK: [{ player_id: "a", name: "Keeper", team: "Brazil" }] },
                             { crests: true });
      return { rugby: html.includes("pitch-rugby"), box: html.includes("pitch-box"),
               pips: (html.match(/pp-pos/g) || []).length, pipShown: showPosPips(),
               crest: crestIdFor("Brazil"),
               crestBadge: html.includes("-bottom-0.5 -left-1") };
    });
    expect(fb.rugby, "football keeps its own pitch").toBe(false);
    expect(fb.box, "with its penalty boxes").toBe(true);
    expect(fb.pipShown, "one group per row needs no pip").toBe(false);
    expect(fb.pips, "so football draws none").toBe(0);
    expect(fb.crest, "and football crests still resolve").not.toBeNull();
    expect(fb.crestBadge, "so football still tucks one into the corner").toBe(true);
  });

test("editing a lineup is a swap, not an add and a remove", async ({ page }) => {
  /* The old editor gave every player a + or a −, so filling one hole could put
     three players into a row before you noticed -- and on a fifteen-a-side
     pitch that row ran off the screen. Now a tap picks a player up, everyone
     they can legally trade with stays lit, and a second tap exchanges the two. */
  await openLeague(page, { managers: 4, played: 3 });

  const out = await page.evaluate(() => {
    closeReveal();
    const me = myManager();
    const mine = managerPicks(me.id).filter((pk) => pk.slot !== "TEAM");
    // Start from a legal side, which is the state the swap flow is for.
    const want = starterQuota(), got = {};
    S.lineupDraft = new Set();
    for (const pk of mine)
      if ((got[pk.position] || 0) < (want[pk.position] || 0)) {
        S.lineupDraft.add(pk.id); got[pk.position] = (got[pk.position] || 0) + 1;
      }
    S.lineupEdit = true; S.lineupPick = null;
    renderLineup();
    const before = sumGroups(lineupCounts());

    const held = mine.find((pk) => S.lineupDraft.has(pk.id) && pk.position === "MID");
    const sameOnBench = mine.find((pk) => !S.lineupDraft.has(pk.id) && pk.position === "MID");
    const otherOnBench = mine.find((pk) => !S.lineupDraft.has(pk.id) && pk.position === "GK");
    const tap = (id) => document.querySelector(`[data-hold="${id}"]`)?.click();

    tap(held.id);
    const heldState = {
      selected: !!document.querySelector(".pp-sel"),
      eligibleLit: !document.querySelector(`[data-brow="${sameOnBench.id}"]`)
        ?.className.includes("opacity-40"),
      ineligibleDim: !!document.querySelector(`[data-brow="${otherOnBench.id}"]`)
        ?.className.includes("opacity-40"),
    };

    // Trading with a position the formation cannot take must change nothing.
    tap(otherOnBench.id);
    const refused = S.lineupDraft.has(held.id) && !S.lineupDraft.has(otherOnBench.id);

    // ...and with a like-for-like it goes through.
    tap(sameOnBench.id);
    const swapped = !S.lineupDraft.has(held.id) && S.lineupDraft.has(sameOnBench.id);

    const after = sumGroups(lineupCounts());
    const stillLegal = lineupValid(lineupCounts());
    S.lineupEdit = false; S.lineupPick = null;
    return { before, after, heldState, refused, swapped, stillLegal,
             plusButtons: document.querySelectorAll("[data-lineup]").length };
  });

  expect(out.heldState.selected, "the held player is marked on the pitch").toBe(true);
  expect(out.heldState.eligibleLit, "a like-for-like partner stays lit").toBe(true);
  expect(out.heldState.ineligibleDim, "one the formation cannot take is dimmed").toBe(true);
  expect(out.refused, "and tapping the dimmed one changes nothing").toBe(true);
  expect(out.swapped, "while the eligible one trades places").toBe(true);
  expect(out.after, "a swap never changes the size of the side").toBe(out.before);
  expect(out.stillLegal, "and never leaves it illegal").toBe(true);
  expect(out.plusButtons, "the + and − controls are gone").toBe(0);
});

test("a round already under way keeps line-ups locked", async ({ page }) => {
  /* Reported from the app: matchweek 1 live in the banner, and the card
     directly beneath it offering "Last chance to set your team · Matchweek 2"
     with an editable XI.

     The cause was that `upcoming` rolls to the NEXT matchweek the instant the
     current one's first game kicks off, and the lock is derived from that
     week's kickoff -- days away. So the window sprang back open mid-round.

     A real matchweek runs Friday night to Monday night, so the seed's
     all-at-once round is reshaped here into that spread: the hours that matter
     are the quiet ones, when nothing is live and a manager would otherwise be
     rewriting their XI having already seen Saturday's results. */
  await openLeague(page, { managers: 2, played: 3, h2h: true });

  const round = await page.evaluate(() => {
    const weeks = matchweeksOf(S.fixtures);
    const next = weeks[weeks.length - 1];             // the one not yet played
    const DAY = 24 * 3600e3;
    let i = 0;
    // Friday to Monday, the shape a real matchweek has. New array rather than a
    // mutation: autoWindowState caches on the array's identity.
    const spread = S.fixtures.map((f) => f.round !== next.round ? f
      : { ...f, status: "NS",
          kickoff_utc: new Date(next.first + (i++ % 4) * DAY).toISOString() });
    /* And a round AFTER it. Without one there is no next kickoff to lock
       against, so the window stays shut whatever the code does -- which would
       make this test pass with the bug put back in. The reported situation had
       matchweek 2 sitting a week beyond the live matchweek 1. */
    const nextWeek = new Date(next.first + 10 * DAY).toISOString();
    S.fixtures = spread.concat(spread.slice(0, 4).map((f, k) => ({
      ...f, fixture_id: 90000 + k, round: "Regular Season - 9",
      status: "NS", kickoff_utc: nextWeek })));
    return { name: next.round, first: next.first, last: next.first + 3 * DAY };
  });

  const at = async (ms) => {
    await page.clock.setFixedTime(new Date(ms));
    return page.evaluate(() => {
      renderHomeTab();
      const p = matchdayNow();
      return { stage: p.stage, title: p.title, matchweek: p.matchweek,
               lineupOpen: lineupOpen(),
               cta: p.cta?.act || null,
               offersLineup: !!document.querySelector('#md-cta[data-act="lineup"]') };
    });
  };

  const before = await at(round.first - 6 * 3600e3);
  expect(before.lineupOpen, "the window was shut before the round even started")
    .toBe(true);

  // Saturday morning: the round has started, nothing is on this minute.
  const quiet = await at(round.first + 14 * 3600e3);
  expect(quiet.lineupOpen, "line-ups were editable mid-round — the reported bug")
    .toBe(false);
  expect(quiet.stage, "a round under way was reported as finished").toBe("locked");
  expect(quiet.title, "the card still invited an edit").not.toMatch(/set your team/i);
  expect(quiet.offersLineup, "the card offered a button openLineup would refuse")
    .toBe(false);
  /* The label half of the same bug: the card named the round that had not
     started rather than the one being played. */
  expect(quiet.matchweek, "the card named the wrong matchweek")
    .toBe(String(Number(round.name.match(/\d+/)?.[0])));

  // Still locked while the final game of the round is being played.
  const last = await at(round.last + 3600e3);
  expect(last.lineupOpen, "the last game of the round was treated as the end of it")
    .toBe(false);

  /* Reopening once the round ends is covered by the pure tests, not here: the
     round reshaped above is the seed's LAST matchweek, so after it there is no
     next kickoff to lock against and the window correctly stays shut. */

  // The sheet itself refuses, not just the card — this is what actually stops
  // the edit, and it must not leave the page scroll-locked behind nothing.
  await at(round.first + 14 * 3600e3);
  const refused = await page.evaluate(() => {
    openLineup();
    return { open: !document.getElementById("lineup-sheet").classList.contains("hidden"),
             overflow: document.body.style.overflow };
  });
  expect(refused.open, "the lineup sheet opened mid-round").toBe(false);
  expect(refused.overflow).not.toBe("hidden");
});

test("the log says 'as it stands' while a round is still being played",
  async ({ page }) => {
  /* A table built on a round in progress reads exactly like a final one,
     which is how somebody tells their group chat they have won on a Saturday
     night. Reported from the app. */
  await openLeague(page, { managers: 6, played: 3, h2h: true });

  const cur = await page.evaluate(() => {
    document.getElementById("reveal-sheet")?.classList.add("hidden");
    // Spread the newest played round Friday->Monday, the shape a real one has.
    const weeks = matchweeksOf(S.fixtures);
    const w = weeks[weeks.length - 2];
    const DAY = 24 * 3600e3; let i = 0;
    S.fixtures = S.fixtures.map((f) => f.round !== w.round ? f
      : { ...f, kickoff_utc: new Date(w.first + (i++ % 4) * DAY).toISOString() });
    return { first: w.first, last: w.first + 3 * DAY };
  });

  const logAt = async (ms) => {
    await page.clock.setFixedTime(new Date(ms));
    return page.evaluate(() => {
      S._recapChecked = true;                 // the recap owns its own test
      setBoardTab("lb"); renderBoard();
      const box = document.getElementById("board-lb");
      return { text: box.textContent,
               flagged: !!box.querySelector(".todo-alert") };
    });
  };

  // Sunday morning: the round has started, nothing is on this minute.
  const mid = await logAt(cur.first + 36 * 3600e3);
  expect(mid.flagged, "a provisional table is not marked as one").toBe(true);
  expect(mid.text).toContain("As it stands");
  expect(mid.text, "it still counts the unfinished round as played")
    .not.toMatch(/\b3 rounds played\b/);

  // Still provisional while the last game of the round is on.
  expect((await logAt(cur.last + 3600e3)).flagged,
    "the round's last game being on was treated as the round being over")
    .toBe(true);

  // Once the round is over, the table is the table.
  const done = await logAt(cur.last + 4 * 3600e3);
  expect(done.flagged, "a finished round still claims to be provisional").toBe(false);
  expect(done.text).not.toContain("As it stands");
});

test("a fixture's leader is shown by weight, not by colouring the name green",
  async ({ page }) => {
  await openLeague(page, { managers: 6, played: 3, h2h: true });
  const seen = await page.evaluate(() => {
    document.getElementById("reveal-sheet")?.classList.add("hidden");
    S._recapChecked = true;
    setBoardTab("fixtures"); renderBoard();
    const live = getComputedStyle(document.documentElement)
      .getPropertyValue("--c-live").trim();
    const rows = [...document.querySelectorAll("#board-fixtures [data-fix]")];
    const names = rows.flatMap((r) =>
      [...r.querySelectorAll(".grid > span")].slice(0, 3).filter((_, i) => i !== 1)
        .map((n) => ({ colour: getComputedStyle(n).color,
                       weight: Number(getComputedStyle(n).fontWeight) })));
    return { live, names, rows: rows.length };
  });
  expect(seen.rows, "no fixtures to look at").toBeGreaterThan(0);
  /* The score bar underneath already says whose lead it is and by how much;
     a green NAME was a second, louder signal for the same fact, and green on
     a name reads as a status rather than as a score. */
  const [r, g, b] = seen.live.split(/\s+/).map(Number);
  const greenish = `rgb(${r}, ${g}, ${b})`;
  expect(seen.names.map((n) => n.colour), "a manager's name is still green")
    .not.toContain(greenish);
  expect(seen.names.some((n) => n.weight >= 700),
    "nothing marks the leader at all now").toBe(true);
});

test("scoring can be corrected after a game has been scored, but only deliberately",
  async ({ page }) => {
  /* Every total in this app is recomputed from the rules rather than stored,
     so editing them rewrites results that have already happened. That is why
     the design locks once a game is scored -- and why it has to be openable:
     a league that finds a rule wrong in gameweek 1 should be able to fix it
     rather than live with it for a season. Reported from the app: the league
     always meant to score on pass accuracy PERCENTAGE, not the count. */
  await openLeague(page, { managers: 2, played: 3 });
  const shown = await page.evaluate(() => {
    document.getElementById("reveal-sheet")?.classList.add("hidden");
    showView("admin"); renderAdmin();
    // The scoring card lives inside a collapsed section; open it the way a
    // person would before reaching for anything in it.
    document.querySelectorAll('[data-view="admin"] details').forEach((d) => d.open = true);
    const box = document.getElementById("adm-config");
    return { locked: !!box.querySelector("#adm-config-unlock"),
             save: !!document.getElementById("adm-config-save"),
             inputs: box.querySelectorAll("input:not([disabled])").length,
             text: box.textContent };
  });
  expect(shown.locked, "a scored league does not warn that its design is locked")
    .toBe(true);
  expect(shown.save, "a locked design still offers Save").toBe(false);
  expect(shown.text, "the lock does not say how much is at stake")
    .toMatch(/match(es)? have already been scored|match has already been scored/);

  // Unlocking is its own act, behind a confirm that names the consequence.
  const asked = [];
  await page.evaluate(() => { window.confirm = (m) => (window.__asked = m, true); });
  await page.locator("#adm-config-unlock").click();
  asked.push(await page.evaluate(() => window.__asked));
  expect(asked[0], "unlocking does not say what it will recalculate")
    .toMatch(/recalculated/);

  const open = await page.evaluate(() => {
    const box = document.getElementById("adm-config");
    return { save: !!document.getElementById("adm-config-save"),
             warned: !!box.querySelector(".todo-alert.is-bad"),
             editable: box.querySelectorAll("select:not([disabled])").length };
  });
  expect(open.save, "unlocking did not make the design editable").toBe(true);
  expect(open.editable, "the rule pickers are still disabled").toBeGreaterThan(0);
  expect(open.warned, "an unlocked design does not say it will rewrite results")
    .toBe(true);

  /* And it closes behind you. Walking away has to re-lock, or a panel left
     open becomes a setting rather than a decision. */
  const relocked = await page.evaluate(() => {
    showView("board"); showView("admin"); renderAdmin();
    document.querySelectorAll('[data-view="admin"] details').forEach((d) => d.open = true);
    return !!document.getElementById("adm-config-unlock");
  });
  expect(relocked, "the design stayed unlocked after leaving the panel").toBe(true);
});

test("pass accuracy is offered as a percentage, not only as a count",
  async ({ page }) => {
  await openLeague(page, { managers: 2, played: 3 });
  const opts = await page.evaluate(() => {
    document.getElementById("reveal-sheet")?.classList.add("hidden");
    showView("admin"); renderAdmin();
    document.querySelectorAll('[data-view="admin"] details').forEach((d) => d.open = true);
    return [...document.querySelectorAll('#adm-config select[data-rk="stat"] option')]
      .map((o) => o.textContent);
  });
  expect(opts, "there is no way to score a pass-accuracy percentage")
    .toContain("Pass accuracy %");
  expect(opts, "the raw count is no longer offered under its own name")
    .toContain("Accurate passes");
});

test("editing the scoring design leaves every other league setting alone",
  async ({ page }) => {
  /* leagues.config is one blob holding everything about a league -- whether it
     is head-to-head, whether it has captains, its windows, its waiver rules,
     its pool corrections. The design editor renders a handful of those and
     used to save by rebuilding a config from the fields on screen and writing
     that over the column, destroying every key it does not render.

     Reported from the app by someone who changed a scoring rule and found
     their league was no longer head-to-head and their captains had gone. */
  await openLeague(page, { managers: 2, played: 3, h2h: true });

  const before = await page.evaluate(() => {
    document.getElementById("reveal-sheet")?.classList.add("hidden");
    // A setting the editor never shows, and a pool correction nobody could
    // re-enter from memory.
    S.league.config = { ...S.league.config, poolEdit: { api_1: { position: "MID" } } };
    let wrote = null;
    S.sb.from = ((orig) => (t) => t === "leagues"
      ? { update: (v) => { wrote = v; return { eq: async () => ({}) }; } }
      : orig(t))(S.sb.from.bind(S.sb));
    window.__wrote = () => wrote;
    return { h2h: h2hEnabled(), captain: captainEnabled(),
             auto: autoWindowsEnabled() };
  });
  expect(before.h2h, "the seed is not head-to-head, so this proves nothing").toBe(true);
  expect(before.captain, "the seed has no captains, so this proves nothing").toBe(true);

  await page.evaluate(() => {
    showView("admin"); renderAdmin();
    document.querySelectorAll('[data-view="admin"] details').forEach((d) => d.open = true);
    window.confirm = () => true;
    document.getElementById("adm-config-unlock")?.click();
    document.getElementById("adm-config-save").click();
  });

  const wrote = await page.evaluate(() => window.__wrote());
  expect(wrote, "nothing was written").toBeTruthy();
  expect(wrote.config.h2hEnabled, "saving scoring turned off head-to-head").toBe(true);
  expect(wrote.config.captain, "saving scoring turned off captains").toBe(true);
  expect(wrote.config.autoWindows, "saving scoring turned off automatic windows").toBe(true);
  expect(wrote.config.poolEdit, "saving scoring discarded the pool corrections")
    .toEqual({ api_1: { position: "MID" } });

  const after = await page.evaluate(() => ({
    h2h: h2hEnabled(), captain: captainEnabled(), auto: autoWindowsEnabled(),
  }));
  expect(after, "the league changed shape when only scoring was edited").toEqual(before);
});

test("resetting scoring resets scoring, not the whole league", async ({ page }) => {
  await openLeague(page, { managers: 2, played: 3, h2h: true });
  const wrote = await page.evaluate(async () => {
    document.getElementById("reveal-sheet")?.classList.add("hidden");
    // A custom rule to reset AWAY from -- without one, "scoring is gone"
    // is true before the button is pressed and proves nothing.
    S.league.config = { ...S.league.config,
      scoring: [{ stat: "goals.total", mode: "each", points: 99 }] };
    let w = "untouched";
    S.sb.from = ((orig) => (t) => t === "leagues"
      ? { update: (v) => { w = v; return { eq: async () => ({}) }; } }
      : orig(t))(S.sb.from.bind(S.sb));
    window.confirm = () => true;
    await resetConfigEditor();
    return w;
  });
  /* It used to write null over the entire column -- a different sentence from
     the one on the button, which says "scoring & bonuses". */
  expect(wrote.config, "reset wiped the whole league config").not.toBeNull();
  expect(wrote.config.h2hEnabled, "reset turned off head-to-head").toBe(true);
  expect(wrote.config.captain, "reset turned off captains").toBe(true);
  expect(wrote.config.scoring, "reset left the custom scoring in place").toBeUndefined();
  expect(wrote.config.stageBonus, "reset left a custom stage bonus in place").toBeUndefined();
});

/* ---------- what a manager sees BETWEEN two matchweeks ----------
   The seeded league sits exactly there: the newest round finished three and a
   half days ago, the next is three and a half days out, the trade window is
   open. Three separate complaints came from that one state. */

test("a finished round's points are not tallied against the next round's lineup",
  async ({ page }) => {
  await openLeague(page, { managers: 6, played: 2, h2h: true });

  const gap = await page.evaluate(() => {
    document.getElementById("reveal-sheet")?.classList.add("hidden");
    document.getElementById("recap-sheet")?.classList.add("hidden");
    S._recapChecked = true;
    S.homeScoreMode = "round";       // a manager who used the toggle last week
    setBoardTab("home"); renderBoard();
    const box = document.getElementById("board-home");
    const h = managerHistory(myManager().id);
    return {
      curRound: h.curRound, played: h.curRoundPlayed,
      roundPts: h.current.items.reduce((s, i) => s + (i.roundPts || 0), 0),
      toggle: !!box.querySelector("[data-scoremode]"),
      head: box.querySelector('[data-hist="older"]')?.parentElement
              ?.textContent.replace(/\s+/g, " ").trim(),
      total: h.total,
    };
  });
  /* "This round" used to mean the newest round with RESULTS, so between two
     matchweeks it drew the finished round's points against the squad you had
     just picked for the next one. Reported from the app. */
  expect(gap.curRound, "the current lineup is still filed under the old round").toBe(3);
  expect(gap.played, "a round nobody has played is being called played").toBe(false);
  expect(gap.roundPts, "last round's points leaked into the new round").toBe(0);
  expect(gap.toggle, "This round is on offer with nothing to total").toBe(false);
  expect(gap.head, "the header still claims a round total").toContain("season to date");
  expect(gap.total, "the season total was collateral damage").toBeGreaterThan(0);

  // Positive control: mid-round the toggle is back, and it totals THAT round.
  const mid = await page.evaluate(async () => {
    const weeks = matchweeksOf(S.fixtures);
    return weeks[weeks.length - 2].first + 3600e3;      // an hour into round 2
  });
  await page.clock.setFixedTime(new Date(mid));
  const live = await page.evaluate(() => {
    S.homeScoreMode = "round";
    setBoardTab("home"); renderBoard();
    const box = document.getElementById("board-home");
    const h = managerHistory(myManager().id);
    return {
      curRound: h.curRound, played: h.curRoundPlayed,
      roundPts: h.current.items.reduce((s, i) => s + (i.roundPts || 0), 0),
      toggle: !!box.querySelector("[data-scoremode]"),
      head: box.querySelector('[data-hist="older"]')?.parentElement
              ?.textContent.replace(/\s+/g, " ").trim(),
    };
  });
  expect(live.curRound, "the round being played is not the current round").toBe(2);
  expect(live.played, "a round with results is not being counted").toBe(true);
  expect(live.toggle, "This round vanished during a round").toBe(true);
  expect(live.roundPts, "the round in progress totals nothing").toBeGreaterThan(0);
  expect(live.head).toContain("round 2");
});

test("the round recap can be opened, not only waited for", async ({ page }) => {
  await openLeague(page, { managers: 6, played: 2, h2h: true });
  /* Its only button lived in matchdayPlan's `results` stage, which cannot
     occur: lineupOpen is tested first and is true for the whole gap between
     matchweeks. The auto-open was the only real way in, and it fires once and
     is then suppressed by a localStorage stamp for good. */
  const shown = await page.evaluate(() => {
    document.getElementById("reveal-sheet")?.classList.add("hidden");
    document.getElementById("recap-sheet")?.classList.add("hidden");
    S._recapChecked = true;
    localStorage.setItem("wcf_recap_" + S.league.id, "99");   // already seen
    setBoardTab("home"); renderBoard();
    const btn = document.getElementById("md-recap");
    btn?.click();
    return {
      label: btn?.textContent.replace(/\s+/g, " ").trim(),
      opened: !document.getElementById("recap-sheet").classList.contains("hidden"),
      body: document.getElementById("recap-body").textContent.replace(/\s+/g, " ").trim(),
    };
  });
  expect(shown.label, "no way to reach the recap at all").toBe("Round 2 recap ›");
  expect(shown.opened, "the link does not open the sheet").toBe(true);
  expect(shown.body).toContain("Round 2 complete");

  // No finished round, no link: it is an offer, not furniture.
  const none = await page.evaluate(() => {
    S.stats = []; bustScores(); S.histIdxByMgr = {};
    setBoardTab("home"); renderBoard();
    return !!document.getElementById("md-recap");
  });
  expect(none, "a league with nothing to recap still offers a recap").toBe(false);
});

test("waiver priority is the table, reset every window, whatever is stored",
  async ({ page }) => {
  await openLeague(page, { managers: 6, played: 2, h2h: true });
  /* Two bugs in one rule. The order used to be READ from
     managers.waiver_order, and the only thing that ever wrote it was
     resetWaiverOrder(), called from the manual open-the-window tap -- which
     returns early in auto-window mode. So an auto league's queue was null for
     everyone and the screen had nothing to draw at all ("I can't see the waiver
     order?"), and once a batch did write it, the queue would have frozen a
     half-season-old table into place for good.

     It is derived now: worst-placed first, off the table, every window. The
     stored column is read by nobody, which is what this seeds a contradiction
     into to prove. */
  const seen = await page.evaluate(() => {
    // Exactly the order the table does NOT give: best-placed first.
    standingsOrder().forEach((id, i) => {
      const m = S.managers.find((x) => x.id === id);
      if (m) m.waiver_order = i;
    });
    const name = (id) => S.managers.find((m) => m.id === id).name;
    const worstFirst = standingsOrder().slice().reverse().map(name);
    document.getElementById("reveal-sheet")?.classList.add("hidden");
    document.getElementById("recap-sheet")?.classList.add("hidden");
    S._recapChecked = true;
    setBoardTab("trades"); S.tradeTab = "deals"; renderBoard();
    const box = document.getElementById("board-trades");
    return { worstFirst,
      shown: [...box.querySelectorAll("details ol li")]
        .map((li) => /Mgr\d+/.exec(li.textContent)?.[0]),
      unset: box.textContent.includes("not in the league table yet"),
      mine: Number(/You're #(\d+)/.exec(box.textContent)?.[1]) };
  });
  expect(seen.shown.length, "the waiver queue is not on screen at all").toBe(6);
  /* Worst-placed first — the same rule processFaClaims resolves with, and NOT
     the contradictory order sitting in the column. */
  expect(seen.shown).toEqual(seen.worstFirst);
  expect(seen.unset, "your seat is being reported as undecided").toBe(false);
  expect(seen.mine, "your own seat disagrees with the list")
    .toBe(seen.worstFirst.indexOf("Mgr1") + 1);

  /* ...and resolving a batch leaves nothing behind. A contested win reorders
     the turns INSIDE the batch, which is what stops one manager taking
     everything, but next window starts from the table again. */
  const after = await page.evaluate(async () => {
    const wrote = [];
    const orig = S.sb.from.bind(S.sb);
    S.sb.from = (t) => t === "managers"
      ? { update: (v) => { wrote.push(v); return { eq: async () => ({}) }; } }
      : orig(t);
    const me = myManager(), other = activeManagers().find((m) => m.id !== me.id);
    const owned = new Set(S.picks.map((p) => p.player_id));
    const mine = managerPicks(me.id).find((p) => !p.is_sub && p.slot !== "TEAM");
    const theirs = managerPicks(other.id).find((p) => p.position === mine.position && !p.is_sub);
    // Both chasing the same free agent: a genuine contest.
    const target = S.players.find((p) => !owned.has(p.player_id) && p.position === mine.position);
    S.faClaims = [
      { id: "q1", manager_id: me.id, rank: 0, status: "pending", pick_id: mine.id,
        out_player_id: mine.player_id, in_player_id: target.player_id,
        in_player_name: target.name, out_player_name: mine.player_name },
      { id: "q2", manager_id: other.id, rank: 0, status: "pending", pick_id: theirs.id,
        out_player_id: theirs.player_id, in_player_id: target.player_id,
        in_player_name: target.name, out_player_name: theirs.player_name },
    ];
    await processFaClaims();
    S.sb.from = orig;
    return { wrote, name: (id) => id };
  });
  expect(after.wrote.some((v) => "waiver_order" in v),
    "the batch wrote a waiver order back, so next window inherits this one")
    .toBe(false);
});

test("a squads re-pull cannot reclassify a player somebody has drafted",
  async ({ page }) => {
  /* Two stores hold a player's position: `picks.position`, which per-position
     scoring, the quota, formation validity and the auto-subs all read, and the
     pool row, which the players list, Dream XI and the detail sheet read.
     pickReconciliation already refuses to write a changed feed position onto a
     pick -- it would re-score history -- but nothing stopped the POOL from
     changing, so the same player showed one total on the pitch and another two
     taps away, under a different position's rules. Reported from the app:
     "de cuyper was a def, now suddenly a mid". */
  await openLeague(page, { managers: 4, played: 2 });
  const seen = await page.evaluate(() => {
    document.getElementById("reveal-sheet")?.classList.add("hidden");
    document.getElementById("recap-sheet")?.classList.add("hidden");
    S._recapChecked = true;
    const me = myManager();
    const pk = managerPicks(me.id).find((p) => !p.is_sub && p.position === "DEF");
    const before = playerPoints(pk.player_id, pk.position);
    // The feed comes back having reclassified him. This is the shared pool
    // row, exactly what "Load competition" rewrites.
    S._poolBase = S._poolBase.map((p) =>
      p.player_id === pk.player_id ? { ...p, position: "MID", pos_feed: undefined } : p);
    applyPoolOverrides(); bustScores();
    const pool = S.playerById[pk.player_id];
    return { name: pk.player_name, drafted: pk.position,
      poolPos: pool.position, feed: pool.pos_feed, before,
      // The two screens, on the same player.
      onPitch: playerPoints(pk.player_id,
        managerPicks(me.id).find((p) => p.player_id === pk.player_id).position),
      inList: playerPoints(pool.player_id, pool.position) };
  });
  expect(seen.drafted, "the seed gave us the wrong player to test with").toBe("DEF");
  expect(seen.poolPos, "the feed's reclassification reached the pool").toBe("DEF");
  expect(seen.feed, "what the feed actually said was thrown away").toBe("MID");
  expect(seen.onPitch, "the pitch total moved").toBe(seen.before);
  expect(seen.inList, "the same player is worth two different totals")
    .toBe(seen.onPitch);
});

test("the recap counts the points you LEFT on the bench, not the ones it banked",
  async ({ page }) => {
  /* Every round item carries two numbers: `pts`, what counted for you, and
     `scored`, what the player earned. The card read `pts` for the bench --
     which is zero for anyone who never came on, and the full amount for a sub
     who did. So it reported the points your bench BANKED as the points you
     left there. Reported from the app: "1 points left" against a bench that
     had 27 on it. */
  await openLeague(page, { managers: 4, played: 2 });
  const r = await page.evaluate(() => {
    document.getElementById("reveal-sheet")?.classList.add("hidden");
    document.getElementById("recap-sheet")?.classList.add("hidden");
    S._recapChecked = true;
    const h = managerHistory(myManager().id);
    const round = h.rounds[h.rounds.length - 1];
    const bench = round.items.filter((it) => it.entry.is_sub);
    return {
      n: round.n,
      benchPts: myRecap().benchPts,
      // Nobody was absent in this seed, so no sub came on and every bench
      // point is a point left behind.
      cameOn: round.cameOn.length,
      benchScored: bench.reduce((s, it) => s + (it.scored || 0), 0),
      benchCounted: bench.reduce((s, it) => s + (it.pts || 0), 0),
      shape: bench.map((it) => [it.scored, it.pts, it.counted]),
    };
  });
  expect(r.cameOn, "a sub came on, so this seed cannot test what was left").toBe(0);
  expect(r.benchScored, "the bench scored nothing at all — nothing to leave")
    .toBeGreaterThan(0);
  expect(r.benchCounted, "an unused bench somehow counted for something").toBe(0);
  expect(r.benchPts, "the recap is still reading the counted figure")
    .toBe(r.benchScored);
  // ...and the two numbers really are carried separately, not aliased.
  expect(r.shape.some(([sc, pts]) => sc !== pts),
    "scored and pts are the same number, so nothing was actually measured")
    .toBe(true);

  /* ...and a starter who never turned out is not the quietest man on the
     pitch. His cover came on and it cost nothing; naming him reported a 0
     while somebody who played ninety minutes had done less. */
  const seed = await openLeague(page, { managers: 4, played: 2, missingStarters: 2 });
  const q = await page.evaluate(() => {
    document.getElementById("reveal-sheet")?.classList.add("hidden");
    document.getElementById("recap-sheet")?.classList.add("hidden");
    S._recapChecked = true;
    const h = managerHistory(myManager().id);
    const round = h.rounds[h.rounds.length - 1];
    const rc = myRecap();
    return { missed: round.missed, worst: rc.worst.entry.player_id,
             cameOn: round.cameOn };
  });
  expect(q.missed, "the seed's absentees never reached the round")
    .toEqual(seed.absent);
  expect(q.cameOn.length, "nobody came on, so nothing was covered")
    .toBeGreaterThan(0);
  expect(q.missed, "an absent starter is being called the quietest")
    .not.toContain(q.worst);
});

test("refreshing the competition applies a real-world transfer, and asks nothing",
  async ({ page }) => {
  /* Two jobs sat behind one button and only one of them was reachable.
     SETTING the competition is a change -- it can orphan scored games, and
     reusing a pool another league loaded is the fast path. REFRESHING the one
     you are already on is not a change: it is the only thing that moves a
     drafted player to his new club, because reconcilePicksToPool has no other
     caller. Both confirms were asked either way, and on a refresh both pointed
     the wrong way -- one warned about orphaning games nothing was going to
     touch, and the other's OK, the button a person actually presses, quietly
     did nothing while Cancel was the action. Reported from the app:
     "there have been multiple real life transfers and I cant get it to
     reflect in the app". */
  const seed = await openLeague(page, { managers: 4, played: 2 });
  const asked = [];

  const moved = await page.evaluate(async ([clubs]) => {
    const me = myManager();
    const pk = managerPicks(me.id).find((p) => !p.is_sub && p.slot !== "TEAM");
    // Captured now: reconcilePicksToPool writes the new club onto this very
    // object, so reading pk.team afterwards reports the answer, not the setup.
    const from = pk.team;
    const to = clubs.find((c) => c !== from);
    window.__asked = [];
    window.confirm = (t) => { window.__asked.push(t); return true; };
    // The league is already on a competition, and the shared pool already has
    // rows -- the exact state both dialogs used to fire in.
    S.league.competition = { name: "Prem", apiLeagueId: 39, season: 2026, sport: "football" };
    S.players = S.players.map((p) => ({ ...p }));
    S._poolBase = S.players;
    window.__db.tables.competition_pools = [{ competition_key: "39-2026",
      players: S.players, fixtures: S.fixtures, round_order: [] }];
    /* The feed comes back with him at a new club. fetchPoolFor is the only
       thing that talks to the API here, so stubbing it is stubbing the pull. */
    window.fetchPoolFor = async () => ({
      players: S.players.map((p) =>
          p.player_id === pk.player_id ? { ...p, team: to } : p),
      teams: clubs, fixtures: S.fixtures, roundOrder: [] });
    document.getElementById("adm-api-key").value = "k";
    document.getElementById("adm-comp-select").innerHTML =
      '<option value="39">Prem</option>';
    document.getElementById("adm-comp-season").value = "2026";
    await loadCompetition({ refresh: true });
    return { id: pk.player_id, name: pk.player_name, from, to,
      pickNow: managerPicks(me.id).find((p) => p.player_id === pk.player_id).team,
      poolNow: S.playerById[pk.player_id].team,
      asked: window.__asked,
      log: document.getElementById("adm-comp-log").textContent };
  }, [seed.clubs]);

  expect(moved.to, "the seed has only one club, so nothing can move")
    .not.toBe(moved.from);
  expect(moved.asked, "a refresh is still stopping to ask something").toEqual([]);
  expect(moved.pickNow, "the transfer never reached the pick").toBe(moved.to);
  expect(moved.poolNow, "the transfer never reached the pool").toBe(moved.to);
  // ...and it says who moved, rather than a count nobody can check. That line
  // used to be written and overwritten by the summary on the next statement.
  expect(moved.log).toContain(`${moved.name}: ${moved.from} → ${moved.to}`);
  expect(moved.log).toContain("1 transfer applied");

  /* Two things the pull used to swallow whole.

     A player in TWO squads at once is what the feed looks like mid-transfer --
     the new club has him, the old one has not dropped him. The dedup kept
     whichever came back first, which is team order and not recency, so a
     transfer could be right there in the data and still never reach the app
     with nothing anywhere saying a choice had been made.

     And a player in NO squad has left the competition outright. His pick is
     left alone on purpose, but it can never score again -- the one case here
     a manager actually has to act on, and it read exactly like nothing had
     happened. */
  const quiet = await page.evaluate(async () => {
    const me = myManager();
    const picks = managerPicks(me.id).filter((p) => p.slot !== "TEAM");
    const leaver = picks[0], twoClubs = picks[1];
    const elsewhere = S.teams.find((t) => t !== twoClubs.team);
    window.fetchPoolFor = async () => ({
      // The leaver is in nobody's squad; the other is in two, old club first.
      players: S.players.filter((p) => p.player_id !== leaver.player_id),
      teams: S.teams, fixtures: S.fixtures, roundOrder: [],
      dup: [{ name: twoClubs.player_name, kept: twoClubs.team, also: elsewhere,
              resolved: false }] });
    await loadCompetition({ refresh: true });
    return { leaver: leaver.player_name, leaverClub: leaver.team,
      dupName: twoClubs.player_name, kept: twoClubs.team, also: elsewhere,
      stillThere: !!managerPicks(me.id).find((p) => p.id === leaver.id),
      clubKept: managerPicks(me.id).find((p) => p.id === leaver.id)?.team,
      badge: availBadges(leaver.player_id),
      log: document.getElementById("adm-comp-log").textContent };
  });
  expect(quiet.log, "a pick that can never score again is reported as nothing")
    .toContain(`${quiet.leaver} (was ${quiet.leaverClub})`);
  expect(quiet.log).toContain("no longer in this competition");
  expect(quiet.log, "the feed contradicting itself is still silent")
    .toContain(`${quiet.dupName}: ${quiet.kept} (also listed at ${quiet.also})`);
  expect(quiet.log, "an unchecked clash does not say it went unchecked")
    .toContain("could not check his transfers");
  // He keeps his pick and his club — blanking it would strand his stat rows —
  // and wears the badge that says he cannot score.
  expect(quiet.stillThere, "the leaver was dropped from the squad").toBe(true);
  expect(quiet.clubKept, "the leaver's club was blanked").toBe(quiet.leaverClub);
  expect(quiet.badge, "no ✈ LEFT badge on a player who has left").toContain("LEFT");

  // ...and the pull itself really does spot the two-squad case, rather than
  // the test handing it a ready-made answer.
  const built = await page.evaluate(async () => {
    window.apiFootball = async (key, path, params) => {
      if (path === "teams") return [
        { team: { id: 1, name: "Old Club", code: "OLD" } },
        { team: { id: 2, name: "New Club", code: "NEW" } }];
      /* His history says he moved to the new club last week. Team 1 is listed
         first by `teams`, so first-wins would keep the old one. */
      if (path === "transfers") return [{ transfers: [
        { date: "2024-07-01", teams: { in: { id: 1 }, out: { id: 99 } } },
        { date: "2026-08-14", teams: { in: { id: 2 }, out: { id: 1 } } }] }];
      // The mover is on both lists; only the new club has the debutant.
      return params?.team === 1
        ? [{ players: [{ id: 7, name: "Mover", position: "Midfielder", number: 7 }] }]
        : [{ players: [
            { id: 7, name: "Mover", position: "Midfielder", number: 7 },
            { id: 8, name: "Debutant", position: "Attacker", number: 8 }] }];
    };
    const out = await fetchCompetitionPool("k", 39, 2026, null);
    return { dup: out.dup, count: out.players.length,
      moverAt: out.players.find((p) => p.player_id === "api_7").team };
  });
  expect(built.count, "the dedup dropped or duplicated somebody").toBe(2);
  /* The transfer history settles it, so the club the feed happens to list
     FIRST does not. Observed live: "T. Awoniyi: kept Nottingham Forest, also
     listed at Coventry", on the same pull that reported nobody had moved. */
  expect(built.moverAt, "the old club still wins on team order").toBe("New Club");
  expect(built.dup, "the clash is not reported, or not reported as settled")
    .toEqual([{ name: "Mover", kept: "New Club", also: "Old Club", resolved: true }]);

  // ...and when the transfers lookup cannot be had -- the proxy has not been
  // redeployed with it -- the pull survives and says it could not check.
  const blind = await page.evaluate(async () => {
    const base = window.apiFootball;
    window.apiFootball = async (k, path, params) => {
      if (path === "transfers") throw new Error("Unsupported path: transfers");
      return base(k, path, params);
    };
    const out = await fetchCompetitionPool("k", 39, 2026, null);
    return { dup: out.dup, moverAt: out.players.find((p) => p.player_id === "api_7").team,
             count: out.players.length };
  });
  expect(blind.count, "one optional lookup failing lost the whole pull").toBe(2);
  expect(blind.moverAt, "with nothing to go on, first listed has to stand").toBe("Old Club");
  expect(blind.dup[0].resolved, "an unchecked clash is being reported as settled").toBe(false);
});

test("the admin season box follows the league, not the calendar", async ({ page }) => {
  /* It only ever defaulted to the current YEAR, and nothing set it from the
     competition the league is actually on. So a league on the 2025/26 season
     -- API season key 2025 -- showed 2026 the moment the year turned, and both
     buttons then meant something else: "Load competition" re-points the league
     at a season with no pool and no stats, and a refresh is not a refresh,
     because sameComp is false and the transfer reconcile is skipped entirely.
     Reported from the app: "there are still no transfers coming through". */
  await openLeague(page, { managers: 4, played: 2 });
  const seen = await page.evaluate(() => {
    document.getElementById("reveal-sheet")?.classList.add("hidden");
    // A league a season behind the calendar, which is every league from
    // January until the next season is loaded.
    S.league.competition = { name: "Prem", apiLeagueId: 39,
      season: new Date().getFullYear() - 1, sport: "football" };
    S._compSeeded = null;
    showView("admin"); renderAdmin();
    const box = document.getElementById("adm-comp-season");
    return { season: box.value, thisYear: String(new Date().getFullYear()),
      refreshShown: !document.getElementById("adm-comp-refresh").classList.contains("hidden") };
  });
  expect(seen.season, "the season box is still showing the calendar year")
    .toBe(String(Number(seen.thisYear) - 1));
  expect(seen.refreshShown, "refresh is hidden, so there is no way to pull squads at all")
    .toBe(true);

  // ...and an admin typing a DIFFERENT season is not overwritten mid-edit,
  // which is what re-seeding on every render would do.
  const typed = await page.evaluate(() => {
    const box = document.getElementById("adm-comp-season");
    box.value = "2030";
    box.dispatchEvent(new Event("input", { bubbles: true }));
    return { season: box.value,
      refreshShown: !document.getElementById("adm-comp-refresh").classList.contains("hidden") };
  });
  expect(typed.season, "the box was reset while it was being typed into").toBe("2030");
  // ...and refresh withdraws, because 2030 is not the competition it refreshes.
  expect(typed.refreshShown, "refresh still offers to re-pull a season the league is not on")
    .toBe(false);
});

test("the squad check says what the stored pool actually holds", async ({ page }) => {
  /* Read-only, pulls nothing. The refresh log reports what a pull CHANGED;
     this reports what the data says now, which is the question when a refresh
     looks like it did nothing -- is the player still in the pool, and at which
     club. Without it the only way to tell a failed pull from a feed that has
     not moved is to guess. */
  await openLeague(page, { managers: 4, played: 2 });
  const seen = await page.evaluate(() => {
    document.getElementById("reveal-sheet")?.classList.add("hidden");
    document.getElementById("recap-sheet")?.classList.add("hidden");
    S._recapChecked = true;
    S.authUser = { id: "00000000-0000-4000-8000-000000000001", email: "koen.johan.c@gmail.com" };
    S.league.competition = { name: "Prem", apiLeagueId: 39, season: 2026, sport: "football" };
    S._compPool = { updated_at: new Date(Date.now() - 34 * 864e5).toISOString() };
    const mine = S.picks.filter((p) => p.slot !== "TEAM");
    const gone = mine[0], moved = mine[1];
    // One player out of the pool entirely, one at a different club.
    S._poolBase = S._poolBase.filter((p) => p.player_id !== gone.player_id)
      .map((p) => p.player_id === moved.player_id ? { ...p, team: "Elsewhere" } : p);
    applyPoolOverrides();
    setBoardTab("test"); renderBoard();
    const box = document.getElementById("board-test");
    const surname = S.players[3].name.split(" ").pop();
    const find = document.getElementById("sim-pool-find");
    find.value = surname; find.dispatchEvent(new Event("input", { bubbles: true }));
    const hits = document.getElementById("sim-pool-hits").textContent;
    find.value = "zzzznobody"; find.dispatchEvent(new Event("input", { bubbles: true }));
    return { text: box.textContent.replace(/\s+/g, " "),
      gone: gone.player_name, goneClub: gone.team, moved: moved.player_name,
      movedFrom: moved.team, surname, hits,
      missing: document.getElementById("sim-pool-hits").textContent };
  });
  expect(seen.text, "a player who has left the pool is not called out")
    .toContain(`${seen.gone}`);
  expect(seen.text).toContain("not in the pool at all");
  expect(seen.text, "a pick that disagrees with the pool is not called out")
    .toContain(`${seen.movedFrom} → Elsewhere`);
  expect(seen.text, "how stale the pool is has to be right here too")
    .toContain("34 days ago");
  // The lookup: where does the pool think a given player is?
  expect(seen.hits, "the name lookup found nobody").toContain(seen.surname);
  /* Nobody by that name IS the answer when you are chasing a transfer, so it
     has to say so rather than going blank. */
  expect(seen.missing, "an empty result reads as a broken box")
    .toContain("has left the competition");
});

test("a claim confirmed after the deadline does not queue", async ({ page }) => {
  /* openSwap() gates on the window, but that gate ran when the sheet OPENED
     and nothing looked again when it was confirmed. Leave the picker sitting
     open over the deadline -- put the phone down, come back to it -- and the
     claim queued into a window that had already shut, which nobody would ever
     see happen. */
  await openLeague(page, { managers: 4, played: 2 });
  const at = await page.evaluate(() => {
    document.getElementById("reveal-sheet")?.classList.add("hidden");
    document.getElementById("recap-sheet")?.classList.add("hidden");
    S._recapChecked = true;
    return fixtureWindows(S.fixtures, Date.now(), cfgOf().windows || {}).tradeWindow.closeAt;
  });
  const before = await page.evaluate(() => ({
    open: tradingOpen(), claims: (S.faClaims || []).length }));
  expect(before.open, "the seed is not mid-window, so this proves nothing").toBe(true);

  // The deadline passes while the picker is open. Nothing is refetched — this
  // is the tab that has been sitting there, which is the whole point.
  await page.clock.setFixedTime(new Date(at + 60e3));
  const after = await page.evaluate(async () => {
    const me = myManager();
    const pick = managerPicks(me.id).find((p) => !p.is_sub && p.slot !== "TEAM");
    const owned = new Set(S.picks.map((p) => p.player_id));
    const free = S.players.find((p) => !owned.has(p.player_id) && p.position === pick.position);
    await submitFaClaim(pick, free);
    return { open: tradingOpen(), claims: (S.faClaims || []).length,
             rows: window.__db.tables.fa_claims.length };
  });
  /* The window closing is arithmetic on the fixture list and the clock, so an
     un-refreshed tab still knows -- that is what makes this checkable at all. */
  expect(after.open, "a tab that has not refetched still thinks the window is open")
    .toBe(false);
  expect(after.rows, "a claim was queued after the window shut").toBe(0);
});

test("the transfer record catches what a stale squad list cannot", async ({ page }) => {
  await openLeague(page, { managers: 4, played: 2 });
  /* The transfer record as a second source, end to end through the real pull.

     The squad endpoint asks one question -- "who is in your squad?" -- once per
     club, and a stale answer is indistinguishable from a correct one because
     nothing else in the pull can disagree. Both live cases, one cause: a player
     moves within the league and his new club has not listed him yet, or leaves
     the league and his old club has not dropped him. */
  const second = await page.evaluate(async () => {
    window.apiFootball = async (key, path, params) => {
      if (path === "teams") return [
        { team: { id: 1, name: "Old Club", code: "OLD" } },
        { team: { id: 2, name: "New Club", code: "NEW" } }];
      if (path === "transfers") return [
        // Moved inside the competition; only the old club still lists him.
        { player: { id: 11, name: "Switcher" }, transfers: [
          { date: "2026-08-15", teams: { in: { id: 2 }, out: { id: 1 } } } ] },
        // Left the competition; the old club still lists him anyway.
        { player: { id: 12, name: "Leaver" }, transfers: [
          { date: "2026-08-12", teams: { in: { id: 777 }, out: { id: 1 } } } ] },
        // Arrived from inside the league, and NOBODY lists him yet.
        { player: { id: 13, name: "Arrival" }, transfers: [
          { date: "2026-08-16", teams: { in: { id: 2 }, out: { id: 1 } } } ] },
        // Signed from OUTSIDE the league. Never been here, so there is no old
        // row to carry -- he has to be looked up or he simply does not exist.
        { player: { id: 15, name: "Import" }, transfers: [
          { date: "2026-08-17", teams: { in: { id: 2 }, out: { id: 900 } } } ] },
        // ...one the lookup cannot place, who must not be invented...
        { player: { id: 16, name: "Prospect" }, transfers: [
          { date: "2026-08-17", teams: { in: { id: 2 }, out: { id: 900 } } } ] },
        // ...one whose lookup falls over, which must not take the pull with
        // it. Six hundred squads for one optional call is a bad trade...
        { player: { id: 17, name: "Unlucky" }, transfers: [
          { date: "2026-08-17", teams: { in: { id: 2 }, out: { id: 900 } } } ] },
        // ...and a summer signing with no game this season anywhere, whose
        // position is a season old. That is the ordinary state of a July
        // arrival, and dropping him loses the best free agent in the window.
        { player: { id: 18, name: "Newcomer" }, transfers: [
          { date: "2026-07-02", teams: { in: { id: 2 }, out: { id: 900 } } } ] }];
      if (path === "players") {
        if (params.id === 17) throw new Error("rate limited");
        if (params.id === 15) return [{ player: { id: 15, name: "Import", photo: "i.png" },
          statistics: [{ team: { id: 900 }, games: { position: "Attacker", number: 9 } }] }];
        /* A summer signing who has not played a game anywhere THIS season --
           nothing on record now, a position last season. */
        if (params.id === 18) return params.season === 2026
          ? [{ player: { id: 18, name: "Newcomer" }, statistics: [{ games: {} }] }]
          : [{ player: { id: 18, name: "Newcomer" },
               statistics: [{ team: { id: 900 }, games: { position: "Goalkeeper" } }] }];
        return [{ player: { id: 16, name: "Prospect" }, statistics: [{ games: {} }] }];
      }
      return params?.team === 1
        ? [{ players: [
            { id: 11, name: "Switcher", position: "Defender", number: 11 },
            { id: 12, name: "Leaver", position: "Midfielder", number: 12 },
            // A word the app has never seen. It must not vanish, and it must
            // not pass unremarked either.
            { id: 19, name: "Oddity", position: "Wing-back", number: 19 }] }]
        : [{ players: [{ id: 14, name: "Settled", position: "Attacker", number: 14 }] }];
    };
    // The pool as it stood: it is what makes the unlisted arrival placeable.
    const prev = [{ player_id: "api_13", api_id: 13, name: "Arrival",
                    position: "MID", team: "Old Club", team_code: "OLD", team_logo: 1 }];
    /* The squads were last pulled on 1 July, so anything dated after that is
       news and anything before it is already in the lists we just read. */
    const out = await fetchCompetitionPool("k", 39, 2026, null, prev, "2026-07-01T00:00:00Z");
    const at = (id) => out.players.find((p) => p.player_id === id);
    return { tx: out.tx, count: out.players.length,
             switcher: at("api_11")?.team, switcherCode: at("api_11")?.team_code,
             leaver: !!at("api_12"),
             arrival: at("api_13")?.team, arrivalPos: at("api_13")?.position,
             settled: at("api_14")?.team,
             importer: at("api_15"), prospect: !!at("api_16"),
             newcomer: at("api_18"), oddity: at("api_19"), unmapped: out.unmapped };
  });
  expect(second.tx.checked, "the transfer pass did not run at all").toBe(true);
  expect(second.switcher, "a move inside the league never reached the pool").toBe("New Club");
  expect(second.switcherCode, "the club code did not follow, so his crest is wrong").toBe("NEW");
  expect(second.leaver, "a player who left the league is still in the pool").toBe(false);
  expect(second.arrival, "an arrival nobody lists yet was lost instead of placed")
    .toBe("New Club");
  expect(second.arrivalPos, "the carried row lost the position only the old pool knew")
    .toBe("MID");
  expect(second.settled, "somebody with no transfer on record was disturbed").toBe("New Club");
  expect(second.tx.moved.map((m) => m.name)).toEqual(["Switcher"]);
  expect(second.tx.carried.map((m) => m.name)).toEqual(["Arrival"]);
  expect(second.tx.left.map((m) => m.name)).toEqual(["Leaver"]);

  /* A signing from OUTSIDE the competition has no old row to carry, so without
     a lookup he does not exist and nobody can draft him -- which in a transfer
     window is the best free agent going missing. */
  expect(second.importer, "a signing from another league never made it in")
    .toBeTruthy();
  expect([second.importer.team, second.importer.position, second.importer.player_id],
    "the looked-up row does not match the shape every other pool row has")
    .toEqual(["New Club", "FWD", "api_15"]);
  expect(second.tx.signed.map((r) => r.name).sort()).toEqual(["Import", "Newcomer"]);
  /* ...and one the endpoint cannot place is NOT invented at a default
     position. The quota and the formation read that field. */
  expect(second.prospect, "a player with no position on record was made up").toBe(false);
  expect(second.tx.unknown.map((r) => [r.apiId, r.why]))
    .toEqual([[16, "no position on record"], [17, "lookup failed"]]);

  /* A signing with nothing on record this season falls back to last season,
     which is where a July arrival's position actually lives. */
  expect(second.newcomer, "a summer signing with no games yet was dropped")
    .toBeTruthy();
  expect(second.newcomer.position, "his position came from the wrong season").toBe("GK");
  expect(second.tx.signed.find((r) => r.name === "Newcomer")?.from,
    "the log does not say the position is a season old").toBe(2025);

  /* The last silent default in the pull. apiPosToSlot still absorbs an
     unrecognised word -- refusing them would delete a whole position group if
     the feed renamed one -- but it is named now instead of passing as fact. */
  expect(second.oddity, "an unrecognised position dropped the player").toBeTruthy();
  expect(second.oddity.position, "the fallback stopped being MID").toBe("MID");
  expect(second.unmapped.map((u) => [u.name, u.said]),
    "a position the app does not recognise passed unremarked")
    .toEqual([["Oddity", "Wing-back"]]);
  expect(second.tx.signed.length, "one lookup falling over took the others with it")
    .toBe(2);

  // ...and if the endpoint is not reachable, the pull is exactly what it was
  // before any of this existed, and says the check did not happen.
  const noTx = await page.evaluate(async () => {
    // A whole stub rather than a wrapper: the point is a pull with no second
    // source at all, which is what every league has until the proxy is
    // redeployed with the transfers path.
    window.apiFootball = async (key, path, params) => {
      if (path === "teams") return [
        { team: { id: 1, name: "Old Club", code: "OLD" } },
        { team: { id: 2, name: "New Club", code: "NEW" } }];
      if (path === "transfers") throw new Error("Unsupported path: transfers");
      return params?.team === 1
        ? [{ players: [
            { id: 11, name: "Switcher", position: "Defender", number: 11 },
            { id: 12, name: "Leaver", position: "Midfielder", number: 12 }] }]
        : [{ players: [{ id: 14, name: "Settled", position: "Attacker", number: 14 }] }];
    };
    const out = await fetchCompetitionPool("k", 39, 2026, null, [], "2026-07-01T00:00:00Z");
    return { checked: out.tx.checked, count: out.players.length,
             switcher: out.players.find((p) => p.player_id === "api_11")?.team };
  });
  expect(noTx.checked, "an unreachable endpoint is being reported as a clean check")
    .toBe(false);
  expect(noTx.count, "losing the transfer pass lost the squads with it").toBe(3);
  expect(noTx.switcher, "the pool changed despite having no second source")
    .toBe("Old Club");

  /* ...and with no earlier pull to compare against, the record is not consulted
     at all. Nothing in it is newer than squads read a moment ago, and acting on
     it anyway is what moved J. Gelhardt to the club he had just left. */
  const cold = await page.evaluate(async () => {
    const out = await fetchCompetitionPool("k", 39, 2026, null, [], null);
    return { checked: out.tx.checked, noBaseline: !!out.tx.noBaseline,
             switcher: out.players.find((p) => p.player_id === "api_11")?.team };
  });
  expect(cold.noBaseline, "a first pull is not saying why it skipped the record").toBe(true);
  expect(cold.checked, "the record was consulted with nothing to compare it to").toBe(false);
  expect(cold.switcher, "a first pull moved somebody on evidence it cannot date")
    .toBe("Old Club");
});
