"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Shows the "Changes successfully saved" toast when a server-action result flips
 *  to ok, auto-dismissing after a beat. Returns the portal element (or null) to
 *  render alongside a form. Shared by the account cards. */
export function useSaveToast(state: { ok?: boolean } | null): ReactNode {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [toast, setToast] = useState(false);
  useEffect(() => {
    if (state?.ok) {
      setToast(true);
      const t = setTimeout(() => setToast(false), 2600);
      return () => clearTimeout(t);
    }
    // A new non-ok result (e.g. a re-submit that failed) clears any lingering
    // success banner so it doesn't show alongside the error.
    if (state) setToast(false);
  }, [state]);

  if (!mounted || !toast) return null;
  return createPortal(
    <div className="save-toast" role="status" aria-live="polite" onClick={() => setToast(false)}>
      <span className="save-toast-check" aria-hidden>✓</span> Changes successfully saved
    </div>,
    document.body,
  );
}
