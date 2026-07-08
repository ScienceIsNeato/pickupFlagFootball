import { z } from "zod";

/**
 * The activity "skin" — all copy + config for one activity (flag football).
 * A future tennis site is a new JSON file conforming to this schema; zero
 * component changes. Mirrors the runtime tunables that live on activity_types.
 */
export const SkinSchema = z.object({
  slug: z.string(),
  brandName: z.string(),
  acronym: z.string(),
  activity: z.string(),
  // Small icon for share posts and the like (e.g. "🏈"). Optional — an
  // activity without an obvious emoji just omits it and copy renders clean.
  emoji: z.string().default(""),
  event: z.string(),
  participant: z.string(),
  seo: z.object({ title: z.string(), description: z.string() }),
  hero: z.object({
    heading: z.string(),
    body: z.string(),
    body2: z.string().optional(),
    gate: z.string(),
    cta: z.string(),
    note: z.string(),
  }),
  how: z.array(z.object({ n: z.string(), title: z.string(), body: z.string() })),
  faq: z.array(
    z.object({ q: z.string(), a: z.string().optional(), aHtml: z.string().optional() })
  ),
  register: z.object({
    seoTitle: z.string(),
    seoDescription: z.string(),
    heading: z.string(),
    blurb: z.string(),
    cta: z.string(),
    note: z.string(),
  }),
  donate: z.object({
    url: z.string(), // where the footer link + {donate} token resolve to (the /donate page)
    label: z.string(),
    seoTitle: z.string(),
    seoDescription: z.string(),
    heading: z.string(),
    blurb: z.string(),
    // each donation path is just a hosted URL (Stripe Payment Link, Buy Me a Coffee, ...)
    methods: z.array(
      z.object({
        name: z.string(),
        tag: z.string().optional(), // small badge, e.g. "suggested"
        desc: z.string(),
        cta: z.string(),
        // external (http…) opens in a new tab; internal (/…) is a route.
        // Optional ONLY for action:"subscribe" (integrated Stripe Checkout is
        // the real path there; the donate page throws if neither is available).
        url: z.string().optional(),
        // "subscribe" → render an integrated Stripe Checkout button instead of
        // a link (an explicit `url` is an optional fallback).
        action: z.enum(["subscribe"]).optional(),
      }).refine((m) => m.action === "subscribe" || !!m.url, {
        message: "donation method needs a url (only action:\"subscribe\" may omit it)",
      })
    ),
  }),
  faqPage: z.object({
    seoTitle: z.string(),
    seoDescription: z.string(),
    heading: z.string(),
  }),
  footer: z.object({
    tagline: z.string(),
    githubUrl: z.string(),
    note: z.string(),
    // Physical postal address shown in email footers — CAN-SPAM requires a valid
    // mailing address on commercial/mixed mail. Set a real address or P.O. box
    // before launch.
    mailingAddress: z.string(),
  }),
  privacy: z.object({
    seoTitle: z.string(),
    seoDescription: z.string(),
    heading: z.string(),
    updated: z.string(),
  }),
  terms: z.object({
    seoTitle: z.string(),
    seoDescription: z.string(),
    heading: z.string(),
    updated: z.string(),
  }),
})
  // Placeholders must never ship. The skin is parsed at module load (lib/skin),
  // so a leftover REPLACE_ME / CHANGEME / TO-DO anywhere in the config fails the
  // build and the server start instead of silently rendering a dead link.
  .superRefine((skin, ctx) => {
    const hit = JSON.stringify(skin).match(/REPLACE[_-]?ME|CHANGE[_-]?ME|TO[_-]?DO/i);
    if (hit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `skin contains the placeholder "${hit[0]}" — fill in the real value before shipping`,
      });
    }
  });

export type Skin = z.infer<typeof SkinSchema>;
