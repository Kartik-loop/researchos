import { randomUUID } from "node:crypto";
import { embedTexts, embeddingModel, vectorLiteral, type Evidence } from "./ai";
import { query } from "./db";
import type { Citation } from "./types";

export type RetrievedChunk = {
  id: string;
  paper_id: string;
  title: string;
  page: number;
  section: string | null;
  content: string;
  score: number;
};
export type EmbeddedChunk = Evidence & {
  id: string;
  ordinal: number;
  embedding: number[];
};
export const ANALYSIS_QUERIES = [
  "Abstract main research problem novel contribution summary",
  "Key contributions novelty main findings",
  "Methodology experimental setup training procedure evaluation protocol",
  "Datasets benchmarks sample size data collection splits",
  "Model algorithm neural network architecture components",
  "Results evaluation metrics accuracy performance comparison tables",
  "Limitations failure cases weaknesses computational cost hardware memory runtime",
  "Conclusion future work further research open questions",
];
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return -1;
  let product = 0;
  let left = 0;
  let right = 0;
  for (let index = 0; index < a.length; index++) {
    product += a[index] * b[index];
    left += a[index] ** 2;
    right += b[index] ** 2;
  }
  return left && right ? product / Math.sqrt(left * right) : 0;
}
// Retrieval for ingestion uses the same embeddings before the atomic publication of chunks.
// Round-robin query coverage prevents the abstract from dominating every analysis field.
export function selectAnalysisEvidence(
  chunks: EmbeddedChunk[],
  queryVectors: number[][],
  maxCharacters = 36_000,
): Evidence[] {
  if (!chunks.length) return [];
  const selected = new Map<string, EmbeddedChunk>();
  const add = (chunk: EmbeddedChunk | undefined) => {
    if (chunk) selected.set(chunk.id, chunk);
  };
  add(chunks[0]);
  add(chunks[Math.floor(chunks.length / 2)]);
  add(chunks[chunks.length - 1]);
  const rankings = queryVectors.map((vector) =>
    chunks
      .map((chunk) => ({
        chunk,
        score: cosineSimilarity(chunk.embedding, vector),
      }))
      .sort((a, b) => b.score - a.score),
  );
  for (let rank = 0; rank < 2; rank++)
    for (const ranking of rankings) add(ranking[rank]?.chunk);
  for (const fraction of [0.2, 0.4, 0.6, 0.8])
    add(chunks[Math.floor((chunks.length - 1) * fraction)]);
  // Explicit section evidence also preserves limitations/conclusions if semantic ranking misses them.
  for (const chunk of chunks
    .filter((item) =>
      /conclusion|limitations?|future work/i.test(item.section || ""),
    )
    .slice(-3))
    add(chunk);
  let used = 0;
  return [...selected.values()]
    .flatMap((chunk) => {
      if (used + chunk.content.length > maxCharacters) return [];
      used += chunk.content.length;
      return [
        { page: chunk.page, section: chunk.section, content: chunk.content },
      ];
    })
    .sort((a, b) => a.page - b.page);
}
export async function retrieveChunks(
  userId: string,
  question: string,
  paperIds: string[],
  mode: "chat" | "compare",
  signal?: AbortSignal,
): Promise<RetrievedChunk[]> {
  const dimensions = [
    "Research problem objective contribution",
    "Dataset benchmark evaluation data",
    "Method methodology algorithm training procedure",
    "Architecture model components layers",
    "Experimental results quantitative metrics accuracy performance",
    "Limitations weaknesses failure cases",
    "Computational requirements hardware runtime memory training cost complexity",
  ];
  const vectors = await embedTexts(
    [question, ...(mode === "compare" ? dimensions : [])],
    signal,
  );
  const questionVector = vectors[0];
  const retrieve = async (
    ids: string[],
    vector: number[],
    terms: string,
    limit: number,
  ): Promise<RetrievedChunk[]> => {
    const result = await query<RetrievedChunk>(
      `
      WITH eligible AS MATERIALIZED (
        SELECT c.*, p.title FROM chunks c JOIN papers p ON p.id=c.paper_id AND p.user_id=c.user_id
        WHERE c.user_id=$1 AND p.status='ready' AND p.embedding_model=$2
          AND (cardinality($3::uuid[])=0 OR c.paper_id=ANY($3::uuid[]))
      ), semantic AS (
        SELECT id, row_number() OVER (ORDER BY embedding <=> $4::vector) AS rank FROM eligible ORDER BY embedding <=> $4::vector LIMIT 48
      ), lexical AS (
        SELECT id, row_number() OVER (ORDER BY ts_rank_cd(search,websearch_to_tsquery('english',$5)) DESC) AS rank
        FROM eligible WHERE search @@ websearch_to_tsquery('english',$5)
        ORDER BY ts_rank_cd(search,websearch_to_tsquery('english',$5)) DESC LIMIT 48
      ), ranked AS (
        SELECT coalesce(s.id,l.id) AS id, coalesce(1.0/(60+s.rank),0)+coalesce(1.0/(60+l.rank),0) AS score
        FROM semantic s FULL OUTER JOIN lexical l ON s.id=l.id
      )
      SELECT e.id,e.paper_id,e.title,e.page,e.section,e.content,r.score::float8 FROM ranked r JOIN eligible e ON e.id=r.id ORDER BY r.score DESC LIMIT $6`,
      [userId, embeddingModel(), ids, vectorLiteral(vector), terms, limit],
    );
    return result.rows;
  };
  if (mode === "compare") {
    const results: RetrievedChunk[] = [];
    for (const id of paperIds) {
      signal?.throwIfAborted();
      const specific = await retrieve([id], questionVector, question, 1);
      const unique = new Map(specific.map((chunk) => [chunk.id, chunk]));
      // Each requested comparison dimension gets a retrieval query per paper, so
      // a highly relevant abstract cannot crowd out results or hardware evidence.
      for (let index = 0; index < dimensions.length; index++) {
        signal?.throwIfAborted();
        const evidence = await retrieve(
          [id],
          vectors[index + 1],
          dimensions[index],
          1,
        );
        for (const chunk of evidence) unique.set(chunk.id, chunk);
      }
      results.push(...unique.values());
    }
    return results;
  }
  return retrieve(paperIds, questionVector, question, 12);
}
export function citationsFromChunks(chunks: RetrievedChunk[]): Citation[] {
  return chunks.map((chunk, index) => ({
    label: index + 1,
    paper_id: chunk.paper_id,
    chunk_id: chunk.id,
    title: chunk.title,
    page: chunk.page,
    section: chunk.section,
    excerpt: chunk.content.slice(0, 700),
  }));
}
export function createChunkId(): string {
  return randomUUID();
}
