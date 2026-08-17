# Design: Per-game chat

Status: **Draft / decisions pending**
Author: Will (designed with Claude)
Date: 2026-08-16
Scope: a chat thread per proposal/game, gated read, verified write, per-user email preferences. Schema, access model, transport, discovery, digests, moderation.

---

## 1. Motivation

A proposal lives or dies on coordination that has nowhere to happen today. "Could we do 6:30 instead?",
"east lot, gate code 1234", "I'll bring cones" — none of it has a home, so it happens in group texts the
app never sees, or it doesn't happen and the proposal stalls.

Chat gives each proposal and each formed game one conversation, visible to the people who could actually
play there.

---

## 2. Settled decisions

These were decided and are **not** reopened by this document.

| Decision | Choice |
|---|---|
| Read scope | **Not public.** Signed in + eligible (see §4) |
| Write scope | Read eligibility **+ verified email** |
| Notifications | **Per-user email preference** — off / each / hourly / daily (§8). Reversed 2026-08-17; the original call was "none" |
| Transport | Polling. No websockets, no SSE |
| Granularity | **One thread per game series**, not per weekly occurrence |

---

## 3. Corrections to the first-pass design

Four claims in the initial sketch were wrong about this repo. They are corrected here so nobody
builds on them.

1. **"Reuse the app's existing eligibility rule, verbatim" — there is no such single rule.** Three
   predicates exist and disagree: [`catchmentUsers`](../../lib/mime/engine.ts) (adds `email_opt_in` +
   `area_optouts`), the radius-only inline checks in
   [`propose-actions.ts`](<../../app/(app)/play/propose-actions.ts>) and
   [`interested/actions.ts`](<../../app/(marketing)/interested/actions.ts>), and
   [`reachableActiveGame`](../../lib/db/gameMembership.ts). Copying `catchmentUsers` would make chat
   read conditional on `email_opt_in`, so unsubscribing from email would silently kill access to the
   feature that by decision sends no email.

2. **"Active interest signal + radius" is really just radius.** [`createMember`](../../lib/auth/createMember.ts)
   inserts an `active: true` interest signal for *every* account in the same transaction as the user row,
   and [`setActiveInterest`](../../lib/db/interest.ts) only ever moves it. So
   `exists(active interest_signals)` is true for 100% of accounts and discriminates nobody.

3. **The polling cost rationale was wrong.** `min-instances=0` with default CPU throttling means an idle
   warm instance is **not** billed; request-seconds are. SSE costs roughly 3,600 vCPU-s/hour per viewer
   against a 180k/month free tier (~50 viewer-hours) versus ~39 vCPU-s/hour for a 7s poll. Polling still
   wins by ~100x — just for a different reason. The genuinely scarce resource is **Neon awake-time**
   ([DEPLOY.md](../../DEPLOY.md): 5-minute autosuspend tail; the 15-minute cron already burns ~60 of 100
   free CU-h/month).

4. **There are no null-coordinate fail-open cases.** `users.home_lat/home_lng/max_travel_km` and area
   centroids are all `NOT NULL` ([schema.ts](../../lib/db/schema.ts)). Only `games.place_lat/place_lng`
   are nullable, so the coalesce-to-area-centroid belongs there and nowhere else.

---

## 4. Access model

### 4.1 The rule

One module, `lib/chat/eligibility.ts`, exporting `canReadThread(userId, threadId)` and
`canWriteThread(userId, threadId)`. The chat routes are its only callers.

```
READ  = game_roster row for this game
      OR area_captains row for this area
      OR attempt_interest row on this attempt
      OR venue within the user's own max_travel_km of their home
WRITE = READ + isEmailVerified
```

Radius alone is wrong in both directions. [`app/api/map/route.ts`](../../app/api/map/route.ts) states
outright that "Membership is the roster, NOT proximity" — so a rostered player who moves across town or
drops their radius from 15mi to 5mi would keep the weekly poll email and the RSVP tally but lose the chat
for the game they play every week. Captains have the same problem. Hence the union.

`email_opt_in` appears nowhere in this module. The haversine half of
[`withinTravelRadius`](../../lib/mime/engine.ts) is extracted to a shared helper rather than copied a
fourth time.

### 4.2 What the gate actually protects (be honest)

