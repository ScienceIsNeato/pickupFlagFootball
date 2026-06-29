import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNotificationEmail } from "@/lib/email/templates";

test("proposal email carries the details + Interested/Not-Interested buttons", () => {
  const inUrl = "https://app.test/interested?t=in.sig";
  const outUrl = "https://app.test/interested?t=out.sig";
  const mail = buildNotificationEmail("GAME_PROPOSED", {
    displayName: "Sam", appBaseUrl: "https://app.test", footer: null,
    buttons: { inUrl, outUrl },
    details: { place: "Republic Square, Austin 78701", when: "Saturdays at 10:00 am" },
  });
  assert.ok(mail.htmlContent.includes(inUrl), "html carries the interested link");
  assert.ok(mail.htmlContent.includes(outUrl), "html carries the not-interested link");
  assert.ok(/i&#39;m interested|i'm interested/i.test(mail.htmlContent), "has the interested button");
  assert.ok(/Republic Square/.test(mail.htmlContent), "shows the spot");
  assert.ok(/Saturdays at 10:00 am/.test(mail.htmlContent), "shows the time");
  assert.ok(mail.textContent.includes(inUrl), "text carries the interested link");
});

test("a plain notice omits the two-button row", () => {
  const mail = buildNotificationEmail("STALLED_NOTICE", {
    displayName: "Sam", appBaseUrl: "https://app.test", footer: null,
  });
  assert.ok(!/\/interested\?t=/.test(mail.htmlContent), "no interest links in html");
  assert.ok(!/i'm interested/i.test(mail.textContent), "no interest button in text");
});
