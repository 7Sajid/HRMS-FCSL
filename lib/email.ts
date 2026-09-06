import nodemailer from "nodemailer";

/**
 * Email (§8).
 *
 * sendMail NEVER THROWS. An email is a courtesy attached to an action that has
 * already happened: an approval that succeeded must not be reported as failed
 * because a mail server was slow. Every caller sends AFTER its transaction has
 * committed, and treats the result as information rather than as control flow.
 */

export type SendFailure = "not_configured" | "failed";
export type SendResult = { sent: true } | { sent: false; reason: SendFailure };

export type Mail = { to: string; subject: string; html: string; text?: string };

/**
 * Escape anything a person typed before it goes into an HTML body. A show-cause
 * subject or a denial reason is written by a human and lands in somebody's
 * inbox; it is not markup.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendMail(mail: Mail): Promise<SendResult> {
  const host = process.env.SMTP_HOST?.trim();

  // No SMTP_HOST means development. Print and carry on: the system works
  // fully, nobody is notified, and a laptop never mails a real employee.
  if (!host) {
    console.log(`\n[email — not sent, SMTP_HOST unset]\n  to: ${mail.to}\n  subject: ${mail.subject}\n`);
    return { sent: false, reason: "not_configured" };
  }

  try {
    const port = Number(process.env.SMTP_PORT ?? 587);
    const transport = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" }
        : undefined,
    });
    await transport.sendMail({
      from: process.env.EMAIL_FROM ?? "FCSL HR <hr@fcslbd.com>",
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });
    return { sent: true };
  } catch (error) {
    console.error("[email] send failed", mail.subject, error);
    return { sent: false, reason: "failed" };
  }
}

const APP_URL = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

/**
 * One layout for every message, so nothing has to be re-invented per panel and
 * every mail looks like it came from the same company.
 */
export function layout(options: { heading: string; lines: string[]; link?: { label: string; href: string } }): string {
  const body = options.lines.map((l) => `<p style="margin:0 0 12px">${l}</p>`).join("");
  const button = options.link
    ? `<p style="margin:24px 0 0"><a href="${APP_URL()}${options.link.href}" style="background:#6e1616;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:500;display:inline-block">${escapeHtml(options.link.label)}</a></p>`
    : "";
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;color:#17181c;line-height:1.6;max-width:520px">
<p style="font-size:11px;letter-spacing:.12em;color:#979ba6;margin:0 0 4px">FIRST CAPITAL SECURITIES LIMITED</p>
<h1 style="font-size:18px;margin:0 0 16px">${escapeHtml(options.heading)}</h1>
${body}${button}
<p style="margin:28px 0 0;font-size:12px;color:#979ba6">This message is from the FCSL HR system. It never contains documents or bank details — sign in to see them.</p>
</div>`;
}
