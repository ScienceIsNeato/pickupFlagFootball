"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { AuthModal } from "./AuthModal";

/**
 * Site-wide account control for the upper-right, like ganglia-ai.com: a single
 * "sign in" button opens a modal (Google + email/password); signed in shows an
 * avatar with a dropdown (name, email, find a game, account, sign out).
 */
export function AccountMenu() {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [callbackUrl, setCallbackUrl] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // middleware bounces gated routes to /?signin=1&next=… — auto-open the modal.
  // /?reset=1 arrives after a completed password reset — same modal, plus a
  // "password updated" notice so the user knows to log in with the new one.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const signin = p.get("signin") === "1";
    const reset = p.get("reset") === "1";
    if (signin || reset) {
      const next = p.get("next");
      setCallbackUrl(next && /^\/(?![/\\])/.test(next) ? next : undefined);
      if (reset) setNotice("password updated — sign in with your new password.");
      setAuthOpen(true);
      const url = new URL(window.location.href);
      url.searchParams.delete("signin"); url.searchParams.delete("next"); url.searchParams.delete("reset");
      window.history.replaceState({}, "", url);
    }
  }, []);

  const name = session?.user
    ? (session.user.name || session.user.email?.split("@")[0] || "you")
    : "";
  const initials = name.trim().slice(0, 2).toUpperCase();

  // One stable tree across all states. The modal renders at a fixed position and
  // is gated only on authOpen + signed-out — NOT on `status`. signIn() makes
  // useSession flip to "loading" briefly; gating the modal on status (the old
  // early-returns) unmounted it mid-submit, wiping its error and flashing a fresh
  // modal. Keeping it mounted lets the "wrong email or password" error survive.
  return (
    <div className="acct" ref={ref} style={{ position: "relative" }}>
      {status === "loading" ? (
        <div style={{ width: 64 }} aria-hidden />
      ) : session?.user ? (
        <>
          <button className="acct-avatar" onClick={() => setOpen((o) => !o)} aria-label="account menu">
            {initials}
          </button>
          {open && (
            <div className="acct-menu" role="menu">
              <div className="acct-id">
                <div className="acct-name">{name}</div>
                <div className="acct-email">{session.user.email}</div>
              </div>
              <Link href="/play" onClick={() => setOpen(false)}>find a game</Link>
              <Link href="/account" onClick={() => setOpen(false)}>account</Link>
              <button className="acct-signout" onClick={() => signOut({ callbackUrl: "/" })}>
                sign out
              </button>
            </div>
          )}
        </>
      ) : (
        <button className="acct-cta" onClick={() => { setCallbackUrl(undefined); setAuthOpen(true); }}>sign in</button>
      )}

      {/* Mounted whenever the modal is open and we're not signed in — independent
          of the transient "loading" status, so it isn't remounted mid-login. */}
      {authOpen && !session?.user && (
        <AuthModal callbackUrl={callbackUrl} notice={notice} onClose={() => { setAuthOpen(false); setNotice(undefined); }} />
      )}
    </div>
  );
}
