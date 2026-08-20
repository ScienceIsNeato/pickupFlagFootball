"use client";

import { useEffect } from "react";

/**
 * Registers the (inert, no-caching) service worker on app pages. The splash's
 * InstallApp panel also registers it, but a user who signed up on their phone
 * and lives on /play would otherwise never become installable (audit M49) —
 * Chrome only offers install on pages whose scope has an active SW.
 */
export function RegisterSW() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Install-ability is progressive enhancement; a failure stays silent.
      });
    }
  }, []);
  return null;
}
