import { test } from "node:test";
import assert from "node:assert/strict";
import { signRsvpToken, verifyRsvpToken, rsvpLink } from "@/lib/rsvpLink";

// secret() reads AUTH_SECRET at call time, so setting it here (before any test
// body runs) is enough.
process.env.AUTH_SECRET ??= "test-secret-for-rsvp-links";

test("rsvp token round-trips", () => {
  const t = signRsvpToken("user-1", "occ-9", "in");
  assert.deepEqual(verifyRsvpToken(t), { userId: "user-1", occurrenceId: "occ-9", action: "in" });
});

test("rsvp token rejects tampering", () => {
  const t = signRsvpToken("user-1", "occ-9", "out");
  assert.equal(verifyRsvpToken(t + "x"), null, "altered signature");
  assert.equal(verifyRsvpToken("garbage"), null, "malformed");
  // swap the payload but keep the old signature → must fail
  const forged = Buffer.from("user-2.occ-9.in").toString("base64url") + "." + t.split(".")[1];
  assert.equal(verifyRsvpToken(forged), null, "forged payload");
});

test("rsvpLink builds an absolute /rsvp url", () => {
  const url = rsvpLink("https://app.test", "u", "o", "in");
  assert.match(url, /^https:\/\/app\.test\/rsvp\?t=/);
  const t = url.split("t=")[1];
  assert.deepEqual(verifyRsvpToken(t), { userId: "u", occurrenceId: "o", action: "in" });
});
