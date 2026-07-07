import fs from "node:fs/promises";
import path from "node:path";

export type BrevoEmail = {
  to: string;
  toName?: string | null;
  subject: string;
  htmlContent: string;
  textContent: string;
  // RFC-8058 one-click unsubscribe target (the /api/unsubscribe POST endpoint).
  // Set on bulk notification mail so Gmail/Yahoo show a native unsubscribe button
  // and don't spam-penalize us. Omitted for pure transactional mail.
  listUnsubscribeUrl?: string;
};

const sender = () => ({
  // Defaults match the Brevo-verified sender for pickupflagfootball.com.
  name: process.env.BREVO_SENDER_NAME ?? "Pickup Flag Football",
  email: process.env.BREVO_SENDER_EMAIL ?? "support@pickupflagfootball.com",
});

/** Best-effort local outbox so you can eyeball outgoing mail in dev without a
 *  real key. Set EMAIL_OUTBOX_PATH to a writable file to enable. */
async function appendOutbox(payload: unknown): Promise<void> {
  const out = process.env.EMAIL_OUTBOX_PATH;
  if (!out) return;
  try {
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.appendFile(out, `${JSON.stringify({ at: new Date().toISOString(), ...(payload as object) })}\n`, "utf8");
  } catch {
    /* the outbox is a dev convenience — never let it break a real send */
  }
}

/**
 * Send one transactional email via Brevo's REST API. Matches the house pattern
 * (ChronicChronicler et al.): plain fetch, the BREVO_* env vars, a graceful
 * no-op when BREVO_API_KEY is unset (so dev/CI don't send), and an optional file
 * outbox. Throws on a non-2xx so the caller can leave the row unsent and retry.
 */
export async function sendBrevoEmail(email: BrevoEmail): Promise<boolean> {
  const payload = {
    sender: sender(),
    to: [{ email: email.to, ...(email.toName ? { name: email.toName } : {}) }],
    subject: email.subject,
    htmlContent: email.htmlContent,
    textContent: email.textContent,
    ...(email.listUnsubscribeUrl ? {
      headers: {
        "List-Unsubscribe": `<${email.listUnsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    } : {}),
  };
  await appendOutbox(payload);

  const apiKey = process.env.BREVO_API_KEY ?? "";
  if (apiKey === "") {
    // no recipient in the log — avoid leaking PII when email isn't configured
    console.warn("[email] BREVO_API_KEY not set — not sending:", email.subject);
    return false;
  }

  // Bound the call so a hung Brevo request can't stall the cron flush.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { accept: "application/json", "api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Brevo send failed (${res.status}): ${await res.text()}`);
    return true;
  } finally {
    clearTimeout(timer);
  }
}
