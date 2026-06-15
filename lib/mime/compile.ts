import type { Tunables } from "./tunables";
import type { SuggestionInput, CompiledOption } from "./types";

/** Normalize a place for dedupe: lowercase, collapse whitespace, drop punctuation. */
export function normalizePlace(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
}

/** Two suggestions are the same option if they name the same place at the same
 *  start instant (minute granularity). */
function groupKey(s: SuggestionInput): string {
  return `${normalizePlace(s.placeText)}@${Math.floor(s.proposedStart.getTime() / 60000)}`;
}

/**
 * Dedupe raw suggestions into options, newest-duplicates folded into the
 * earliest. Each option carries first_suggested_at (the earliest source
 * created_at) as the adjudication tiebreak. Sorted by first_suggested_at, capped
 * at options_cap.
 */
export function compileOptions(suggestions: SuggestionInput[], t: Tunables): CompiledOption[] {
  const groups = new Map<string, SuggestionInput[]>();
  for (const s of suggestions) {
    const k = groupKey(s);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(s);
  }

  const options: CompiledOption[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const earliest = sorted[0];
    options.push({
      placeText: earliest.placeText,
      proposedStart: earliest.proposedStart,
      firstSuggestedAt: earliest.createdAt,
      sourceIds: sorted.map((s) => s.id),
    });
  }

  options.sort((a, b) => a.firstSuggestedAt.getTime() - b.firstSuggestedAt.getTime());
  return options.slice(0, t.optionsCap);
}
