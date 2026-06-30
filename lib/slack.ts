/**
 * Fire-and-forget Slack notifications to the team's #mime-activity feed via an
 * incoming webhook. Mirrors the ganglia SlackService pattern: webhook-based,
 * per-environment, and best-effort — a Slack/network failure is logged and
 * swallowed so it can NEVER block a user action or fail the cron tick.
 *
 * The webhook is `SLACK_WEBHOOK_URL`, bound per-environment at deploy time
 * (prod → pff-slack-webhook-url, dev → pff-dev-slack-webhook-url), so prod and
 * dev post to different channels. Unset → no-op (local dev + tests stay quiet).
 *
 * This is the ACTIVITY feed (product events). "Tick is down" is NOT here — a
 * dead server can't report itself; that's a Cloud Monitoring alert → #mime-alerts.
 */

/** Post a plain message to the activity feed. Returns immediately; never throws. */
export function notifySlack(text: string): void {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return; // local / test / unconfigured — stay quiet
  // Fire-and-forget: don't await (no latency for the caller), never throw.
  void (async () => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) console.error("[slack] post failed", res.status, await res.text().catch(() => ""));
    } catch (e) {
      console.error("[slack] post error", e instanceof Error ? e.message : String(e));
    }
  })();
}

/** "street, city zip — notes" → the street line, for compact messages. */
function placeLine(placeText: string): string {
  return placeText.split(" — ")[0];
}

/** Escape Slack mrkdwn control chars before interpolating user-controlled text
 *  (names, places, times). Slack parses `&`, `<`, `>` as link/mention syntax, so a
 *  raw `<http…>` or `&` in a display name could forge a link or break the payload.
 *  Per Slack's rules: &→&amp;, <→&lt;, >→&gt;. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── product-event messages (mrkdwn; the activity feed) ───────────────────────

// No email here: the activity feed is visible to everyone with channel access (and
// retained), so a signup's email address would be needless PII exposure. Name +
// city/zip is enough to recognize a new player.
export function slackNewPlayer(p: { displayName: string; city?: string | null; zip: string }): void {
  const where = p.city ? `${esc(p.city)} (${esc(p.zip)})` : esc(p.zip);
  notifySlack(`🙋 New player: *${esc(p.displayName)}* — ${where}`);
}

export function slackProposed(p: { place: string; when: string; closesInH: number }): void {
  notifySlack(`📍 New game proposed: *${esc(placeLine(p.place))}* — ${esc(p.when)}. Interest window closes in ~${p.closesInH}h.`);
}

/** The outcome of resolving one proposal — returned by resolveAttempt so the
 *  caller can post AFTER the transaction commits (never a false "formed" on a
 *  rollback). `null` when nothing was decided this pass. */
export type ResolveOutcome =
  | { kind: "formed"; place: string; count: number }
  | { kind: "stalled"; place: string; count: number; pMin: number };

/** Post a formed/stalled outcome to the activity feed. Call AFTER commit. */
export function notifyResolve(o: ResolveOutcome): void {
  if (o.kind === "formed") {
    notifySlack(`🏈 Game formed: *${esc(placeLine(o.place))}* — ${o.count} player${o.count === 1 ? "" : "s"} in.`);
  } else {
    notifySlack(`🥀 Proposal stalled: *${esc(placeLine(o.place))}* — only ${o.count}/${o.pMin} interested.`);
  }
}
