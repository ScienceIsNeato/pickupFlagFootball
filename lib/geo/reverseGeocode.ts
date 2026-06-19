// Reverse geocoding for a PUBLIC map point the user right-clicks to propose a
// game (a candidate venue — not the user's home, so not PII). Goes through our
// /api/geocode route, which uses Nominatim (house-number precise) self-hosted
// when GEOCODER_URL is set, else the public instance.

export type { ReverseResult } from "./nominatim";
import type { ReverseResult } from "./nominatim";

/**
 * Look up the closest address to a lat/lng. Returns null on any failure (offline,
 * aborted, no match) so the caller can fall back to an empty, editable field.
 * Never throws.
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<ReverseResult | null> {
  try {
    const r = await fetch(`/api/geocode?lat=${lat}&lng=${lng}`, { signal });
    if (!r.ok) return null;
    const { reverse } = (await r.json()) as { reverse: ReverseResult | null };
    return reverse ?? null;
  } catch {
    return null;
  }
}
