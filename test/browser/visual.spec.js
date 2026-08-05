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

/* Screens, not whatever timer happened to fire. The app pops the draft-complete
   and round-recap sheets on its own, and the first version of these baselines
   captured the squad list from one of them sitting over the board — so the
   picture under test was not the screen named in the test. */
const settle = (page) => page.evaluate(() => {
  S._recapChecked = true;
  document.querySelectorAll("[id$='-sheet']").forEach((e) => e.classList.add("hidden"));
});

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
    await settle(page);
    await expect(page.locator("#board-home")).toHaveScreenshot("team.png", SHOT);
  });

  test("the leaderboard looks the way it did", async ({ page }) => {
    await openLeague(page, { managers: 2, played: 3 });
    await page.evaluate(() => { showView("board"); setBoardTab("lb"); });
    await settle(page);
    await expect(page.locator("#board-lb")).toHaveScreenshot("leaderboard.png", SHOT);
  });

  test("a past round in the pager looks the way it did", async ({ page }) => {
    await openLeague(page, { managers: 2, played: 3 });
    await page.evaluate(() => {
      showView("board"); setBoardTab("lb");
      // The pager is keyed per manager; S.histIdx is read by nothing, so this
      // baseline was quietly a second copy of the current view.
      const me = myManager().id;
      S.histIdxByMgr[me] = 1; renderBoard();        // one round back
    });
    await settle(page);
    await expect(page.locator("#board-lb")).toHaveScreenshot("round-view.png", SHOT);
  });
});

test("no player name is cut off on a pitch", async ({ page }) => {
  /* Measured, not eyeballed. .pp-name was capped at 62px while "Roemeratoe"
     needed 75 and "Magalhaes" 67, so both rendered with an ellipsis — on the
     team pitch, the past-round view, both Dream XI screens, the squad planner
     and the head-to-head card. shortName() has already reduced the name to a
     single word, so there is nothing to wrap: the size has to come down. */
  await page.setViewportSize({ width: 390, height: 844 });
  await openLeague(page, { managers: 4, played: 3 });

  const cut = await page.evaluate(() => {
    const bad = [];
    const scan = (where) => {
      for (const el of document.querySelectorAll(".pp-name, .sub-name")) {
        if (!el.offsetParent) continue;
        if (el.scrollWidth > el.clientWidth + 1)
          bad.push({ where, text: el.textContent.trim(),
                     need: el.scrollWidth, got: el.clientWidth });
      }
    };
    showView("board"); setBoardTab("home"); scan("team");
    const me = myManager().id;
    S.histIdxByMgr[me] = 1; setBoardTab("lb"); renderBoard(); scan("past round");
    setBoardTab("stats"); S.statsView = "dream"; renderStatsTab(); scan("dream XI");
    S.statsView = "nightmare"; renderStatsTab(); scan("nightmare XI");
    const other = S.managers.find((m) => m.id !== me).id;
    openH2HFixture(managerHistory(me).rounds.slice(-1)[0].n, me, other);
    scan("head-to-head card");
    return bad;
  });

  expect(cut, `names cut off:\n${cut.map((c) =>
    `  ${c.where}: "${c.text}" needs ${c.need}px, has ${c.got}px`).join("\n")}`)
    .toEqual([]);
});

test("the matchday card starts collapsed and every tab's content is above the fold", async ({ page }) => {
  /* Expanded, this card was 18 fixture rows — about 530px, 63% of a phone
     viewport — and it rendered identically above Team, League, Players and
     Activity. Every tab's own content began below the fold. */
  await page.setViewportSize({ width: 390, height: 844 });
  await openLeague(page, { managers: 4, played: 3, h2h: true });

  const read = () => page.evaluate(() => {
    const b = document.getElementById("board-banner");
    const pane = [...document.querySelectorAll("[id^='board-']")]
      .find((el) => el.id !== "board-banner" && !el.classList.contains("hidden"));
    return { banner: Math.round(b.getBoundingClientRect().height),
             paneTop: Math.round(pane.getBoundingClientRect().top),
             open: b.querySelector("[data-bannertoggle]")?.getAttribute("aria-expanded") };
  });

  for (const tab of ["home", "lb", "fixtures", "stats", "trades"]) {
    await page.evaluate((t) => { showView("board"); setBoardTab(t); }, tab);
    const r = await read();
    expect(r.open, `${tab}: the card is not collapsed by default`).toBe("false");
    expect(r.banner, `${tab}: the collapsed card is ${r.banner}px tall`).toBeLessThan(64);
    expect(r.paneTop, `${tab}: content starts ${r.paneTop}px down, below the fold`)
      .toBeLessThan(300);
  }

  // Opening it gives everything back, and the choice survives a tab change.
  await page.evaluate(() => document.querySelector("[data-bannertoggle]").click());
  const opened = await read();
  expect(opened.open, "tapping the card did not expand it").toBe("true");
  expect(opened.banner, "expanded, the card shows no more than collapsed")
    .toBeGreaterThan(200);
  await page.evaluate(() => setBoardTab("lb"));
  expect((await read()).open, "the expanded choice was not remembered").toBe("true");
});

test("red means destructive, and nothing else does", async ({ page }) => {
  /* Red was doing two jobs. "Create a league", "Set your lineup", "Claim" and
     "Pull stats now" wore the same red as the controls that destroy things, so
     a column of nine red "Claim" buttons read as a column of warnings and the
     genuinely dangerous button on a screen had nothing to set it apart. */
  await page.setViewportSize({ width: 390, height: 844 });
  await openLeague(page, { managers: 4, played: 3 });

  const RED = "rgb(200, 16, 46)";      // wcred
  const GOLD = "rgb(255, 199, 44)";    // wcgold

  const bg = (sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    return getComputedStyle(el).backgroundColor;
  }, sel);

  // The main action on a screen is gold, and its label is dark on it.
  expect(await bg("#lineup-primary"), "the lineup's primary action is not gold").toBe(GOLD);
  expect(await page.evaluate(() =>
    getComputedStyle(document.querySelector("#lineup-primary")).color),
    "gold button with light text would be unreadable").toBe("rgb(11, 18, 32)");

  // Starting a draft cannot be undone, so it stays red.
  expect(await bg("#lobby-start"), "an irreversible action lost its warning colour").toBe(RED);

  /* And no button anywhere carries both treatments — that is the state the
     mechanical pass could have left behind and nobody would have noticed. */
  const both = await page.evaluate(() =>
    [...document.querySelectorAll(".btn-primary, .btn-quiet")]
      .filter((b) => b.className.includes("bg-wcred"))
      .map((b) => b.id || b.textContent.trim().slice(0, 30)));
  expect(both, "buttons wearing two roles at once").toEqual([]);
});

test("the collapsed matchday summary is not itself truncated", async ({ page }) => {
  // The first version read "18 matches · first kick-off 07:44…" — the half it
  // cut was the time, which is the only number on the row.
  await page.setViewportSize({ width: 390, height: 844 });
  await openLeague(page, { managers: 4, played: 3 });
  const cut = await page.evaluate(() =>
    [...document.querySelectorAll("#board-banner span")]
      .filter((el) => !el.children.length && el.scrollWidth > el.clientWidth + 1)
      .map((el) => ({ text: el.textContent.trim(), need: el.scrollWidth, got: el.clientWidth })));
  expect(cut, `collapsed summary truncated: ${JSON.stringify(cut)}`).toEqual([]);
});
