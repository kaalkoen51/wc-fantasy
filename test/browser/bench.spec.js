const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

/* The test bench, driven by its own buttons.
 *
 * settlement.spec.js calls refetchAll() directly, which is the app's entry
 * point but not the bench's. This presses the bench's own buttons instead.
 *
 * Writing it corrected the record on something. simApply() used to move the
 * fixture calendar and then only re-render, and that was reported here as the
 * reason a closed window never settled. Sabotaging it back proves otherwise:
 * settlement still happens, about 1.5s later, because tickMatchday() refetches
 * once when a deadline is crossed and rebuilding the calendar crosses one. So
 * that change bought immediacy, not correctness.
 *
 * What actually stopped settlement was the second test below: the bench
 * regenerates the SAME round numbers against new dates, so the rows recorded
 * on the previous pass were still there, the round was already settled, and
 * the ritual correctly stood down -- every time, silently. Sabotaging THAT
 * fails, which is how the two are told apart.
 */

const STUB = fs.readFileSync(path.join(__dirname, "supabase-stub.js"), "utf8");
const LEAGUE = "33333333-3333-4333-8333-333333333333";
const MGR = "44444444-4444-4444-8444-444444444444";

async function openBench(page) {
  await page.route("**/vendor/supabase.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: STUB }));
  await page.goto("/index.html", { waitUntil: "networkidle" });

  await page.evaluate(([lid, mid]) => {
    window.__db.tables.leagues = [{
      id: lid, name: "Bench", invite_code: "BENCH", current_pick: 999,
      num_managers: 1, sim: true,
      config: { autoWindows: true, fa_defer_to_close: true },
      owner_id: "00000000-0000-4000-8000-000000000001",
    }];
    window.__db.tables.managers = [{
      id: mid, league_id: lid, name: "Tester", draft_position: 1,
      user_id: "00000000-0000-4000-8000-000000000001",
    }];
    for (const t of ["picks", "rounds", "lineup_snapshots", "match_stats",
                     "transactions", "messages", "fa_claims"])
      window.__db.tables[t] = [];
    localStorage.setItem("wcf_session", JSON.stringify({ leagueId: lid, managerId: mid }));
  }, [LEAGUE, MGR]);

  /* The Test tab renders only for a product-owner account. Read the allowed
     address out of the app rather than hard-coding one, so this keeps working
     if the list changes. */
  await page.evaluate(async () => {
    S.authUser = { id: "00000000-0000-4000-8000-000000000001", email: APP_OWNER_EMAILS[0] };
    await loadPlayers();
    await refetchAll();
    // Navigate the way the nav button does, then let the bench draw itself.
    showView("board");
    setBoardTab("test");
    renderTestTab();
  });
  await page.waitForSelector('[data-stage="lineup"]', { state: "visible", timeout: 10000 });
}

test("pressing a calendar stage builds fixtures AND settles what it closed", async ({ page }) => {
  await openBench(page);

  /* Clear anything settled during setup FIRST. public/fixtures.json is the real
     World Cup calendar, every date of it now past, so the initial refetch
     settles a round on its own -- and an assertion that `rounds` is non-empty
     afterwards passes whether or not the button did anything. It did: both
     sabotages below went green before this line existed. */
  await page.evaluate(() => { window.__db.tables.rounds = []; S.rounds = []; });

  // The bench renders its own controls; this is the button a person clicks.
  const btn = page.locator('[data-stage="lineup"]');
  await expect(btn, "the Test tab did not render its stage buttons").toHaveCount(1);
  await btn.click();

  // Fixtures appear immediately; settlement follows the debounced refetch.
  await expect
    .poll(async () => page.evaluate(() => (S.fixtures || []).length),
      { message: "the stage button wrote no fixtures", timeout: 10000 })
    .toBeGreaterThan(0);

  /* Moving the calendar closes a window, so the round it led into has to end
     up recorded. This does NOT distinguish simApply's refetch from a bare
     re-render -- a deadline-crossing tick refetches within a couple of seconds
     either way -- but it does prove the button is wired to something that
     builds a calendar and settles what that calendar closed. The claim about
     which change fixed what is in the header, and in the second test. */
  await expect
    .poll(async () => page.evaluate(() => (window.__db.tables.rounds || []).length),
      { message: "the calendar moved but nothing settled — simApply re-rendered without refetching",
        timeout: 10000 })
    .toBeGreaterThan(0);
});

test("rebuilding the calendar clears settlements keyed to the old one", async ({ page }) => {
  await openBench(page);

  await page.evaluate(() => { window.__db.tables.rounds = []; S.rounds = []; });
  await page.locator('[data-stage="lineup"]').click();
  await expect
    .poll(async () => page.evaluate(() => (window.__db.tables.rounds || []).length),
      { timeout: 10000 }).toBeGreaterThan(0);

  /* A round settles once. The bench regenerates the SAME round numbers against
     new dates every time a stage is picked, so leaving the old rows behind
     meant every later pass found the round already recorded and correctly
     stood down -- which read as "waivers never resolve". */
  const claimedAt = await page.evaluate(() =>
    (window.__db.tables.rounds || []).map((r) => r.claimed_at));

  /* The SECOND stage change calls simApply() directly rather than clicking.
     The app runs second-by-second timers that repaint the board, so the bench
     panel is replaced under Playwright faster than it can settle on a target
     and a click never becomes actionable. The FIRST change, above, is the one
     that has to go through the DOM -- it is what proves the button is wired to
     anything. Past that the question is what simApply does, which is the same
     code either way. Worth being explicit: this line is weaker than a click,
     and it is only the repeat that is weaker. */
  await page.waitForTimeout(1500);
  await page.evaluate(() => simApply("transfers", 6, true));
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() =>
    (window.__db.tables.rounds || []).map((r) => r.claimed_at));

  /* Assert the OLD rows are GONE, not merely that the list changed. A stale
     row plus a newly settled one also changes the list, so "different" passes
     with the bug still in place -- which it did, before this was tightened. */
  const survivors = after.filter((c) => claimedAt.includes(c));
  expect(survivors, "rebuilding the calendar left the previous settlements in place")
    .toEqual([]);
});

