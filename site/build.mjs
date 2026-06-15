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

const content = JSON.parse(readFileSync(contentPath, 'utf8'));

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

// Single pass over the template: each {{KEY}} is replaced exactly once, so inserted
// copy is never re-scanned for further placeholders. Values are HTML-escaped unless
// flagged { raw: true } (used for the card/faq HTML we generate ourselves).
function render(templateFile, values) {
  const html = readFileSync(join(root, 'src', templateFile), 'utf8');
  return html.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (!(key in values)) return match;
    const entry = values[key];
    if (entry && typeof entry === 'object' && entry.raw) return entry.value;
    return escapeHtml(entry);
  });
}

const howCards = content.how.map((s) => `
        <div class="card">
          <div class="step-n">${escapeHtml(s.n)}</div>
          <div class="title">${escapeHtml(s.title)}</div>
          <p>${escapeHtml(s.body)}</p>
        </div>`).join('');

const faqItems = content.faq.map((f) => `
        <div class="faq-item">
          <div class="q">${escapeHtml(f.q)}</div>
          <p>${escapeHtml(f.a)}</p>
        </div>`).join('');

const indexHtml = render('index.template.html', {
  SEO_TITLE: content.seo.title,
  SEO_DESC: content.seo.description,
  BRAND: content.brandName,
  ACRONYM: content.acronym,
  HERO_HEADING: content.hero.heading,
  HERO_BODY: content.hero.body,
  GATE: content.hero.gate,
  HERO_CTA: content.hero.cta,
  HERO_NOTE: content.hero.note,
  HOW_CARDS: { raw: true, value: howCards },
  FAQ_ITEMS: { raw: true, value: faqItems },
  FOOTER: content.footer,
});

const registerHtml = render('register.template.html', {
  SEO_TITLE: content.register.seoTitle,
  SEO_DESC: content.register.seoDescription,
  BRAND: content.brandName,
  REG_HEADING: content.register.heading,
  REG_BLURB: content.register.blurb,
  REG_CTA: content.register.cta,
  REG_NOTE: content.register.note,
});

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'index.html'), indexHtml);
writeFileSync(join(root, 'dist', 'register.html'), registerHtml);
copyFileSync(join(root, 'src', 'styles.css'), join(root, 'dist', 'styles.css'));
console.log(`built site/dist/index.html + register.html from ${activity}.json`);
