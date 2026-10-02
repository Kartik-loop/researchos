import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireUser, rateLimit } from "@/server/auth";
import { query, transaction } from "@/server/db";
import { ApiError, handle, jsonBody } from "@/server/http";
import type { Collection } from "@/server/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({ name: z.string().trim().min(1).max(80) }).strict();

export const GET = handle(async () => {
  const user = await requireUser();
  const result = await query<Collection>(
    `SELECT c.id,c.name,count(cp.paper_id)::int AS paper_count
    FROM collections c LEFT JOIN collection_papers cp ON cp.collection_id=c.id AND cp.user_id=c.user_id
    WHERE c.user_id=$1 GROUP BY c.id ORDER BY lower(c.name),c.id`,
    [user.id],
  );
  return Response.json({ collections: result.rows });
});

export const POST = handle(async (request) => {
  const user = await requireUser();
  await rateLimit(`collections:${user.id}`, 60, 3600);
  const { name } = await jsonBody(request, schema);
  const collection = await transaction(async (client) => {
    await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
      user.id,
    ]);
    const count = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM collections WHERE user_id=$1",
      [user.id],
    );
    if (Number(count.rows[0].count) >= 100)
      throw new ApiError(409, "You can create up to 100 collections.");
    const result = await client.query<Collection>(
      `INSERT INTO collections(id,user_id,name) VALUES($1,$2,$3)
      ON CONFLICT(user_id,name) DO NOTHING RETURNING id,name,0::int AS paper_count`,
      [randomUUID(), user.id, name],
    );
    if (!result.rows[0])
      throw new ApiError(409, "A collection with this name already exists.");
    return result.rows[0];
  });
  return Response.json({ collection }, { status: 201 });
});
