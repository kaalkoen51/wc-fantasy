"use strict";
/* The service worker: the one piece of this app that can run while the app is
 * closed.
 *
 * It exists for NOTIFICATIONS, not for offline. A push arrives at the browser
 * long after the last tab was shut, and a service worker is the only thing
 * still listening at that point -- on Android, Chrome refuses to show a
 * notification raised by a page at all and accepts one only from here. Stage 1
 * registers it and stops; the push and notificationclick handlers land with
 * the sender.
 *
 * IT DELIBERATELY DOES NOT CACHE ANYTHING, and there is no fetch handler.
 *
 * A service worker that caches is a service worker that can serve a stale
 * app.js to somebody who then reports a bug that no longer exists, and the
 * usual fix -- clear your site data -- is not something you can talk a league
 * through over WhatsApp. The site is static files behind Cloudflare with
 * revalidation already set in _headers; the network is not the problem here,
 * so caching would be all risk and no benefit. If offline support is ever
 * wanted it should be its own change, with its own version-and-purge story.
 *
 * The cost of that choice, stated plainly: Chrome's automatic "Install app"
 * prompt wants evidence a site works offline, so it will not appear. Adding to
 * the Home Screen by hand still works everywhere, which is the flow iOS needs
 * regardless -- and iOS is the only platform where installing is REQUIRED
 * before notifications can be delivered at all.
 */

// Take over as soon as an update is installed, rather than waiting for every
// tab to close. With no cache there is nothing a mid-session swap can corrupt,
// and a notification handler that ships is no use sitting in the waiting room.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
