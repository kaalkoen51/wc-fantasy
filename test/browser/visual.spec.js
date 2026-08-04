const { test, expect } = require("@playwright/test");
const { openLeague, expectLayoutSane } = require("./lib");

/* Two kinds of visual check, and they are not equally trustworthy.
 *
 * The GEOMETRY checks are deterministic: nothing overflows the viewport,
 * nothing readable collapses to zero height. They need no baseline, so they
 * cannot go stale, and they catch the fault that actually happened here -- the
 * Test tab rendered for weeks with a collapsed grid because five of its classes
 * had been purged, and every test we had passed.
 *
 * The SCREENSHOTS are stricter and more fragile. Every screen in this app shows
 * relative time -- countdowns, "opens Mon, Aug 3", a deadline in three hours --
 * so without a frozen clock a baseline is stale the moment it is taken. The
 * clock is pinned below, and the fixtures are generated relative to that same
 * instant, which makes the render reproducible.
 *
 * The honest caveat: baselines are pixels, and pixels depend on the machine
 * that drew them. Font rendering differs between this container and a CI
 * runner, so these may need `--update-snapshots` on first CI run, and a
 * tolerance is set for that reason. If they ever start failing for reasons
 * nobody can see, delete them -- a visual test nobody trusts is worse than no
 * visual test, and the geometry checks above carry most of the value.
 */

// A fixed instant, so "3 hours until kickoff" is the same 3 hours every run.
const FROZEN = new Date("2026-08-15T12:00:00Z");

const SHOT = {
  maxDiffPixelRatio: 0.02,      // absorbs font hinting differences
  animations: "disabled",
  caret: "hide",
};

test.describe("visual", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install({ time: FROZEN });
    await page.setViewportSize({ width: 390, height: 844 });   // a phone
  });

  test("layout holds at phone width on every tab", async ({ page }) => {
    await openLeague(page, { managers: 2, played: 3 });
    await expectLayoutSane(page);
  });

  test("layout holds at desktop width on every tab", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openLeague(page, { managers: 2, played: 3 });
    await expectLayoutSane(page);
  });

  test("the team screen looks the way it did", async ({ page }) => {
    await openLeague(page, { managers: 2, played: 3 });
    await page.evaluate(() => { showView("board"); setBoardTab("home"); });
    await expect(page.locator("#board-home")).toHaveScreenshot("team.png", SHOT);
  });

  test("the leaderboard looks the way it did", async ({ page }) => {
    await openLeague(page, { managers: 2, played: 3 });
    await page.evaluate(() => { showView("board"); setBoardTab("lb"); });
    await expect(page.locator("#board-lb")).toHaveScreenshot("leaderboard.png", SHOT);
  });

  test("a past round in the pager looks the way it did", async ({ page }) => {
    await openLeague(page, { managers: 2, played: 3 });
    await page.evaluate(() => {
      showView("board"); setBoardTab("lb");
      S.histIdx = 1; renderBoard();        // one round back
    });
    await expect(page.locator("#board-lb")).toHaveScreenshot("round-view.png", SHOT);
  });
});
