import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWithdrawnEmail } from "@/lib/email/templates";
import { whenText } from "@/lib/email/flush";

test("withdrawn notice names the spot and time and points back to the map", () => {
  // The caller passes whenText's output — the same wording the GAME_PROPOSED
  // ask used, since both emails land minutes apart on withdraw-then-repropose.
  const when = whenText(new Date(2026, 7, 22, 10, 0), 6, "10:00:00");
  assert.equal(when, "Saturdays at 10:00 am · first game Sat, Aug 22");
  const mail = buildWithdrawnEmail("Sam", "https://app.test", "Republic Square", when);
  assert.match(mail.subject, /Republic Square/, "subject names the spot");
  assert.match(mail.subject, /withdrawn/i, "subject says what happened");
  assert.ok(mail.htmlContent.includes(`Republic Square (${when})`), "html carries spot + time");
  assert.ok(mail.htmlContent.includes("https://app.test/play"), "cta goes to the map");
  assert.ok(mail.textContent.includes("https://app.test/play"), "text carries the map link");
  assert.ok(/hey Sam,/.test(mail.textContent), "greets by name");
});

test("one-off proposals get a dated when, not a recurring one", () => {
  assert.equal(whenText(new Date(2026, 7, 22, 18, 30), null, null), "Sat, Aug 22 at 6:30 pm");
});

test("withdrawn notice without a time still reads cleanly", () => {
  const mail = buildWithdrawnEmail(null, "https://app.test/", "Zilker Park", null);
  assert.ok(/at Zilker Park was withdrawn/.test(mail.textContent), "no dangling parens without a time");
  assert.ok(!/\(\)/.test(mail.textContent), "no empty parenthetical");
  assert.ok(/hey there,/.test(mail.textContent), "falls back to a generic greeting");
  // trailing slash on the base URL must not produce a double slash in the cta
  assert.ok(mail.htmlContent.includes("https://app.test/play"), "base url trailing slash trimmed");
  assert.ok(!mail.htmlContent.includes("app.test//play"), "no double slash");
});
