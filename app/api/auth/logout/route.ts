import { handle } from "@/server/http";
import { logout } from "@/server/auth";
export const POST = handle(async () => {
  await logout();
  return Response.json({ ok: true });
});
