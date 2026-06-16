"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { AuthModal } from "./AuthModal";

/**
 * Site-wide account control for the upper-right, like ganglia-ai.com: a single
 * "sign in" button opens a modal (Google + email/password); signed in shows an
 * avatar with a dropdown (name, email, dashboard, account, sign out).
 */
export function AccountMenu() {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [callbackUrl, setCallbackUrl] = useState<string | undefined>(undefined);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // middleware bounces gated routes to /?signin=1&next=… — auto-open the modal
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("signin") === "1") {
      const next = p.get("next");
      setCallbackUrl(next && /^\/(?![/\\])/.test(next) ? next : undefined);
      setAuthOpen(true);
      const url = new URL(window.location.href);
      url.searchParams.delete("signin"); url.searchParams.delete("next");
      window.history.replaceState({}, "", url);
    }
  }, []);

  if (status === "loading") return <div className="acct" style={{ width: 64 }} aria-hidden />;

  if (!session?.user) {
    return (
      <div className="acct">
        <button className="acct-cta" onClick={() => { setCallbackUrl(undefined); setAuthOpen(true); }}>sign in</button>
        {authOpen && <AuthModal callbackUrl={callbackUrl} onClose={() => setAuthOpen(false)} />}
      </div>
    );
  }

  const name = session.user.name || session.user.email?.split("@")[0] || "you";
  const initials = name.trim().slice(0, 2).toUpperCase();

  return (
    <div className="acct" ref={ref} style={{ position: "relative" }}>
      <button className="acct-avatar" onClick={() => setOpen((o) => !o)} aria-label="account menu">
        {initials}
      </button>
      {open && (
        <div className="acct-menu" role="menu">
          <div className="acct-id">
            <div className="acct-name">{name}</div>
            <div className="acct-email">{session.user.email}</div>
          </div>
          <Link href="/dashboard" onClick={() => setOpen(false)}>dashboard</Link>
          <Link href="/account" onClick={() => setOpen(false)}>account</Link>
          <button className="acct-signout" onClick={() => signOut({ callbackUrl: "/" })}>
            sign out
          </button>
        </div>
      )}
    </div>
  );
}
