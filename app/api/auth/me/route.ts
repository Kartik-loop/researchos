import { handle } from "@/server/http";
import { requireUser } from "@/server/auth";
export const GET = handle(async () =>
  Response.json({ user: await requireUser() }),
);
