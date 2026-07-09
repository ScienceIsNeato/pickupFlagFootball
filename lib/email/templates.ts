import { skin } from "@/lib/skin";
import type { DonationFooter } from "./donationFooter";

export type NotifKind =
  | "GAME_PROPOSED" | "GAME_ON" | "STALLED_NOTICE"
  // weekly occurrence poll
  | "POLL_ASK" | "WEEK_ON" | "WEEK_OFF"
  // series lifecycle: captain paused or retired the standing game
  | "SERIES_PAUSED" | "SERIES_RETIRED";

type Copy = { subject: string; title: string; intro: string; cta: string; path: string };

// Per-kind copy. CTA path is app-relative; the layer makes it absolute.
const COPY: Record<NotifKind, Copy> = {
  GAME_PROPOSED:  { subject: "a game's been proposed near you", title: "want in?", intro: "someone proposed a game near you. here's the spot and time - tap below if you're in.", cta: "see it on the map", path: "/play" },
  GAME_ON:        { subject: "game on - you're in", title: "your game is scheduled", intro: "enough players are in - your standing weekly game is on. here's the spot, time, and who's coming.", cta: "see your game", path: "/my-games" },
  STALLED_NOTICE: { subject: "not enough players this round", title: "not quite there yet", intro: "there wasn't enough interest to lock this one in - but you can always propose another, or jump on the next one nearby.", cta: "find a game", path: "/play" },
  POLL_ASK:       { subject: "you in for this week's game?", title: "rsvp for this week", intro: "your weekly game's poll is open. let everyone know if you're in or out so we know whether it's on.", cta: "rsvp now", path: "/my-games" },
  WEEK_ON:        { subject: "game on this week", title: "this week's game is a go", intro: "enough players are in - this week's game is on. here's the spot, time, and who's coming.", cta: "see this week", path: "/my-games" },
  WEEK_OFF:       { subject: "no game this week", title: "this week's game is off", intro: "not enough players were in this week, so it's off. there's always next week - and you can still rally folks.", cta: "see your games", path: "/my-games" },
  SERIES_PAUSED:  { subject: "your weekly game is paused", title: "your game's on pause", intro: "a captain paused your weekly game for now - no polls or games until it's back. here's the spot and when to expect it.", cta: "see your games", path: "/my-games" },
  SERIES_RETIRED: { subject: "your weekly game has ended", title: "your game has wrapped up", intro: "a captain retired this weekly game, so it won't run anymore. thanks for playing - you're back in the pool for other games near you.", cta: "find another game", path: "/play" },
};

