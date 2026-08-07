"use strict";
/* Sets the theme before the page paints.
 *
 * This is a separate file loaded from <head> rather than three lines inside
 * app.js, and both halves of that are deliberate.
 *
 * app.js is the last thing in <body>, so by the time it runs the browser has
 * already painted the document with the default theme -- the page would flash
 * dark and then turn cream, on every single load, for anyone not using the
 * default. The fix has to run before the body is parsed.
 *
 * It cannot be an inline <script> either: the CSP is `script-src 'self'` with
 * no 'unsafe-inline', which is the directive that makes a missed escape in
 * this app a blocked console error rather than a stolen account. A display
 * preference is not worth widening it for. A same-origin file costs one small
 * render-blocking request and needs no policy change at all.
 */
(function () {
  /* "dark" is the default and deliberately carries NO attribute: the :root
     tokens ARE dark, so the default theme costs nothing to express and cannot
     be broken by a missing or corrupt preference. Anything unrecognised falls
     back to it for the same reason. */
  var KNOWN = { sticker: 1 };
  var saved;
  try {
    saved = localStorage.getItem("wcf_theme");
  } catch (e) {
    return;          // private mode or storage disabled: the default is fine
  }
  if (saved && KNOWN[saved]) document.documentElement.dataset.theme = saved;
})();
