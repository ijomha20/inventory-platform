import { Resend } from "resend";
import { logger } from "./logger.js";

const RESEND_API_KEY = process.env["RESEND_API_KEY"]?.trim() ?? "";
const APP_URL = (() => {
  const domain = (process.env["REPLIT_DOMAINS"] ?? "").split(",")[0]?.trim();
  return domain ? `https://${domain}` : "https://script-reviewer.replit.app";
})();

export async function sendInvitationEmail(
  toEmail: string,
  role: string,
  invitedBy: string,
): Promise<void> {
  if (!RESEND_API_KEY) {
    logger.warn("RESEND_API_KEY not set — skipping invitation email");
    return;
  }

  const resend = new Resend(RESEND_API_KEY);
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
