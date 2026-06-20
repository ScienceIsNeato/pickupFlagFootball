"use client";

import { useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";

type GsiButtonConfig = { theme?: string; size?: string; width?: number; text?: string; shape?: string };
type Gsi = {
  accounts: { id: {
    initialize: (o: { client_id: string; callback: (r: { credential: string }) => void }) => void;
    renderButton: (el: HTMLElement, o: GsiButtonConfig) => void;
  } };
};
declare global { interface Window { google?: Gsi } }

let gsiPromise: Promise<void> | null = null;
function loadGsi(): Promise<void> {
  if (gsiPromise) return gsiPromise;
  gsiPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true; s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("gsi load failed"));
    document.head.appendChild(s);
  });
  return gsiPromise;
}

/** Google Identity Services "continue with Google" button. On success it signs
 *  in via the google-onetap provider and navigates to `dest`. Renders a small
 *  note instead when Google isn't configured. Shared by the auth modal and the
 *  registration form so the GSI wiring lives in one place. */
export function GoogleButton({ dest, onError }: { dest: string; onError?: (msg: string) => void }) {
  const [off, setOff] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await (await fetch("/api/google-config")).json();
        if (!cfg.clientId) { setOff(true); return; }
        await loadGsi();
        if (cancelled || !window.google || !ref.current) return;
        window.google.accounts.id.initialize({
          client_id: cfg.clientId,
          callback: async (resp) => {
            const res = await signIn("google-onetap", { credential: resp.credential, redirect: false });
            if (res?.ok) window.location.href = dest;
            else onError?.("google sign-in failed");
          },
        });
        window.google.accounts.id.renderButton(ref.current, {
          theme: "filled_black", size: "large", width: 300, text: "continue_with", shape: "pill",
        });
      } catch { setOff(true); }
    })();
    return () => { cancelled = true; };
  }, [dest]);

  if (off) return <p className="auth-note">google sign-in isn&apos;t configured yet — use email below.</p>;
  return <div ref={ref} />;
}
