import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { parseNominatimSearch, parseNominatimReverse } from "@/lib/geo/nominatim";

export const dynamic = "force-dynamic";

// Self-hosted Nominatim when deployed (GEOCODER_URL), else the public instance.
// Public Nominatim's policy wants a real User-Agent and light traffic — keeping
// this server-side (vs. per-browser) lets us honor that and add caching later.
const BASE = process.env.GEOCODER_URL?.replace(/\/+$/, "") || "https://nominatim.openstreetmap.org";
const UA = "mime-ff/1.0 (pickup flag football game finder)";

async function nominatim(path: string): Promise<unknown | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetch(`${BASE}${path}`, { signal: ctrl.signal, headers: { "User-Agent": UA } });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Geocode proxy for the propose-a-game picker. Two modes:
 *   /api/geocode?q=...          → { results: [{name, detail, lat, lng}] } (precise points only)
 *   /api/geocode?lat=..&lng=..  → { reverse: {address, city, zip} | null }
 * Auth-gated like the map it serves, so it can't be used as an open proxy.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const lat = url.searchParams.get("lat");
  const lng = url.searchParams.get("lng");

  if (lat != null && lng != null) {
    const la = Number(lat), ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) {
      return NextResponse.json({ error: "bad coords" }, { status: 400 });
    }
    const json = await nominatim(`/reverse?format=jsonv2&addressdetails=1&lat=${la}&lon=${ln}`);
    return NextResponse.json({ reverse: json ? parseNominatimReverse(json) : null });
  }

  if (q && q.length >= 3) {
    const json = await nominatim(`/search?format=jsonv2&addressdetails=1&limit=8&q=${encodeURIComponent(q)}`);
    return NextResponse.json({ results: json ? parseNominatimSearch(json) : [] });
  }

  return NextResponse.json({ results: [] });
}
