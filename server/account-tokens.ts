import { createHash, randomBytes } from "node:crypto";
import { query, transaction } from "./db";
import { hashPassword } from "./auth";
import { ApiError } from "./http";
import { sendAccountEmail } from "./mail";
import { passwordSchema, tokenSchema } from "./account-validation";
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const invalid = () =>
  new ApiError(
    400,
    "This link has expired or already been used. Please request a new one.",
    "INVALID_ACCOUNT_TOKEN",
  );

export async function issueAccountToken(
  userId: string,
  purpose: "verify" | "reset",
) {
  const token = randomBytes(32).toString("hex");
  await transaction(async (db) => {
    // Serialize token issuance, password reset, and session creation by user.
    await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
    await db.query(
      "DELETE FROM account_tokens WHERE user_id=$1 AND (purpose=$2 OR expires_at<=now())",
      [userId, purpose],
    );
    await db.query(
      "INSERT INTO account_tokens(token_hash,user_id,purpose,expires_at) VALUES($1,$2,$3,now()+make_interval(secs=>$4))",
      [digest(token), userId, purpose, purpose === "verify" ? 86400 : 1800],
    );
  });
  return token;
}

export async function requestAccountEmail(
  email: string,
  purpose: "verify" | "reset",
) {
  const { rows } = await query<{
    id: string;
    email_verified_at: string | null;
  }>("SELECT id,email_verified_at FROM users WHERE email=$1", [email]);
  if (!rows[0] || (purpose === "verify" && rows[0].email_verified_at)) return;
  const token = await issueAccountToken(rows[0].id, purpose);
  try {
    await sendAccountEmail(email, purpose, token);
  } catch {
    await query("DELETE FROM account_tokens WHERE token_hash=$1", [
      digest(token),
    ]);
    console.error(
      JSON.stringify({ event: "account.email_delivery_failed", purpose }),
    );
    // Same public response for existing and unknown accounts, including failures.
  }
}

export async function consumeAccountToken(
  raw: string,
  purpose: "verify" | "reset",
  password?: string,
) {
  const token = tokenSchema.parse(raw);
  const passwordHash =
    purpose === "reset"
      ? await hashPassword(passwordSchema.parse(password))
      : null;
  await transaction(async (db) => {
    const found = await db.query<{ user_id: string }>(
      "SELECT user_id FROM account_tokens WHERE token_hash=$1 AND purpose=$2 AND expires_at>now()",
      [digest(token), purpose],
    );
    if (!found.rows[0]) throw invalid();
    const userId = found.rows[0].user_id;
    await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
    const consumed = await db.query(
      "DELETE FROM account_tokens WHERE token_hash=$1 AND purpose=$2 AND expires_at>now() RETURNING user_id",
      [digest(token), purpose],
    );
    if (!consumed.rowCount) throw invalid();
    if (purpose === "verify") {
      await db.query(
        "UPDATE users SET email_verified_at=COALESCE(email_verified_at,now()) WHERE id=$1",
        [userId],
      );
    } else {
      await db.query(
        "UPDATE users SET password_hash=$2,password_changed_at=now(),email_verified_at=COALESCE(email_verified_at,now()) WHERE id=$1",
        [userId, passwordHash],
      );
      await db.query("DELETE FROM sessions WHERE user_id=$1", [userId]);
      await db.query("DELETE FROM account_tokens WHERE user_id=$1", [userId]);
    }
  });
}
