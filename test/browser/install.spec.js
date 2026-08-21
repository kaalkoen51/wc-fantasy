/* Making the app installable.
 *
 * The point of all of it is notifications: an iPhone will not deliver one to a
 * browser tab under any circumstances, so the site has to be a Home Screen web
 * app first. That makes the manifest and its icons load-bearing rather than
 * decorative -- a build that quietly dropped one would leave every button in
 * place and the notifications silently undeliverable. */
const { test, expect } = require("@playwright/test");
const { openLeague } = require("./lib.js");

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 "
  + "(KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

test("the app declares itself installable, and every icon it promises exists",
  async ({ page, baseURL }) => {
  await page.goto("/");

  const href = await page.getAttribute('link[rel="manifest"]', "href");
  expect(href, "no manifest is linked — an iPhone would make a bookmark").toBeTruthy();

  const res = await page.request.get(new URL(href, baseURL).href);
  expect(res.status(), "the manifest 404s").toBe(200);
  const m = await res.json();

  /* The fields a browser actually reads before it will treat this as an app.
     `display` is the one that decides bookmark vs web app. */
  expect(m.name).toBeTruthy();
  expect(m.start_url).toBeTruthy();
  expect(m.display, "without standalone this installs as a bookmark").toBe("standalone");

  // 192 and 512 are the two sizes the install flow looks for; a maskable one
  // stops Android cropping the mark out of its own circle.
  const sizes = m.icons.map((i) => i.sizes);
  expect(sizes, "the sizes browsers look for are missing").toEqual(
    expect.arrayContaining(["192x192", "512x512"]));
  expect(m.icons.some((i) => /maskable/.test(i.purpose || "")),
    "no maskable icon — Android will crop the mark").toBe(true);

  // Every promised icon has to resolve. A manifest naming a missing file is
  // the failure that leaves an install looking broken for no visible reason.
  for (const icon of m.icons) {
    const r = await page.request.get(new URL(icon.src, baseURL).href);
    expect(r.status(), `${icon.src} is named in the manifest but ${r.status()}s`).toBe(200);
    expect(r.headers()["content-type"]).toContain("image/png");
  }
  const apple = await page.getAttribute('link[rel="apple-touch-icon"]', "href");
  expect((await page.request.get(new URL(apple, baseURL).href)).status(),
    "the apple-touch-icon is missing — iOS would use a screenshot").toBe(200);
});

test("the service worker registers, because a push is delivered to one", async ({ page }) => {
  await page.goto("/");
  // Registration is async and deliberately non-blocking, so wait for it rather
  // than reading once and calling it absent.
  const scope = await page.waitForFunction(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    return r ? r.scope : null;
  }, null, { timeout: 5000 }).then((h) => h.jsonValue());
  expect(scope, "nothing registered — no device could receive a notification")
    .toContain("/");
});

test("the theme colour follows the theme, so an installed app is not two-tone",
  async ({ page }) => {
  await page.goto("/");
  const read = () => page.getAttribute('meta[name="theme-color"]', "content");
  expect((await read()).toUpperCase(), "the default is not the dark ground").toBe("#070B24");
  await page.evaluate(() => setTheme("sticker"));
  expect((await read()).toUpperCase(), "an installed sticker album keeps a navy status bar")
    .toBe("#F2EAD9");
  await page.evaluate(() => setTheme("dark"));
  expect((await read()).toUpperCase()).toBe("#070B24");
});

test.describe("on an iPhone", () => {
  test.use({ userAgent: IPHONE });

  test("the Home Screen hint appears once and stays dismissed", async ({ page }) => {
    await openLeague(page, { managers: 2, played: 3 });
    await page.evaluate(() => {
      document.getElementById("reveal-sheet")?.classList.add("hidden");
      renderHomeTab();
    });
    const hint = page.locator("#install-hint");
    await expect(hint, "an iPhone is never told how to receive alerts").toHaveCount(1);

    /* Below the deadline card, never above it. That card carries what you
       still have to do; pushing it down to advertise an install would put the
       app's convenience above the manager's. */
    const order = await page.evaluate(() => {
      const kids = [...document.getElementById("board-home").children];
      return kids.findIndex((k) => k.id === "install-hint");
    });
    expect(order, "the hint is the first thing on the page").toBeGreaterThan(0);

    await page.locator("#install-hint-x").click();
    await expect(hint, "dismissing it did nothing").toHaveCount(0);
    await page.evaluate(() => renderHomeTab());
    await expect(hint, "it came back on the next render").toHaveCount(0);
  });
});

test("a desktop is not nagged to install — it gains nothing by it", async ({ page }) => {
  await openLeague(page, { managers: 2, played: 3 });
  await page.evaluate(() => {
    document.getElementById("reveal-sheet")?.classList.add("hidden");
    renderHomeTab();
  });
  await expect(page.locator("#install-hint")).toHaveCount(0);
});

