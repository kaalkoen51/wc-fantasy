const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

/* The settlement flow, driven through the real application in a real browser.
 *
 * This is the loop that took five rounds of back-and-forth to diagnose by
 * hand: a window closes, the round settles, waiver claims resolve. Every
 * failure on the way was invisible -- the app returned false and said nothing.
 * Here it either resolves the claims or the test says which step did not.
 *
 * The database is an in-memory stub (see supabase-stub.js), so this proves the
 * APP does the right thing given a database that behaves. Whether the real
 * database behaves is test_sql.sh's job.
 */

const STUB = fs.readFileSync(path.join(__dirname, "supabase-stub.js"), "utf8");

// Serve the stub in place of the vendored client, and seed a league that has
// played three rounds and has two waiver claims queued in an open window.
async function openApp(page, seed) {
  await page.route("**/vendor/supabase.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: STUB }));
  await page.addInitScript((s) => { window.__seed = s; }, seed);
  await page.goto("/index.html", { waitUntil: "networkidle" });
  await page.evaluate(() => {
    Object.assign(window.__db.tables, window.__seed);
  });
}

const LEAGUE = "11111111-1111-4111-8111-111111111111";
const MGR = "22222222-2222-4222-8222-222222222222";

// Three rounds played, round 4 upcoming, so the round-3 window has shut.
function seed() {
  const day = 86400000, now = Date.now();
  const fixtures = [];
  for (let r = 1; r <= 4; r++) {
    const at = now + (r - 3.5) * 7 * day;
    fixtures.push({ home: "A", away: "B", kickoff_utc: new Date(at).toISOString(),
      date: new Date(at).toISOString().slice(0, 10),
      round: `Regular Season - ${r}`, status: r <= 3 ? "FT" : "NS" });
  }
  return {
    leagues: [{ id: LEAGUE, name: "Harness", invite_code: "TEST", current_pick: 999,
      num_managers: 1, config: { autoWindows: true, fa_defer_to_close: true },
      owner_id: "00000000-0000-4000-8000-000000000001" }],
    managers: [{ id: MGR, league_id: LEAGUE, name: "Tester",
      user_id: "00000000-0000-4000-8000-000000000001", draft_position: 1 }],
    picks: [], rounds: [], lineup_snapshots: [], transactions: [], messages: [],
    fa_claims: [
      { id: "c1", league_id: LEAGUE, manager_id: MGR, rank: 0, status: "pending",
        out_player_id: "p_out", out_player_name: "Out", in_player_id: "p_in",
        in_player_name: "In" },
    ],
    __fixtures: fixtures,
  };
}

test("a closed window settles its round and resolves the queued claims", async ({ page }) => {
  const s = seed();
  const fixtures = s.__fixtures; delete s.__fixtures;
  await openApp(page, s);

  // Drive the app's own state into the league, then let its refetch run --
  // the same entry point a real page load uses.
  await page.evaluate(async ([lid, mid, fx]) => {
    localStorage.setItem("wcf_session", JSON.stringify({ leagueId: lid, managerId: mid }));
    S.fixtures = fx;
    await refetchAll();
  }, [LEAGUE, MGR, fixtures]);

  // The round the closed window led into must now be recorded as settled...
  const rounds = await page.evaluate(() => window.__db.tables.rounds || []);
  expect(rounds.length, "no round was recorded — nothing settled").toBeGreaterThan(0);
  expect(rounds.some((r) => r.status === "settled"),
    `rounds recorded but none settled: ${JSON.stringify(rounds)}`).toBe(true);

  // ...and the ritual it owns must have run: no claim left pending.
  const claims = await page.evaluate(() => window.__db.tables.fa_claims || []);
  expect(claims.every((c) => c.status !== "pending"),
    `claims still pending after settlement: ${JSON.stringify(claims)}`).toBe(true);
});

test("settling twice records the round once", async ({ page }) => {
  const s = seed();
  const fixtures = s.__fixtures; delete s.__fixtures;
  await openApp(page, s);

  const count = await page.evaluate(async ([lid, mid, fx]) => {
    localStorage.setItem("wcf_session", JSON.stringify({ leagueId: lid, managerId: mid }));
    S.fixtures = fx;
    await refetchAll();
    await refetchAll();          // a second client, or simply a second refresh
    await advanceRound();
    return (window.__db.tables.rounds || []).length;
  }, [LEAGUE, MGR, fixtures]);

  /* A round settles exactly once. More than one row means the claim is not
     actually claiming, and waiver awards could be applied twice -- the failure
     the unique key exists to prevent. */
  expect(count).toBe(1);
});
