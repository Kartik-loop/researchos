import { ApiError } from "./http";
import { emailSchema } from "./account-validation";

export function requireMailConfigured() {
  if (
    !process.env.GMAIL_CLIENT_ID ||
    !process.env.GMAIL_CLIENT_SECRET ||
    !process.env.GMAIL_REFRESH_TOKEN ||
    !emailSchema.safeParse(process.env.EMAIL_FROM).success
  )
    throw new ApiError(
      503,
      "Account email delivery is not configured yet. Please contact the workspace owner.",
      "EMAIL_NOT_CONFIGURED",
    );
  const origin = new URL(process.env.APP_URL || "http://localhost:3000");
  if (process.env.NODE_ENV === "production" && origin.protocol !== "https:")
    throw new ApiError(
      503,
      "Account email delivery requires an HTTPS application address.",
    );
}

export async function sendAccountEmail(
  to: string,
  purpose: "verify" | "reset",
  token: string,
) {
  requireMailConfigured();
  const recipient = emailSchema.parse(to);
  const sender = emailSchema.parse(process.env.EMAIL_FROM);
  const url = new URL(
    `/account/${purpose}`,
    process.env.APP_URL || "http://localhost:3000",
  );
  // Fragments stay out of server access logs and HTTP referrers.
  url.hash = `token=${token}`;
  const action =
    purpose === "verify" ? "Verify your email" : "Reset your password";
  const expiry = purpose === "verify" ? "24 hours" : "30 minutes";
  const text = `${action} by opening this link:\n\n${url}\n\nThis link expires in ${expiry} and works only once. If you did not request this, ignore this email. Your password will not change unless you complete a reset.`;
  const message = [
    `From: ResearchOS <${sender}>`,
    `To: ${recipient}`,
    `Subject: ${action} - ResearchOS`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(text)
      .toString("base64")
      .match(/.{1,76}/g)!
      .join("\r\n"),
  ].join("\r\n");
  try {
    const auth = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: process.env.GMAIL_CLIENT_ID!,
        client_secret: process.env.GMAIL_CLIENT_SECRET!,
        refresh_token: process.env.GMAIL_REFRESH_TOKEN!,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!auth.ok) throw new Error("Authorization rejected");
    const credentials = (await auth.json()) as { access_token?: string };
    if (!credentials.access_token) throw new Error("No access token");
    const response = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credentials.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          raw: Buffer.from(message).toString("base64url"),
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) throw new Error("Delivery rejected");
  } catch {
    // Never expose provider payloads, recipient addresses, or security links.
    throw new ApiError(
      503,
      "The email could not be sent. Please try again later.",
      "EMAIL_DELIVERY_FAILED",
    );
  }
}
