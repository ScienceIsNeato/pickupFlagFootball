import type { Metadata } from "next";
import { skin } from "@/lib/skin";

export const metadata: Metadata = {
  title: skin.faqPage.seoTitle,
  description: skin.faqPage.seoDescription,
};

// FAQ answers are plain text, except a couple of trusted entries with links
// (skin-authored). Rewrite the static-site hrefs/token to app routes.
function answerHtml(aHtml: string): string {
  return aHtml
    .replaceAll("{donate}", skin.donate.url)
    .replaceAll('href="privacy.html"', 'href="/privacy"');
}

export default function FaqPage() {
  return (
    <main>
      <section>
        <h2>{skin.faqPage.heading}</h2>
        <div className="faq">
          {skin.faq.map((f, i) => (
            <div className="faq-item" key={i}>
              <div className="q">{f.q}</div>
              {f.a ? (
                <p>{f.a}</p>
              ) : (
                <p dangerouslySetInnerHTML={{ __html: answerHtml(f.aHtml ?? "") }} />
              )}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
