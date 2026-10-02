import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { handle, jsonBody, ApiError } from "@/server/http";
import { hashPassword, createSession, rateLimit } from "@/server/auth";
import { query } from "@/server/db";
const schema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.email().trim().toLowerCase().max(254),
  password: z
    .string()
    .min(12, "Use at least 12 characters for your password.")
    .max(128),
});
export const POST = handle(async (req) => {
  if (process.env.ALLOW_REGISTRATION === "false")
    throw new ApiError(403, "New account registration is closed.");
  await rateLimit("registration:global", 100, 3600);
  const data = await jsonBody(req, schema);
  await rateLimit(
    "register:" + createHash("sha256").update(data.email).digest("hex"),
    5,
    3600,
  );
  const id = randomUUID();
  await query(
    "INSERT INTO users(id,name,email,password_hash) VALUES($1,$2,$3,$4)",
    [id, data.name, data.email, await hashPassword(data.password)],
  );
  await createSession(id);
  return Response.json(
    { user: { id, name: data.name, email: data.email } },
    { status: 201 },
  );
});
