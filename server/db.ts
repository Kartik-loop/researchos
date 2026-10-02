import pg from "pg";
const globalDb = globalThis as unknown as { researchPool?: pg.Pool };
export const pool =
  globalDb.researchPool ??
  new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DB_POOL_SIZE || 10),
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 30000,
    ...(process.env.DATABASE_SSL === "true"
      ? { ssl: { rejectUnauthorized: true } }
      : {}),
  });
globalDb.researchPool = pool;
pool.on("error", (error) =>
  console.error("Database pool error:", error.message),
);
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
) {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL is not configured.");
  return pool.query<T>(sql, params);
}
export async function transaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL is not configured.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
