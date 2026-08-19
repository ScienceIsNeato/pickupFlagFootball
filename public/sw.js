/**
 * Deliberately inert service worker.
 *
 * It exists for exactly one reason: Chrome still requires a fetch handler before it
 * will fire `beforeinstallprompt`, which is what our own install button hangs off
 * (menu-install dropped the requirement in 108/112, the prompt did not).
 * https://developer.chrome.com/blog/update-install-criteria
 *
 * It caches NOTHING and intercepts NOTHING. That is the point: this app is a live
 * map whose whole value is being current, and a caching service worker on a
 * deployed site is a reliable way to serve someone yesterday's page with no obvious
 * way to clear it. If offline support is ever wanted, it should be a deliberate
 * design decision with a cache-busting story, not a side effect of an install button.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {
  // No respondWith: the request goes to the network exactly as it would without
  // a service worker. Present only to satisfy the install criteria.
});
