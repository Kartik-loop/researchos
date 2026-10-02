import { requireUser, rateLimit } from "@/server/auth";
import { query } from "@/server/db";
import { handle } from "@/server/http";
import type { GraphData } from "@/server/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const user = await requireUser();
  await rateLimit(`graph:${user.id}`, 30, 60);
  const selected = await query<GraphData["nodes"][number]>(
    `SELECT id,title,tags,year
    FROM papers WHERE user_id=$1 ORDER BY created_at DESC,id LIMIT 100`,
    [user.id],
  );
  const nodes = selected.rows;
  if (nodes.length < 2)
    return Response.json({ nodes, edges: [] } satisfies GraphData);

  const similarities = await query<{
    source: string;
    target: string;
    weight: number;
  }>(
    `
    WITH centroids AS (
      SELECT p.id,p.embedding_model,avg(c.embedding) AS center
      FROM papers p JOIN chunks c ON c.paper_id=p.id AND c.user_id=p.user_id
      WHERE p.user_id=$1 AND p.id=ANY($2::uuid[]) AND p.status='ready' AND p.embedding_model IS NOT NULL
      GROUP BY p.id,p.embedding_model
    )
    SELECT a.id AS source,b.id AS target,1-(a.center <=> b.center) AS weight
    FROM centroids a JOIN centroids b ON a.id<b.id AND a.embedding_model=b.embedding_model
    WHERE 1-(a.center <=> b.center)>=0.75
    ORDER BY weight DESC,a.id,b.id LIMIT 200`,
    [user.id, nodes.map((node) => node.id)],
  );

  const edges: GraphData["edges"] = [];
  for (let a = 0; a < nodes.length; a++) {
    const topics = new Set(
      nodes[a].tags.map((tag) => tag.toLocaleLowerCase("en")),
    );
    for (let b = a + 1; b < nodes.length; b++) {
      const shared = [
        ...new Map(
          nodes[b].tags
            .filter((tag) => topics.has(tag.toLocaleLowerCase("en")))
            .map((tag) => [tag.toLocaleLowerCase("en"), tag]),
        ).values(),
      ];
      if (!shared.length) continue;
      edges.push({
        source: nodes[a].id,
        target: nodes[b].id,
        kind: "topic",
        weight:
          shared.length /
          new Set([
            ...topics,
            ...nodes[b].tags.map((tag) => tag.toLocaleLowerCase("en")),
          ]).size,
        label: `Shared topics: ${shared.join(", ")}`,
      });
    }
  }
  edges.sort((a, b) => b.weight - a.weight || a.source.localeCompare(b.source));
  // Render bounded truthful relationships; semantic similarity is not a citation claim.
  const result = edges.slice(0, 200);
  for (const edge of similarities.rows) {
    if (!Number.isFinite(edge.weight)) continue;
    result.push({
      ...edge,
      kind: "similarity",
      weight: Math.max(0, Math.min(1, edge.weight)),
      label: `Semantic similarity: ${Math.round(Math.max(0, Math.min(1, edge.weight)) * 100)}%`,
    });
  }
  return Response.json({ nodes, edges: result } satisfies GraphData);
});
