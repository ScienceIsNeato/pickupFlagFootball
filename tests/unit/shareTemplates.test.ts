import { test } from "node:test";
import assert from "node:assert/strict";
import { buildShareTemplates } from "@/lib/shareTemplates";

const URL = "https://pickupflagfootball.com";
const PLACE = { city: "Coralville", zip: "52241" };

test("alone: two templates, both mention the place and the link", () => {
  const t = buildShareTemplates({ kind: "alone" }, PLACE, URL);
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
  const t = buildShareTemplates({ kind: "ambient-interest", othersCount: 4, totalCount: 5, viewerIncluded: true }, null, URL);
  assert.match(t[0].text, /\b5\b/);
});

test("ambient-interest: claims 'of us' / 'including me' only when the viewer is actually counted", () => {
  const included = buildShareTemplates({ kind: "ambient-interest", othersCount: 4, totalCount: 5, viewerIncluded: true }, PLACE, URL);
  assert.match(included[0].text, /of us/);
  assert.match(included[1].text, /including me/);

  // catchmentUsers can exclude the viewer (emailOptIn off, or an opt-out on
  // their own area) — the post must not claim they're one of the count.
  const excluded = buildShareTemplates({ kind: "ambient-interest", othersCount: 5, totalCount: 5, viewerIncluded: false }, PLACE, URL);
  assert.doesNotMatch(excluded[0].text, /of us/);
  assert.doesNotMatch(excluded[1].text, /including me/);
});

test("open-proposal: shows the real interested/pMin tally", () => {
  const t = buildShareTemplates(
    { kind: "open-proposal", interestedCount: 3, pMin: 6, closesAt: new Date().toISOString(), placeText: "The Park" },
    PLACE, URL,
  );
  assert.ok(t[0].text.includes("3/6"));
});

test("games: names the place when there's exactly one", () => {
  const t = buildShareTemplates({ kind: "games", count: 1, placeText: "Republic Square" }, PLACE, URL);
  assert.match(t[0].text, /Republic Square/);
});

test("no place on file falls back to a generic phrase, not 'null'", () => {
  const t = buildShareTemplates({ kind: "alone" }, null, URL);
  for (const x of t) assert.ok(!/null/.test(x.text));
});