**As specified, very little.** [`registerWithPassword`](../../lib/auth/register.ts) signs a user in with
`emailVerified` still null, home coordinates come from a typed ZIP, and
[`saveAccount`](<../../app/(app)/account/actions.ts>) lets that same session re-point home to any ZIP in
the country and set `max_travel_km` to 100 miles behind nothing but a session check — no verification, no
cooldown, no rate limit. Reading a specific neighborhood's chat costs an attacker one throwaway
registration and about a minute, after which they can flip home back.

Requiring `isEmailVerified` for **read** as well as write is the cheap fix: it raises the cost from
"60 seconds" to "control a mailbox", costs legitimate users nothing (write already requires it), and adds
one boolean to a query already being run. See open question Q1.

`area_optouts` deliberately does **not** gate read — it means "stop courting me for formation here", not
"hide this conversation". It *does* suppress that area's chat badge on the map. Written down because every
other call site honors it and a reader would otherwise assume the omission is a bug.

---

## 5. Data model

```sql
chat_threads
  id uuid pk
  attempt_id uuid null unique  -> formation_attempts(id) ON DELETE CASCADE
  game_id    uuid null unique  -> games(id)              ON DELETE CASCADE
  locked boolean not null default false
  last_message_at timestamptz
  message_count int not null default 0
  version int not null default 0        -- bumped on insert, soft-delete, AND lock
  created_at timestamptz not null default now()
  CHECK (attempt_id is not null OR game_id is not null)

chat_messages
  id uuid pk
  thread_id uuid not null -> chat_threads(id) ON DELETE CASCADE
  seq int not null                      -- per-thread monotonic; the poll cursor
  user_id uuid null -> users(id) ON DELETE SET NULL
  body text not null                    -- length-capped in app + CHECK
  created_at timestamptz not null default now()   -- display only, never a cursor
  occurrence_date date null             -- stamped at insert; nothing reads it in v1
  deleted_at timestamptz null
  deleted_by uuid null -> users(id) ON DELETE SET NULL
  unique (thread_id, seq); index (thread_id, seq)
  partial index (thread_id, deleted_at) where deleted_at is not null

chat_reads
  thread_id uuid -> chat_threads(id) ON DELETE CASCADE
  user_id   uuid -> users(id)        ON DELETE CASCADE
  last_read_at timestamptz not null
  primary key (thread_id, user_id)

chat_rate
  user_id uuid, window_start timestamptz, n int
  primary key (user_id, window_start)
```

**`ON DELETE CASCADE` is load-bearing, not cosmetic.** `games` and `formation_attempts` are *hard*-deleted
by [`seed-demo-interest.ts`](../../scripts/seed-demo-interest.ts), which
[`deploy_app.sh`](../../scripts/deploy_app.sh) invokes under `set -e`. One non-cascading row and the dev
deploy aborts on a FK violation — and CI would not catch it, because both the e2e reset
([`tests/e2e/support/db.ts`](../../tests/e2e/support/db.ts)) and the sim reset use `TRUNCATE ... CASCADE`.
The chat tables must be added explicitly to both wipe lists and to the delete-ordering comment in the seed
script.

**`user_id` is `SET NULL`, not cascade.** Accounts are hard-deleted in two live paths (the documented
"ghost" e2e scenario and the seed script). Cascade would punch holes in everyone else's conversation and
contradicts the soft-delete moderation model; `SET NULL` keeps the message and renders the author as
"removed player".

**`seq`, not id or timestamp, is the cursor.** Every PK is `gen_random_uuid()` and every `created_at` is
`DEFAULT now()`, which in Postgres is *transaction start* — so neither is monotonic and `?after={messageId}`
is unimplementable as first sketched. Worse, a timestamp cursor silently drops messages: Alice's transaction
begins at T, spends 40ms, commits at T+40 stamped `created_at = T`; Bob's begins at T+10 and commits at
T+15; a poller at T+20 sees only Bob and advances past Alice forever. `seq` is assigned by the same `UPDATE`
that bumps `message_count`/`last_message_at`/`version` under the thread row lock, so seq order equals commit
order and one statement fixes the cursor, the counters, and the ordering together.

---

## 6. Lifecycle: resolve at read time, don't backfill

