/**
 * Near-inert service worker.
 *
 * It exists for two reasons:
 *  1. Chrome still requires a fetch handler before it will fire
 *     `beforeinstallprompt`, which our install button hangs off
 *     (menu-install dropped the requirement in 108/112, the prompt did not).
 *     https://developer.chrome.com/blog/update-install-criteria
 *  2. An installed app launched with no network otherwise dead-ends on the
 *     browser's own error page (audit gap). For NAVIGATIONS ONLY, a network
 *     failure gets a tiny inline "you're offline" response instead.
 *
 * It still caches NOTHING of the app. That is the point: this is a live map
 * whose whole value is being current, and a caching service worker on a
 * deployed site is a reliable way to serve someone yesterday's page with no
 * obvious way to clear it. The offline page below is generated inline — no
 * cache storage, no staleness story.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

const OFFLINE_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>offline - MIME-FF</title>
<style>
  body { margin:0; min-height:100dvh; display:flex; align-items:center; justify-content:center;
    background:#0b1210; color:#e9edf6; font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    text-align:center; padding:24px; }
  h1 { font-size:1.4rem; margin:0 0 8px; }
  p { color:#a3acc2; font-size:1rem; line-height:1.5; margin:0 0 18px; max-width:38ch; }
  button { background:#468944; color:#fff; border:0; border-radius:8px; padding:12px 22px;
    font-size:1rem; font-weight:700; cursor:pointer; }
</style></head><body><div>
<h1>you're offline</h1>
<p>MIME-FF is a live map of who's playing near you - it needs a connection to be honest with you.</p>
<button onclick="location.reload()">try again</button>
</div></body></html>`;

self.addEventListener("fetch", (e) => {
  // Only navigations, and only on network FAILURE — every other request goes to
  // the network exactly as it would without a service worker.
  if (e.request.mode !== "navigate") return;
  e.respondWith(
    fetch(e.request).catch(() =>
      new Response(OFFLINE_HTML, { headers: { "content-type": "text/html; charset=utf-8" } }),
    ),
  );
});
