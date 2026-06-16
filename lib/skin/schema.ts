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
  donate: z.object({ url: z.string(), label: z.string() }),
  gear: z.object({
    seoTitle: z.string(),
    seoDescription: z.string(),
    heading: z.string(),
    blurb: z.string(),
    items: z.array(z.object({ name: z.string(), desc: z.string(), url: z.string() })),
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
