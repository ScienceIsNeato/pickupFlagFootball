import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWithdrawnEmail } from "@/lib/email/templates";

test("withdrawn notice names the spot and time and points back to the map", () => {
  const mail = buildWithdrawnEmail("Sam", "https://app.test", "Republic Square", "Saturdays 10:00");
  assert.match(mail.subject, /Republic Square/, "subject names the spot");
  assert.match(mail.subject, /withdrawn/i, "subject says what happened");
  assert.ok(/Republic Square \(Saturdays 10:00\)/.test(mail.htmlContent), "html carries spot + time");
  assert.ok(mail.htmlContent.includes("https://app.test/play"), "cta goes to the map");
  assert.ok(mail.textContent.includes("https://app.test/play"), "text carries the map link");
  assert.ok(/hey Sam,/.test(mail.textContent), "greets by name");
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
