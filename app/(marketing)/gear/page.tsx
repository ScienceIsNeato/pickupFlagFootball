import type { Metadata } from "next";
import { skin } from "@/lib/skin";

export const metadata: Metadata = {
  title: skin.gear.seoTitle,
  description: skin.gear.seoDescription,
};

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
              <a href={g.url}>on amazon ↗</a>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
