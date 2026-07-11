import Link from "next/link";
import { skin } from "@/lib/skin";
import Gallery from "./Gallery";

export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="hero-inner">
          <div className="kicker">{skin.brandName}</div>
          <div className="acronym">{skin.acronym}</div>
          <h1>{skin.hero.heading}</h1>
          <p className="lead">{skin.hero.body}</p>
          {skin.hero.body2 && <p className="lead">{skin.hero.body2}</p>}
          <Link href="/show-interest" className="btn">{skin.hero.cta}</Link>
        </div>
      </section>

      <main>
        <section id="how">
          <h2>how it works</h2>
          <div className="cards">
            {skin.how.map((s) => (
              <div className="card" key={s.n}>
                <div className="step-n">{s.n}</div>
                <div className="title">{s.title}</div>
                <p>{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        {skin.gallery.length > 0 && (
          <section id="gallery">
            <Gallery items={skin.gallery} />
          </section>
        )}
      </main>
    </>
  );
}
