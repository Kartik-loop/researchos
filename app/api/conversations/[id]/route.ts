import { requireUser } from "@/server/auth";
import { query } from "@/server/db";
import { ApiError, handle, uuid } from "@/server/http";
import type { Conversation, Message } from "@/server/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  return handle(async () => {
    const user = await requireUser();
    const id = uuid.parse((await context.params).id);
    const result = await query<Conversation>(
      `SELECT id,title,mode,paper_ids,updated_at
      FROM conversations WHERE id=$1 AND user_id=$2`,
      [id, user.id],
    );
    if (!result.rows[0]) throw new ApiError(404, "Conversation not found.");
    const messages = await query<Message>(
      `SELECT id,role,content,status,citations,error FROM messages
      WHERE conversation_id=$1 AND user_id=$2 ORDER BY created_at ASC,role DESC,id`,
      [id, user.id],
    );
    return Response.json({
      conversation: result.rows[0],
      messages: messages.rows,
    });
  })(request);
}

export async function DELETE(request: Request, context: Context) {
  return handle(async () => {
    const user = await requireUser();
    const id = uuid.parse((await context.params).id);
    const result = await query(
      "DELETE FROM conversations WHERE id=$1 AND user_id=$2 RETURNING id",
      [id, user.id],
    );
    if (!result.rows.length) throw new ApiError(404, "Conversation not found.");
    return new Response(null, { status: 204 });
  })(request);
}
