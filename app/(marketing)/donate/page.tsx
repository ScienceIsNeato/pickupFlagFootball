import type { Metadata } from "next";
import Link from "next/link";
import { skin } from "@/lib/skin";
import { stripeConfigured } from "@/lib/stripe/client";
import { startSubscription } from "./actions";

// Render per-request, NOT at build: stripeConfigured() reads env, and the
// Docker build has no Stripe secrets (they bind at Cloud Run deploy). A static
// prerender would bake integrated=false and prod would never show the real
// subscribe button.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: skin.donate.seoTitle,
  description: skin.donate.seoDescription,
};

export default function DonatePage() {
  const integrated = stripeConfigured(); // the real subscribe button
  return (
    <main>
      <section>
        <h2>{skin.donate.heading}</h2>
        <p className="page-blurb">{skin.donate.blurb}</p>
        <div className="cards">
          {skin.donate.methods.map((m) => {
            if (m.action === "subscribe" && !integrated && !m.url) {
              // Fail loud, not with a dead link: the subscribe card requires
              // Stripe env (STRIPE_SECRET_KEY + STRIPE_PRICE_ID) or an explicit
              // fallback url in the skin. Sentry hears about it in prod.
              throw new Error(
                "donate: subscribe method has no Stripe env (STRIPE_SECRET_KEY + STRIPE_PRICE_ID) and no fallback url",
              );
            }
            const external = !!m.url?.startsWith("http");
            return (
              <div className="card" key={m.name}>
                <div className="title">
                  {m.name}
                  {m.tag && <span className="tag">{m.tag}</span>}
                </div>
                <p>{m.desc}</p>
                {m.action === "subscribe" && integrated ? (
                  // Integrated Stripe Checkout (subscription) — server action.
                  <form action={startSubscription}>
                    <button type="submit">{m.cta}</button>
                  </form>
                ) : external ? (
                  <a href={m.url} target="_blank" rel="noopener noreferrer">
                    {m.cta}
                  </a>
                ) : (
                  <Link href={m.url!}>{m.cta}</Link>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
