# pickup flag football (MIME-FF)

Massive Interests Matching Engine, for flag football.

Say you're interested in playing near you. When enough people in an area do too,
the app sparks a formation round: people suggest a spot + weekly time, vote on
the options, and once enough commit, the game is on — recurring, weekly, with no
organizer. Free on the web, pay-what-you-can.

The engine is **activity-agnostic**: flag football is one row in `activity_types`.
A different sport is a new row + a new copy "skin", not a rewrite.

## Stack

- **Next.js 15** (App Router, React 19) — server components + server actions.
- **Postgres (Neon)** via **Drizzle ORM** (`@neondatabase/serverless`).
- **NextAuth** — Google one-tap + email/password (bcrypt).
- **MapLibre GL** + an **H3** hex grid (`h3-js`) for the map and spatial matching.
- **Nominatim** (self-hosted when `GEOCODER_URL` is set, else public) for address
  geocoding; ZIP centroids for coarse, privacy-preserving location.

## Run it

```bash
npm install
# set env (see below) in .env.local
npm run dev            # next dev
```

Scripts:

```bash
npm run build          # next build
npm test               # unit tests (node --test): geo, mime engine, datetime, …
npm run sim            # formation-engine simulation harness (tests/sim)
node --env-file=.env.local scripts/apply-sql.mjs db/migrations/<file>.sql   # apply a migration
node --env-file=.env.local --import tsx scripts/seed-demo-interest.ts        # seed demo data
node --env-file=.env.local --import tsx scripts/seed-demo-interest.ts --clean
```

`scripts/deploy_app.sh` builds + serves a production bundle (used by the editor
preview); `--status` / `--logs` / `--stop` manage it.

### Env (`.env.local`)

- `DATABASE_URL` — pooled Neon connection (app).
- `DATABASE_URL_UNPOOLED` — direct connection (migrations / scripts).
- `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` — NextAuth.
- `CRON_SECRET` — bearer token guarding `/api/mime/tick`.
- `GEOCODER_URL` — optional; self-hosted Nominatim base URL. Falls back to the
  public instance / ZIP centroids when unset.

## What's here

### `app/`
- **Marketing** (`(marketing)/`): landing, faq, donate, privacy. Copy is a
  skin — all text in `config/skins/<activity>.json`, validated by `lib/skin/schema.ts`.
- **App** (`(app)/`, auth-gated):
  - `play` — the fullscreen MapLibre map. Anonymous flags represent interest
    (jittered, never exact). Cursor probes "who'd play here"; right-click proposes
    a game at an address; established games show colored badges, proposed sites show
    forming badges with an activity log.
  - `my-games` — games you're rostered on or interested in; captain badges; RSVP.
  - `account` — display name (a username is fine — no real name needed), ZIP
    (required), optional address + travel radius, donation preference.
  - `show-interest` — entry point that records an interest signal.
- **API** (`app/api/`): `map` (cluster feed + claimed-interest coloring),
  `game` / `proposed` (badge detail popups), `geocode` (address search/reverse),
  `mime/tick` (the cron that advances formation windows), `auth`, `google-config`.

### `lib/`
- `mime/` — the formation engine: critical-mass spark, suggestion/availability
  windows, compile + adjudicate, soft promises, backoff/anti-spam. Pure logic in
  `fsm.ts` etc.; DB orchestration in `engine.ts`.
- `geo/` — H3 cells, haversine, ZIP lookup, address geocode (Nominatim) + reverse,
  `resolveHome`, `ensureArea`.
- `db/` — Drizzle schema + connection (pooled + unpooled pool for transactions).
- `auth*`, `skin/`, `brand.ts`, `datetime.ts`, `email/`.

### `db/`
- `schema.sql` — canonical, ORM-agnostic Postgres schema (source of truth).
  Activity-agnostic core, H3 grid + ZIP/city for display, **no street addresses
  at rest beyond what a user opts into**. Interest signals, the formation FSM
  (suggestion + availability windows, soft promises, options), games + roster,
  area captains, per-game color, the anti-spam ledger.
- `migrations/` — incremental SQL, applied with `scripts/apply-sql.mjs`.

### `site/`
- The original static concept site (`build.mjs`, zero deps). Superseded by the
  Next.js app; kept for reference.

## Tests

- `tests/unit/` — `node --test` units for the engine FSM, geo math, datetime
  helpers, and geocode parsers.
- `tests/sim/` — a simulation harness that runs whole formation scenarios
  (happy path, concurrent ticks, recovery) against the engine.
