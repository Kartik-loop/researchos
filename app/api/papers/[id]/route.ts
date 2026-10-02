import { requireUser } from "@/server/auth";
import { handle, jsonBody, uuid } from "@/server/http";
import {
  deletePaper,
  getPaper,
  paperPatchSchema,
  updatePaper,
} from "@/server/papers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  return handle(async () => {
    const user = await requireUser();
    const id = uuid.parse((await context.params).id);
    return Response.json({ paper: await getPaper(user.id, id) });
  })(request);
}

export async function PATCH(request: Request, context: Context) {
  return handle(async () => {
    const user = await requireUser();
    const id = uuid.parse((await context.params).id);
    const patch = await jsonBody(request, paperPatchSchema);
    return Response.json({ paper: await updatePaper(user.id, id, patch) });
  })(request);
}

export async function DELETE(request: Request, context: Context) {
  return handle(async () => {
    const user = await requireUser();
    const id = uuid.parse((await context.params).id);
    await deletePaper(user.id, id);
    return new Response(null, { status: 204 });
  })(request);
}
