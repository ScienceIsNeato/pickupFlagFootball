import { test } from "node:test";
import assert from "node:assert/strict";
import { donationFooterFor } from "@/lib/email/donationFooter";

test("donationFooter: shown for an opted-in user who hasn't decided", () => {
  const f = donationFooterFor({ donationStatus: "unset", emailOptIn: true });
  assert.ok(f, "expected a footer");
  assert.match(f!.text, /\$5\/month/);
  assert.ok(f!.donateUrl.length > 0);
});

test("donationFooter: suppressed once the user subscribes", () => {
  assert.equal(donationFooterFor({ donationStatus: "subscribed", emailOptIn: true }), null);
});

test("donationFooter: suppressed once the user declines", () => {
  assert.equal(donationFooterFor({ donationStatus: "declined", emailOptIn: true }), null);
});

test("donationFooter: never shown to an email-opted-out user", () => {
  assert.equal(donationFooterFor({ donationStatus: "unset", emailOptIn: false }), null);
});
