"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSession, signIn, signOut } from "next-auth/react";

/**
 * Site-wide account control for the upper-right, like ganglia-ai.com: signed
 * out shows log in / sign up; signed in shows an avatar with a dropdown
 * (name, email, dashboard, account, sign out). Client-side via useSession so
 * the static marketing pages stay static.
 */
export function AccountMenu() {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  if (status === "loading") return <div className="acct" style={{ width: 70 }} aria-hidden />;

  if (!session?.user) {
    return (
      <div className="acct">
        <button className="acct-link" onClick={() => signIn()}>log in</button>
        <button className="acct-cta" onClick={() => signIn()}>sign up</button>
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
