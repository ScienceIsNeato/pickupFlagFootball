import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNotificationEmail } from "@/lib/email/templates";

test("courting email includes the decline link when given one", () => {
  const url = "https://app.test/decline?t=abc.def";
  const mail = buildNotificationEmail("SPARK_ASK", {
    displayName: "Sam", appBaseUrl: "https://app.test", footer: null, declineUrl: url,
  });
  assert.ok(mail.htmlContent.includes(url), "html carries the decline link");
  assert.ok(/not interested in this site/i.test(mail.htmlContent), "html has the prompt");
  assert.ok(mail.textContent.includes(url), "text carries the decline link");
});

test("email omits the decline link when none is given", () => {
  const mail = buildNotificationEmail("POLL_ASK", {
    displayName: "Sam", appBaseUrl: "https://app.test", footer: null,
  });
  assert.ok(!/\/decline\?t=/.test(mail.htmlContent), "no decline link in html");
  assert.ok(!/not interested in this site/i.test(mail.textContent), "no decline prompt in text");
});
