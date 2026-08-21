import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { skin } from "@/lib/skin";
import Gallery from "./Gallery";
import { InstallApp } from "@/components/InstallApp";

export default async function Home({ searchParams }: { searchParams: Promise<{ signin?: string; next?: string }> }) {
  // A signed-in player has already been sold - the splash is for people we
  // haven't met. Straight to the map - or, for a stale ?signin=1&next=... link,
  // straight to the destination the link wanted (relative paths only, same
  // validation the auth modal applies).
  const sp = await searchParams;
  const session = await auth();
  if (session?.user?.id) {
    redirect(sp.next && /^\/(?![/\\])/.test(sp.next) ? sp.next : "/play");
  }
  return (
    <>
      <section className="hero">
        <div className="hero-inner">
          <div className="kicker">{skin.brandName}</div>
          <div className="acronym">{skin.acronym}</div>
          <h1>{skin.hero.heading}</h1>
          <p className="lead">{skin.hero.body}</p>
          {/* CTA above the long second paragraph so it sits inside the first
              phone screen (audit M20) — the detail still follows for readers. */}
          <Link href="/show-interest" className="btn">{skin.hero.cta}</Link>
          {skin.hero.body2 && <p className="lead">{skin.hero.body2}</p>}
        </div>
        {/* Right rail on wide screens, and it falls under the CTA on narrow ones —
            the hero column itself stays centered and untouched. Renders nothing at
            all unless the browser can actually install. */}
        <InstallApp />
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
            <Gallery items={skin.gallery} />
          </section>
        )}
      </main>
    </>
  );
}
