import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { query, transaction } from "./db";
import { ApiError } from "./http";
import type { Paper } from "./types";

export const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_LIBRARY_BYTES = 500 * 1024 * 1024;
const MAX_LIBRARY_PAPERS = 1000;
const columns = `p.id, p.title, p.filename, p.file_size, p.authors, p.year, p.tags,
 p.status, p.error, p.page_count, p.created_at, p.updated_at,
 ARRAY(SELECT cp.collection_id::text FROM collection_papers cp
       WHERE cp.paper_id=p.id AND cp.user_id=p.user_id ORDER BY cp.collection_id) AS collection_ids`;

export const paperPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    tags: z
      .array(z.string().trim().min(1).max(40))
      .max(20)
      .transform((tags) => [...new Set(tags)])
      .optional(),
    collection_ids: z
      .array(z.string().uuid())
      .max(100)
      .transform((ids) => [...new Set(ids)])
      .optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Provide at least one field to update.",
  );

export type PaperPatch = z.infer<typeof paperPatchSchema>;

export async function listPapers(userId: string, url: URL): Promise<Paper[]> {
  const filters = z
    .object({
      q: z.string().trim().max(200).default(""),
      tag: z.string().trim().max(40).optional(),
      collection: z.string().uuid().optional(),
    })
    .parse({
      q: url.searchParams.get("q") ?? "",
      tag: url.searchParams.get("tag") || undefined,
      collection: url.searchParams.get("collection") || undefined,
    });
  const result = await query<Paper>(
    `SELECT ${columns},NULL::jsonb AS analysis FROM papers p
    WHERE p.user_id=$1
    AND ($2::text='' OR p.title ILIKE '%' || $2 || '%'
      OR array_to_string(p.tags,' ') ILIKE '%' || $2 || '%'
      OR array_to_string(p.authors,' ') ILIKE '%' || $2 || '%'
      OR EXISTS (SELECT 1 FROM chunks c WHERE c.user_id=$1 AND c.paper_id=p.id
        AND c.search @@ websearch_to_tsquery('english',$2)))
    AND ($3::text IS NULL OR $3=ANY(p.tags))
    AND ($4::uuid IS NULL OR EXISTS (SELECT 1 FROM collection_papers cp
      WHERE cp.user_id=$1 AND cp.paper_id=p.id AND cp.collection_id=$4))
    ORDER BY p.created_at DESC, p.id LIMIT 1000`,
    [userId, filters.q, filters.tag ?? null, filters.collection ?? null],
  );
  return result.rows;
}

export async function getPaper(
  userId: string,
  paperId: string,
): Promise<Paper> {
  const result = await query<Paper>(
    `SELECT ${columns},p.analysis FROM papers p WHERE p.id=$1 AND p.user_id=$2`,
    [paperId, userId],
  );
  if (!result.rows[0]) throw new ApiError(404, "Paper not found.");
  return result.rows[0];
}

/** Read the request with a hard bound even when Content-Length is absent or false. */
export async function readPdfUpload(
  request: Request,
): Promise<{ bytes: Buffer; filename: string }> {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("multipart/form-data;")
  ) {
    throw new ApiError(415, "Upload a PDF using multipart form data.");
  }
  const maximumBody = MAX_PDF_BYTES + 64 * 1024;
  const announced = Number(request.headers.get("content-length"));
  if (Number.isFinite(announced) && announced > maximumBody) {
    throw new ApiError(413, "PDFs must be 20 MB or smaller.");
  }
  if (!request.body) throw new ApiError(400, "Choose a PDF to upload.");
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  const deadline = setTimeout(
    () => void reader.cancel("Upload timed out."),
    30_000,
  );
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBody) {
        await reader.cancel("Upload too large.");
        throw new ApiError(413, "PDFs must be 20 MB or smaller.");
      }
      parts.push(value);
    }
  } finally {
    clearTimeout(deadline);
    reader.releaseLock();
  }
  let data: FormData;
  try {
    data = await new Response(Buffer.concat(parts), {
      headers: { "content-type": request.headers.get("content-type")! },
    }).formData();
  } catch {
    throw new ApiError(
      400,
      "The upload was incomplete. Please choose the PDF again.",
    );
  }
  const entries = data.getAll("file");
  const file = entries[0];
  if (entries.length !== 1 || !(file instanceof File))
    throw new ApiError(400, "Choose exactly one PDF to upload.");
  if (file.size > MAX_PDF_BYTES)
    throw new ApiError(413, "PDFs must be 20 MB or smaller.");
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length < 8 || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new ApiError(
      415,
      "This file is not a PDF. Choose a valid PDF document.",
    );
  }
  const filename =
    file.name
      .split(/[\\/]/)
      .pop()
      ?.replace(/[\u0000-\u001f\u007f]/g, "")
      .slice(0, 240) || "paper.pdf";
  return { bytes, filename };
}

