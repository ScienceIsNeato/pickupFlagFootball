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
  const t = buildShareTemplates({ kind: "ambient-interest", othersCount: 4, totalCount: 5 }, PLACE, URL);
  assert.ok(t[0].text.includes("5"));
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
