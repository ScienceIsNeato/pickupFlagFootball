import { and, eq, sql } from "drizzle-orm";
import {
  activityTypes, areas, interestSignals, users,
  formationAttempts, suggestions, formationOptions, softPromises,
  games, notificationsSent,
} from "@/lib/db/schema";
import { cellsForPoint } from "@/lib/geo/h3";
import { evaluate, tick } from "@/lib/mime/engine";
import type { EngineDb } from "@/lib/mime/engine";
import type { World } from "./world";
import { Clock } from "./clock";
import type { BeatResult, Perspective, AssertionResult } from "./types";

export type Person = { id: string; name: string; zip: string; lat: number; lng: number };

type BeatView = Partial<Record<Perspective, string>>;

/** The scenario-facing API. Data ops (participant/interest/suggest/promise) set
 *  up world state; evaluate/tick drive the REAL engine; beat() snapshots. */
export class Sim {
  readonly clock: Clock;
  private readonly world: World;
  private activityTypeId!: string;
  private anon = 0;

  // accumulating report state
  readonly beats: BeatResult[] = [];
  private pendingAsserts: AssertionResult[] = [];
  private prevCells: Record<Perspective, string> | null = null;
  private prevKindCounts: Record<string, number> = {};
  private focusZip: string | null = null;

  constructor(world: World, startIso: string) {
    this.world = world;
    this.clock = new Clock(startIso);
  }

  private get db() { return this.world.db; }

  async init() {
    const rows = await this.db
      .select({ id: activityTypes.id })
      .from(activityTypes)
      .where(eq(activityTypes.slug, "flag-football"))
      .limit(1);
    if (!rows.length) throw new Error("flag-football activity_type not seeded");
    this.activityTypeId = rows[0].id;
  }

  // ── participants ──────────────────────────────────────────────────────────
  async participant(name: string, opts: { zip: string }): Promise<Person> {
    const centroid = await this.centroid(opts.zip);
    const email = `${name.toLowerCase().replace(/\s+/g, ".")}@sim.test`;
    const [row] = await this.db
      .insert(users)
      .values({ email, displayName: name, zip: opts.zip,
        homeLat: centroid.lat, homeLng: centroid.lng })
      .returning({ id: users.id });
    this.focusZip ??= opts.zip;
    return { id: row.id, name, zip: opts.zip, lat: centroid.lat, lng: centroid.lng };
  }

  async people(n: number, opts: { zip: string }): Promise<Person[]> {
    const out: Person[] = [];
    for (let i = 0; i < n; i++) out.push(await this.participant(`Anon${++this.anon}`, opts));
    return out;
  }

  // ── interest (harness state setup; mirrors the prod show-interest path) ─────
  async interest(people: Person[]): Promise<void> {
    for (const p of people) {
      const cells = cellsForPoint(p.lat, p.lng);
      const areaId = await this.ensureArea(p.zip, cells.r7, cells.snapLat, cells.snapLng);
      await this.db
        .insert(interestSignals)
        .values({ activityTypeId: this.activityTypeId, userId: p.id, areaId,
          h3Base: cells.r7, active: true })
        .onConflictDoUpdate({
          target: [interestSignals.activityTypeId, interestSignals.userId, interestSignals.areaId],
          set: { active: true },
        });
    }
  }

  // ── engine drivers (the REAL lib/mime, injected onto the pglite db) ─────────
  async evaluate(zip: string): Promise<void> {
    const area = await this.areaForZip(zip);
    if (!area) throw new Error(`evaluate: no area for ${zip}`);
    await evaluate(this.db as unknown as EngineDb, this.activityTypeId, area.id, this.clock.now());
  }

  async tick(): Promise<void> {
    await tick(this.db as unknown as EngineDb, this.clock.now());
  }

  // ── formation inputs (used once an attempt is live) ────────────────────────
  async suggest(person: Person, place: string, when: Date): Promise<void> {
    const attempt = await this.liveAttempt(person.zip);
    await this.db.insert(suggestions).values({
      attemptId: attempt, userId: person.id, placeText: place, proposedStart: when,
    });
  }

