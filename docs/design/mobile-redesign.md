# Mobile-first redesign - decisions and plan

**Date:** 2026-08-19 · **Follows:** [mobile-audit.md](mobile-audit.md) (63 findings)
**Decided by:** owner, from a four-fork options gallery with mockups.

## The four decisions

| Fork | Decision | What it means |
|---|---|---|
| A - Navigation shell | **A1 · Bottom tab bar** | Persistent map / my games / account tabs on phones. The legal-links footer dies on phones; faq/privacy/terms move behind account. Unread chat badge lives on the my-games tab. |
| B - Detail surfaces | **B2 · Full-screen pages** | Game, proposed-site, and propose become routed pages (`/game/[id]`, `/proposed/[id]`, `/propose`) with back navigation. The centered modals are retired everywhere - one code path, desktop included. Deep links come free, which also provides the non-canvas path that fixes the M1 accessibility blocker. |
| C - Map chrome | **C1 · Chip bar + FAB** | The legend collapses into a tappable "key" chip; live counts stay as chips; propose-a-game becomes a visible + FAB (long-press still works). Landscape gets the same compact chrome. |
| D - Icon language | **D1 · Two tiers** | Illustrated badges stay on the map as world-art, re-exported at real sizes. Everything interface - tabs, chrome, actions - uses one consistent SVG stroke set. |

Known interaction: B2 + A1 compose cleanly (pages sit inside the tab shell).
C1's chips keep the bottom edge clear, which the tab bar now owns.

## Build order

Dependency-driven; e2e green at every commit.

0. **Foundation** (fork-independent): viewport export (`viewport-fit=cover`,
   `interactive-widget=resizes-content`, theme-color), 16px inputs on touch,
   44px touch targets, safe-area insets, `dvh` for viewport-capped panels,
   `overscroll-behavior`/`touch-action`. Clears M6 M7 M9 M40 M41 (+parts of M62).
1. **A1 tab bar**: `AppTabBar` on app pages under 880px, footer hidden on
   phones, legal links into account, unread badge on the my-games tab.
   Clears M2 M12 M32 M33 M34.
2. **B2 pages**: modal internals refactored into page components; MapView
   navigates instead of opening modals; e2e steps updated; a "games near you"
   list route gives the canvas-free path. Clears M5 M14 M15 M16 M29 M41 M1.
3. **C1 map chrome**: key chip + sheet, count chips, propose FAB, restyled
   maplibre controls, landscape strategy keyed off `pointer: coarse` not just
   width. Clears M3 M4 M10 M26 M27 M35 M36 M37 M38.
4. **D1 icons**: `components/icons.tsx` stroke set, badge PNG re-exports at
   real sizes, maskable/home-screen icon backgrounds. Clears M22 M50 M51.
5. **Chat fit** (now inside the game page): composer pinned and
   keyboard-aware, thread flexes, delete gets a target + confirm.
   Clears M23 M24 M25 M11 (+M55).
6. **Batches**: account/forms (M8 M13 M21 M30 M31 M39), splash (M19 M20 M47
   M48 M57 M58), a11y (M42 M43 M44 M56), PWA meta (M49 M59 M60 M61 M63),
   misc (M45 M46 M53 M64).

## Verification

Re-run the mobile sweep (see mobile-audit.md "Reproducing the sweep") after
each phase - same screens, same widths - and diff against the audit
screenshots. Full e2e before every push.
