const { test, expect } = require("@playwright/test");

/* WCAG contrast between two computed "rgb(r, g, b)" strings.
   These tests used to assert literal hexes, which pinned them to one palette:
   any restyle broke them, and the honest fix would have looked like loosening
   a test to make a change pass. What they actually protect -- that the roles
   stay visually distinct and legible -- is a RELATIONSHIP, and a relationship
   survives a palette. So they measure instead of matching. */
const rgb = (s) => (String(s).match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
const lum = (c) => {
  const [r, g, b] = rgb(c).map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
// "Is this the warning colour?" without naming a specific red.
const readsAsDanger = (c) => { const [r, g, b] = rgb(c); return r > g * 1.8 && r > b * 1.8 && r > 120; };
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

test("the sticker theme keeps every layout budget the default does", async ({ page }) => {
  /* The budgets are not decoration: each was won by fixing a real complaint
     about the app being too tall to use on a phone. A second theme is exactly
     where they quietly stop holding, because nobody looks at it as often --
     so it is checked rather than assumed.

     The name check is the one that mattered most in the mockups: Sticker
     Album's chips carry the same surnames in the same 62px box, and if this
     theme ever grows the condensed display face it wants, "Roemeratoe" is
     where it will break first. */
  await page.setViewportSize({ width: 390, height: 844 });
  await openLeague(page, { managers: 4, played: 3 });
  await page.evaluate(() => setTheme("sticker"));

  const cut = await page.evaluate(() => {
    const bad = [];
    showView("board"); setBoardTab("home");
    for (const el of document.querySelectorAll(".pp-name, .sub-name")) {
      if (!el.getBoundingClientRect().width) continue;
      if (el.scrollWidth > el.clientWidth + 1)
        bad.push(`${el.textContent.trim()} (${el.scrollWidth} > ${el.clientWidth})`);
    }
    return bad;
  });
  expect(cut, "a player name is clipped in the sticker theme").toEqual([]);

  const over = await page.evaluate(() => {
    const bad = [];
    for (const tabs of Object.values(navGroups())) for (const tab of tabs) {
      setBoardTab(tab);
      const pane = document.getElementById("board-" + tab);
      if (!pane || pane.classList.contains("hidden")) continue;
      for (const el of pane.querySelectorAll("*")) {
        if (el.hasAttribute("data-decor")) continue;
        const r = el.getBoundingClientRect();
        if (r.width && r.right > 390 + 1)
          bad.push(`${tab}: ${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ")[0]} → ${Math.round(r.right)}px`);
      }
    }
    return [...new Set(bad)].slice(0, 6);
  });
  expect(over, "something overflows the phone in the sticker theme").toEqual([]);
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

test("the Dream XI names its owners with crests, not with words", async ({ page }) => {
  /* Reported from the app with a screenshot of eleven manager names under
     eleven shirts on a 390px pitch: "FeelingALittleKinsky" clipped to
     "eelingALittleKinsky" and "HansaPilsener" ran into the shirt beside it.
     A crest is the same fact in a sixth of the width, and it is how a
     manager is identified everywhere else in the app.

     The flex Ⓕ badge went with it, as asked: which slot a player filled is
     an artefact of how this XI was ASSEMBLED, not a fact about the player
     or the round.

     The name-overflow sweep above already covers .pp-name; nothing covered
     the owner line, which is the line that was actually overflowing. */
  await page.setViewportSize({ width: 390, height: 844 });
  await openLeague(page, { managers: 5, played: 3 });

  for (const view of ["dream", "nightmare"]) {
    const seen = await page.evaluate((v) => {
      showView("board"); setBoardTab("stats"); S.statsView = v; renderStatsTab();
      const box = document.getElementById("stats-dream");
      const chips = [...box.querySelectorAll(".pp")];
      const owners = [...box.querySelectorAll(".pp-own")];
      return {
        chips: chips.length,
        owners: owners.length,
        // Every owner mark must be a real box, not an empty span.
        sized: owners.every((o) => o.getBoundingClientRect().width > 0),
        // ...and must say who it is, since the words are gone.
        titled: owners.every((o) => !!o.querySelector("[title]")?.title.trim()),
        flexBadges: [...box.querySelectorAll(".cap-badge")]
          .map((b) => b.textContent.trim()).filter((t) => t === "F").length,
        blurb: box.querySelector("p")?.textContent || "",
        // Nothing may spill past the pitch, which is what the names did.
        over: chips.filter((c) => c.getBoundingClientRect().right > 390).length,
      };
    }, view);

    expect(seen.chips, `${view}: nothing rendered, so this asserts nothing`).toBeGreaterThan(0);
    expect(seen.owners, `${view}: no owner crest was drawn`).toBeGreaterThan(0);
    expect(seen.sized, `${view}: an owner crest has no size`).toBe(true);
    expect(seen.titled, `${view}: a crest does not say whose it is`).toBe(true);
    expect(seen.flexBadges, `${view}: the flex Ⓕ badge is still being drawn`).toBe(0);
    expect(seen.blurb, `${view}: the blurb still promises the Ⓕ badge`).not.toMatch(/Ⓕ/);
    expect(seen.over, `${view}: a shirt overflows the phone`).toBe(0);
  }
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

  const paint = (sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const c = getComputedStyle(el);
    return { bg: c.backgroundColor, fg: c.color };
  }, sel);

  const primary = await paint("#lineup-primary");
  const danger = await paint("#lobby-start");
  expect(primary, "the lineup's primary action was not rendered").toBeTruthy();
  expect(danger, "the draft's start button was not rendered").toBeTruthy();

  // The main action on a screen is legible -- whatever colour it is.
  expect(contrast(primary.bg, primary.fg),
    `the primary action's label is ${primary.fg} on ${primary.bg}, which is unreadable`)
    .toBeGreaterThanOrEqual(4.5);

  // Starting a draft cannot be undone, so it wears the warning colour...
  expect(readsAsDanger(danger.bg),
    `an irreversible action is ${danger.bg}, which does not read as a warning`).toBe(true);
  // ...and the ordinary primary action does not.
  expect(readsAsDanger(primary.bg),
    `the primary action is ${primary.bg}, which reads as a warning`).toBe(false);

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

test("desktop uses the width, and only one pane at a time", async ({ page }) => {
  /* At 1280px the app was a centred 740px column with about 45% of the viewport
     left empty, still wearing the phone's bottom bar. */
  await page.setViewportSize({ width: 1280, height: 900 });
  await openLeague(page, { managers: 4, played: 3, h2h: true });
  await page.evaluate(() => { showView("board"); setBoardTab("home"); });

  const geom = await page.evaluate(() => {
    const nav = document.getElementById("bottom-nav").getBoundingClientRect();
    const squad = document.querySelector("#board-home > .home-squad").getBoundingClientRect();
    const ident = document.querySelector("#board-home > div").getBoundingClientRect();
    return { navW: Math.round(nav.width), navH: Math.round(nav.height),
             navLeft: Math.round(nav.left),
             squadLeft: Math.round(squad.left), identLeft: Math.round(ident.left),
             pageH: document.body.scrollHeight };
  });
  // A rail down the left, not a bar across the bottom.
  expect(geom.navLeft, "the navigation is not against the left edge").toBe(0);
  expect(geom.navW, "the navigation is still full width").toBeLessThan(300);
  expect(geom.navH, "the navigation is not full height").toBeGreaterThan(700);
  // Two columns: the squad sits left of everything it is read alongside.
  expect(geom.squadLeft, "the squad is not in its own left column")
    .toBeLessThan(geom.identLeft);
  // And the whole team page fits a laptop screen.
  expect(geom.pageH, `the team page is ${geom.pageH}px tall on a 900px screen`)
    .toBeLessThan(1100);

  /* Switching tabs must actually switch. These grid rules outrank .hidden, so
     the pane that should be gone can stay on screen — which is exactly what
     the first version of this did. */
  for (const tab of ["lb", "rosters", "stats", "trades"]) {
    await page.evaluate((t) => setBoardTab(t), tab);
    const shown = await page.evaluate(() =>
      [...document.querySelectorAll("[id^='board-']")]
        .filter((el) => el.id !== "board-banner" && el.id !== "board-subtabs"
                     && el.getBoundingClientRect().height > 0)
        .map((el) => el.id));
    expect(shown, `on ${tab} these panes are all visible at once`).toHaveLength(1);
  }
});

test("the deadline is the first thing on the team page", async ({ page }) => {
  /* It used to start around 790px down a 844px screen — behind the fixture
     banner and the identity card — so "your starting XI isn't valid yet" was
     below the fold on the tab the app opens on. */
  await page.setViewportSize({ width: 390, height: 844 });
  await openLeague(page, { managers: 4, played: 3 });
  const r = await page.evaluate(() => {
    showView("board"); setBoardTab("home");
    const first = document.querySelector("#board-home > *");
    const cta = document.getElementById("md-cta");
    return { first: Math.round(first.getBoundingClientRect().top),
             firstText: first.textContent.replace(/\s+/g, " ").trim().slice(0, 40),
             cta: cta ? Math.round(cta.getBoundingClientRect().bottom) : null };
  });
  expect(r.first, `the page starts ${r.first}px down`).toBeLessThan(200);
  // ...and it is the deadline card, not the identity card that used to lead.
  expect(r.firstText, `the first card reads "${r.firstText}"`).toMatch(/window|lock|deadline|live|round/i);
  // The action it carries is reachable without scrolling an 844px screen.
  if (r.cta !== null)
    expect(r.cta, `its button ends ${r.cta}px down`).toBeLessThan(844);
});

test("Activity is one row of navigation, not two", async ({ page }) => {
  /* It stacked a Trades/Chat pair on top of Deals/Planner/Watchlist/History
     which, with the bottom bar, made three levels of navigation before any
     content. Chat is a peer of Deals and History, not a parent of them. */
  await page.setViewportSize({ width: 390, height: 844 });
  await openLeague(page, { managers: 4, played: 3 });
  await page.evaluate(() => { showView("board"); setBoardTab("trades"); renderBoard(); });

  const tabs = await page.evaluate(() =>
    [...document.querySelectorAll("#board-subtabs button")].map((b) => b.textContent.trim()));
  expect(tabs, "the Activity strip is not one row of five").toEqual(
    ["Deals", "Planner", "Watchlist", "History", "Chat"]);

  // The strip has to actually switch, including to and back from Chat.
  await page.evaluate(() =>
    [...document.querySelectorAll("#board-subtabs button")].find((b) => b.textContent.trim() === "Chat").click());
  expect(await page.evaluate(() => S.boardTab), "Chat did not open from the strip").toBe("chat");
  await page.evaluate(() =>
    [...document.querySelectorAll("#board-subtabs button")].find((b) => b.textContent.trim() === "Planner").click());
  expect(await page.evaluate(() => [S.boardTab, S.tradeTab]),
    "going back from Chat did not restore a trades sub-tab").toEqual(["trades", "planner"]);

  /* And nothing else on the page draws a second tab row. The old one lived
     inside the Trades pane, so removing it is the sort of change that leaves a
     duplicate behind if a caller is missed. */
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll("#board-trades button")]
      .filter((b) => ["Deals", "Planner", "Watchlist", "History"].includes(b.textContent.trim())).length);
  expect(rows, "the Trades pane is still drawing its own tab row").toBe(0);
});

test("the head-to-head card is legible on a phone", async ({ page }) => {
  /* Twenty-two shirts on one 390px pitch cannot be legible at any type size:
     chips nearly touched and names truncated throughout. A phone gets the two
     XIs stacked; a wide screen keeps them facing, which is the card's idea. */
  await page.setViewportSize({ width: 390, height: 844 });
  await openLeague(page, { managers: 4, played: 3, h2h: true });

  const read = () => page.evaluate(() => {
    const me = myManager().id;
    const other = S.managers.find((m) => m.id !== me).id;
    openH2HFixture(managerHistory(me).rounds.slice(-1)[0].n, me, other);
    const body = document.getElementById("recap-body");
    const vis = (el) => el.getBoundingClientRect().height > 0;
    return {
      facing: [...body.querySelectorAll(".pitch-vs")].filter(vis).length,
      plain: [...body.querySelectorAll(".pitch:not(.pitch-vs)")].filter(vis).length,
      cut: [...body.querySelectorAll(".pp-name")]
        .filter((el) => vis(el) && el.scrollWidth > el.clientWidth + 1).length,
      eyebrow: body.querySelector(".eyebrow")?.textContent.trim(),
    };
  });

  const phone = await read();
  expect(phone.facing, "the phone still draws one facing pitch").toBe(0);
  expect(phone.plain, "the phone does not draw two separate XIs").toBe(2);
  expect(phone.cut, "names are still being cut off on the match card").toBe(0);
  // ...and the score says whether it is settled.
  expect(phone.eyebrow, `the header reads "${phone.eyebrow}"`).toMatch(/Final|In progress|Latest/);

  await page.setViewportSize({ width: 1280, height: 900 });
  const desk = await read();
  expect(desk.facing, "the wide layout lost its facing pitch").toBe(1);
});

test("the score bar shows its split even when both managers share a colour", async ({ page }) => {
  /* Nothing stops two managers picking the same colour, and nothing should —
     but the bar drew two segments with no boundary, so 55–13 rendered as one
     unbroken block and the split it exists to show was invisible. */
  await page.setViewportSize({ width: 390, height: 844 });
  await openLeague(page, { managers: 4, played: 3, h2h: true });

  const read = await page.evaluate(() => {
    for (const m of S.managers) m.color = "#C8102E";   // the reported case
    showView("board"); setBoardTab("fixtures"); renderBoard();
    const bar = document.querySelector("#board-fixtures [data-scorebar]");
    if (!bar) return null;
    const [a, b] = [...bar.children];
    const ca = getComputedStyle(a), cb = getComputedStyle(b);
    return {
      fillsMatch: ca.backgroundColor === cb.backgroundColor,
      dividerWidth: parseFloat(ca.borderRightWidth),
      dividerColor: ca.borderRightColor,
      fill: ca.backgroundColor,
      widthA: parseFloat(a.getBoundingClientRect().width),
      widthB: parseFloat(b.getBoundingClientRect().width),
    };
  });

  expect(read, "no score bar rendered").not.toBeNull();
  // The setup has to be the hard case, or this proves nothing.
  expect(read.fillsMatch, "the two segments are different colours, so the test is easy")
    .toBe(true);
  expect(read.dividerWidth, "there is no divider between the two segments")
    .toBeGreaterThan(1);
  expect(read.dividerColor, "the divider is the same colour as the fill it separates")
    .not.toBe(read.fill);
  // Both sides still take their share of the track.
  expect(read.widthA, "the left segment has no width").toBeGreaterThan(4);
  expect(read.widthB, "the right segment has no width").toBeGreaterThan(4);
});

test("the matchday ticker scrolls at a sane speed even if built while hidden", async ({ page }) => {
  /* The speed comes from the ticker's own width, floored at a 14-second lap.
     Measured while the element was not laid out, scrollWidth is 0 — so the
     duration collapsed to that floor and a whole matchday's names sprinted
     past. The banner render is cached on its HTML, so the wrong duration then
     stuck until the markup changed, which is why a reload appeared to fix it.

     renderBanner runs on a 60s interval regardless of which view is up, and
     during boot it can run before the board is shown at all — so this builds
     the ticker with the board hidden, exactly as it happens. */
  await page.setViewportSize({ width: 390, height: 844 });
  await openLeague(page, { managers: 4, played: 3 });

  const res = await page.evaluate(async () => {
    setBannerOpen(true);
    // Build the ticker while nothing is laid out, the way boot does.
    showView("home");
    bannerCache = null;
    renderBanner();
    const hiddenLap = document.querySelector("#board-banner .ticker")?.scrollWidth ?? -1;
    /* Let the frame callbacks run WHILE it is still hidden. Without this the
       old code's requestAnimationFrame fired after the board appeared and
       measured correctly by luck — the first version of this test passed with
       the bug fully in place. */
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise((r) => setTimeout(r, 60));
    // Now the board appears, and the ticker finally has a width.
    showView("board"); setBoardTab("home");
    await new Promise((r) => setTimeout(r, 300));   // let the observer fire
    const el = document.querySelector("#board-banner .ticker");
    return {
      hiddenLap,
      lap: el ? el.scrollWidth / 2 : 0,
      dur: el ? getComputedStyle(el).animationDuration : null,
    };
  });

  // The setup has to actually be the broken case, or this proves nothing.
  expect(res.hiddenLap, "the ticker was measurable while hidden, so this is not the bug")
    .toBe(0);
  expect(res.lap, "the ticker has no content to scroll").toBeGreaterThan(200);

  /* ~42px a second, with a 14-second floor for short content. The floor is the
     whole bug — measured at zero the duration collapsed to it — so the expected
     value must be max(floor, width/speed) and NOT be capped at the floor, which
     is what the first version of this assertion did: it accepted 14s for an
     8700px lap and passed with the bug in place. */
  const secs = parseFloat(res.dur);
  const want = Math.max(14, res.lap / 42);
  expect(secs, `a ${Math.round(res.lap)}px lap scrolls in ${res.dur}, expected about ${Math.round(want)}s`)
    .toBeGreaterThan(want * 0.75);
  expect(secs, `a ${Math.round(res.lap)}px lap scrolls in ${res.dur}, expected about ${Math.round(want)}s`)
    .toBeLessThan(want * 1.35);
});

/* A 1x1 transparent PNG, so the crest path can be exercised without a network. */
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64");

test("the club shows as a crest, and as its code when the crest cannot load", async ({ page }) => {
  /* The Players list identified clubs by a three-letter code. A badge is what
     people recognise a club by, so the crest replaces it — but the app deletes
     avatar images that fail, which left the row with an owner mark, a gap and
     some form dots and no club at all. The code is the fallback, not the
     default. */
  await page.setViewportSize({ width: 390, height: 844 });

  const seed = () => page.evaluate(() => {
    /* teamLogoId memoises on the identity of S.players, so a new array is
       needed — mutating in place leaves the old, empty map in force. */
    S.players = S.players.map((p) => ({ ...p, team_logo: 50 + (p.team.charCodeAt(0) % 20) }));
    S.playerById = Object.fromEntries(S.players.map((p) => [p.player_id, p]));
    showView("board"); setBoardTab("stats"); S.statsView = "list"; renderStatsTab();
  });
  const rows = () => page.evaluate(() =>
    [...document.querySelectorAll("#stats-list li")].slice(0, 5).map((li) => {
      const img = li.querySelector("img[data-crest-code]");
      // [title] distinguishes it from the rank number, which is also mono.
      const code = li.querySelector("[data-crest-fallback]");
      return { crest: img?.getAttribute("alt") || null,
               code: code ? code.textContent.trim() : null };
    }));

  // 1. The crest loads: a badge, labelled with the club for anyone not seeing it.
  await page.route("https://media.api-sports.io/**", (r) =>
    r.fulfill({ contentType: "image/png", body: PIXEL }));
  await openLeague(page, { managers: 4, played: 3 });
  await seed();
  await page.waitForTimeout(400);
  const ok = await rows();
  expect(ok.length, "no player rows").toBe(5);
  for (const r of ok) {
    expect(r.crest, "the club is not shown as a crest").toBeTruthy();
    expect(r.code, "the code is still there alongside the crest").toBeNull();
  }

  // 2. The crest 404s: the code takes its place rather than the club vanishing.
  await page.unroute("https://media.api-sports.io/**");
  await page.route("https://media.api-sports.io/**", (r) => r.abort());
  await openLeague(page, { managers: 4, played: 3 });
  await seed();
  await page.waitForTimeout(600);
  const broken = await rows();
  for (const r of broken) {
    expect(r.crest, "a broken crest is still being shown as an image").toBeNull();
    expect(r.code, "a broken crest left the row with no club at all").toBeTruthy();
  }
});

test("the club column stays aligned whether or not a player is owned", async ({ page }) => {
  /* An absent owner chip collapsed its slot, so everything after it shifted
     left — the club crests ran a ragged column, indented only on the rows that
     happened to be owned. A free agent now gets a chip of its own, which fills
     the slot and is worth reading in its own right. */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("https://media.api-sports.io/**", (r) =>
    r.fulfill({ contentType: "image/png", body: PIXEL }));
  await openLeague(page, { managers: 4, played: 3 });

  const setup = await page.evaluate(() => {
    S.players = S.players.map((p) => ({ ...p, team_logo: 50 + (p.team.charCodeAt(0) % 20) }));
    S.playerById = Object.fromEntries(S.players.map((p) => [p.player_id, p]));
    /* Free agents need stats or the list has nothing unowned to show — it
       filters to players who have played. Without this the whole comparison
       runs on owned rows only and proves nothing. */
    const owned = new Set(S.picks.map((p) => p.player_id));
    const free = S.players.filter((p) => !owned.has(p.player_id)).slice(0, 6);
    const label = S.stats[0]?.match_label;
    S.stats = [...S.stats, ...free.map((p, i) => ({
      league_id: S.league.id, player_id: p.player_id, match_label: label,
      appeared: true, minutes: 90, goals: 3 - (i % 3), assists: 0,
      clean_sheet: false, yellow_cards: 0, red_cards: 0, saves: 0, motm: false,
      penalty_saved: 0, penalty_missed: 0, team: p.team,
    }))];
    bustScores();
    showView("board"); setBoardTab("stats"); S.statsView = "list"; renderStatsTab();
    return { freeIds: free.map((p) => p.player_id) };
  });
  expect(setup.freeIds.length, "no free agents to compare against").toBeGreaterThan(3);

  await page.waitForTimeout(400);
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll("#stats-list li")].map((li) => {
      const crest = li.querySelector("img[data-crest-code], [data-crest-fallback]");
      /* Kind is decided by the OWNER chip alone, never by the presence of a
         free-agent chip — otherwise removing that chip drops free rows from
         the sample entirely and the test fails for the wrong reason instead
         of reporting the ragged column it exists to catch. */
      const owner = li.querySelector("span[title^='Owned by']");
      return crest
        ? { x: Math.round(crest.getBoundingClientRect().left),
            kind: owner ? "owned" : "free" }
        : null;
    }).filter(Boolean));

  const kinds = new Set(rows.map((r) => r.kind));
  // Both kinds have to be on screen, or alignment between them proves nothing.
  expect([...kinds].sort(), "the list shows only one kind of row")
    .toEqual(["free", "owned"]);
  const xs = [...new Set(rows.map((r) => r.x))];
  expect(xs, `the club column is ragged: crests start at ${xs.join(", ")}px`)
    .toHaveLength(1);
});

test("a selected tab looks the same wherever it is", async ({ page }) => {
  /* Red had crept back into three toggles — the Players view switcher, the
     leaderboard's Total/Player-points pair and the admin window mode — while
     every other selector in the app marks its choice with slate and gold. Red
     is reserved for destructive actions, so a selected tab wearing it is both
     inconsistent and a false alarm. */

  await page.setViewportSize({ width: 390, height: 844 });
  await openLeague(page, { managers: 4, played: 3 });

  const groups = [
    ["[data-tab]", () => { showView("board"); setBoardTab("lb"); renderBoard(); }],
    ["[data-atab]", () => { setBoardTab("trades"); renderBoard(); }],
    ["[data-tableview]", () => { setBoardTab("lb"); renderBoard(); }],
    ["[data-statsview]", () => { setBoardTab("stats"); renderStatsTab(); }],
    ["[data-winmode]", () => { showView("admin"); renderAdmin(); }],
  ];

  let shared = null;
  for (const [sel, open] of groups) {
    await page.evaluate(open);
    await page.waitForTimeout(120);
    const seen = await page.evaluate((s) =>
      [...document.querySelectorAll(s)]
        .filter((b) => b.getBoundingClientRect().height > 0)
        .map((b) => {
          const c = getComputedStyle(b);
          return { text: b.textContent.trim().slice(0, 18),
                   bg: c.backgroundColor, fg: c.color };
        }), sel);

    expect(seen.length, `${sel}: no buttons rendered, so this group is untested`)
      .toBeGreaterThan(1);
    // Exactly one is chosen.
    const on = seen.filter((b) => b.bg !== "rgba(0, 0, 0, 0)");
    expect(on.length, `${sel}: expected one selected button, saw ${on.length}`).toBe(1);
    /* The FIRST group sets what "selected" looks like and every other group has
       to agree with it. Consistency is the property; which slate and which gold
       is a palette decision this test has no business pinning. */
    shared ||= on[0];
    expect(on[0].bg, `${sel}: "${on[0].text}" is selected in ${on[0].bg}, but `
      + `"${shared.text}" uses ${shared.bg} — selected must look the same everywhere`)
      .toBe(shared.bg);
    expect(on[0].fg, `${sel}: "${on[0].text}" selected text is ${on[0].fg}, but `
      + `"${shared.text}" uses ${shared.fg}`).toBe(shared.fg);
    expect(contrast(on[0].bg, on[0].fg),
      `${sel}: selected text is unreadable on its own background`).toBeGreaterThanOrEqual(4.5);
    // ...and nothing in the group is wearing the destructive colour.
    for (const b of seen)
      expect(readsAsDanger(b.bg), `${sel}: "${b.text}" uses the danger red for a tab`).toBe(false);
  }
});

test("the team page opens on this round, with it first", async ({ page }) => {
  /* The round in progress is what you open the app to look at; the season
     total is what you check afterwards, and it is on the leaderboard anyway.
     It defaulted to Total and put Total on the left. */
  await page.setViewportSize({ width: 390, height: 844 });
  await openLeague(page, { managers: 4, played: 3 });
  const t = await page.evaluate(() => {
    showView("board"); setBoardTab("home");
    // Every manager's card carries this toggle and they all exist in the DOM,
    // so it has to be scoped to the Team pane.
    const bs = [...document.querySelectorAll("#board-home [data-scoremode]")];
    return { order: bs.map((b) => b.dataset.scoremode),
             labels: bs.map((b) => b.textContent.trim()),
             // .is-selected is the state; "text-wcgold" was the styling that
             // happened to carry it, and Stage 1 missed this one.
             on: bs.find((b) => b.classList.contains("is-selected"))?.dataset.scoremode,
             mode: S.homeScoreMode };
  });
  expect(t.order.length, "the score toggle did not render").toBe(2);
  expect(t.order, "Total is still first").toEqual(["round", "total"]);
  expect(t.labels, "the labels are not the ones expected").toEqual(["This round", "Total"]);
  expect(t.mode, "the stored default is not this round").toBe("round");
  expect(t.on, "the page did not open on this round").toBe("round");
});
