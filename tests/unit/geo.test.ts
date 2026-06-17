import { test } from "node:test";
import assert from "node:assert/strict";
import { haversineKm, milesToKm, kmToMiles } from "@/lib/geo/distance";
import { geocodeAddress } from "@/lib/geo/geocode";

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

test("geocodeAddress: no street line → null without any network call", async () => {
  // The early return guards the request path: callers fall back to the ZIP
  // centroid when there's no street address to resolve.
  assert.equal(await geocodeAddress({ city: "Coralville", state: "IA", zip: "52241" }), null);
  assert.equal(await geocodeAddress({ line1: "   " }), null);
});

test("geocodeAddress: self-host gate — no GEOCODER_URL → null, never a 3rd-party call", async () => {
  // Guards the privacy promise: with no in-house geocoder configured we don't
  // send the address anywhere; the caller uses the ZIP centroid instead.
  const prev = process.env.GEOCODER_URL;
  delete process.env.GEOCODER_URL;
  try {
    assert.equal(await geocodeAddress({ line1: "1806 Brown Deer Trail", city: "Coralville", state: "IA", zip: "52241" }), null);
  } finally {
    if (prev !== undefined) process.env.GEOCODER_URL = prev;
  }
});
