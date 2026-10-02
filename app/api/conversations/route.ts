import { requireUser } from "@/server/auth";
import { query } from "@/server/db";
import { handle } from "@/server/http";
import type { Conversation } from "@/server/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const user = await requireUser();
  const result = await query<Conversation>(
    `SELECT id,title,mode,paper_ids,updated_at FROM conversations
    WHERE user_id=$1 ORDER BY updated_at DESC,id LIMIT 100`,
    [user.id],
  );
  return Response.json({ conversations: result.rows });
});
