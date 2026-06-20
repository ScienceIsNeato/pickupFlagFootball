import type { Metadata } from "next";
import { skin } from "@/lib/skin";

export const metadata: Metadata = {
  title: skin.gear.seoTitle,
  description: skin.gear.seoDescription,
};

/** Append the Amazon Associates tag, turning a plain product search into an
 *  affiliate link. No-ops while the tag is still the REPLACE_ME placeholder, so
 *  the links work as ordinary searches until a real tag is configured. */
function withAffiliateTag(url: string, tag: string): string {
  if (!tag || tag.includes("REPLACE_ME")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}tag=${encodeURIComponent(tag)}`;
}

export default function GearPage() {
  return (
    <main>
      <section>
        <h2>{skin.gear.heading}</h2>
        <p className="page-blurb">{skin.gear.blurb}</p>
        <div className="cards">
          {skin.gear.items.map((g) => (
            <div className="card" key={g.name}>
              <div className="title">{g.name}</div>
              <p>{g.desc}</p>
              <a href={withAffiliateTag(g.url, skin.gear.affiliateTag)}
                target="_blank" rel="sponsored nofollow noopener noreferrer">on amazon ↗</a>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
