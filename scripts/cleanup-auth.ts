import { pool } from "../server/db";
// Bounded batches avoid long transactions on small hosted databases.
try {
  for (const [table, column] of [
    ["sessions", "expires_at"],
    ["account_tokens", "expires_at"],
    ["rate_limits", "reset_at"],
  ] as const) {
    const result = await pool.query(
      `DELETE FROM ${table} WHERE ctid IN (SELECT ctid FROM ${table} WHERE ${column}<now() LIMIT 5000)`,
    );
    console.info(
      JSON.stringify({
        event: "auth.cleanup",
        table,
        deleted: result.rowCount,
      }),
    );
  }
} finally {
  await pool.end();
}
