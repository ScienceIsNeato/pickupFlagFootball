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

test("game-on email carries the spot, time, and roster", () => {
  const mail = buildNotificationEmail("GAME_ON", {
    displayName: "Sam", appBaseUrl: "https://app.test", footer: null,
    details: { place: "Republic Square, Austin 78701", when: "Saturdays at 10:00 am · first game Sat, Jul 4" },
    roster: { count: 3, names: ["Ana", "Bo", "Sam"] },
  });
  assert.match(mail.htmlContent, /Republic Square/, "shows the spot");
  assert.match(mail.htmlContent, /Saturdays at 10:00 am/, "shows the time");
  assert.match(mail.htmlContent, /3 planning to play/i, "shows the headcount");
  assert.match(mail.htmlContent, /Ana, Bo, Sam/, "lists the roster");
});

test("a plain notice omits the two-button row", () => {
  const mail = buildNotificationEmail("STALLED_NOTICE", {
    displayName: "Sam", appBaseUrl: "https://app.test", footer: null,
  });
  assert.ok(!/\/interested\?t=/.test(mail.htmlContent), "no interest links in html");
  assert.ok(!/i'm interested/i.test(mail.textContent), "no interest button in text");
});

test("week-on renders the donation ask with a chip-in link", () => {
  const mail = buildNotificationEmail("WEEK_ON", {
    displayName: "Sam", appBaseUrl: "https://app.test",
    footer: { text: "if it's running your weekly game, chip in $5/month.", donateUrl: "/donate" },
  });
  assert.match(mail.htmlContent, />chip in<\/a>/, "ask renders a chip-in link");
  assert.ok(mail.htmlContent.includes("https://app.test/donate"), "link is absolute");
  assert.ok(mail.textContent.includes("https://app.test/donate"), "text carries the donate url");
});

test("week-on renders a supporter thank-you with no ask link", () => {
  const mail = buildNotificationEmail("WEEK_ON", {
    displayName: "Sam", appBaseUrl: "https://app.test",
    footer: { text: "thanks for chipping in - your support keeps your weekly game running.", donateUrl: null },
  });
  assert.match(mail.htmlContent, /thanks for chipping in/i, "shows the thank-you");
  assert.ok(!/>chip in<\/a>/.test(mail.htmlContent), "no chip-in link for supporters");
  assert.ok(!/\/donate/.test(mail.textContent), "no donate url in the text");
});