The first sketch had `resolveAttempt` set `thread.game_id` when a proposal confirms. **That is a silent
data-loss race and is dropped.** The thread is created lazily on first message, *outside* the
`FOR UPDATE` lock in [`engine.ts`](../../lib/mime/engine.ts): user A submits the first message on attempt X
while user B taps "I'm in"; `resolveProposal` locks X, confirms, inserts game G, runs
`UPDATE chat_threads SET game_id = G WHERE attempt_id = X` matching **0 rows**, and commits; then A's
transaction commits a thread with `game_id NULL`. No constraint is violated, `GameDetailsModal` finds
nothing under `game_id = G`, lazily creates a *second* thread, and A's message — the one most likely to
exist, on the proposal that just tipped over `pMin` — is permanently unreachable, because
[`/api/proposed`](../../app/api/proposed/route.ts) only returns OPEN attempts.

Instead, derive the link at read time from `games.origin_attempt_id`, which the engine already writes:

```sql
select * from chat_threads
where game_id = $G
   or attempt_id = (select origin_attempt_id from games where id = $G)
```

The write path upserts on `attempt_id` when the game has an `origin_attempt_id`, else on `game_id`.
**The formation engine needs no chat code at all**, which is the real win.

Caveat: the 1:1 between `games.origin_attempt_id` and `formation_attempts.scheduled_game_id` is currently
unenforced (no FK, no unique index) and an out-of-band confirm path exists in the e2e helpers. Worth a
unique index on `games.origin_attempt_id` alongside this work.

FAILED attempts keep their thread; no surface reaches it in v1 and that is fine. `CANCELLED` is a dead
enum value nothing writes — ignore it.

---

## 7. Transport and discovery

**Two polls, one of which already exists.**

- **Panel open**: `GET /api/chat/{threadId}?after={seq}` every ~7s, paused on tab-hide, backing off when
  idle. Response is `{ version, locked, messages: [seq > cursor], tombstones: [seq...] }`.
- **Ambient**: unread counts fold into the **existing** [`/api/hud`](../../app/api/hud/route.ts) response,
  which [`MapHud`](../../components/MapHud.tsx) already polls every 15s. No second always-on timer paying
  its own `auth()` round trip.

**Tombstones matter.** An after-cursor returns rows strictly *above* the cursor while moderation mutates
rows *below* it — the two never meet. Without tombstones, a captain deletes message #12 and every panel
sitting at cursor #40 keeps rendering it until reload; the same hole swallows `locked`, leaving composers
enabled until the write 403s. Hence `version` and an explicit tombstone list.

**Session widening.** [`auth()`](../../lib/auth.ts) already costs a mandatory DB round trip on every
request and currently selects only id/email/name. Adding `home_lat`, `home_lng`, `max_travel_km`, and
`email_verified` to that existing query makes the eligibility haversine and the write gate effectively
free, collapsing the poll to one additional statement.

**Discovery is the whole product risk.** With notifications off by decision, the unread dot is the *only*
reach mechanism — so `chat_reads` is v1, not v1.1. Unread is
`thread.last_message_at > coalesce(chat_reads.last_read_at, '-infinity')`, surfaced as a dot in the app nav
([`layout.tsx`](<../../app/(app)/layout.tsx>)). A localStorage marker is not a substitute: the map is the
primary surface and people hit it from phone and laptop, so a device-local marker shows phantom unreads on
the second device forever.

**The proposal-chat audience problem is real.** Walk it: Alice proposes, the frozen cohort gets an email,
Bob clicks the one-click link and lands on `/interested` — `applyInterest` records him without his ever
loading `/play`. The next scheduled contact is GAME_ON or STALLED_NOTICE at resolution, and the default
window is 48 hours. So Alice types "east lot, gate code 1234" and it reaches nobody. See Q6.

---

## 8. Message settings and email digests

### 8.1 Why this reversed

"No notifications" is reversed as of 2026-08-17. §7 documented that with notifications off, the unread dot
was the *only* reach mechanism, and that proposal chat — the highest-value window — reaches nobody, because
the cohort arrives by one-click email and never loads `/play` before the 48-hour window closes. Email is
what makes proposal chat work at all.

### 8.2 The pane

A new "message settings" pane on the account grid (<code>app/(app)/account/page.tsx</code>):

- checkbox: **get emails when people post**
- radio: **every message** / **grouped** / **daily summary**

Stored as **one column**, not two:

```sql
users.chat_email_pref  enum('off','each','hourly','daily')  not null  default <see Q8>
```

The checkbox is `off` vs not-off; the radio picks among the other three. A separate boolean and mode can
drift out of sync with each other; a single enum cannot. The UI stays exactly as described.

### 8.3 Which threads email you — the spam fork