  async promise(who: Person[] | number, place: string): Promise<void> {
    const list = typeof who === "number"
      ? await this.people(who, { zip: this.focusZip! })
      : who;
    const option = await this.optionByPlace(place);
    for (const p of list) {
      await this.db.insert(softPromises)
        .values({ attemptId: option.attemptId, optionId: option.id, userId: p.id });
    }
  }

  at(_human: string): Date {
    // placeholder time parser for proposed_start; refined when formation UIs land
    return new Date(this.clock.now().getTime() + 2 * 86_400_000);
  }

  // ── beat: run the body, then snapshot the world into a report row ───────────
  async beat(feed: string, body: () => Promise<void>, view: BeatView = {}): Promise<void> {
    this.pendingAsserts = [];
    await body();
    const cells = await this.snapshot(view);
    const changed: Perspective[] = [];
    (Object.keys(cells) as Perspective[]).forEach((k) => {
      if (view[k] !== undefined) { changed.push(k); return; }
      if (this.prevCells && this.prevCells[k] !== cells[k] && cells[k] !== "—") changed.push(k);
      else if (!this.prevCells && cells[k] !== "—") changed.push(k);
    });
    this.beats.push({
      n: this.beats.length,
      time: this.clock.label(),
      feed,
      cells,
      changed,
      asserts: this.pendingAsserts,
    });
    this.prevCells = cells;
  }

  // ── expectations (record into the current beat) ────────────────────────────
  get expect() {
    return {
      area: (zip: string) => new AreaExpectation(this, zip),
      attempt: () => new AttemptExpectation(this),
      option: (place: string) => new OptionExpectation(this, place),
      outbox: () => new OutboxExpectation(this),
      game: () => new GameExpectation(this),
    };
  }

  /** @internal */ record(a: AssertionResult) { this.pendingAsserts.push(a); }
  /** @internal */ get database() { return this.db; }
  /** @internal */ get activity() { return this.activityTypeId; }

  // ── internals ──────────────────────────────────────────────────────────────
  private async centroid(zip: string) {
    const rows = await this.db.execute(
      sql`select lat, lng from zip_centroids where zip = ${zip} limit 1`
    );
    const r = (rows.rows as Array<{ lat: number; lng: number }>)[0];
    if (!r) throw new Error(`no zip_centroid fixture for ${zip} (seed it in the scenario)`);
    return r;
  }

  async ensureArea(zip: string, h3R7: bigint, lat: number, lng: number): Promise<string> {
    const inserted = await this.db.insert(areas)
      .values({ activityTypeId: this.activityTypeId, h3Cell: h3R7,
        displayZip: zip, centerLat: lat, centerLng: lng })
      .onConflictDoNothing()
      .returning({ id: areas.id });
    if (inserted.length) return inserted[0].id;
    const [existing] = await this.db.select({ id: areas.id }).from(areas)
      .where(and(eq(areas.activityTypeId, this.activityTypeId), eq(areas.h3Cell, h3R7)))
      .limit(1);
    return existing.id;
  }

  async areaForZip(zip: string) {
    const c = await this.centroid(zip);
    const cells = cellsForPoint(c.lat, c.lng);
    const [a] = await this.db.select().from(areas)
      .where(and(eq(areas.activityTypeId, this.activityTypeId), eq(areas.h3Cell, cells.r7)))
      .limit(1);
    return a ?? null;
  }

  private async liveAttempt(zip: string): Promise<string> {
    const a = await this.areaForZip(zip);
    if (!a) throw new Error(`no area for ${zip}`);
    const [att] = await this.db.select({ id: formationAttempts.id }).from(formationAttempts)
      .where(eq(formationAttempts.areaId, a.id)).limit(1);
    if (!att) throw new Error(`no live attempt for ${zip}`);
    return att.id;
  }

  private async optionByPlace(place: string) {
    const [o] = await this.db.select({ id: formationOptions.id, attemptId: formationOptions.attemptId })
      .from(formationOptions).where(eq(formationOptions.placeText, place)).limit(1);
    if (!o) throw new Error(`no option "${place}"`);
    return o;
  }

