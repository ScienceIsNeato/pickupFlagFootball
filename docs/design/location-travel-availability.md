# Design: Location, travel radius, availability, and the live "interest probe" map

Status: **Draft / for discussion**
Author: Will
Date: 2026-06-16
Scope: account setup (address/ZIP/radius/availability), the flag-map interaction model, supporting schema + API changes.

---

## 1. Motivation

Today the app knows *roughly* where a user is (ZIP centroid → snapped H3 cell) and renders
aggregate interest as flag clusters at cell centers. We want three things it can't do yet:

1. **Know how far someone will actually travel** for a game, so matching reflects reach, not just a fixed H3 ring.
2. **Know when someone is *not* available** (blacked-out days/times), so interest counts mean "would actually show up."
3. **Turn the map into a live probe**: as the cursor hovers a spot, the flags of people who would travel to *that spot* and are *available* gather into the cursor. **N flags in your grasp = N potentially-interested people at that exact spot.**

All of this stays anonymous. Flags are placed Airbnb/Craigslist-style — in the general vicinity of a
person, never their real point — and no name or account detail is ever exposed on the map.

---

## 2. Current state (what we're building on)

| Concern | Where | Today |
|---|---|---|
| User profile + location | [`lib/db/schema.ts`](../../lib/db/schema.ts) `users` | `city`, `zip`, snapped `home_lat/lng`, `h3_r5..r9`. **No street address by design.** |
| Account form | [`app/(app)/account/page.tsx`](../../app/(app)/account/page.tsx) | Collects `displayName`, `city`, `zip` only |
| ZIP → location | [`app/(app)/account/actions.ts`](../../app/(app)/account/actions.ts), [`lib/geo/zipLookup.ts`](../../lib/geo/zipLookup.ts) | `lookupZip()` → centroid → `cellsForPoint()` → H3 cells |
| Interest | [`lib/db/schema.ts`](../../lib/db/schema.ts) `interest_signals` | `time_prefs time_slot[]` (positive prefs), `active` |
| Time slots | [`lib/db/schema.ts`](../../lib/db/schema.ts) `time_slot` enum | 6 coarse slots: `weekday_am/midday/eve`, `weekend_am/midday/pm` |
| Map data | [`app/api/map/route.ts`](../../app/api/map/route.ts) | `GET /api/map?res=N` → `{cells:[{h3,lat,lng,count,hasGame}]}` aggregated per cell |
| Map render | [`components/MapView.tsx`](../../components/MapView.tsx) | MapLibre GL + Canvas2D flags; cursor gravity radius `GR=120px`; flags belong to a cluster and pull toward cursor when within `GR` |

The map's flag-pull physics ([`MapView.tsx:160`](../../components/MapView.tsx)) are most of the mechanic
we want — but today *every* nearby flag pulls in, regardless of whether that person would actually travel
to the cursor, and the count is a static per-cell aggregate, not a live probe.

---

## 3. Goals / non-goals

**Goals**
- Optionally collect a street address (geocoded to a precise home point); **ZIP remains the only required field.**
- Per-user **travel radius** (miles) captured at setup.
- Per-user **availability** (blackout days/times) captured at setup, excluded from interest counts.
- Map probe: hovering a spot gathers exactly the flags of people who *would travel there* and are *available*, and shows the live count.
- Keep all of this anonymous and cheap to compute on `pointermove`.

**Non-goals**
- No real routing / drive-time. Straight-line (great-circle) reach only. (Roads are out of scope; the engine already matches on H3 catchment, not routes.)
- No exposure of names, exact coordinates, or account details anywhere public.
- No per-minute calendar sync (v1 is recurring weekly availability + optional date exceptions, see §6).

---

## 4. Account setup changes

New/changed fields on the setup + account forms:

1. **Address (optional)** — free-text street address. If provided, geocoded to a precise `home_lat/lng`.
   If omitted, we fall back to the **ZIP centroid** (current behavior). Graceful degradation: address just
   sharpens accuracy.
2. **ZIP (required)** — unchanged requirement; still the floor for placing someone on the map.
3. **Travel radius (miles)** — how far this person will go for a game. Drives both matching and the map probe.
   Default suggestion: 10 mi. Stored in miles; converted to meters for math.
4. **Availability / blackouts** — mark days/times you are *not* available. Anyone blacked-out for the
   active time context is excluded from interest counts and dropped from the probe.

