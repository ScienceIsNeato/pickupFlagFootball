import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Digital Asset Links — the proof that we own both this domain and the Android
 * app, served at /.well-known/assetlinks.json (see the rewrite in next.config).
 *
 * This is what makes the Play Store build a Trusted Web Activity rather than a
 * glorified browser tab: Chrome fetches this file on launch, and if the app's
 * signing certificate matches a fingerprint listed here, it drops the URL bar.
 * A mismatch isn't fatal — the app still works, it just wears a browser chrome
 * that makes it look like a website in a costume, which is exactly the "this is
 * just a repackaged site" impression the store listing needs to avoid.
 *
 * Config, not code, because the fingerprint doesn't exist until the first
 * upload: Play App Signing generates the real signing key on Google's side, so
 * you can only read it out of the console after the AAB lands. Setting the env
 * var on the Cloud Run service publishes it without a redeploy.
 *
 * TWA_SHA256_FINGERPRINTS takes a comma-separated list, and you almost always
 * want TWO entries: the Play App Signing certificate (what real installs are
 * signed with) and your local upload certificate (what a sideloaded debug build
 * is signed with). Listing only the first makes locally-built APKs show the URL
 * bar and look broken while production is fine.
 */
const REL = "delegate_permission/common.handle_all_urls";

/** Normalize to the colon-separated uppercase hex Chrome expects. Accepts the
 *  console's copy-paste form as-is, and tolerates lowercase or a stray space. */
function normalizeFingerprint(raw: string): string | null {
  const hex = raw.trim().replace(/[\s:]/g, "").toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(hex)) return null; // SHA-256 = 32 bytes = 64 hex chars
  return (hex.match(/.{2}/g) ?? []).join(":");
}

export async function GET() {
  const pkg = process.env.TWA_PACKAGE_NAME;
  const raw = process.env.TWA_SHA256_FINGERPRINTS;
  // Unconfigured ⇒ 404 rather than an empty statement of ownership. An
  // assetlinks.json that parses but delegates to nobody reads as "we checked and
  // this app is NOT ours", which is worse than absent while we're mid-setup.
  if (!pkg || !raw) {
    return NextResponse.json({ error: "assetlinks not configured" }, { status: 404 });
  }

  const fingerprints = raw.split(",").map(normalizeFingerprint).filter((f): f is string => !!f);
  if (!fingerprints.length) {
    // Configured but unusable — a typo'd fingerprint would silently ship a file
    // that can never verify, and the only symptom is a URL bar nobody connects
    // back to an env var. Fail loudly in the logs instead.
    console.error("[twa] TWA_SHA256_FINGERPRINTS set but no valid SHA-256 fingerprints parsed");
    return NextResponse.json({ error: "assetlinks misconfigured" }, { status: 500 });
  }

  return NextResponse.json(
    [{
      relation: [REL],
      target: { namespace: "android_app", package_name: pkg, sha256_cert_fingerprints: fingerprints },
    }],
    {
      headers: {
        "content-type": "application/json",
        // Chrome caches this; keep it short enough that fixing a wrong
        // fingerprint doesn't mean waiting out a day of stale verification.
        "cache-control": "public, max-age=300",
      },
    },
  );
}
