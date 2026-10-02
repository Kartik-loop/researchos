import { requireUser, rateLimit } from "@/server/auth";
import { handle } from "@/server/http";
import { listPapers, readPdfUpload, uploadPaper } from "@/server/papers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async (request) => {
  const user = await requireUser();
  return Response.json({
    papers: await listPapers(user.id, new URL(request.url)),
  });
});

export const POST = handle(async (request) => {
  const user = await requireUser();
  await rateLimit(`upload:${user.id}`, 30, 3600);
  const paper = await uploadPaper(user.id, await readPdfUpload(request));
  return Response.json({ paper }, { status: 202 });
});
