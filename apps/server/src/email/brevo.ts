import { LOGIN_LINK_MINUTES } from "@bbn/shared";

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";
const apiKey = process.env.BREVO_API_KEY?.trim();
const fromEmail = process.env.EMAIL_FROM?.trim();
const fromName = process.env.EMAIL_FROM_NAME?.trim() || "Big Brother Ninja";

export function emailConfigured(): boolean {
  return !!apiKey && !!fromEmail;
}

/** Send one short-lived magic link. Provider credentials never leave the server. */
export async function sendSignInEmail(to: string, link: string): Promise<void> {
  if (!apiKey || !fromEmail) throw new Error("Transactional email is not configured");

  const res = await fetch(BREVO_ENDPOINT, {
    method: "POST",
    headers: {
      accept: "application/json",
      "api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sender: { name: fromName, email: fromEmail },
      // Magic links must not be wrapped in a tracked redirect: security scanners
      // can visit tracked links before the recipient. This email needs no analytics.
      to: [{ email: to, contactPixelTrackingConsent: false }],
      subject: "Your sign-in link",
      textContent: [
        `Use this link to sign in: ${link}`,
        "",
        `This link expires in ${LOGIN_LINK_MINUTES} minutes and can only be used once.`,
        "If you did not request it, you can ignore this email.",
      ].join("\n"),
      htmlContent: `
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#171717;max-width:560px;margin:auto">
          <h1 style="font-size:24px">Sign in</h1>
          <p>Use the button below to sign in. The link expires in ${LOGIN_LINK_MINUTES} minutes and can only be used once.</p>
          <p style="margin:28px 0"><a href="${escapeHtml(link)}" style="background:#111827;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Sign in</a></p>
          <p style="font-size:13px;color:#666">If you did not request this email, you can ignore it.</p>
        </div>
      `,
      tags: ["sign-in"],
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`Brevo rejected the email (${res.status})`);
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
