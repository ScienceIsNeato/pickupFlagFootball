import { latLngToCell, cellToLatLng, cellToParent } from "h3-js";

export type H3Cells = {
  r5: bigint;
  r6: bigint;
  r7: bigint;
  r8: bigint;
  r9: bigint;
};

export function h3ToBigInt(cell: string): bigint {
  return BigInt("0x" + cell);
}

export function bigIntToH3(n: bigint): string {
  return n.toString(16).padStart(15, "0");
}

export function cellsForPoint(
  lat: number,
  lng: number
): H3Cells & { snapLat: number; snapLng: number } {
  const r7cell = latLngToCell(lat, lng, 7);
  const [snapLat, snapLng] = cellToLatLng(r7cell);
  return {
    r5: h3ToBigInt(cellToParent(r7cell, 5)),
    r6: h3ToBigInt(cellToParent(r7cell, 6)),
    r7: h3ToBigInt(r7cell),
    r8: h3ToBigInt(latLngToCell(lat, lng, 8)),
    r9: h3ToBigInt(latLngToCell(lat, lng, 9)),
    snapLat,
    snapLng,
  };
}