> **Privacy tension (Open Decision A — since settled).** The original schema was emphatic ("NO PII … we NEVER
> store a street address"); today [`lib/db/schema.ts`](../../lib/db/schema.ts) does persist optional, user-supplied
> `address_line1/2` — server-only, used to geocode a precise home point, never served to any client. The precise
> `home_lat/lng` is for matching math only; the map always renders a **jittered** point (see §7). A stricter
> variant remains open: geocode on submit, keep lat/lng, discard the address text.

---

## 5. The map interaction model (the core)

### 5.1 From "cluster flags" to "person flags + probe"

Two rendering regimes by zoom (the API already varies resolution with zoom,
[`MapView.tsx:33`](../../components/MapView.tsx) `resForZoom`):

- **Low/mid zoom (overview):** keep today's **aggregate** clusters — one clump + count per H3 cell. Rendering a
  flag per person nationwide doesn't scale and isn't meaningful.
- **High zoom (≥ threshold, e.g. zoom ≥ 11 / `MAX_ZOOM`):** switch to **per-person anonymous flags** within the
  viewport. This is where the probe mechanic lives and where "9 flags = 9 people" is literally true.

### 5.2 Probe semantics

A person qualifies for the cursor probe at screen point `C` iff **both**:

1. **Reach:** `distance(personHome, C) ≤ personTravelRadius` — i.e. the cursor is inside *their* willingness circle.
2. **Available:** the person is not blacked-out for the **active time context** (see §6.3).

Qualifying flags ease into the cursor (reuse the existing pull in [`MapView.tsx:161`](../../components/MapView.tsx));
non-qualifying flags stay home and do **not** respond to the cursor. The live count rendered at the cursor =
number of qualifying flags = potentially-interested people at that spot.

This inverts today's test. Today: "is the flag within `GR` pixels of the cursor?" New: "is the cursor within
*this person's* travel circle?" The circle radius is per-flag, not a global constant.

### 5.3 No routefinding, no per-move geo math (Open Decision B → recommended approach)

The worry is recomputing miles on every `pointermove`. We don't need to. Web Mercator has a fixed
**meters-per-pixel** at a given zoom + latitude:

```
metersPerPixel(zoom, lat) = 156543.03392 * cos(lat) / 2^zoom   // tileSize 256
```

So:

- **On `moveend` / zoom change** (rare relative to mouse moves): for each visible flag, precompute its travel
  radius **in pixels**: `radiusPx = travelRadiusMeters / metersPerPixel`. Store on the flag. (At metro zoom the
  cos(lat) variation across the viewport is negligible; compute per-flag at its own latitude if we want to be exact.)
- **Each animation frame:** reproject each flag's *home* to pixels via `map.project()` (already done every frame
  at [`MapView.tsx:152`](../../components/MapView.tsx)). `radiusPx` is unchanged by panning, only by zoom.
- **On `pointermove`:** pure pixel test — `hypot(cursor − flagHomePx) < flag.radiusPx`. **Zero trig, zero
  haversine, zero routing per move.**

