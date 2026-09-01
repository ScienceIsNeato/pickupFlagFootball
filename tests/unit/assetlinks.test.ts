import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { GET } from "@/app/api/assetlinks/route";

/** The Play Store app only loses its URL bar if this file vouches for the exact
 *  signing certificate, so a malformed one fails in the least obvious way
 *  possible: the app still works, it just looks like a website in a costume. */

const REAL = "6A:C9:5E:16:B2:D3:8F:AC:B8:6B:1F:00:E2:A9:F9:2B:79:D1:0A:64:66:7C:C1:03:0B:AA:5F:FB:42:0D:3E:B3";

afterEach(() => {
  delete process.env.TWA_PACKAGE_NAME;
  delete process.env.TWA_SHA256_FINGERPRINTS;
});

test("assetlinks: unset config 404s rather than claiming the app isn't ours", async () => {
  const res = await GET();
  assert.equal(res.status, 404);
});

test("assetlinks: serves the delegation for a configured package", async () => {
  process.env.TWA_PACKAGE_NAME = "com.pickupflagfootball.app";
  process.env.TWA_SHA256_FINGERPRINTS = REAL;
  const res = await GET();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body[0].relation[0], "delegate_permission/common.handle_all_urls");
  assert.equal(body[0].target.namespace, "android_app");
  assert.equal(body[0].target.package_name, "com.pickupflagfootball.app");
  assert.deepEqual(body[0].target.sha256_cert_fingerprints, [REAL]);
});

// Both certs must be listed: Play installs are signed with Google's app signing
// key, sideloaded builds with the local upload key. Listing one silently breaks
// the other.
test("assetlinks: carries both certificates, normalizing console copy-paste", async () => {
  process.env.TWA_PACKAGE_NAME = "com.pickupflagfootball.app";
  // Second one deliberately ugly: lowercase, no colons, stray whitespace.
  process.env.TWA_SHA256_FINGERPRINTS = ` ${REAL.toLowerCase()}, ${"ab".repeat(32)} `;
  const res = await GET();
  const body = await res.json();
  const fps = body[0].target.sha256_cert_fingerprints;
  assert.equal(fps.length, 2);
  assert.equal(fps[0], REAL, "lowercase input is normalized to the colon-separated uppercase Chrome wants");
  assert.equal(fps[1], Array(32).fill("AB").join(":"), "colon-less input gets separators");
});

test("assetlinks: a garbage fingerprint 500s instead of shipping an unverifiable file", async () => {
  process.env.TWA_PACKAGE_NAME = "com.pickupflagfootball.app";
  process.env.TWA_SHA256_FINGERPRINTS = "not-a-fingerprint";
  const res = await GET();
  assert.equal(res.status, 500);
});

test("assetlinks: a truncated fingerprint is rejected, not padded through", async () => {
  process.env.TWA_PACKAGE_NAME = "com.pickupflagfootball.app";
  // 62 hex chars — a plausible copy-paste that drops a byte. Must not pass.
  process.env.TWA_SHA256_FINGERPRINTS = "ab".repeat(31);
  const res = await GET();
  assert.equal(res.status, 500);
});