export async function uploadPaper(
  userId: string,
  upload: { bytes: Buffer; filename: string },
): Promise<Paper> {
  const id = randomUUID();
  const digest = createHash("sha256").update(upload.bytes).digest("hex");
  await transaction(async (client) => {
    // Serializing uploads for one owner makes quota and hash checks race-safe.
    await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
    const duplicate = await client.query(
      "SELECT id FROM papers WHERE user_id=$1 AND sha256=$2",
      [userId, digest],
    );
    if (duplicate.rows.length)
      throw new ApiError(
        409,
        "This PDF is already in your library.",
        "DUPLICATE_PAPER",
      );
    const usage = await client.query<{ count: string; bytes: string }>(
      "SELECT count(*)::text AS count, COALESCE(sum(file_size),0)::text AS bytes FROM papers WHERE user_id=$1",
      [userId],
    );
    if (
      Number(usage.rows[0].count) >= MAX_LIBRARY_PAPERS ||
      Number(usage.rows[0].bytes) + upload.bytes.length > MAX_LIBRARY_BYTES
    ) {
      throw new ApiError(
        413,
        "Your library has reached its limit of 1,000 papers or 500 MB. Delete a paper before uploading another.",
        "LIBRARY_LIMIT",
      );
    }
    const title =
      upload.filename
        .replace(/\.pdf$/i, "")
        .replace(/[_-]+/g, " ")
        .trim() || "Untitled paper";
    await client.query(
      `INSERT INTO papers(id,user_id,title,filename,file_data,file_size,sha256)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        id,
        userId,
        title,
        upload.filename,
        upload.bytes,
        upload.bytes.length,
        digest,
      ],
    );
    await client.query("INSERT INTO jobs(id,paper_id) VALUES($1,$2)", [
      randomUUID(),
      id,
    ]);
  });
  return getPaper(userId, id);
}

export async function updatePaper(
  userId: string,
  paperId: string,
  patch: PaperPatch,
): Promise<Paper> {
  await transaction(async (client) => {
    const existing = await client.query(
      "SELECT id FROM papers WHERE id=$1 AND user_id=$2 FOR UPDATE",
      [paperId, userId],
    );
    if (!existing.rows.length) throw new ApiError(404, "Paper not found.");
    if (patch.collection_ids) {
      const owned = await client.query(
        "SELECT id FROM collections WHERE user_id=$1 AND id=ANY($2::uuid[]) FOR KEY SHARE",
        [userId, patch.collection_ids],
      );
      if (owned.rows.length !== patch.collection_ids.length)
        throw new ApiError(404, "One or more collections were not found.");
      await client.query(
        "DELETE FROM collection_papers WHERE user_id=$1 AND paper_id=$2",
        [userId, paperId],
      );
      if (patch.collection_ids.length) {
        await client.query(
          `INSERT INTO collection_papers(user_id,paper_id,collection_id)
          SELECT $1,$2,unnest($3::uuid[])`,
          [userId, paperId, patch.collection_ids],
        );
      }
    }
    await client.query(
      `UPDATE papers SET title=COALESCE($3,title),tags=COALESCE($4::text[],tags),updated_at=now()
      WHERE id=$1 AND user_id=$2`,
      [paperId, userId, patch.title ?? null, patch.tags ?? null],
    );
  });
  return getPaper(userId, paperId);
}

export async function deletePaper(
  userId: string,
  paperId: string,
): Promise<void> {
  await transaction(async (client) => {
    const result = await client.query(
      "DELETE FROM papers WHERE id=$1 AND user_id=$2 RETURNING id",
      [paperId, userId],
    );
    if (!result.rows.length) throw new ApiError(404, "Paper not found.");
    // Source snapshots remain in historical messages; stale paper selections do not.
    await client.query(
      `UPDATE conversations SET paper_ids=array_remove(paper_ids,$2::uuid),updated_at=now()
      WHERE user_id=$1 AND $2::uuid=ANY(paper_ids)`,
      [userId, paperId],
    );
  });
}

export async function retryPaper(
  userId: string,
  paperId: string,
): Promise<Paper> {
  await transaction(async (client) => {
    const existing = await client.query<{ status: string }>(
      "SELECT status FROM papers WHERE id=$1 AND user_id=$2 FOR UPDATE",
      [paperId, userId],
    );
    if (!existing.rows.length) throw new ApiError(404, "Paper not found.");
    if (existing.rows[0].status !== "failed")
      throw new ApiError(409, "Only failed papers can be retried.");
    await client.query(
      `UPDATE papers SET status='queued',error=NULL,updated_at=now() WHERE id=$1 AND user_id=$2`,
      [paperId, userId],
    );
    await client.query(
      `INSERT INTO jobs(id,paper_id) VALUES($1,$2) ON CONFLICT(paper_id) DO UPDATE
      SET status='queued',attempts=0,available_at=now(),lease_token=NULL,lease_until=NULL,error=NULL`,
      [randomUUID(), paperId],
    );
  });
  return getPaper(userId, paperId);
}

export async function downloadPaper(
  userId: string,
  paperId: string,
): Promise<Response> {
  const result = await query<{ file_data: Buffer; filename: string }>(
    "SELECT file_data,filename FROM papers WHERE id=$1 AND user_id=$2",
    [paperId, userId],
  );
  if (!result.rows[0]) throw new ApiError(404, "Paper not found.");
  const { file_data, filename } = result.rows[0];
  const encodedFilename = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return new Response(new Uint8Array(file_data), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(file_data.length),
      "Content-Disposition": `inline; filename="paper.pdf"; filename*=UTF-8''${encodedFilename}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "sandbox; default-src 'none'; frame-ancestors 'self'",
    },
  });
}
