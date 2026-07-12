import { test } from "node:test";
import assert from "node:assert/strict";
import { haversineKm, milesToKm, kmToMiles } from "@/lib/geo/distance";
import { geocodeAddress } from "@/lib/geo/geocode";
import { cellToParentSafe } from "@/lib/geo/h3";
import { latLngToCell, cellToParent, getResolution } from "h3-js";

const approx = (a: number, b: number, tol: number) =>
  assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

test("haversineKm: zero distance for the same point", () => {
  assert.equal(haversineKm(41.7, -91.6, 41.7, -91.6), 0);
});

test("haversineKm: ~111 km per degree of latitude", () => {
  approx(haversineKm(0, 0, 1, 0), 111.2, 1);
});

test("haversineKm: a known city-to-city distance", () => {
  // Coralville, IA → Cedar Rapids, IA is roughly 35 km
  approx(haversineKm(41.6764, -91.5805, 41.9779, -91.6656), 34, 4);
});

test("haversineKm: symmetric", () => {
  const a = haversineKm(40.0, -105.0, 39.5, -104.5);
  const b = haversineKm(39.5, -104.5, 40.0, -105.0);
  assert.equal(a, b);
});

test("mile/km conversions round-trip and match defaults", () => {
  approx(milesToKm(25), 40.23, 0.1);   // the default travel radius
  approx(kmToMiles(40), 24.85, 0.1);
  approx(kmToMiles(milesToKm(13)), 13, 1e-9);
});

test("cellToParentSafe: a cell coarser than the target res is returned as-is (guards H3 E_RES_MISMATCH)", () => {
  // Regression for the /api/map "Cell arguments had incompatible resolutions
  // (code 12)" crash: aggregating a res-5 cell up to a *finer* res-7 parent
  // throws in raw h3, which 500'd the whole map feed.
  const coarse = latLngToCell(41.68, -91.6, 5);
  assert.throws(() => cellToParent(coarse, 7)); // the raw call is the bug
  assert.equal(cellToParentSafe(coarse, 7), coarse); // the guard clamps to res 5
  assert.equal(getResolution(cellToParentSafe(coarse, 7)), 5);
});

test("cellToParentSafe: a finer cell rolls up to the requested parent resolution", () => {
  const fine = latLngToCell(41.68, -91.6, 7);
  const parent = cellToParentSafe(fine, 5);
  assert.equal(getResolution(parent), 5);
  assert.equal(parent, cellToParent(fine, 5)); // matches the normal roll-up
});

test("cellToParentSafe: equal resolution is the identity", () => {
  const cell = latLngToCell(41.68, -91.6, 6);
  assert.equal(cellToParentSafe(cell, 6), cell);
});

test("geocodeAddress: no street line → null without any network call", async () => {
  // The early return guards the request path: callers fall back to the ZIP
  // centroid when there's no street address to resolve.
  assert.equal(await geocodeAddress({ city: "Coralville", state: "IA", zip: "52241" }), null);
  assert.equal(await geocodeAddress({ line1: "   " }), null);
});

test("geocodeAddress: self-host gate — no GEOCODER_URL → null, never a 3rd-party call", async () => {
  // Guards the privacy promise: with no in-house geocoder configured we don't
  // send the address anywhere; the caller uses the ZIP centroid instead. Assert
  // it explicitly — a regression that still fetched and returned null would slip
  // past a value-only check.
  const prev = process.env.GEOCODER_URL;
  const prevFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    throw new Error("fetch must not be called when GEOCODER_URL is unset");
  }) as typeof fetch;
  delete process.env.GEOCODER_URL;
  try {
    assert.equal(await geocodeAddress({ line1: "1806 Brown Deer Trail", city: "Coralville", state: "IA", zip: "52241" }), null);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = prevFetch;
    if (prev !== undefined) process.env.GEOCODER_URL = prev;
    else delete process.env.GEOCODER_URL;
  }
});
