const EARTH_KM = 6371;
const toRad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance between two lat/lng points, in kilometers. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export const KM_PER_MILE = 1.609344;
export const milesToKm = (mi: number) => mi * KM_PER_MILE;
export const kmToMiles = (km: number) => km / KM_PER_MILE;
