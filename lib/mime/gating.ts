import type { Tunables } from "./tunables";

export type SendContext = {
  /** sends to this user in the trailing 7 days (across all areas) */
  sentLast7d: number;
  /** local hour 0–23 at the user's timezone, for quiet hours */
  localHour: number;
  /** user has been auto-snoozed (ignored too many windows) */
  snoozed: boolean;
  /** consecutive windows this user ignored */
  consecutiveIgnored: number;
};

/** Quiet hours: nothing 21:00–08:00 local. */
export function inQuietHours(localHour: number): boolean {
  return localHour >= 21 || localHour < 8;
}

/** Should this user be auto-snoozed for ignoring too many windows in a row? */
export function shouldDecay(consecutiveIgnored: number, t: Tunables): boolean {
  return consecutiveIgnored >= t.ignoreDecayWindows;
}

/**
 * The per-send gate every notification passes through: not snoozed, under the
 * weekly cap, and outside quiet hours. Pure — the shell supplies the counts and
 * the local hour from the user's timezone.
 */
export function canSend(ctx: SendContext, t: Tunables): boolean {
  if (ctx.snoozed) return false;
  if (shouldDecay(ctx.consecutiveIgnored, t)) return false;
  if (ctx.sentLast7d >= t.perUserWeeklyCap) return false;
  if (inQuietHours(ctx.localHour)) return false;
  return true;
}
