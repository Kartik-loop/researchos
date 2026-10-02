import { requireUser } from "@/server/auth";
import { handle, uuid } from "@/server/http";
import { downloadPaper } from "@/server/papers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser();
    return downloadPaper(user.id, uuid.parse((await context.params).id));
  })(request);
}
