import { test } from "node:test";
import assert from "node:assert/strict";
import { joinConfirmKind } from "@/lib/email/joinConfirm";
import { buildNotificationEmail } from "@/lib/email/templates";

test("joinConfirmKind: decided weeks reuse the game-on / not-this-week emails", () => {
  assert.equal(joinConfirmKind("scheduled", false), "WEEK_ON");
  assert.equal(joinConfirmKind("awaiting_game", false), "WEEK_ON");
  assert.equal(joinConfirmKind("skipped", false), "WEEK_OFF");
});

test("joinConfirmKind: mid-poll joiner gets JOIN_POLLING, unless already asked", () => {
  assert.equal(joinConfirmKind("polling", false), "JOIN_POLLING");
  assert.equal(joinConfirmKind("polling", true), undefined, "already got the POLL_ASK → no dup");
});

test("joinConfirmKind: no occurrence yet → JOIN_UPCOMING", () => {
  assert.equal(joinConfirmKind(null, false), "JOIN_UPCOMING");
  assert.equal(joinConfirmKind(undefined, false), "JOIN_UPCOMING");
});

test("joinConfirmKind: cancelled + transient/settled states send nothing", () => {
  for (const s of ["cancelled", "tallying", "notifying", "played"]) {
    assert.equal(joinConfirmKind(s, false), undefined, `${s} → no email`);
  }
});

test("JOIN_POLLING email: uses the dynamic intro + shows the game's spot/time", () => {
  const intro = "you joined while this week's poll is still open, so you're marked in for Monday, Jul 21. you'll find out by Saturday, Jul 19 whether enough players are in - we'll email you either way.";
  const mail = buildNotificationEmail("JOIN_POLLING", {
    displayName: "Sam", appBaseUrl: "https://app.test", footer: null,
    details: { place: "S.T. Morrison Park, Coralville 52241", when: "Monday, Jul 21 at 6:00 pm" },
    introOverride: intro,
  });
  assert.match(mail.subject, /poll's still open/);
  assert.ok(mail.htmlContent.includes("you'll find out by Saturday, Jul 19".replace(/'/g, "&#39;")), "html carries the poll-close date line");
  assert.ok(mail.textContent.includes("you'll find out by Saturday, Jul 19"), "text carries the poll-close date line");
  assert.match(mail.htmlContent, /S\.T\. Morrison Park/, "shows the spot");
  assert.match(mail.htmlContent, /Monday, Jul 21 at 6:00 pm/, "shows the time");
});

test("JOIN_UPCOMING email: 'you're in' with the next game date, no occurrence needed", () => {
  const intro = "you're on the roster at S.T. Morrison Park. the next game is Monday, Jul 21 at 6:00 pm - we'll email you when the weekly poll opens so you can confirm.";
  const mail = buildNotificationEmail("JOIN_UPCOMING", {
    displayName: "Sam", appBaseUrl: "https://app.test", footer: null,
    details: { place: "S.T. Morrison Park, Coralville 52241", when: "Monday, Jul 21 at 6:00 pm" },
    introOverride: intro,
  });
  assert.match(mail.subject, /on the roster/);
  assert.ok(mail.textContent.includes("the next game is Monday, Jul 21 at 6:00 pm"), "text carries the next-game line");
  assert.match(mail.htmlContent, /S\.T\. Morrison Park/, "shows the spot");
});

test("introOverride replaces the static per-kind intro", () => {
  const withOverride = buildNotificationEmail("JOIN_UPCOMING", {
    displayName: "Sam", appBaseUrl: "https://app.test", footer: null,
    introOverride: "custom dynamic intro here",
  });
  assert.ok(withOverride.htmlContent.includes("custom dynamic intro here"));
  assert.ok(!withOverride.htmlContent.includes("here's when it meets"), "static intro is replaced");
});
