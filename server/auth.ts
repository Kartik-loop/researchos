import {
  randomBytes,
  createHash,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { query } from "./db";
import { ApiError } from "./http";
import type { User } from "./types";
const scrypt = promisify(scryptCallback);
const cookieName = "researchos_session";
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${key.toString("hex")}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [, salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const key = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash, "hex");
  return expected.length === key.length && timingSafeEqual(key, expected);
}
export async function createSession(userId: string) {
  const jar = await cookies();
  const old = jar.get(cookieName)?.value;
  if (old)
    await query("DELETE FROM sessions WHERE token_hash=$1", [digest(old)]);
  const token = randomBytes(32).toString("base64url");
  await query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '30 days')",
    [digest(token), userId],
  );
  jar.set(cookieName, token, {
    httpOnly: true,
    secure:
      new URL(process.env.APP_URL || "http://localhost:3000").protocol ===
      "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}
export async function requireUser(): Promise<User> {
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) throw new ApiError(401, "Please sign in to your workspace.");
  const { rows } = await query<User>(
    "SELECT u.id,u.name,u.email FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now()",
    [digest(token)],
  );
  if (!rows[0])
    throw new ApiError(401, "Your session expired. Please sign in again.");
  return rows[0];
}
export async function logout() {
  const jar = await cookies();
  const token = jar.get(cookieName)?.value;
  if (token)
    await query("DELETE FROM sessions WHERE token_hash=$1", [digest(token)]);
  jar.delete(cookieName);
}
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
) {
  const { rows } = await query<{ count: number }>(
    `INSERT INTO rate_limits(key,count,reset_at) VALUES($1,1,now()+make_interval(secs=>$2))
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.reset_at<now() THEN 1 ELSE rate_limits.count+1 END,
    reset_at=CASE WHEN rate_limits.reset_at<now() THEN now()+make_interval(secs=>$2) ELSE rate_limits.reset_at END RETURNING count`,
    [key, windowSeconds],
  );
  if (rows[0].count > limit)
    throw new ApiError(
      429,
      "Too many requests. Please wait a little before trying again.",
    );
}
