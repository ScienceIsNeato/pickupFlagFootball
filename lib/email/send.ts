import { sendBrevoEmail, type BrevoEmail } from "./brevo";

export type OutgoingEmail = BrevoEmail;

function transport(): "smtp" | "brevo" {
  return process.env.EMAIL_TRANSPORT === "smtp" ? "smtp" : "brevo";
}

/** Is a delivery transport actually configured? brevo needs a key; smtp needs a
 *  URL to point at. Callers use this to no-op gracefully (leave the backlog
 *  intact) rather than claim rows that can never be delivered. */
export function isEmailConfigured(): boolean {
  return transport() === "smtp" ? !!process.env.SMTP_URL : !!process.env.BREVO_API_KEY;
}

/**
 * Send via the configured transport: Brevo HTTP in prod (default), or SMTP →
 * Mailpit in the e2e tests (EMAIL_TRANSPORT=smtp). Returns true if accepted,
 * false if no transport is configured. nodemailer/SMTP is dynamically imported
 * only in smtp mode, so it stays out of the production path.
 */
export async function sendEmail(email: OutgoingEmail): Promise<boolean> {
  if (transport() === "smtp") {
    const { sendSmtpEmail } = await import("./smtp");
    return sendSmtpEmail(email);
  }
  return sendBrevoEmail(email);
}
