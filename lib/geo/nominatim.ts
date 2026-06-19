// Pure parsers for Nominatim (OpenStreetMap) geocoding responses. Nominatim
// resolves house-number-precise addresses (Photon only returns street
// centerlines), so a proposed game lands on an exact meeting point, not a street.
// The /api/geocode route does the fetching (self-hosted GEOCODER_URL when set,
// else public Nominatim); these functions just normalize its JSON.

export type GeoResult = { name: string; detail: string; lat: number; lng: number };
export type ReverseResult = { address: string; street?: string; city?: string; zip?: string };

type NominatimAddress = {
  house_number?: string;
  road?: string;
  city?: string; town?: string; village?: string; hamlet?: string; suburb?: string;
  state?: string;
  postcode?: string;
};
type NominatimItem = {
  lat?: string | number;
  lon?: string | number;
  name?: string;
  display_name?: string;
  type?: string;
  addresstype?: string;
  class?: string;
  address?: NominatimAddress;
};

const cityOf = (a: NominatimAddress) => a.city || a.town || a.village || a.hamlet || a.suburb;

/** A bare street/road has no exact meeting point — exclude it from the picker. */
function isBareStreet(it: NominatimItem): boolean {
  const a = it.address ?? {};
  if (a.house_number) return false; // a numbered address is precise
  return it.addresstype === "road" || it.class === "highway";
}

function coords(it: NominatimItem): { lat: number; lng: number } | null {
  const lat = Number(it.lat), lng = Number(it.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/** Forward-search results → precise, pickable points (streets filtered out). */
export function parseNominatimSearch(json: unknown): GeoResult[] {
  if (!Array.isArray(json)) return [];
  const out: GeoResult[] = [];
  for (const it of json as NominatimItem[]) {
    if (isBareStreet(it)) continue;
    const c = coords(it);
    if (!c) continue;
    const a = it.address ?? {};
    const line = [a.house_number, a.road].filter(Boolean).join(" ");
    const name = (it.name && it.name.trim()) || line || a.road || (it.display_name ?? "").split(",")[0] || "unnamed spot";
    const detail = [it.name && line ? line : null, cityOf(a), a.state, a.postcode]
      .filter(Boolean).join(", ");
    out.push({ name, detail, lat: c.lat, lng: c.lng });
  }
  return out;
}

/** Reverse lookup → a "closest address" label for a clicked point. */
export function parseNominatimReverse(json: unknown): ReverseResult | null {
  const it = json as NominatimItem | null;
  const a = it?.address;
  if (!it || !a) return null;
  const line = [a.house_number, a.road].filter(Boolean).join(" ").trim();
  const place = (it.name && it.name.trim()) || line || a.road || "";
  const tail = [cityOf(a), a.state].filter(Boolean).join(", ");
  const address = [place, tail].filter(Boolean).join(", ").trim();
  if (!address) return null;
  // street = a numbered street line, or a named place (park/field) as the "spot"
  const street = line || (it.name && it.name.trim()) || a.road || undefined;
  return { address, street, city: cityOf(a) || undefined, zip: a.postcode || undefined };
}
