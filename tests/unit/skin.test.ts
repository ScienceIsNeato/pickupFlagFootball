import { test } from "node:test";
import assert from "node:assert/strict";
import { SkinSchema } from "@/lib/skin/schema";
import raw from "@/config/skins/flag-football.json";

test("the shipped skin parses clean (no placeholders, all urls real)", () => {
  const skin = SkinSchema.parse(raw); // throws = fail
  // the two donation links that shipped as REPLACE_ME once — never again
  const tip = skin.donate.methods.find((m) => !m.action && m.url?.startsWith("http"));
  assert.ok(tip?.url?.includes("buymeacoffee.com/pickupFlagFootball"), "tip link is the real BMC page");
});

test("a placeholder anywhere in the skin fails the parse (build/server dies)", () => {
  const doctored = structuredClone(raw) as Record<string, unknown>;
  (doctored as { hero: { note: string } }).hero.note = "https://example.com/REPLACE_ME";
  assert.throws(() => SkinSchema.parse(doctored), /placeholder/i, "REPLACE_ME rejected");

  const doctored2 = structuredClone(raw) as { footer: { note: string } };
  doctored2.footer.note = "TODO: write this";
  assert.throws(() => SkinSchema.parse(doctored2), /placeholder/i, "TODO rejected");
});

test("only the subscribe method may omit its url", () => {
  const noUrl = structuredClone(raw) as { donate: { methods: { url?: string; action?: string }[] } };
  const tip = noUrl.donate.methods.find((m) => !m.action)!;
  delete tip.url;
  assert.throws(() => SkinSchema.parse(noUrl), /needs a url/, "plain method without url rejected");
});
