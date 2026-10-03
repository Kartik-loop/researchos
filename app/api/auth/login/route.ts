import { createHash } from "node:crypto";
import { z } from "zod";
import { handle, jsonBody, ApiError } from "@/server/http";
import { verifyPassword, createSession, rateLimit } from "@/server/auth";
import { query } from "@/server/db";
import type { User } from "@/server/types";
import { emailSchema } from "@/server/account-validation";
const dummy = "scrypt:0123456789abcdef0123456789abcdef:" + "0".repeat(128);
export const POST = handle(async (req) => {
  const data = await jsonBody(
    req,
    z.object({
      email: emailSchema,
      password: z.string().min(1).max(128),
    }),
  );
  await rateLimit("login:global", 500, 60);
  await rateLimit(
    "login:" + createHash("sha256").update(data.email).digest("hex"),
    10,
    900,
  );
  const { rows } = await query<User & { password_hash: string }>(
    "SELECT id,name,email,password_hash FROM users WHERE email=$1",
    [data.email],
  );
  const valid = await verifyPassword(
    data.password,
    rows[0]?.password_hash || dummy,
  );
  if (!rows[0] || !valid)
    throw new ApiError(401, "Email or password is incorrect.");
  const { password_hash: _, ...user } = rows[0];
  await createSession(user.id, rows[0].password_hash);
  return Response.json({ user });
});
