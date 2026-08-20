/**
 * The interface icon set — one consistent SVG stroke language for chrome,
 * tabs, and actions (redesign decision D1: strokes for the interface,
 * illustrated badges for the map world; docs/design/mobile-redesign.md).
 *
 * All icons are 24×24, stroke-based, and inherit `currentColor`, so they
 * theme with CSS like text. Add new icons here rather than inlining SVG or
 * reaching for text glyphs (×, ▸, ⓘ) in components.
 */

type IconProps = { size?: number; className?: string };

function base({ size = 24, className }: IconProps, children: React.ReactNode) {
  return (
    <svg
      viewBox="0 0 24 24" width={size} height={size} className={className}
      fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Folded map — the find-a-game tab. */
export function IconMap(p: IconProps = {}) {
  return base(p, <>
    <path d="M9 20l-5.5-2.5v-13L9 7l6-2.5L20.5 7v13L15 17.5 9 20z" />
    <path d="M9 7v13M15 4.5v13" />
  </>);
}

/** Calendar — the my-games tab. */
export function IconCalendar(p: IconProps = {}) {
  return base(p, <>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M8 3v4M16 3v4M3 10h18" />
  </>);
}

/** Person — the account tab. */
export function IconUser(p: IconProps = {}) {
  return base(p, <>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c1.5-4 5-5.5 8-5.5s6.5 1.5 8 5.5" />
  </>);
}

/** Speech bubble — chat affordances. */
export function IconChat(p: IconProps = {}) {
  return base(p, <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.5-.7L3 21l1.8-4.3a8.4 8.4 0 1 1 16.2-5.2z" />);
}

/** Plus — the propose-a-game FAB. */
export function IconPlus(p: IconProps = {}) {
  return base(p, <path d="M12 5v14M5 12h14" />);
}

/** Close — replaces the × text glyph. */
export function IconClose(p: IconProps = {}) {
  return base(p, <path d="M6 6l12 12M18 6L6 18" />);
}

/** Back arrow — page-level back navigation. */
export function IconBack(p: IconProps = {}) {
  return base(p, <path d="M19 12H5m6-7l-7 7 7 7" />);
}

/** Map key — the collapsed-legend chip. */
export function IconKey(p: IconProps = {}) {
  return base(p, <>
    <path d="M6 4v16M6 5h10l-2.5 3.5L16 12H6" />
  </>);
}

/** Info — attribution / help affordances. */
export function IconInfo(p: IconProps = {}) {
  return base(p, <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 7.5v.5" />
  </>);
}