  private async snapshot(view: BeatView): Promise<Record<Perspective, string>> {
    const zip = this.focusZip;
    let engine = "—", area = "—";
    if (zip) {
      const a = await this.areaForZip(zip);
      if (a) {
        const [{ c }] = await this.db.select({ c: sql<number>`count(*)::int` })
          .from(interestSignals)
          .where(and(eq(interestSignals.areaId, a.id), eq(interestSignals.active, true)));
        area = `${a.status} · ${c} interested`;
        const [att] = await this.db.select().from(formationAttempts)
          .where(eq(formationAttempts.areaId, a.id))
          .orderBy(sql`${formationAttempts.createdAt} desc`).limit(1);
        engine = att ? `${a.status} · attempt #${att.attemptNumber} ${att.status}` : `${a.status}`;
      }
    }
    const outbox = await this.outboxDelta();
    return {
      engine: view.engine ?? engine,
      area: view.area ?? area,
      participant: view.participant ?? "—",
      outbox: view.outbox ?? outbox,
    };
  }

  private async outboxDelta(): Promise<string> {
    const rows = await this.db.select({
      kind: notificationsSent.kind,
      c: sql<number>`count(*)::int`,
    }).from(notificationsSent).groupBy(notificationsSent.kind);
    const now: Record<string, number> = {};
    const parts: string[] = [];
    for (const r of rows) {
      now[r.kind] = r.c;
      const delta = r.c - (this.prevKindCounts[r.kind] ?? 0);
      if (delta > 0) parts.push(`${r.kind} → ${delta}`);
    }
    this.prevKindCounts = now;
    return parts.length ? parts.join(" · ") : "—";
  }
}