Read eligibility is radius-based (§4), so "email me when people post" scoped to *everything you can read*
would mail a user about strangers' games all over their travel radius. That is the fastest way to train
people to unsubscribe. Email follows **participation, not proximity**:

- games you're on the roster of
- proposals you responded to (`attempt_interest`)
- any thread you've posted in
- for captains, threads in their area

### 8.4 Suppression, applied in every mode

- never your own messages
- **never messages you already read in-app** (`chat_reads.last_read_at`) — this cuts volume hard and makes
  the mail feel considered instead of robotic
- `users.email_opt_in = false` suppresses everything; it is the global unsubscribe
- unverified addresses are never mailed (deliverability)
- soft-deleted messages never appear
- every chat email carries a one-click "turn these off" link, reusing the HMAC pattern already in
  [`interestLink.ts`](../../lib/interestLink.ts) / [`rsvpLink.ts`](../../lib/rsvpLink.ts)

### 8.5 Digest bookkeeping

```sql
chat_email_state (user_id, thread_id, last_emailed_seq, primary key (user_id, thread_id))
```

Pairs with the `seq` cursor from §5: "send everything with `seq > last_emailed_seq`, minus suppressions",
then advance. Simpler than modelling digests inside `notifications_sent`, whose CHECK constraint demands
exactly one attempt/occurrence parent that a chat digest doesn't have.

### 8.6 Infrastructure: it already exists

**No lambdas and no new cron.** [`flushNotificationEmails`](../../lib/email/flush.ts) already runs inside
the tick ([`app/api/mime/tick/route.ts`](../../app/api/mime/tick/route.ts)) and already does
claim-before-send via `notifications_sent.emailed_at` — the exact pattern digests need.

**There is one real integration point.** The tick is no longer a fixed 15-minute cron: it self-schedules
via Cloud Tasks from `computeNextTickAt` ([`lib/mime/scheduleTick.ts`](../../lib/mime/scheduleTick.ts)),
and an empty calendar means it sleeps. So on a quiet week with no games due, **nothing wakes and hourly
digests would silently never fire**. `computeNextTickAt` must include the next pending chat-digest
boundary. That is the entire infrastructure change.

Cadence per mode:

| Mode | Behaviour |
|---|---|
| `each` | sent on the next tick after the message — near-real-time, bounded by tick latency, not instant |
| `hourly` | bucket by clock hour, send the previous hour's still-unread messages |
| `daily` | one summary at a fixed local hour, using `users.timezone` (nullable text, already on the table) with a UTC fallback |

### 8.7 Volume

`each` on an active thread can burn a free-tier Brevo allowance quickly and is the mode most likely to
generate unsubscribes. Hourly is the recommended default (Q8); treat `each` as the power-user option.

---

## 9. Rate limiting and moderation

**Rate limit is one atomic statement**, not count-then-insert:

```sql
insert into chat_rate (user_id, window_start, n)
values ($me, date_trunc('minute', now()), 1)
on conflict (user_id, window_start)
do update set n = chat_rate.n + 1 where chat_rate.n < 5
returning n
```

Zero rows returned means limited. A `select count(*)` acquires no locks; under READ COMMITTED, putting it
in the same transaction as the insert does **not** serialize it — two concurrent sends both read 4, both
pass, both insert. An in-process token bucket is also out: `min-instances=0` kills the process every idle
period, and `max-instances=10` means ten independent buckets when it doesn't.

**v1 ships author self-delete only.** Captain moderation is deliberately deferred, because
[`volunteerAsCaptain`](<../../app/(app)/play/captain-actions.ts>) requires only a session, a verified
email, and a valid `gameId` — no geographic check, no roster check, no incumbent approval, no cap. And
`gameId` is not a secret; [`/api/game`](../../app/api/game/route.ts) returns it to any logged-in user for
any lat/lng. Hanging moderation on `area_captains` today would let a verified throwaway account captain a
game 2,000 km away, soft-delete an entire thread, and lock it, with every check in this design passing.
See Q5.

---

## 10. Privacy

- **The privacy page needs a line.** It currently covers display name and "other players" but says nothing
  about user-generated content. It must say that what you post in a game chat is readable by other players
  near that game.
- **Do not mirror message bodies to Slack.** [`lib/slack.ts`](../../lib/slack.ts) posts to a team channel
  with a different audience than the one users consented to. Metadata only (thread, area, author id,
  length) gives the flood/brigade signal that motivated the mirror without exporting gated conversation. If
  bodies are ever mirrored, the privacy page must name Slack as a processor alongside Brevo.
