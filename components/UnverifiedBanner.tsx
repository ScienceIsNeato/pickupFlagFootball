"use client";

import { useState } from "react";
import { resendVerification } from "@/lib/auth/resend";

/** Top-left "email unconfirmed" status shown to signed-in users who haven't
 *  confirmed their email yet. Until then they can't join or propose games. */
export function UnverifiedBanner() {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  return (
    <div className="unverified-banner" role="status">
      <span className="unverified-dot" aria-hidden />
      <span>email <strong>unconfirmed</strong> - confirm to join or propose games.</span>
      <button
        type="button"
        className="unverified-resend"
        disabled={state === "sending" || state === "sent"}
        onClick={async () => {
          setState("sending");
          try {
            const r = await resendVerification();
            setState(r.ok ? "sent" : "error");
          } catch {
            setState("error");
          }
        }}
      >
        {state === "sent" ? "sent ✓" : state === "sending" ? "sending…" : state === "error" ? "retry" : "resend"}
      </button>
    </div>
  );
}
