export type AddressParts = {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
};

/**
 * Geocode a structured US address to a point using a SELF-HOSTED geocoder, so a
 * user's address never leaves our own infrastructure (per the privacy promise).
 *
 * The endpoint is a self-run Nominatim base URL in GEOCODER_URL (e.g.
 * http://geocoder.internal:8080). When it isn't configured we do NOT fall back
 * to any third-party service — we return null and the caller uses the ZIP
 * centroid instead. So precise address→distance is dormant until the in-house
 * geocoder is deployed; nothing is sent to an outside party in the meantime.
 *
 * Returns null when there's no street line, no configured geocoder, or the
 * lookup fails/times out/doesn't match. Never throws.
 */
export async function geocodeAddress(parts: AddressParts): Promise<{ lat: number; lng: number } | null> {
  const line1 = (parts.line1 ?? "").trim();
  if (!line1) return null; // nothing more precise than the ZIP to geocode

  const base = process.env.GEOCODER_URL?.replace(/\/+$/, "");
  if (!base) return null; // no self-hosted geocoder → never call a third party

  const q = [line1, parts.line2, parts.city, parts.state, parts.zip]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(", ");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    // Nominatim search API: GET /search?q=...&format=jsonv2&limit=1
    const r = await fetch(
      `${base}/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`,
      { signal: ctrl.signal, headers: { "User-Agent": "mime-ff/1.0 (game finder)" } },
    );
    if (!r.ok) return null;
    const d = (await r.json()) as { lat?: string | number; lon?: string | number }[];
    const hit = Array.isArray(d) ? d[0] : null;
    if (!hit) return null;
    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
  } catch {
    return null; // aborted / offline / bad payload — fall back to ZIP centroid
  } finally {
    clearTimeout(timer);
  }
}
