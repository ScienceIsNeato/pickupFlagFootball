/**
 * Injected clock. The engine never calls `new Date()` directly — it takes `now`
 * from here, so a scenario can advance time deterministically and the same code
 * runs in prod (real clock) and sim (frozen, steppable).
 */
export class Clock {
  private ms: number;
  readonly startMs: number;

  constructor(startIso: string) {
    this.ms = Date.parse(startIso);
    this.startMs = this.ms;
  }

  now(): Date {
    return new Date(this.ms);
  }

  /** Advance by a human duration: "48h", "30m", "14d", "90s". */
  advance(span: string): void {
    this.ms += parseSpan(span);
  }

  /** Hours since the scenario started — for "T+56h" beat labels. */
  label(): string {
    const h = Math.round((this.ms - this.startMs) / 3_600_000);
    return `T+${h}h`;
  }
}

const UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function parseSpan(span: string): number {
  const m = /^(\d+)\s*([smhd])$/.exec(span.trim());
  if (!m) throw new Error(`bad duration: "${span}" (use e.g. 48h, 30m, 14d)`);
  return Number(m[1]) * UNIT_MS[m[2]];
}
