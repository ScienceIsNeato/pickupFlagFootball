import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const activity = process.argv[2] || 'flag-football';
const contentPath = join(root, 'content', `${activity}.json`);

if (!existsSync(contentPath)) {
  console.error(`unknown activity '${activity}': no content/${activity}.json found`);
  process.exit(1);
}

let content;
try {
  content = JSON.parse(readFileSync(contentPath, 'utf8'));
} catch (err) {
  console.error(`invalid JSON in content/${activity}.json: ${err.message}`);
  process.exit(1);
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

// Single pass: each {{KEY}} replaced once (inserted copy never re-scanned). Values
// are HTML-escaped unless flagged { raw: true } for HTML we generate ourselves.
function render(templateFile, values) {
  const html = readFileSync(join(root, 'src', templateFile), 'utf8');
  const missing = [];
  const out = html.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (!(key in values)) { missing.push(key); return match; }
    const entry = values[key];
    if (entry === undefined || entry === null) { missing.push(key); return match; }
    if (typeof entry === 'object' && entry.raw) return entry.value;
    return escapeHtml(entry);
  });
  if (missing.length) {
    console.error(`${templateFile}: unresolved placeholder(s): ${[...new Set(missing)].join(', ')}`);
    process.exit(1);
  }
  return out;
}

const howCards = content.how.map((s) => `
        <div class="card">
          <div class="step-n">${escapeHtml(s.n)}</div>
          <div class="title">${escapeHtml(s.title)}</div>
          <p>${escapeHtml(s.body)}</p>
        </div>`).join('');

// FAQ answers are plain text (escaped) unless an item provides trusted aHtml, which
// may contain links. {donate} in aHtml resolves to the configured donate URL.
const donateUrl = escapeHtml(content.donate.url);
const faqItems = content.faq.map((f) => {
  const answer = f.aHtml ? f.aHtml.replaceAll('{donate}', donateUrl) : escapeHtml(f.a);
  return `
        <div class="faq-item">
          <div class="q">${escapeHtml(f.q)}</div>
          <p>${answer}</p>
        </div>`;
}).join('');

const gearCards = content.gear.items.map((g) => `
        <div class="card">
          <div class="title">${escapeHtml(g.name)}</div>
          <p>${escapeHtml(g.desc)}</p>
          <a href="${escapeHtml(g.url)}">on amazon ↗</a>
        </div>`).join('');

const common = {
  BRAND: content.brandName,
  DONATE_URL: content.donate.url,
  DONATE_LABEL: content.donate.label,
  FOOTER: content.footer,
};

const pages = {
  'index.html': render('index.template.html', {
    ...common,
    SEO_TITLE: content.seo.title,
    SEO_DESC: content.seo.description,
    ACRONYM: content.acronym,
    HERO_HEADING: content.hero.heading,
    HERO_BODY: content.hero.body,
    GATE: content.hero.gate,
    HERO_CTA: content.hero.cta,
    HERO_NOTE: content.hero.note,
    HOW_CARDS: { raw: true, value: howCards },
  }),
  'register.html': render('register.template.html', {
    ...common,
    SEO_TITLE: content.register.seoTitle,
    SEO_DESC: content.register.seoDescription,
    REG_HEADING: content.register.heading,
    REG_BLURB: content.register.blurb,
    REG_CTA: content.register.cta,
    REG_NOTE: content.register.note,
  }),
  'faq.html': render('faq.template.html', {
    ...common,
    SEO_TITLE: content.faqPage.seoTitle,
    SEO_DESC: content.faqPage.seoDescription,
    FAQ_HEADING: content.faqPage.heading,
    FAQ_ITEMS: { raw: true, value: faqItems },
  }),
  'gear.html': render('gear.template.html', {
    ...common,
    SEO_TITLE: content.gear.seoTitle,
    SEO_DESC: content.gear.seoDescription,
    GEAR_HEADING: content.gear.heading,
    GEAR_BLURB: content.gear.blurb,
    GEAR_ITEMS: { raw: true, value: gearCards },
  }),
};

mkdirSync(join(root, 'dist'), { recursive: true });
for (const [name, html] of Object.entries(pages)) {
  writeFileSync(join(root, 'dist', name), html);
}
copyFileSync(join(root, 'src', 'styles.css'), join(root, 'dist', 'styles.css'));
console.log(`built ${Object.keys(pages).join(', ')} from ${activity}.json`);
