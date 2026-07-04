import { test } from "node:test";
import assert from "node:assert/strict";
import { buildShareTemplates } from "@/lib/shareTemplates";

const URL = "https://pickupflagfootball.com";
const PLACE = { city: "Coralville", zip: "52241" };
const ACTIVITY = "flag football";

test("alone: two templates, both mention the place and the link", () => {
  const t = buildShareTemplates({ kind: "alone", pMin: 6 }, ACTIVITY, PLACE, URL);
  assert.equal(t.length, 2);
  for (const x of t) {
    assert.match(x.text, /Coralville/);
    assert.ok(x.text.includes(URL));
  }
});

test("ambient-interest: uses the live total count, not a hardcoded number", () => {
  // place: null (no ZIP in the text) so the digit can only have come from
  // interpolating totalCount — with PLACE, "52241" would make this pass even
  // if the count were hardcoded.
  const t = buildShareTemplates({ kind: "ambient-interest", othersCount: 4, totalCount: 5, viewerIncluded: true, pMin: 6 }, ACTIVITY, null, URL);
  assert.match(t[0].text, /\b5\b/);
});

test("ambient-interest: uses the passed activityName, not a hardcoded sport", () => {
  // Regression: an earlier fix threaded activityName into every OTHER branch
  // but missed the ambient-interest ledes, which still said "flag football"
  // literally. Use a deliberately different activity name so a reintroduced
  // hardcode fails loudly instead of passing by coincidence.
  const t = buildShareTemplates(
    { kind: "ambient-interest", othersCount: 4, totalCount: 5, viewerIncluded: true, pMin: 6 }, "kickball", PLACE, URL,
  );
  assert.match(t[0].text, /kickball/);
  assert.match(t[1].text, /kickball/);
  assert.doesNotMatch(t[0].text, /flag football/);
  assert.doesNotMatch(t[1].text, /flag football/);
});

test("ambient-interest: claims 'of us' / 'including me' only when the viewer is actually counted", () => {
  const included = buildShareTemplates({ kind: "ambient-interest", othersCount: 4, totalCount: 5, viewerIncluded: true, pMin: 6 }, ACTIVITY, PLACE, URL);
  assert.match(included[0].text, /of us/);
  assert.match(included[1].text, /including me/);

  // catchmentUsers can exclude the viewer (emailOptIn off, or an opt-out on
  // their own area) — the post must not claim they're one of the count.
  const excluded = buildShareTemplates({ kind: "ambient-interest", othersCount: 5, totalCount: 5, viewerIncluded: false, pMin: 6 }, ACTIVITY, PLACE, URL);
  assert.doesNotMatch(excluded[0].text, /of us/);
  assert.doesNotMatch(excluded[1].text, /including me/);
});

test("open-proposal: shows the real interested/pMin tally", () => {
  const t = buildShareTemplates(
    { kind: "open-proposal", interestedCount: 3, pMin: 6, closesAt: new Date().toISOString(), placeText: "The Park" },
    ACTIVITY, PLACE, URL,
  );
  assert.ok(t[0].text.includes("3/6"));
});

test("games: names the place when there's exactly one", () => {
  const t = buildShareTemplates({ kind: "games", count: 1, placeText: "Republic Square" }, ACTIVITY, PLACE, URL);
  assert.match(t[0].text, /Republic Square/);
});

test("no place on file falls back to a generic phrase, not 'null'", () => {
  const t = buildShareTemplates({ kind: "alone", pMin: 6 }, ACTIVITY, null, URL);
  for (const x of t) assert.ok(!/null/.test(x.text));
});
