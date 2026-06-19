import { useEffect } from "react";

/** Close-on-Escape for modal dialogs. Add to any overlay that should dismiss on
 *  Escape (paired with role="dialog" / aria-modal on the backdrop). */
export function useEscape(onClose: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}
