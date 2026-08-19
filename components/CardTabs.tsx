"use client";

import { useRef } from "react";

/**
 * Tabs for the game / proposal cards.
 *
 * Shared rather than hand-rolled per card: the first pass put role="tablist" and
 * role="tab" on plain buttons with none of the rest of the pattern, which is worse
 * than no ARIA at all — a screen reader announces "tab 1 of 2" and then arrow keys
 * do nothing. Implemented here once, properly: aria-controls pointing at a real
 * tabpanel, aria-selected, roving tabindex (only the active tab is in the tab
 * order), and arrow/Home/End to move between them.
 *
 * The panels are the caller's job — each must be role="tabpanel" with
 * id={`${idBase}-panel-${id}`} and aria-labelledby={`${idBase}-tab-${id}`}.
 */
export function CardTabs<T extends string>({ tabs, active, onChange, idBase }: {
  tabs: readonly { id: T; label: string }[];
  active: T;
  onChange: (id: T) => void;
  idBase: string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKeyDown(e: React.KeyboardEvent) {
    const i = tabs.findIndex((t) => t.id === active);
    let next = i;
    if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault();
    const id = tabs[next].id;
    onChange(id);
    refs.current[id]?.focus();
  }

  return (
    <div className="game-tabs" role="tablist" onKeyDown={onKeyDown}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`${idBase}-tab-${t.id}`}
          aria-controls={`${idBase}-panel-${t.id}`}
          aria-selected={active === t.id}
          // Roving tabindex: Tab reaches the tablist once, then arrows move within.
          tabIndex={active === t.id ? 0 : -1}
          ref={(el) => { refs.current[t.id] = el; }}
          className={`game-tab${active === t.id ? " game-tab-on" : ""}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
