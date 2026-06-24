"use client";

import { useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { registerWithGoogle } from "@/lib/auth/register";

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

type GoogleLocation = { zip: string; line1: string; line2: string; city: string; state: string };

/** Google Identity Services "continue with Google" button. Two modes:
 *  - "login" (default): sign in an existing account; an unknown email fails (the
 *    Google provider is login-only) and we tell them to sign up.
 *  - "signup": require a location (getLocation), create the account+interest via
 *    registerWithGoogle, then sign in. This is the only Google account-creation
 *    path, and it can't run without a ZIP.
 *  On success it navigates to `dest`. Renders a note when Google isn't configured. */
export function GoogleButton({
  dest, mode = "login", getLocation, onError,
}: {
  dest: string;
  mode?: "login" | "signup";
  getLocation?: () => GoogleLocation | null;
  onError?: (msg: string) => void;
}) {
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
            // This runs after init, so a rejection here escapes the outer catch —
            // handle it locally or the user gets no feedback.
            try {
              if (mode === "signup") {
                const loc = getLocation?.() ?? null;
                if (!loc) { onError?.("enter your zip code first, then continue with google"); return; }
                const reg = await registerWithGoogle({ credential: resp.credential, ...loc });
                if (!reg.ok) { onError?.(reg.error); return; }
              }
              const res = await signIn("google-onetap", { credential: resp.credential, redirect: false });
              if (res?.ok) { window.location.href = dest; return; }
              onError?.(mode === "signup"
                ? "account created, but sign-in failed — try logging in"
                : "no account for that google address — sign up first");
            } catch {
              onError?.("google sign-in failed — please try again");
            }
          },
        });
        window.google.accounts.id.renderButton(ref.current, {
          theme: "filled_black", size: "large", width: 300,
          text: mode === "signup" ? "signup_with" : "continue_with", shape: "pill",
        });
      } catch { setOff(true); }
    })();
    return () => { cancelled = true; };
  }, [dest, mode, getLocation]);

  if (off) return <p className="auth-note">google sign-in isn&apos;t configured yet — use email below.</p>;
  return <div ref={ref} />;
}
