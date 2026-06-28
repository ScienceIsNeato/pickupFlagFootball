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

/** Every message currently in Mailpit (the whole outbox), newest first, with
 *  recipient + subject + rendered HTML. For folding the flow's emails into the
 *  story report. */
export async function allEmails(): Promise<{ to: string; subject: string; html: string }[]> {
  const res = await fetchWithTimeout(`${E2E.mailpitApi}/api/v1/messages?limit=200`);
  if (!res.ok) throw new Error(`mailpit list failed: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as { messages?: MailpitListItem[] };
  const out: { to: string; subject: string; html: string }[] = [];
  for (const m of data.messages ?? []) {
    const detail = await fetchWithTimeout(`${E2E.mailpitApi}/api/v1/message/${m.ID}`);
    const full = detail.ok ? ((await detail.json()) as { HTML?: string }) : { HTML: "" };
    out.push({ to: (m.To ?? [])[0]?.Address ?? "", subject: m.Subject, html: full.HTML ?? "" });
  }
  return out;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

/** Render the outbox as a self-contained HTML "inbox" page — one card per distinct
 *  subject (with a recipient count), so a step's AfterStep screenshot becomes a
 *  legible record of the emails the flow sent. */
export function inboxHtml(emails: { to: string; subject: string; html: string }[], label: string): string {
  const groups = new Map<string, { subject: string; html: string; to: string[] }>();
  for (const e of emails) {
    const g = groups.get(e.subject) ?? { subject: e.subject, html: e.html, to: [] };
    g.to.push(e.to);
    groups.set(e.subject, g);
  }
  const cards = [...groups.values()].map((g) => `
    <div style="border:1px solid #d0d0d0;border-radius:10px;margin:0 0 16px;overflow:hidden;background:#fff">
      <div style="background:#f4f5f7;padding:10px 14px;border-bottom:1px solid #e2e2e2;font:13px/1.4 system-ui,sans-serif;color:#333">
        <strong>${esc(g.subject)}</strong><br>
        <span style="color:#666">to ${g.to.length} recipient${g.to.length > 1 ? "s" : ""} · ${esc(g.to[0])}${g.to.length > 1 ? ` +${g.to.length - 1} more` : ""}</span>
      </div>
      <div style="padding:6px 14px">${g.html}</div>
    </div>`).join("");
  const body = emails.length
    ? cards
    : `<p style="font:14px system-ui,sans-serif;color:#888">(no emails in the outbox)</p>`;
  return `<div style="background:#eceff3;padding:18px;min-height:100vh">
    <h2 style="font:700 18px system-ui,sans-serif;margin:0 0 14px;color:#222">📬 ${esc(label)} — ${emails.length} email${emails.length === 1 ? "" : "s"}</h2>
    ${body}
  </div>`;
}

/** Pull the confirm-email link out of a verification message's HTML. */
export function extractConfirmLink(html: string): string {
  const m = html.match(/https?:\/\/[^"'\s)]*\/verify-email\?token=[a-f0-9]+/i);
  if (!m) throw new Error("no /verify-email confirm link found in email HTML");
  return m[0];
}