- **Display name is an email leak.** `display_name` is nullable, non-unique, unvalidated, and *defaults to
  the email local part* ([`createMember`](../../lib/auth/createMember.ts)) — so someone who registered as
  `will.martin@gmail.com` and never edited their profile posts as "will.martin" on every message, while the
  privacy page promises other players never see your email. Either require a non-default display name
  before the first chat write, or render `coalesce(display_name, 'player')` and never fall back to anything
  email-derived.

---

## 11. UI copy

Voice: lowercase, plain, blunt, hyphens not em dashes.

| Slot | Copy |
|---|---|
| heading | `chat` |
| placeholder | `say something - parking, gear, who's bringing a ball` |
| who can see | `anyone close enough to play this game can read this, plus everyone on the roster. nobody gets emailed - people see it when they come back to the map.` |
| empty (game) | `nothing here yet. start it off - where to park, what to bring, what time you're actually showing up.` |
| empty (proposal) | `nothing here yet. heads up - people who said "i'm in" by email won't see this unless they come back to the map.` |
| unverified | `confirm your email to post. you can read without it.` |
| not eligible | `this chat is for people who play here.` |
| locked | `a captain locked this thread. you can still read it.` |
| rate limited | `slow down - 5 messages a minute.` |
| deleted | `message removed` |
| removed author | `removed player` |

---

## 12. Scope

**In v1**: the four tables; `lib/chat/eligibility.ts` as the single access definition; shared haversine
helper; read-time thread resolution (no engine changes); `GET`/`POST /api/chat/{threadId}` with tombstones
and the atomic rate limit; unread folded into `/api/hud` + a nav dot; chat panels in `GameDetailsModal` and
`ProposedDetailsModal`; author self-delete; widened session select; viewer-gated map badge; chat tables
added to the e2e wipe list, the sim truncate list, and the seed delete-ordering comment.

Plus, from §8: the "message settings" account pane; `users.chat_email_pref`; `chat_email_state`; the
digest builder inside the existing `flushNotificationEmails`; chat-digest boundaries added to
`computeNextTickAt`; and a one-click "turn these off" link.

**Out of v1**: websockets/SSE (settled); per-occurrence threads (`occurrence_date`
is stamped only to keep a future split cheap); captain moderation powers (blocked on Q5); message editing;
attachments, mentions, reactions, typing indicators, read receipts; a surface for FAILED-attempt threads;
Slack body mirroring; tightening `registerWithPassword`/`saveAccount` (real gaps, but account-security work
with a blast radius well beyond chat — its own ADR).

---

## 13. Open questions

| # | Question | Recommendation |
|---|---|---|
| Q1 | Given §4.2, require `isEmailVerified` for **read** too? Or accept the gate as a speed bump and say so? | **Require it for read.** One boolean, big cost increase for throwaways, no cost to real users. |
| Q2 | Does a newly-eligible user see the entire backlog? (Eligibility is live, so moving in unlocks all history; moving out loses it.) | Live evaluation for v1, documented as a known property, bounded by Q3. |
| Q3 | Retention — how long do messages live? | Delete older than 90 days on the existing cron. Bounds harvestable scrollback, keeps indexes irrelevant, one line in a cron that already runs. Awkward to retrofit once people expect permanence. |
| Q4 | Slack mirror: bodies, metadata only, or none? | Metadata only. |
| Q5 | Who moderates, given self-service captaincy? | v1: author self-delete only, you moderate by hand. Then tighten `volunteerAsCaptain` in its own change. |
| Q6 | Ship proposal chat in v1, given its audience arrives by email and never returns? | Largely answered by §8 — email is the reach. Ship both. |
| Q7 | Which threads email you: participation (roster / responded / posted-in) or everything you can read? | **Participation.** Radius-scoped email would mail people about strangers' games across their whole travel radius. |
| Q8 | Default `chat_email_pref` for new *and* existing users? | `hourly`. `off` is the safe-looking choice but it recreates the discovery problem the reversal was meant to fix. Note this decides whether existing accounts get opted in — a consequential, user-visible change. |
| Q9 | Daily summary: what local hour, and what fallback when `users.timezone` is null? | Early evening local (people plan the next day), fall back to the game's area rather than raw UTC. |
| Q10 | Per-thread mute ("stop emailing me about *this* game")? | Out of v1, but it is the thing people ask for first once email is on. `chat_email_state` gives it a natural home later. |
