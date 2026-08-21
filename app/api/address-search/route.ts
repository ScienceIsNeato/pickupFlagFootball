import { NextResponse } from "next/server";
import { lookupZip } from "@/lib/geo/zipLookup";

export const dynamic = "force-dynamic";

/**
 * Address autocomplete for REGISTRATION (signed-out users, so unlike
 * /api/geocode this can't hide behind auth). Kept safe to expose:
 *   - 5-digit queries resolve from the local zip_centroids table - no external
 *     call at all (also what keeps e2e hermetic).
 *   - anything else goes to Nominatim, US-only, limit 5, addressdetails on.
 *   - per-IP token bucket so it can't be farmed as an open geocode proxy.
 *
 * Returns structured pieces the register form needs:
 *   { results: [{ label, line1, city, state, zip, lat, lng }] }
 */

const BASE = process.env.GEOCODER_URL?.replace(/\/+$/, "") || "https://nominatim.openstreetmap.org";
const UA = "mime-ff/1.0 (pickup flag football game finder)";

// Best-effort in-memory bucket (one Cloud Run instance at min-scale; a fresh
// instance just starts a fresh bucket - fine for an abuse brake, not billing).
const bucket = new Map<string, { n: number; resetAt: number }>();
const LIMIT = 15, WINDOW_MS = 60_000;
function allow(ip: string): boolean {
  const now = Date.now();
  const b = bucket.get(ip);
  if (!b || now > b.resetAt) { bucket.set(ip, { n: 1, resetAt: now + WINDOW_MS }); return true; }
  if (b.n >= LIMIT) return false;
  b.n += 1;
  return true;
}

type Item = {
  lat?: string; lon?: string;
  address?: {
    house_number?: string; road?: string; city?: string; town?: string; village?: string;
    municipality?: string; state?: string; postcode?: string;
  };
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  if (q.length < 3) return NextResponse.json({ results: [] });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allow(ip)) return NextResponse.json({ error: "slow down" }, { status: 429 });

  // ZIP fast-path: the local centroid table answers without leaving the box.
  if (/^\d{5}$/.test(q)) {
    const z = await lookupZip(q);
    return NextResponse.json({
      results: z ? [{
        label: `${z.city ? `${z.city}, ` : ""}${z.state ?? ""} ${q}`.trim(),
        line1: "", city: z.city ?? "", state: z.state ?? "", zip: q,
        lat: z.lat, lng: z.lng,
      }] : [],
    });
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetch(
      `${BASE}/search?format=jsonv2&addressdetails=1&countrycodes=us&limit=5&q=${encodeURIComponent(q)}`,
      { signal: ctrl.signal, headers: { "User-Agent": UA } },
    );
    if (!r.ok) return NextResponse.json({ results: [] });
    const json = (await r.json()) as Item[];
    const results = (Array.isArray(json) ? json : [])
      .map((it) => {
        const a = it.address ?? {};
        const lat = Number(it.lat), lng = Number(it.lon);
        // Only results we can turn into a real home: a ZIP is the anchor the
        // whole area model keys off, so no postcode = not selectable.
        if (!a.postcode || !/^\d{5}/.test(a.postcode) || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        const city = a.city || a.town || a.village || a.municipality || "";
        const line1 = [a.house_number, a.road].filter(Boolean).join(" ");
        const zip = a.postcode.slice(0, 5);
        return {
          label: [line1 || null, city || null, a.state || null, zip].filter(Boolean).join(", "),
          line1, city, state: a.state ?? "", zip, lat, lng,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      // dedupe identical labels (Nominatim loves near-duplicates)
      .filter((x, i, arr) => arr.findIndex((y) => y.label === x.label) === i);
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ results: [] });
  } finally {
    clearTimeout(timer);
  }
}
