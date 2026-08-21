/* Browser harness. `npm run test:browser`.
 *
 * The unit suite loads app.js into a stub DOM, which is why it has 700-odd
 * assertions and still cannot see a script that fails to load, a CSP that
 * blocks something, or a render that throws. Those need a real browser.
 *
 * Runs against public/ -- the assembled site -- so it tests what is deployed
 * rather than what is in the repo. Chromium is preinstalled here; the
 * PLAYWRIGHT_BROWSERS_PATH the image sets is honoured automatically.
 */
module.exports = {
  testDir: "./test/browser",
  timeout: 30000,
  /* Use whatever Chromium the machine already has rather than downloading one.
     The image ships a build that the pinned @playwright/test does not expect,
     and `playwright install` is both slow and blocked in some sandboxes --
     CHROME_PATH lets CI point at its own.

     WHICH Chromium matters more than it looks. CI runs chrome-headless-shell;
     pointing CHROME_PATH at a full Chromium build gives a browser with
     different DEFAULTS, and at least one of them is load-bearing:
     Notification.permission is "denied" in the shell and "default" in the full
     build. A test that assumed the permissive default passed locally and
     failed on CI, which is the worst way to find out. If a browser test asks
     the browser about permissions, media, or anything else the user would
     normally be prompted for, drive it from an explicit value rather than the
     browser's own default -- and run it both ways before trusting it. */
  use: {
    baseURL: "http://127.0.0.1:4173",
    headless: true,
    launchOptions: process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : {},
  },
  webServer: {
    command: "node test/serve.js",
    url: "http://127.0.0.1:4173/index.html",
    reuseExistingServer: true,
    timeout: 20000,
  },
};
