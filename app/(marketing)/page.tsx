import Link from "next/link";
import { skin } from "@/lib/skin";

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
            <h2>see it in action</h2>
            <div className="gallery">
              {skin.gallery.map((g) => (
                <figure className="gallery-item" key={g.src}>
                  <video
                    className="gallery-video"
                    autoPlay loop muted playsInline preload="metadata"
                    poster={`/gallery/${g.src}.jpg`}
                    aria-label={g.title}
                  >
                    <source src={`/gallery/${g.src}.webm`} type="video/webm" />
                    <source src={`/gallery/${g.src}.mp4`} type="video/mp4" />
                  </video>
                  <figcaption>
                    <span className="gallery-title">{g.title}</span>
                    <span className="gallery-caption">{g.caption}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}
      </main>
    </>
  );
}
