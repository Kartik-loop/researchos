import { query } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public readiness deliberately excludes connection details, errors, and credentials. */
export async function GET() {
  let database = false;
  try {
    const result = await query<{
      ready: boolean;
    }>(`SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='vector')
      AND to_regclass('public.papers') IS NOT NULL AND to_regclass('public.jobs') IS NOT NULL AS ready`);
    database = result.rows[0]?.ready === true;
  } catch {
    // A readiness response must not leak connection strings or database exception text.
  }
  const ai = Boolean(
    (process.env.AI_API_KEY || process.env.OPENAI_API_KEY)?.trim(),
  );
  return Response.json(
    {
      status: database ? (ai ? "ready" : "degraded") : "unavailable",
      database,
      ai_configured: ai,
    },
    {
      status: database ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
