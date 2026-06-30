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

// ── product-event messages (mrkdwn; the activity feed) ───────────────────────

export function slackNewPlayer(p: { displayName: string; email: string; city?: string | null; zip: string }): void {
  const where = p.city ? `${p.city} (${p.zip})` : p.zip;
  notifySlack(`🙋 New player: *${p.displayName}* (${p.email}) — ${where}`);
}

export function slackProposed(p: { place: string; when: string; closesInH: number }): void {
  notifySlack(`📍 New game proposed: *${placeLine(p.place)}* — ${p.when}. Interest window closes in ~${p.closesInH}h.`);
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
    notifySlack(`🏈 Game formed: *${placeLine(o.place)}* — ${o.count} player${o.count === 1 ? "" : "s"} in.`);
  } else {
    notifySlack(`🥀 Proposal stalled: *${placeLine(o.place)}* — only ${o.count}/${o.pMin} interested.`);
  }
}
