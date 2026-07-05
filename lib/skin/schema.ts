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
        url: z.string(), // external (http…) opens in a new tab; internal (/…) is a route
        // "subscribe" → render an integrated Stripe Checkout button instead of a
        // link (falls back to `url` until Stripe is configured).
        action: z.enum(["subscribe"]).optional(),
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
  }),
  privacy: z.object({
    seoTitle: z.string(),
    seoDescription: z.string(),
    heading: z.string(),
    updated: z.string(),
  }),
});

export type Skin = z.infer<typeof SkinSchema>;
