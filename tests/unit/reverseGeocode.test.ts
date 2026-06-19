import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNominatimSearch, parseNominatimReverse } from "@/lib/geo/nominatim";

test("parseNominatimSearch: keeps numbered addresses, builds name + detail", () => {
  const out = parseNominatimSearch([
    { lat: "41.7", lon: "-91.6", type: "house", addresstype: "house",
      address: { house_number: "1806", road: "Brown Deer Trail", city: "Coralville", state: "Iowa", postcode: "52241" } },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "1806 Brown Deer Trail");
  assert.equal(out[0].detail, "Coralville, Iowa, 52241");
  assert.equal(out[0].lat, 41.7);
});

test("parseNominatimSearch: drops bare streets (no exact meeting point)", () => {
  const out = parseNominatimSearch([
    { lat: "41.7", lon: "-91.6", class: "highway", addresstype: "road", name: "Brown Deer Trail", address: { road: "Brown Deer Trail" } },
  ]);
  assert.deepEqual(out, []);
});

test("parseNominatimSearch: keeps a named POI (park/field) with its street under it", () => {
  const out = parseNominatimSearch([
    { lat: "41.7", lon: "-91.6", type: "park", addresstype: "leisure", name: "Morrison Park",
      address: { road: "5th St", city: "Coralville", state: "Iowa" } },
  ]);
  assert.equal(out[0].name, "Morrison Park");
  assert.equal(out[0].detail, "5th St, Coralville, Iowa");
});

test("parseNominatimSearch: skips items with bad coords; tolerates non-arrays", () => {
  assert.deepEqual(parseNominatimSearch([{ lat: "x", lon: "y", address: { house_number: "1" } }]), []);
  assert.deepEqual(parseNominatimSearch(null), []);
});

test("parseNominatimReverse: builds a closest-address label", () => {
  const r = parseNominatimReverse({
    address: { house_number: "1806", road: "Brown Deer Trail", city: "Coralville", state: "Iowa", postcode: "52241" },
  });
  assert.equal(r?.address, "1806 Brown Deer Trail, Coralville, Iowa");
  assert.equal(r?.zip, "52241");
});

test("parseNominatimReverse: null for empty/garbage", () => {
  assert.equal(parseNominatimReverse(null), null);
  assert.equal(parseNominatimReverse({}), null);
});
