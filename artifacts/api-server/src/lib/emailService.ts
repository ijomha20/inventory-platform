import { Resend } from "resend";
import { logger } from "./logger.js";
import { env } from "./env.js";

const APP_URL = env.REPLIT_DOMAINS
  ? `https://${env.REPLIT_DOMAINS.split(",")[0]?.trim()}`
  : "https://script-reviewer.replit.app";

export async function sendInvitationEmail(
  toEmail: string,
  role: string,
  invitedBy: string,
): Promise<void> {
  if (!env.RESEND_API_KEY) {
    logger.warn("RESEND_API_KEY not set — skipping invitation email");
    return;
  }

  const resend = new Resend(env.RESEND_API_KEY);
  const roleName = role === "guest" ? "Guest (prices hidden)" : "Viewer";

  try {
    await resend.emails.send({
      from:    "Inventory Portal <onboarding@resend.dev>",
      to:      toEmail,
      subject: "You've been invited to the Inventory Portal",
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff;">
          <h2 style="margin:0 0 8px;font-size:20px;color:#111;">You have been invited</h2>
          <p style="margin:0 0 20px;font-size:15px;color:#444;">
            <strong>${invitedBy}</strong> has given you <strong>${roleName}</strong> access
            to the Vehicle Inventory Portal.
          </p>
          <a href="${APP_URL}"
            style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;
                   text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;">
            Open Inventory Portal
          </a>
          <p style="margin:24px 0 0;font-size:13px;color:#888;">
            Sign in with the Google account associated with <strong>${toEmail}</strong>.
            If you don't have a Google account with this email, contact ${invitedBy}.
          </p>
        </div>
      `,
    });
    logger.info({ toEmail, role }, "Invitation email sent");
  } catch (err) {
    logger.error({ err, toEmail }, "Failed to send invitation email");
  }
}

export async function sendOpsAlert(
  severity: "info" | "warning" | "critical",
  subject: string,
  html: string,
): Promise<void> {
  if (!env.RESEND_API_KEY) {
    logger.warn("RESEND_API_KEY not set — skipping ops alert email");
    return;
  }
  if (!env.OWNER_EMAIL) {
    logger.warn("OWNER_EMAIL not set — skipping ops alert email");
    return;
  }

  const resend = new Resend(env.RESEND_API_KEY);
  const prefix = severity.toUpperCase();
  try {
    await resend.emails.send({
      from: "Inventory Ops <onboarding@resend.dev>",
      to: env.OWNER_EMAIL,
      subject: `[${prefix}] ${subject}`,
      html,
    });
    logger.info({ severity, subject }, "Ops alert email sent");
  } catch (err) {
    logger.error({ err, severity, subject }, "Failed to send ops alert email");
  }
}