/* ---------- stage 2: subscribing ---------- */

test("the alerts panel offers the switch, remembers the choices, and can be turned off",
  async ({ page }) => {
  await openLeague(page, { managers: 2, played: 3 });
  await page.evaluate(() => {
    document.getElementById("reveal-sheet")?.classList.add("hidden");
    openCrestPicker();
  });
  const panel = page.locator("#alerts-panel");
  await expect(panel, "there is no alerts panel in the settings sheet").toHaveCount(1);

  /* Each state drawn from an explicit state object rather than by trying to
     put the browser into it. What each state SAYS is tested in test_logic;
     what the panel DRAWS for it is this. */
  const draw = (o) => page.evaluate((opts) => {
    renderAlertsPanel(pushState(opts));
    const box = document.getElementById("alerts-panel");
    return { text: box.textContent, on: !!box.querySelector("#alerts-on"),
             off: !!box.querySelector("#alerts-off"),
             switches: box.querySelectorAll("[data-alert]").length };
  }, o);

  const ready = { supported: true, configured: true, signedIn: true, ua: "Linux" };
  const off = await draw(ready);
  expect(off.on, "a device that could subscribe is not offered the switch").toBe(true);
  expect(off.switches, "the switches appear before anyone has opted in").toBe(0);

  for (const [name, opts, wanted] of [
    ["signed out", { ...ready, signedIn: false }, "Sign in"],
    ["unsupported", { ...ready, supported: false }, "can't do alerts"],
    ["blocked", { ...ready, permission: "denied" }, "blocked"],
    ["no key yet", { ...ready, configured: false }, "aren't set up"],
    ["iPhone in a tab", { ...ready, ua: "iPhone" }, "Home Screen"],
  ]) {
    const r = await draw(opts);
    expect(r.text, `the ${name} state says the wrong thing`).toContain(wanted);
    expect(r.on, `the ${name} state offered a switch that cannot work`).toBe(false);
  }

  /* The live path, checked WITHOUT assuming which state this browser is in.
     Notification.permission is a browser default, not something a test sets:
     chrome-headless-shell says "denied" out of the box and full Chromium says
     "default", and granting the permission moves neither. So rather than
     demanding a particular state, assert the panel drew the state the app
     actually reports -- which is the wiring worth checking, and true anywhere. */
  const live = await page.evaluate(() => {
    renderAlertsPanel();
    const st = pushStateNow();
    const box = document.getElementById("alerts-panel");
    return { state: st.state, title: st.title, text: box.textContent,
             on: !!box.querySelector("#alerts-on") };
  });
  expect(live.text, "the panel is not drawing the state the app reports")
    .toContain(live.title);
  expect(live.on, "only the ready-to-subscribe state may offer the switch")
    .toBe(live.state === "off");

  // Subscribed: the switches appear, one per kind, and a change is written
  // through immediately rather than waiting on a Save nobody would press.
  const saved = await page.evaluate(async () => {
    const writes = [];
    S.sb.from = ((orig) => (t) => t === "push_subscriptions"
      ? { update: (v) => { writes.push(v); return { eq: async () => ({}) }; } }
      : orig(t))(S.sb.from.bind(S.sb));
    S.pushSub = { endpoint: "https://push.example/abc" };
    S.alertPrefs = defaultAlertPrefs();
    // Explicit state again: whether this browser would REPORT "on" depends on
    // a permission default the test does not own.
    renderAlertsPanel(pushState({ supported: true, configured: true,
      signedIn: true, ua: "Linux", subscribed: true }));
    document.querySelector('[data-alert="chatAll"]').click();
    await new Promise((r) => setTimeout(r, 0));
    return { writes, boxes: document.querySelectorAll("[data-alert]").length,
             off: !!document.querySelector("#alerts-off") };
  });
  expect(saved.boxes, "not every alert kind has a switch")
    .toBe(await page.evaluate(() => ALERT_KINDS.length));
  expect(saved.writes.length, "flipping a switch wrote nothing").toBe(1);
  expect(saved.writes[0].prefs.chatAll,
    "the change was not the one that was made").toBe(true);

  expect(saved.off, "there is no way to turn alerts off again").toBe(true);
});

test.describe("an iPhone in a browser tab", () => {
  test.use({ userAgent: IPHONE });

  test("is told to install rather than offered a button that can never work",
    async ({ page }) => {
    /* Safari does not deliver a notification to a tab under any
       circumstances, so "Turn on alerts" there is a button someone could tap
       every week for a season and never get anything. */
    await openLeague(page, { managers: 2, played: 3 });
    await page.evaluate(() => {
      document.getElementById("reveal-sheet")?.classList.add("hidden");
      openCrestPicker();
    });
    await expect(page.locator("#alerts-panel")).toContainText("Home Screen");
    await expect(page.locator("#alerts-on"),
      "an iPhone tab was offered a switch that cannot work").toHaveCount(0);
  });
});
