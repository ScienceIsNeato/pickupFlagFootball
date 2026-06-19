import type { Metadata } from "next";
import Link from "next/link";
import { skin } from "@/lib/skin";

export const metadata: Metadata = {
  title: skin.donate.seoTitle,
  description: skin.donate.seoDescription,
};

export default function DonatePage() {
  return (
    <main>
      <section>
        <h2>{skin.donate.heading}</h2>
        <p className="page-blurb">{skin.donate.blurb}</p>
        <div className="cards">
          {skin.donate.methods.map((m) => {
            const external = m.url.startsWith("http");
            return (
              <div className="card" key={m.name}>
                <div className="title">
                  {m.name}
                  {m.tag && <span className="tag">{m.tag}</span>}
                </div>
                <p>{m.desc}</p>
                {external ? (
                  <a href={m.url} target="_blank" rel="noopener noreferrer">
                    {m.cta}
                  </a>
                ) : (
                  <Link href={m.url}>{m.cta}</Link>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
