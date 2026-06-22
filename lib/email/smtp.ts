import type { BrevoEmail } from "./brevo";

const sender = () => ({
  name: process.env.BREVO_SENDER_NAME ?? "Pickup Flag Football",
  email: process.env.BREVO_SENDER_EMAIL ?? "support@pickupflagfootball.com",
});

/**
 * Send over SMTP — used by the e2e tests, which point SMTP_URL at a local Mailpit
 * container (smtp://127.0.0.1:1025). A real email is composed and delivered to a
 * real inbox the tests can read via Mailpit's HTTP API; nothing is mocked, and
 * nothing leaves the machine. nodemailer is imported here (not at module top) so
 * it never enters the prod/brevo bundle.
 */
export async function sendSmtpEmail(email: BrevoEmail): Promise<boolean> {
  const url = process.env.SMTP_URL;
  if (!url) {
    console.warn("[email] SMTP_URL not set — not sending:", email.subject);
    return false;
  }
  const { default: nodemailer } = await import("nodemailer");
  const transport = nodemailer.createTransport(url);
  const from = sender();
  await transport.sendMail({
    from: `${from.name} <${from.email}>`,
    to: email.toName ? `${email.toName} <${email.to}>` : email.to,
    subject: email.subject,
    html: email.htmlContent,
    text: email.textContent,
  });
  return true;
}
