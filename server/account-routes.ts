import { createHash } from "node:crypto";
import { z } from "zod";
import { handle, jsonBody } from "./http";
import { rateLimit } from "./auth";
import { emailSchema, passwordSchema, tokenSchema } from "./account-validation";
import { consumeAccountToken, requestAccountEmail } from "./account-tokens";
import { requireMailConfigured } from "./mail";

export function requestLink(purpose: "verify" | "reset") {
  return handle(async (request) => {
    const { email } = await jsonBody(
      request,
      z.object({ email: emailSchema }).strict(),
    );
    await rateLimit(`account-email:${purpose}:global`, 100, 3600);
    await rateLimit(
      `account-email:${purpose}:${createHash("sha256").update(email).digest("hex")}`,
      3,
      3600,
    );
    requireMailConfigured();
    await requestAccountEmail(email, purpose);
    return Response.json({
      message:
        "If this address belongs to an eligible account, an email will arrive shortly. Check your spam folder too.",
    });
  });
}
export function completeLink(purpose: "verify" | "reset") {
  return handle(async (request) => {
    await rateLimit(`account-complete:${purpose}:global`, 100, 60);
    const data = await jsonBody(
      request,
      z
        .object({
          token: tokenSchema,
          password: purpose === "reset" ? passwordSchema : z.undefined(),
        })
        .strict(),
    );
    await consumeAccountToken(data.token, purpose, data.password);
    return Response.json({
      message:
        purpose === "verify"
          ? "Your email is verified. You can now sign in."
          : "Your password has been changed. Sign in with your new password.",
    });
  });
}
