"use client";

import { useEffect, useState } from "react";

/**
 * "Install as an app" panel.
 *
 * Three genuinely different platforms, so three different behaviours — a single
 * button would be a lie on two of them:
 *   - Chrome / Edge / Android fire `beforeinstallprompt`, which we capture and
 *     replay on click. That is a real one-tap install.
 *   - iOS Safari never fires it and has no API: installing is Share → Add to Home
 *     Screen, so the only honest thing to offer is the instruction.
 *   - Firefox desktop has no install at all; showing anything there would be noise.
 * Already-installed users get nothing, since they're reading this inside the app.
 */

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

export function InstallApp() {
  const [deferred, setDeferred] = useState<PromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);

  useEffect(() => {
    // Already running as an installed app — nothing to offer.
    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || (window.navigator as { standalone?: boolean }).standalone === true;
    if (standalone) { setInstalled(true); return; }

    const ua = window.navigator.userAgent;
    // iOS Safari only. Chrome on iOS is also WebKit but can't install either, and
    // iPadOS reports as Mac, hence the touch check.
    const isIos = /iPad|iPhone|iPod/.test(ua)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    setIos(isIos);

    const onPrompt = (e: Event) => {
      e.preventDefault(); // stop Chrome's own mini-infobar; we have our own button
      setDeferred(e as PromptEvent);
    };
    const onInstalled = () => { setInstalled(true); setDeferred(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    // The service worker is what makes beforeinstallprompt fire at all. It caches
    // nothing (see public/sw.js) — registering it is the whole job.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // An install button that never appears is a smaller problem than a page
        // that breaks, so this failure stays silent.
      });
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;
  // Nothing installable and not iOS (e.g. Firefox desktop): don't advertise a
  // capability the browser doesn't have.
  if (!deferred && !ios) return null;

  return (
    <aside className="install-pane" aria-labelledby="install-h">
      <h2 id="install-h" className="install-h">keep it on your phone</h2>
      <p className="install-body">
        add {`MIME-FF`} to your home screen - it opens straight to the map, no app store,
        no download.
      </p>

      {deferred && (
        <button type="button" className="install-btn" onClick={async () => {
          await deferred.prompt();
          await deferred.userChoice.catch(() => null);
          // The event is single-use: once prompted it can't be replayed.
          setDeferred(null);
        }}>
          install app
        </button>
      )}

      {ios && !deferred && (
        <>
          <button type="button" className="install-btn"
            aria-expanded={showIosHelp} onClick={() => setShowIosHelp((v) => !v)}>
            add to home screen
          </button>
          {showIosHelp && (
            <ol className="install-steps">
              <li>tap the share button in Safari&apos;s toolbar</li>
              <li>scroll down and pick &quot;add to home screen&quot;</li>
              <li>tap add - it lands next to your other apps</li>
            </ol>
          )}
        </>
      )}
    </aside>
  );
}
