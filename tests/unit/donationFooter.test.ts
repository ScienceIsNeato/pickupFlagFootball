import { test } from "node:test";
import assert from "node:assert/strict";
import { donationFooterFor } from "@/lib/email/donationFooter";

test("donationFooter: the ask for an opted-in user who hasn't decided", () => {
  const f = donationFooterFor({ donationStatus: "unset", emailOptIn: true });
  assert.ok(f, "expected a footer");
  assert.match(f!.text, /\$5\/month/);
  assert.ok(f!.donateUrl && f!.donateUrl.length > 0, "the ask carries a chip-in link");
});

test("donationFooter: a thank-you (no ask, no link) once the user subscribes", () => {
  const f = donationFooterFor({ donationStatus: "subscribed", emailOptIn: true });
  assert.ok(f, "expected a thank-you footer");
  assert.match(f!.text, /thank/i);
  assert.doesNotMatch(f!.text, /\$5\/month/);
  assert.equal(f!.donateUrl, null, "supporters get no chip-in link");
});

test("donationFooter: suppressed once the user declines", () => {
  assert.equal(donationFooterFor({ donationStatus: "declined", emailOptIn: true }), null);
});

test("donationFooter: never shown to an email-opted-out user", () => {
  assert.equal(donationFooterFor({ donationStatus: "unset", emailOptIn: false }), null);
});
