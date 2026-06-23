// Small date/time helpers for the propose-a-game time picker. Pure and
// local-timezone based (the proposer picks a wall-clock weekday + time; we turn
// the chosen first-game date + time into an absolute instant in their tz).

export const DOW_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
] as const;

/** Local YYYY-MM-DD for a Date (not UTC — we want the proposer's calendar day). */
export function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * The next `count` calendar dates (YYYY-MM-DD) that fall on weekday `dow`
 * (0=Sun…6=Sat), strictly after `from`'s local date — so a first game is always
 * in the future, giving voters lead time to prep.
 */
export function upcomingDatesForDow(dow: number, count: number, from: Date): string[] {
  if (dow < 0 || dow > 6 || count <= 0) return [];
  // Start at the local midnight after `from`, then walk forward to the weekday.
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  let delta = (dow - start.getDay() + 7) % 7;
  if (delta === 0) delta = 7; // strictly future: skip today even if it matches
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + delta + i * 7); // setDate (not ms math) is DST-safe
    out.push(toYMD(d));
  }
  return out;
}

/**
 * The next occurrence date (local YYYY-MM-DD) for a game: for a standing game,
 * the soonest date on/after today whose weekday matches recur_dow (today counts
 * if it's game day); otherwise the scheduled start's calendar date. Server-local
 * for now — refine with the user's timezone later.
 */
/**
 * The kickoff instant for a game's occurrence on a given YMD: recur_time when set,
 * otherwise the time-of-day from scheduled_start. Single source for the kickoff
 * cutoff shared by nextPlayableOccurrence, the my-games list, and setOccurrenceRsvp.
 */
export function kickoffAtFor(
  game: { recurTime: string | null; scheduledStart: string | Date },
  ymd: string,
): Date {
  const time = game.recurTime ?? new Date(game.scheduledStart).toTimeString().slice(0, 8);
  return new Date(`${ymd}T${time}`);
}

export function nextOccurrenceYMD(
  game: { isStanding: boolean; recurDow: number | null; scheduledStart: string | Date },
  from: Date,
): string {
  if (game.isStanding && game.recurDow != null && game.recurDow >= 0 && game.recurDow <= 6) {
    const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    const delta = (game.recurDow - start.getDay() + 7) % 7; // 0 = today is game day
    start.setDate(start.getDate() + delta); // setDate (not ms math) is DST-safe
    return toYMD(start);
  }
  return toYMD(new Date(game.scheduledStart));
}

/**
 * All occurrence dates (local YYYY-MM-DD) for a game within an inclusive date
 * range. Standing games yield every recur_dow date in range; one-off games yield
 * their scheduled date if it falls in range. `from`/`to` are compared by calendar
 * day. Used to build the upcoming list and the past-occurrence history.
 */
export function occurrenceDatesInRange(
  game: { isStanding: boolean; recurDow: number | null; scheduledStart: string | Date },
  from: Date,
  to: Date,
): string[] {
  const fromMid = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const toMid = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  if (game.isStanding && game.recurDow != null && game.recurDow >= 0 && game.recurDow <= 6) {
    const out: string[] = [];
    const delta = (game.recurDow - fromMid.getDay() + 7) % 7;
    const d = new Date(fromMid);
    d.setDate(d.getDate() + delta); // setDate (not ms math) is DST-safe
    while (d.getTime() <= toMid.getTime()) {
      out.push(toYMD(d));
      d.setDate(d.getDate() + 7);
    }
    return out;
  }
  const s = new Date(game.scheduledStart);
  const sMid = new Date(s.getFullYear(), s.getMonth(), s.getDate());
  return sMid >= fromMid && sMid <= toMid ? [toYMD(sMid)] : [];
}

/**
 * Combine a local date (YYYY-MM-DD) + time (HH:MM) into an absolute ISO instant,
 * interpreted in the runtime's local timezone (the proposer's browser). Returns
 * "" if either part is missing or the result is invalid.
 */
export function combineDateTimeToISO(date: string, time: string): string {
  if (!date || !time) return "";
  const d = new Date(`${date}T${time}`);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

/** Half-hour time options across a sensible pickup-game window (06:00–22:00). */
export function gameTimeOptions(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (let h = 6; h <= 22; h++) {
    for (const m of [0, 30]) {
      if (h === 22 && m === 30) break; // cap at 22:00
      const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      const hr12 = ((h + 11) % 12) + 1;
      const ampm = h < 12 ? "am" : "pm";
      out.push({ value, label: `${hr12}:${String(m).padStart(2, "0")} ${ampm}` });
    }
  }
  return out;
}