test("rebuilding the calendar does not replay the season under new dates", async ({ page }) => {
  await openBench(page);

  /* A match_label carries the kickoff date, and every calendar is generated
     relative to now — so picking a second stage re-plays the same weeks under
     labels nothing can reach. The rows from the first pass were left behind:
     a player's card showed each match twice, "4 apps · 360'" for two games,
     and the season's points doubled. Reported from the bench exactly that way.

     The invariant is simply stated: every result belongs to a fixture in the
     calendar you are looking at. */
  await page.evaluate(() => { window.__db.tables.match_stats = []; });
  await page.locator('[data-stage="lineup"]').click();
  await expect
    .poll(async () => page.evaluate(() => (window.__db.tables.match_stats || []).length),
      { message: "the first calendar played no weeks at all", timeout: 10000 })
    .toBeGreaterThan(0);

  const first = await page.evaluate(() => window.__db.tables.match_stats.length);

  /* Direct, not a click: the bench repaints on a timer and a second click
     never becomes actionable. The first change above is what proves the
     button is wired; past that it is the same code either way. */
  await page.waitForTimeout(1500);
  await page.evaluate(() => simApply("transfers", 6, true));
  await page.waitForTimeout(1500);

  const after = await page.evaluate(() => {
    const inCalendar = new Set((S.fixtures || []).map((f) =>
      `${f.home} vs ${f.away} (${f.date || String(f.kickoff_utc).slice(0, 10)})`));
    const rows = window.__db.tables.match_stats || [];
    return {
      total: rows.length,
      orphans: [...new Set(rows.map((r) => r.match_label))].filter((l) => !inCalendar.has(l)),
    };
  });

  expect(after.orphans,
    "results from the discarded calendar are still in the league — the season is being replayed")
    .toEqual([]);
  /* And the rows did not simply pile up. Asserting only the orphan list would
     also pass if the delete ran and the replay wrote a second copy under
     labels that happen to be in the new calendar. */
  expect(after.total, "the second calendar left roughly twice the results behind")
    .toBeLessThan(first * 1.5);
});

