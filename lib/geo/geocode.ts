export type AddressParts = {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
};

/**
 * Geocode a structured US address to a point, server-side, via Photon (Komoot's
 * free keyless OSM geocoder). Returns null when there's no street line to
 * resolve, the lookup fails/times out, or nothing matches — callers fall back to
 * the ZIP centroid. Never throws.
 */
export async function geocodeAddress(parts: AddressParts): Promise<{ lat: number; lng: number } | null> {
  const line1 = (parts.line1 ?? "").trim();
  if (!line1) return null; // nothing more precise than the ZIP to geocode

  const q = [line1, parts.line2, parts.city, parts.state, parts.zip]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(", ");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const r = await fetch(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=1`,
      { signal: ctrl.signal, headers: { "User-Agent": "mime-ff/1.0 (game finder)" } },
    );
    if (!r.ok) return null;
    const d = (await r.json()) as { features?: { geometry?: { coordinates?: number[] } }[] };
    const c = d.features?.[0]?.geometry?.coordinates;
    if (!c || c.length < 2) return null;
    const [lng, lat] = c;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
  } catch {
    return null; // aborted / offline / bad payload — fall back to ZIP centroid
  } finally {
    clearTimeout(timer);
  }
}
