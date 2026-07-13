import { latLngToCell, cellToLatLng, cellToParent, gridDisk, getResolution, isValidCell } from "h3-js";

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

/** Parent of `cell` at `res`, or null if the cell is unusable. Clamps `res` to
 *  the cell's own resolution so h3 never sees a finer-than-cell target (which
 *  throws E_RES_MISMATCH, code 12), and returns null for a malformed cell rather
 *  than letting getResolution/cellToParent throw E_RES_DOMAIN (code 4) and 500
 *  the whole map feed. Callers skip a null. One bad row must never break the map. */
export function cellToParentSafe(cell: string, res: number): string | null {
  if (!isValidCell(cell)) {
    console.warn("[h3] cellToParentSafe: skipping invalid cell", JSON.stringify(cell));
    return null;
  }
  return cellToParent(cell, Math.min(res, getResolution(cell)));
}

/** The catchment for a base cell: the cell plus its k-ring of neighbors, as
 *  bigints. v1 counts interest over this disk to decide critical mass. */
export function diskCells(cell: bigint, k = 1): bigint[] {
  return gridDisk(bigIntToH3(cell), k).map(h3ToBigInt);
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
