import { lookupZip } from "./zipLookup";
import { cellsForPoint } from "./h3";
import { geocodeAddress } from "./geocode";
import { haversineKm } from "./distance";

export type HomeInput = {
  zip: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
};

export type ResolvedHome = {
  displayCity: string;
  // the user's home point: the geocoded address, else the ZIP centroid
  homeLat: number;
  homeLng: number;
  // the r7 cell centroid — the shared area's center, never a user's address
  snapLat: number;
  snapLng: number;
  r5: bigint; r6: bigint; r7: bigint; r8: bigint; r9: bigint;
};

/**
 * Resolve a user's home point + H3 cells from their ZIP and optional street
 * address. Geocodes the address when one is given, distrusting a result that
 * lands far from the ZIP (a mis-match); otherwise uses the ZIP centroid.
 * Returns null when the ZIP is unknown (callers surface that).
 */
export async function resolveHome(input: HomeInput): Promise<ResolvedHome | null> {
  const centroid = await lookupZip(input.zip);
  if (!centroid) return null;
  const displayCity = (input.city ?? "").trim() || centroid.city || input.zip;

  let homeLat = centroid.lat;
  let homeLng = centroid.lng;
  const line1 = (input.line1 ?? "").trim();
  if (line1) {
    const g = await geocodeAddress({ line1, line2: input.line2, city: displayCity, state: input.state, zip: input.zip });
    if (g && haversineKm(g.lat, g.lng, centroid.lat, centroid.lng) <= 50) {
      homeLat = g.lat;
      homeLng = g.lng;
    }
  }

  const { r5, r6, r7, r8, r9, snapLat, snapLng } = cellsForPoint(homeLat, homeLng);
  return { displayCity, homeLat, homeLng, snapLat, snapLng, r5, r6, r7, r8, r9 };
}
