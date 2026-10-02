import { requireUser, rateLimit } from "@/server/auth";
import { handle, uuid } from "@/server/http";
import { retryPaper } from "@/server/papers";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser();
    await rateLimit(`retry:${user.id}`, 30, 3600);
    return Response.json(
      {
        paper: await retryPaper(user.id, uuid.parse((await context.params).id)),
      },
      { status: 202 },
    );
  })(request);
}
