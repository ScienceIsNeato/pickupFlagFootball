import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const activity = process.argv[2] || 'flag-football';
const content = JSON.parse(readFileSync(join(root, 'content', `${activity}.json`), 'utf8'));

function render(templateFile, repl) {
  let html = readFileSync(join(root, 'src', templateFile), 'utf8');
  for (const [k, v] of Object.entries(repl)) html = html.replaceAll(k, v);
  return html;
}

const howCards = content.how.map(s => `
        <div class="card">
          <div class="step-n">${s.n}</div>
          <div class="title">${s.title}</div>
          <p>${s.body}</p>
        </div>`).join('');

const faqItems = content.faq.map(f => `
        <div class="faq-item">
          <div class="q">${f.q}</div>
          <p>${f.a}</p>
        </div>`).join('');

const indexHtml = render('index.template.html', {
  '{{SEO_TITLE}}': content.seo.title,
  '{{SEO_DESC}}': content.seo.description,
  '{{BRAND}}': content.brandName,
  '{{ACRONYM}}': content.acronym,
  '{{HERO_HEADING}}': content.hero.heading,
  '{{HERO_BODY}}': content.hero.body,
  '{{GATE}}': content.hero.gate,
  '{{HERO_CTA}}': content.hero.cta,
  '{{HERO_NOTE}}': content.hero.note,
  '{{HOW_CARDS}}': howCards,
  '{{FAQ_ITEMS}}': faqItems,
  '{{FOOTER}}': content.footer,
});

const registerHtml = render('register.template.html', {
  '{{SEO_TITLE}}': content.register.seoTitle,
  '{{SEO_DESC}}': content.register.seoDescription,
  '{{BRAND}}': content.brandName,
  '{{REG_HEADING}}': content.register.heading,
  '{{REG_BLURB}}': content.register.blurb,
  '{{REG_CTA}}': content.register.cta,
  '{{REG_NOTE}}': content.register.note,
});

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'index.html'), indexHtml);
writeFileSync(join(root, 'dist', 'register.html'), registerHtml);
copyFileSync(join(root, 'src', 'styles.css'), join(root, 'dist', 'styles.css'));
console.log(`built site/dist/index.html + register.html from ${activity}.json`);