// ── expectation builders (thenable: await runs the checks) ────────────────────
class AreaExpectation implements PromiseLike<void> {
  private checks: { status?: string; interest?: number } = {};
  constructor(private sim: Sim, private zip: string) {}
  status(s: string) { this.checks.status = s; return this; }
  interest(n: number) { this.checks.interest = n; return this; }
  then<R1 = void, R2 = never>(
    onfulfilled?: ((value: void) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null
  ): PromiseLike<R1 | R2> {
    return this.run().then(onfulfilled, onrejected);
  }
  private async run() {
    const a = await this.sim.areaForZip(this.zip);
    if (this.checks.status !== undefined) {
      this.sim.record({ text: `area ${this.zip} status == ${this.checks.status}`,
        ok: a?.status === this.checks.status, detail: `got ${a?.status ?? "none"}` });
    }
    if (this.checks.interest !== undefined) {
      const c = a ? (await this.sim.database.select({ c: sql<number>`count(*)::int` })
        .from(interestSignals)
        .where(and(eq(interestSignals.areaId, a.id), eq(interestSignals.active, true))))[0].c : 0;
      this.sim.record({ text: `area ${this.zip} interest == ${this.checks.interest}`,
        ok: c === this.checks.interest, detail: `got ${c}` });
    }
  }
}

class AttemptExpectation implements PromiseLike<void> {
  private checks: { status?: string; suggestions?: number; options?: number } = {};
  constructor(private sim: Sim) {}
  status(s: string) { this.checks.status = s; return this; }
  suggestions(n: number) { this.checks.suggestions = n; return this; }
  options(n: number) { this.checks.options = n; return this; }
  then<R1 = void, R2 = never>(
    onfulfilled?: ((value: void) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null
  ): PromiseLike<R1 | R2> {
    return this.run().then(onfulfilled, onrejected);
  }
  private async run() {
    const db = this.sim.database;
    const [att] = await db.select().from(formationAttempts)
      .orderBy(sql`${formationAttempts.createdAt} desc`).limit(1);
    if (this.checks.status !== undefined)
      this.sim.record({ text: `attempt status == ${this.checks.status}`,
        ok: att?.status === this.checks.status, detail: `got ${att?.status ?? "none"}` });
    if (this.checks.suggestions !== undefined) {
      const [{ c }] = await db.select({ c: sql<number>`count(*)::int` }).from(suggestions)
        .where(eq(suggestions.attemptId, att.id));
      this.sim.record({ text: `suggestions == ${this.checks.suggestions}`,
        ok: c === this.checks.suggestions, detail: `got ${c}` });
    }
    if (this.checks.options !== undefined) {
      const [{ c }] = await db.select({ c: sql<number>`count(*)::int` }).from(formationOptions)
        .where(eq(formationOptions.attemptId, att.id));
      this.sim.record({ text: `options == ${this.checks.options}`,
        ok: c === this.checks.options, detail: `got ${c}` });
    }
  }
}

class OptionExpectation implements PromiseLike<void> {
  private wantPromises?: number;
  constructor(private sim: Sim, private place: string) {}
  promises(n: number) { this.wantPromises = n; return this; }
  then<R1 = void, R2 = never>(
    onfulfilled?: ((value: void) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null
  ): PromiseLike<R1 | R2> {
    return this.run().then(onfulfilled, onrejected);
  }
  private async run() {
    const db = this.sim.database;
    const [o] = await db.select({ id: formationOptions.id }).from(formationOptions)
      .where(eq(formationOptions.placeText, this.place)).limit(1);
    if (this.wantPromises !== undefined) {
      const [{ c }] = await db.select({ c: sql<number>`count(*)::int` }).from(softPromises)
        .where(eq(softPromises.optionId, o.id));
      this.sim.record({ text: `option "${this.place}" promises == ${this.wantPromises}`,
        ok: c === this.wantPromises, detail: `got ${c}` });
    }
  }
}

class OutboxExpectation implements PromiseLike<void> {
  private k?: string; private n?: number; private once = false;
  constructor(private sim: Sim) {}
  kind(k: string) { this.k = k; return this; }
  sentTo(n: number) { this.n = n; return this; }
  oncePerUser() { this.once = true; return this; }
  then<R1 = void, R2 = never>(
    onfulfilled?: ((value: void) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null
  ): PromiseLike<R1 | R2> {
    return this.run().then(onfulfilled, onrejected);
  }
  private async run() {
    const db = this.sim.database;
    const rows = await db.select({ userId: notificationsSent.userId })
      .from(notificationsSent).where(eq(notificationsSent.kind, this.k as never));
    const total = rows.length;
    const distinct = new Set(rows.map((r) => r.userId)).size;
    if (this.n !== undefined)
      this.sim.record({ text: `${this.k} sent to ${this.n}`,
        ok: distinct === this.n, detail: `got ${distinct}` });
    if (this.once)
      this.sim.record({ text: `${this.k} once per user`,
        ok: total === distinct, detail: `${total} sends / ${distinct} users` });
  }
}

class GameExpectation implements PromiseLike<void> {
  private wantPlace?: string; private wantRoster?: number;
  constructor(private sim: Sim) {}
  place(p: string) { this.wantPlace = p; return this; }
  roster(n: number) { this.wantRoster = n; return this; }
  then<R1 = void, R2 = never>(
    onfulfilled?: ((value: void) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null
  ): PromiseLike<R1 | R2> {
    return this.run().then(onfulfilled, onrejected);
  }
  private async run() {
    const db = this.sim.database;
    const [g] = await db.select().from(games)
      .orderBy(sql`${games.createdAt} desc`).limit(1);
    if (this.wantPlace !== undefined)
      this.sim.record({ text: `game.place == ${this.wantPlace}`,
        ok: g?.placeText === this.wantPlace, detail: `got ${g?.placeText ?? "none"}` });
    if (this.wantRoster !== undefined) {
      const [{ c }] = await db.select({ c: sql<number>`count(*)::int` }).from(games);
      void c;
      this.sim.record({ text: `roster == ${this.wantRoster}`,
        ok: g?.confirmedCount === this.wantRoster, detail: `got ${g?.confirmedCount ?? 0}` });
    }
  }
}
