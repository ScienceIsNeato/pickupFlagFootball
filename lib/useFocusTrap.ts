import { useEffect, type RefObject } from "react";

/**
 * Trap keyboard focus inside a modal container while it's open: focus the first
 * control on mount, cycle Tab/Shift+Tab within the container, and restore focus
 * to the previously-focused element on unmount. Keeps keyboard users out of the
 * background behind a portaled role="dialog".
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active = true) {
  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;
    const prev = document.activeElement as HTMLElement | null;
    const SEL = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = () => Array.from(node.querySelectorAll<HTMLElement>(SEL));

    (focusables()[0] ?? node).focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const f = focusables();
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    node.addEventListener("keydown", onKey);
    return () => {
      node.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [ref, active]);
}
