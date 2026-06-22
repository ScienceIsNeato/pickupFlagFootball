import { E2E } from "./env";

/** fetch with a hard abort timeout, so a stalled Mailpit call can't hang a run
 *  past its own deadline. */
async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 5000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Throw away every captured message (run before each scenario). */
export async function clearMailpit(): Promise<void> {
  const res = await fetchWithTimeout(`${E2E.mailpitApi}/api/v1/messages`, { method: "DELETE" });
  if (!res.ok) throw new Error(`mailpit clear failed: ${res.status} ${res.statusText}`);
}

type MailpitListItem = { ID: string; To: { Address: string }[]; Subject: string };

export type CapturedEmail = { id: string; subject: string; html: string };

/** Poll Mailpit until a message addressed to `email` shows up, then return its
 *  rendered HTML. This is a real email the app delivered over SMTP — we're just
 *  reading the inbox the way a person would. */
export async function waitForEmailTo(email: string, timeoutMs = 15000): Promise<CapturedEmail> {
  const want = email.toLowerCase();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetchWithTimeout(`${E2E.mailpitApi}/api/v1/messages`);
    if (!res.ok) throw new Error(`mailpit list failed: ${res.status} ${res.statusText}`);
    const data = (await res.json()) as { messages?: MailpitListItem[] };
    const hit = (data.messages ?? []).find((m) =>
      (m.To ?? []).some((t) => t.Address?.toLowerCase() === want),
    );
    if (hit) {
      const detail = await fetchWithTimeout(`${E2E.mailpitApi}/api/v1/message/${hit.ID}`);
      if (!detail.ok) throw new Error(`mailpit fetch ${hit.ID} failed: ${detail.status} ${detail.statusText}`);
      const full = (await detail.json()) as { HTML?: string };
      return { id: hit.ID, subject: hit.Subject, html: full.HTML ?? "" };
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`no email to ${email} within ${timeoutMs}ms`);
}

/** Pull the confirm-email link out of a verification message's HTML. */
export function extractConfirmLink(html: string): string {
  const m = html.match(/https?:\/\/[^"'\s)]*\/verify-email\?token=[a-f0-9]+/i);
  if (!m) throw new Error("no /verify-email confirm link found in email HTML");
  return m[0];
}
