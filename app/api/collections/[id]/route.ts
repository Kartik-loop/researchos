import { requireUser } from "@/server/auth";
import { query } from "@/server/db";
import { ApiError, handle, uuid } from "@/server/http";

export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser();
    const id = uuid.parse((await context.params).id);
    const result = await query(
      "DELETE FROM collections WHERE id=$1 AND user_id=$2 RETURNING id",
      [id, user.id],
    );
    if (!result.rows.length) throw new ApiError(404, "Collection not found.");
    return new Response(null, { status: 204 });
  })(request);
}