test("a transfer in the bench does not rewrite the rounds already played", async ({ page }) => {
  /* Reported from the bench, and it was self-inflicted: the orphaned-results
     cleanup added alongside this file also deleted the line-up snapshots,
     reasoning that they belonged to the discarded calendar too.

     They do not. A snapshot says which players a manager HELD at a moment in
     time — a fact about the manager, not the fixture list. And pinHistory's
     snapshot is the only thing standing between a played round and
     rosterAtFor's live-roster fallback, so wiping it meant the next transfer
     rewrote every round already played: a player signed after round 3 turned
     up in round 1.

     The sequence matters, and it is the one a person actually performs — play
     some weeks, make a transfer, then move the calendar again. The pin is
     written by the transfer and has to survive the stage change. */
  await openBench(page);
  await page.evaluate(() => { window.__db.tables.rounds = []; S.rounds = []; });

  // A squad, drafted the way the bench's own board would leave it.
  await page.evaluate(async () => {
    const mid = myManager().id;
    const need = [["GK", 1], ["DEF", 4], ["MID", 4], ["FWD", 2],
                  ["GK", 1], ["DEF", 1], ["MID", 1], ["FWD", 1]];
    const rows = []; const used = new Set(); let n = 1;
    for (const [pos, k] of need) for (let i = 0; i < k; i++) {
      const p = S.players.find((x) => x.position === pos && !used.has(x.player_id));
      used.add(p.player_id);
      const sub = n > 11;
      rows.push({ league_id: S.league.id, manager_id: mid, player_id: p.player_id,
        player_name: p.name, position: p.position, team: p.team,
        slot: sub ? "SUB_" + p.position : p.position, is_sub: sub, pick_number: n++ });
    }
    await S.sb.from("picks").insert(rows);
    await refetchAll();
  });

  // Trading has to be OPEN for the swap below, which is what this stage means.
  await page.evaluate(() => simApply("transfers", 6, false));
  await page.waitForTimeout(2500);

  const before = await page.evaluate(() =>
    managerHistory(myManager().id).rounds.map((r) =>
      [r.n, r.items.map((i) => i.entry.player_id).sort().join(",")]));
  expect(before.length, "the calendar played no rounds, so there is no history to protect")
    .toBeGreaterThan(0);

  const moved = await page.evaluate(async () => {
    const me = myManager();
    const out = managerPicks(me.id).find((p) => !p.is_sub && p.position === "MID");
    const owned = new Set(S.picks.map((p) => p.player_id));
    const inP = S.players.find((p) => p.position === "MID" && !owned.has(p.player_id));
    S.league.config = { ...S.league.config, fa_defer_to_close: false };
    await doSwap(out, inP);
    await refetchAll();
    return { inId: inP.player_id,
             squad: managerPicks(me.id).map((p) => p.player_id) };
  });
  // Assert the setup, rather than trusting it: a swap the window refused would
  // leave every assertion below comparing the squad to itself.
  expect(moved.squad, "the transfer did not actually go through")
    .toContain(moved.inId);

  // Now move the calendar again, which is where the pin was being destroyed.
  await page.waitForTimeout(1200);
  await page.evaluate(() => simApply("lineup", 6, false));
  await page.waitForTimeout(2500);

  const after = await page.evaluate(() =>
    managerHistory(myManager().id).rounds.map((r) =>
      [r.n, r.items.map((i) => i.entry.player_id).sort().join(",")]));

  for (const [n, ids] of after) {
    expect(ids, `round ${n} was rewritten with a player signed after it`)
      .not.toContain(moved.inId);
    const was = before.find((b) => b[0] === n);
    if (was) expect(ids, `round ${n} changed after a later transfer`).toBe(was[1]);
  }
});