This *is* the "pixels↔miles LUT" intuition, but it collapses to a single scalar (`metersPerPixel`) recomputed
only on zoom — simpler than a table and exact for our purposes. (If we later want a true LUT keyed by zoom
level, it's a 1-D array of `metersPerPixel` by integer zoom; same idea.)

### 5.4 Cost

Per frame: O(visible flags) projections + pixel-distance checks. Visible high-zoom flags are bounded by the
viewport (tens, low hundreds), so this is cheap. The expensive part (who's in the viewport, their radius +
availability) is computed once per `moveend`, server-side.

---

## 6. Data model changes

### 6.1 `users` — precise point + radius

```sql
ALTER TABLE users
  ADD COLUMN travel_radius_m  integer;          -- willingness to travel, meters (NULL → activity default)
  -- home_lat/home_lng already exist; with an address they become the PRECISE point (server-only).
```

Optional, depending on Open Decision A:
```sql
  ADD COLUMN display_lat double precision,       -- jittered, client-safe point for the map
  ADD COLUMN display_lng double precision;       -- (deterministic per-user jitter, see §7)
```

### 6.2 Availability / blackouts (Open Decision C — pick granularity)

Two viable models:

**Option C1 — coarse, reuse the enum (cheapest).** Treat availability as the 6 existing `time_slot` values.
Store *available* slots (or blackout = complement) on the interest signal. We already have
`interest_signals.time_prefs time_slot[]` — repurpose/rename to availability, or add `blackout_slots time_slot[]`.
No new tables. Probe time context = one of the 6 slots.

**Option C2 — granular weekly grid + exceptions (richer).** New table for recurring weekly availability and
one-off date blackouts:
```sql
CREATE TABLE user_availability (
  user_id    uuid REFERENCES users(id) ON DELETE CASCADE,
  dow        int,          -- 0–6, NULL for a date-specific exception
  start_min  int,          -- minutes from midnight, local tz
  end_min    int,
  exception_date date,     -- non-NULL → one-off blackout/availability for a specific date
  available  boolean NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, dow, start_min, exception_date)
);
```

> **Recommendation:** ship **C1** first (it's already 90% in the schema and matches the engine's
> `time_slot`-based formation flow), and design the map's time-context selector around the 6 slots. Promote to
> C2 only if users ask for finer control. Mixing both later is fine — C2 can derive C1's coarse slots.

### 6.3 Active time context on the map

The probe needs a "when" to apply availability. Add a small time-slot selector to the map UI (default: next
upcoming slot, or "any"). Selecting `weekend_am` filters the probe + counts to people available then. With "any",
availability filtering is relaxed (count = reach only).

### 6.4 API: `GET /api/map`

- Low/mid zoom: unchanged (aggregate cells).
- High zoom: new shape returning **per-person anonymous** points in the viewport bbox:
  ```ts
  { members: [{ dLat, dLng, radiusM, avail: number /* 6-bit slot mask */ }] }
  ```
  No `user_id`, no name, **jittered** `dLat/dLng` only. Server filters by bbox; client does the per-frame probe.
  (Open Decision A governs whether radius+jitter per point is an acceptable disclosure — see §7.)

---

## 7. Privacy model

- **Never sent to the client:** name, email, account info, precise `home_lat/lng`, ZIP/address.
- **On the map, everyone is an anonymous flag.** No identity, ever.
- **Jitter, deterministic per user:** display point = precise point + a fixed pseudo-random offset seeded by
  `user_id` (so a person's flag doesn't jump around between loads, but never sits on their real location). Offset
  magnitude on the order of a few hundred meters — enough to obscure, small enough that the probe stays meaningful.
- **Matching uses the precise point server-side; display uses the jittered point.** The probe count is computed
  from precise points server-side where possible; if the client does the probe, it operates on jittered points
  (slightly fuzzes the count — acceptable, and arguably *better* for privacy).
- Open question (A): is shipping per-user `radiusM` + jittered point to the client an acceptable triangulation
  risk? Low, given jitter, but worth a conscious call.

---

## 8. Open decisions (need your call before building)

| # | Decision | Recommendation |
|---|---|---|
| **A** | Do we store a precise street-derived home point at all, given the schema's "no PII" stance? Discard raw address after geocode? Send per-user radius+jitter to client? | Store precise lat/lng server-only; discard raw address text; render jittered; accept low triangulation risk. |
| **B** | Confirm straight-line reach (no routing) and the `metersPerPixel`-per-zoom approach for the probe. | Yes — straight-line + scalar recomputed on zoom. No routing. |
| **C** | Availability granularity: coarse 6-slot (C1) vs. weekly-grid + exceptions (C2). | Ship C1, design UI to allow promoting to C2 later. |
| **D** | Where does the probe run — server (precise, count is exact) or client (jittered, count slightly fuzzed)? | Client probe on jittered points for v1 (cheap, privacy-friendly); revisit if exactness matters. |
| **E** | Zoom threshold for aggregate→per-person flag switch. | Reuse `MAX_ZOOM = 11`. |

---

## 9. Suggested phasing

1. **Schema + setup form:** add `travel_radius_m`, optional address→geocode, availability (C1). Backfill radius
   default. *(No map change yet.)*
2. **API high-zoom member endpoint** with jittered points + radius + availability mask.
3. **Map probe mechanic:** per-flag `radiusPx`, invert the pull test, live cursor count, time-slot selector.
4. **Polish:** jitter tuning, reduced-motion handling (mirror [`FlagFieldCanvas`](../../components/FlagFieldCanvas.tsx)), counts/labels.

Each phase is independently shippable and reversible.
