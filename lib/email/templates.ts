import { skin } from "@/lib/skin";
import type { DonationFooter } from "./donationFooter";

export type NotifKind =
  | "SPARK_ASK" | "OPTIONS_AVAILABLE" | "GAME_ON"
  | "SUGGEST_NUDGE" | "SUGGEST_LASTCALL" | "AVAIL_NUDGE" | "AVAIL_LASTCALL" | "STALLED_NOTICE"
  // weekly occurrence poll
  | "POLL_ASK" | "WEEK_ON" | "WEEK_OFF";

type Copy = { subject: string; title: string; intro: string; cta: string; path: string };

// Per-kind copy. CTA path is app-relative; the layer makes it absolute.
const COPY: Record<NotifKind, Copy> = {
  SPARK_ASK:         { subject: "a game might be forming near you", title: "enough interest to get rolling", intro: "people near you want to play. suggest a spot and a weekly time to get a game off the ground.", cta: "suggest a spot", path: "/play" },
  OPTIONS_AVAILABLE: { subject: "vote on where & when to play", title: "the options are in", intro: "spots and times have been suggested for your area. say which ones you'd actually show up for.", cta: "see the options", path: "/play" },
  GAME_ON:           { subject: "game on — you're in", title: "your game is scheduled", intro: "enough players committed. here's your standing weekly game — check the spot, time, and who's coming.", cta: "see your game", path: "/my-games" },
  SUGGEST_NUDGE:     { subject: "still time to pick a spot", title: "got a spot in mind?", intro: "the suggestion window for your area is open. drop a place and time before it closes.", cta: "suggest a spot", path: "/play" },
  SUGGEST_LASTCALL:  { subject: "last call to suggest a spot", title: "the window's closing", intro: "last chance to suggest where and when your game should happen.", cta: "suggest a spot", path: "/play" },
  AVAIL_NUDGE:       { subject: "don't forget to vote", title: "your vote keeps it alive", intro: "say which of the suggested spots and times you'd come to — the game only forms if enough of you commit.", cta: "vote now", path: "/play" },
  AVAIL_LASTCALL:    { subject: "last call to vote", title: "voting closes soon", intro: "last chance to weigh in on where and when to play.", cta: "vote now", path: "/play" },
  STALLED_NOTICE:    { subject: "not enough players this round", title: "not quite there yet", intro: "there wasn't enough commitment to lock a game this round — but interest sticks around and we'll try again. tell a friend who'd play.", cta: "find a game", path: "/play" },
  POLL_ASK:          { subject: "you in for this week's game?", title: "rsvp for this week", intro: "your weekly game's poll is open. let everyone know if you're in or out so we know whether it's on.", cta: "rsvp now", path: "/my-games" },
  WEEK_ON:           { subject: "game on this week", title: "this week's game is a go", intro: "enough players are in — this week's game is on. check the spot, time, and who's coming.", cta: "see this week", path: "/my-games" },
  WEEK_OFF:          { subject: "no game this week", title: "this week's game is off", intro: "not enough players were in this week, so it's off. there's always next week — and you can still rally folks.", cta: "see your games", path: "/my-games" },
};

function esc(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function layout(p: { title: string; intro: string; cta: string; ctaUrl: string; greeting: string; footer: DonationFooter | null; base: string }): string {
  const footerHtml = p.footer
    ? `<p style="color:#9fb39a; font-size:13px; line-height:1.55; margin:22px 0 0;">${esc(p.footer.text)} <a href="${esc(p.base + p.footer.donateUrl)}" style="color:#f4c430; text-decoration:none;">chip in</a>.</p>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${esc(p.title)}</title></head>
<body style="margin:0; padding:0; background:#0b1210; color:#e9edf6; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0b1210; padding:32px 16px;"><tr><td align="center">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:540px;">
    <tr><td style="padding:0 0 16px 2px; color:#e9edf6; font-size:20px; font-weight:800; letter-spacing:0.3px;">🏈 ${esc(skin.brandName)}</td></tr>
    <tr><td style="background:#12211c; border:1px solid rgba(255,255,255,0.12); border-radius:16px; padding:28px 26px;">
      <h1 style="color:#ffffff; font-size:24px; font-weight:800; line-height:1.2; margin:0 0 14px;">${esc(p.title)}</h1>
      <p style="color:#cdd6d0; font-size:15px; line-height:1.6; margin:0 0 8px;">${esc(p.greeting)}</p>
      <p style="color:#cdd6d0; font-size:15px; line-height:1.6; margin:0 0 22px;">${esc(p.intro)}</p>
      <a href="${esc(p.ctaUrl)}" style="display:inline-block; background:#468944; color:#ffffff; font-size:15px; font-weight:700; text-decoration:none; padding:13px 22px; border-radius:8px;">${esc(p.cta)}</a>
      ${footerHtml}
    </td></tr>
    <tr><td style="color:#6f7891; font-size:12px; line-height:1.6; padding:16px 4px 0;">
      you're getting this because you showed interest in a game near you. manage it anytime in your <a href="${esc(p.base + "/account")}" style="color:#5b9452; text-decoration:none;">account</a>.
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

/** Confirm-your-email sent on account creation. The link carries the single-use
 *  verification token; until it's clicked the account can't join or propose. */
export function buildVerificationEmail(
  displayName: string | null, appBaseUrl: string, token: string,
): { subject: string; htmlContent: string; textContent: string } {
  const base = appBaseUrl.replace(/\/+$/, "");
  const ctaUrl = `${base}/verify-email?token=${encodeURIComponent(token)}`;
  const greeting = `hey ${displayName ?? "there"},`;
  const intro = `you're on the map — nice. one last step: click below to confirm your email. you won't be able to join or propose local games until you do.`;
  return {
    subject: `confirm your email to play · ${skin.brandName}`,
    htmlContent: layout({ title: "confirm your email", intro, cta: "confirm my email", ctaUrl, greeting, footer: null, base }),
    textContent: `${greeting}\n\n${intro}\n\nconfirm your email: ${ctaUrl}\n\nif you didn't sign up, you can ignore this.\n\n${skin.brandName}`,
  };
}

/** Build subject + HTML + text for one notification email. */
export function buildNotificationEmail(
  kind: NotifKind,
  opts: { displayName: string | null; appBaseUrl: string; footer: DonationFooter | null },
): { subject: string; htmlContent: string; textContent: string } {
  const c = COPY[kind];
  const base = opts.appBaseUrl.replace(/\/+$/, "");
  const ctaUrl = `${base}${c.path}`;
  const greeting = `hey ${opts.displayName ?? "there"},`;

  const footerLine = opts.footer ? `\n\n${opts.footer.text} ${base}${opts.footer.donateUrl}` : "";
  const textContent = `${greeting}\n\n${c.intro}\n\n${c.cta}: ${ctaUrl}${footerLine}\n\nmanage email in your account: ${base}/account\n\n${skin.brandName}`;

  return {
    subject: c.subject,
    htmlContent: layout({ title: c.title, intro: c.intro, cta: c.cta, ctaUrl, greeting, footer: opts.footer, base }),
    textContent,
  };
}
