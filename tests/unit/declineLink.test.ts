import { test } from "node:test";
import assert from "node:assert/strict";
import { signDeclineToken, verifyDeclineToken, declineLink } from "@/lib/declineLink";

// secret() reads AUTH_SECRET at call time, so setting it before any test body
// runs is enough.
process.env.AUTH_SECRET ??= "test-secret-for-decline-links";

test("decline token round-trips", () => {
  const t = signDeclineToken("user-1", "area-9");
  assert.deepEqual(verifyDeclineToken(t), { userId: "user-1", areaId: "area-9" });
});

test("decline token rejects tampering", () => {
  const t = signDeclineToken("user-1", "area-9");
  assert.equal(verifyDeclineToken(t + "x"), null, "altered signature");
  assert.equal(verifyDeclineToken("garbage"), null, "malformed");
  // swap the payload but keep the old signature → must fail
  const forged = Buffer.from("user-2.area-9").toString("base64url") + "." + t.split(".")[1];
  assert.equal(verifyDeclineToken(forged), null, "forged payload");
});

test("decline token expires", () => {
  const t = signDeclineToken("u", "a", -1); // already expired
  assert.equal(verifyDeclineToken(t), null);
});

test("declineLink builds an absolute /decline url", () => {
  const url = declineLink("https://app.test", "u", "a");
  assert.match(url, /^https:\/\/app\.test\/decline\?t=/);
  const t = url.split("t=")[1];
  assert.deepEqual(verifyDeclineToken(t), { userId: "u", areaId: "a" });
});
