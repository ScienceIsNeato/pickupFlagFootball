import { test } from "node:test";
import assert from "node:assert/strict";

// secret() reads AUTH_SECRET at call time — set it before importing/using.
process.env.AUTH_SECRET ??= "test-secret-for-unsubscribe-links";

import { signUnsubscribeToken, unsubscribeUrl, unsubscribeApiUrl, verifyUnsubscribeToken } from "@/lib/unsubscribeLink";

test("unsubscribe token round-trips to the user id", () => {
  const t = signUnsubscribeToken("user-42");
  assert.equal(verifyUnsubscribeToken(t), "user-42");
});

test("unsubscribe token rejects tampering", () => {
  const t = signUnsubscribeToken("user-42");
  assert.equal(verifyUnsubscribeToken(t.slice(0, -2) + "xy"), null); // mangled signature
  assert.equal(verifyUnsubscribeToken("garbage"), null);
  assert.equal(verifyUnsubscribeToken(""), null);
});

test("unsubscribe links are absolute and carry the token", () => {
  const page = unsubscribeUrl("https://app.test/", "user-42");
  const api = unsubscribeApiUrl("https://app.test", "user-42");
  assert.match(page, /^https:\/\/app\.test\/unsubscribe\?t=.+/);
  assert.match(api, /^https:\/\/app\.test\/api\/unsubscribe\?t=.+/);
  // the token in the link verifies back to the same user
  assert.equal(verifyUnsubscribeToken(new URL(page).searchParams.get("t")!), "user-42");
});