function esc(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

type TwoButtons = { inUrl: string; inLabel: string; outUrl: string; outLabel: string };
type Details = { place: string; when?: string };
type Roster = { count: number; names: string[] };

function layout(p: { title: string; intro: string; cta: string; ctaUrl: string; greeting: string; footer: DonationFooter | null; base: string; buttons?: TwoButtons; details?: Details; roster?: Roster; unsubscribeUrl?: string; footerReason?: string; note?: string }): string {
  // The proposal's spot + time, shown right in the email so the recipient can
  // decide without clicking through. "when" is optional (a retire notice has no
  // upcoming time).
  const detailsHtml = p.details
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="background:#1a2c25; border-radius:10px; margin:0 0 18px; width:100%;"><tr><td style="padding:14px 16px;">
        <p style="margin:0 0 4px; color:#9fb39a; font-size:11px; text-transform:uppercase; letter-spacing:0.06em;">where</p>
        <p style="margin:0${p.details.when ? " 0 12px" : ""}; color:#ffffff; font-size:15px; line-height:1.4;">${esc(p.details.place)}</p>
        ${p.details.when ? `<p style="margin:0 0 4px; color:#9fb39a; font-size:11px; text-transform:uppercase; letter-spacing:0.06em;">when</p>
        <p style="margin:0; color:#ffffff; font-size:15px; line-height:1.4;">${esc(p.details.when)}</p>` : ""}
      </td></tr></table>`
    : "";
  // A captain's freeform note (pause reason), shown as a quote.
  const noteHtml = p.note
    ? `<p style="margin:0 0 18px; padding:10px 14px; border-left:3px solid #468944; background:#12211c; color:#cdd6d0; font-size:14px; line-height:1.5;">${esc(p.note)}</p>`
    : "";
  // Who said they're in, for the "game on" email.
  const rosterHtml = p.roster
    ? `<p style="margin:0 0 4px; color:#9fb39a; font-size:11px; text-transform:uppercase; letter-spacing:0.06em;">${p.roster.count} planning to play</p>
       <p style="margin:0 0 18px; color:#cdd6d0; font-size:14px; line-height:1.5;">${p.roster.names.length ? esc(p.roster.names.join(", ")) : "—"}</p>`
    : "";
  const buttonsHtml = p.buttons
    ? `<div style="margin:16px 0 0;">
      <a href="${esc(p.buttons.inUrl)}" style="display:inline-block; background:#468944; color:#ffffff; font-size:14px; font-weight:700; text-decoration:none; padding:11px 18px; border-radius:8px; margin:0 8px 8px 0;">${esc(p.buttons.inLabel)}</a>
      <a href="${esc(p.buttons.outUrl)}" style="display:inline-block; background:#33403a; color:#e9edf6; font-size:14px; font-weight:700; text-decoration:none; padding:11px 18px; border-radius:8px;">${esc(p.buttons.outLabel)}</a>
    </div>`
    : "";
  const footerHtml = p.footer
    ? `<p style="color:#9fb39a; font-size:13px; line-height:1.55; margin:22px 0 0;">${esc(p.footer.text)}${
        p.footer.donateUrl ? ` <a href="${esc(p.base + p.footer.donateUrl)}" style="color:#f4c430; text-decoration:none;">chip in</a>.` : ""
      }</p>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${esc(p.title)}</title></head>
<body style="margin:0; padding:0; background:#0b1210; color:#e9edf6; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0b1210; padding:32px 16px;"><tr><td align="center">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:540px;">
    <tr><td style="padding:0 0 16px 2px; color:#e9edf6; font-size:20px; font-weight:800; letter-spacing:0.3px;">🏈 ${esc(skin.brandName)}</td></tr>
    <tr><td style="background:#12211c; border:1px solid rgba(255,255,255,0.12); border-radius:16px; padding:28px 26px;">
      <h1 style="color:#ffffff; font-size:24px; font-weight:800; line-height:1.2; margin:0 0 14px;">${esc(p.title)}</h1>
      <p style="color:#cdd6d0; font-size:15px; line-height:1.6; margin:0 0 8px;">${esc(p.greeting)}</p>
      <p style="color:#cdd6d0; font-size:15px; line-height:1.6; margin:0 0 18px;">${esc(p.intro)}</p>
      ${detailsHtml}
      ${noteHtml}
      ${rosterHtml}
      <a href="${esc(p.ctaUrl)}" style="display:inline-block; background:#468944; color:#ffffff; font-size:15px; font-weight:700; text-decoration:none; padding:13px 22px; border-radius:8px;">${esc(p.cta)}</a>
      ${buttonsHtml}
      ${footerHtml}
    </td></tr>
    <tr><td style="color:#6f7891; font-size:12px; line-height:1.6; padding:16px 4px 0;">
      ${p.footerReason
        ? esc(p.footerReason)
        : `you're getting this because you showed interest in a game near you. manage it anytime in your <a href="${esc(p.base + "/account")}" style="color:#5b9452; text-decoration:none;">account</a>${
            p.unsubscribeUrl ? `, or <a href="${esc(p.unsubscribeUrl)}" style="color:#5b9452; text-decoration:none;">unsubscribe</a>` : ""
          }.`}
      <br/><span style="color:#5b616f;">${esc(skin.footer.mailingAddress)}</span>
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
  const intro = `you're on the map - nice. one last step: click below to confirm your email. you won't be able to join or propose local games until you do.`;
  return {
    subject: `confirm your email to play · ${skin.brandName}`,
    htmlContent: layout({ title: "confirm your email", intro, cta: "confirm my email", ctaUrl, greeting, footer: null, base }),
    textContent: `${greeting}\n\n${intro}\n\nconfirm your email: ${ctaUrl}\n\nif you didn't sign up, you can ignore this.\n\n${skin.brandName}\n${skin.footer.mailingAddress}`,
  };
}

/** Reset-your-password email. The link carries the single-use reset token; the
 *  page it lands on lets the user set a new password. Sent only in response to a
 *  reset request, so it's transactional (no unsubscribe footer). */
export function buildPasswordResetEmail(
  displayName: string | null, appBaseUrl: string, token: string,
): { subject: string; htmlContent: string; textContent: string } {
  const base = appBaseUrl.replace(/\/+$/, "");
  const ctaUrl = `${base}/reset-password?token=${encodeURIComponent(token)}`;
  const greeting = `hey ${displayName ?? "there"},`;
  const intro = `someone asked to reset the password for this email. click below to set a new one - the link is good for one hour. if it wasn't you, you can ignore this and your password stays the same.`;
  return {
    subject: `reset your password · ${skin.brandName}`,
    htmlContent: layout({ title: "reset your password", intro, cta: "set a new password", ctaUrl, greeting, footer: null, base }),
    textContent: `${greeting}\n\n${intro}\n\nset a new password: ${ctaUrl}\n\n${skin.brandName}\n${skin.footer.mailingAddress}`,
  };
}

/** "A friend invited you" email — sent when a member shares a join link. Just a
 *  branded nudge to the public registration; no account is pre-created and no
 *  token is involved. Transactional (person-initiated one-off), so no
 *  unsubscribe footer, but carries the postal address like the other mail. */
export function buildInviteEmail(
  inviterName: string, appBaseUrl: string,
): { subject: string; htmlContent: string; textContent: string } {
  const base = appBaseUrl.replace(/\/+$/, "");
  const ctaUrl = `${base}/show-interest`;
  const intro = `${inviterName} thinks you'd be into ${skin.activity} near you. ${skin.brandName} finds or starts a local pickup game - tell it your general area and you're on the map, no organizing on your part. if a game's already forming nearby, you'll hear about it.`;
  // The invitee has no account and hasn't shown interest, so the default
  // "you showed interest / manage in your account" footer doesn't apply.
  const footerReason = `${inviterName} invited you to ${skin.brandName}. no account needed to take a look — you only sign up if you want in.`;
  return {
    subject: `${inviterName} invited you to play ${skin.activity}`,
    htmlContent: layout({ title: "come play", intro, cta: "find a game near you", ctaUrl, greeting: "hey there,", footer: null, base, footerReason }),
    textContent: `hey there,\n\n${intro}\n\nfind a game near you: ${ctaUrl}\n\n${footerReason}\n\n${skin.brandName}\n${skin.footer.mailingAddress}`,
  };
}

/** Build subject + HTML + text for one notification email. */
export function buildNotificationEmail(
  kind: NotifKind,
  opts: {
    displayName: string | null; appBaseUrl: string; footer: DonationFooter | null;
    // one-click two-button row: RSVP (POLL_ASK/WEEK_ON, lib/rsvpLink) or
    // Interested/Not-Interested (GAME_PROPOSED, lib/interestLink).
    buttons?: { inUrl: string; outUrl: string };
    // spot + time, shown in the GAME_PROPOSED + weekly occurrence emails.
    details?: Details;
    // who said they're in, shown in the WEEK_ON ("game on this week") email.
    roster?: Roster;
    // one-click unsubscribe link (footer + text). Set for bulk notification mail.
    unsubscribeUrl?: string;
    // captain's freeform note, shown on the SERIES_PAUSED email.
    note?: string;
  },
): { subject: string; htmlContent: string; textContent: string } {
  const c = COPY[kind];
  const base = opts.appBaseUrl.replace(/\/+$/, "");
  const ctaUrl = `${base}${c.path}`;
  const greeting = `hey ${opts.displayName ?? "there"},`;

  const labels = kind === "POLL_ASK"
    ? { inLabel: "i'm in", outLabel: "i'm out" }
    : kind === "GAME_PROPOSED"
    ? { inLabel: "i'm interested", outLabel: "not interested" }
    : { inLabel: "play after all", outLabel: "bail" };
  const buttons = opts.buttons ? { inUrl: opts.buttons.inUrl, outUrl: opts.buttons.outUrl, ...labels } : undefined;

  const footerLine = opts.footer ? `\n\n${opts.footer.text}${opts.footer.donateUrl ? ` ${base}${opts.footer.donateUrl}` : ""}` : "";
  const detailsLine = opts.details ? `\n\nwhere: ${opts.details.place}${opts.details.when ? `\nwhen: ${opts.details.when}` : ""}` : "";
  const noteLine = opts.note ? `\n\n"${opts.note}"` : "";
  const rosterLine = opts.roster ? `\n\n${opts.roster.count} planning to play: ${opts.roster.names.join(", ") || "—"}` : "";
  const buttonsLine = buttons ? `\n\n${buttons.inLabel}: ${buttons.inUrl}\n${buttons.outLabel}: ${buttons.outUrl}` : "";
  const unsubLine = opts.unsubscribeUrl ? `\nunsubscribe: ${opts.unsubscribeUrl}` : "";
  const textContent = `${greeting}\n\n${c.intro}${detailsLine}${noteLine}${rosterLine}\n\n${c.cta}: ${ctaUrl}${buttonsLine}${footerLine}\n\nmanage email in your account: ${base}/account${unsubLine}\n\n${skin.brandName}\n${skin.footer.mailingAddress}`;

  return {
    subject: c.subject,
    htmlContent: layout({ title: c.title, intro: c.intro, cta: c.cta, ctaUrl, greeting, footer: opts.footer, base, buttons, details: opts.details, roster: opts.roster, unsubscribeUrl: opts.unsubscribeUrl, note: opts.note }),
    textContent,
  };
}
