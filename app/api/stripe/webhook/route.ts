import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe/client";
import { setSubscribed, clearSubscription } from "@/lib/stripe/donation";

export const dynamic = "force-dynamic";

const idOf = (v: string | { id: string } | null | undefined): string | null =>
  typeof v === "string" ? v : v?.id ?? null;

/**
 * Stripe webhook → keeps donation_status in sync with the subscription.
 *   checkout.session.completed (subscription) → subscribed
 *   customer.subscription.deleted              → back to unset
 * The signature (STRIPE_WEBHOOK_SECRET) is the auth — verified against the raw
 * body. Fails closed if Stripe isn't configured.
 */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "missing signature" }, { status: 400 });

  const body = await req.text(); // raw body — required for signature verification
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(body, sig, secret);
  } catch {
    return NextResponse.json({ error: "bad signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        // Only the subscription donation flips status; one-time tips don't.
        if (s.mode === "subscription" && s.client_reference_id) {
          const ok = await setSubscribed(s.client_reference_id, idOf(s.customer), idOf(s.subscription));
          if (!ok) {
            // A paying customer whose client_reference_id matched no user — don't
            // silently 200. 500 so Stripe retries + the error surfaces.
            console.error("[stripe webhook] no user for client_reference_id", s.client_reference_id);
            return NextResponse.json({ error: "unknown user" }, { status: 500 });
          }
        }
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        if (sub.id) await clearSubscription(sub.id); // match the exact subscription
        break;
      }
      // other events are acknowledged and ignored
    }
  } catch (e) {
    // 500 → Stripe retries; the handlers are idempotent so a retry is safe.
    console.error("[stripe webhook] handler error", event.type, e);
    return NextResponse.json({ error: "handler error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
