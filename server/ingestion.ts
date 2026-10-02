import { randomUUID } from "node:crypto";
import {
  analyzeEvidence,
  embedTexts,
  embeddingModel,
  publicAIError,
  vectorLiteral,
} from "./ai";
import { query, transaction } from "./db";
import {
  ANALYSIS_QUERIES,
  selectAnalysisEvidence,
  type EmbeddedChunk,
} from "./retrieval";

export type PaperPage = { page: number; text: string; section: string | null };
export type ChunkText = {
  id: string;
  ordinal: number;
  page: number;
  section: string | null;
  content: string;
};
export type IngestionJob = {
  id: string;
  paper_id: string;
  user_id: string;
  lease_token: string;
  attempts: number;
  file_data: Buffer;
  title: string;
};
export class IngestionError extends Error {}
class LostLeaseError extends Error {}
const LEASE_SECONDS = 120;
const MAX_ATTEMPTS = 3;
const MAX_PAGES = 300;
const MAX_CHUNKS = 1600;

export function detectSection(text: string): string | null {
  const line = text
    .split("\n")
    .map((value) => value.trim())
    .find((value) =>
      /^(?:\d+(?:\.\d+)*\.?\s+)?(?:abstract|introduction|background|related work|methods?|methodology|approach|model(?: architecture)?|experiments?|experimental (?:setup|results)|datasets?|evaluation|results(?: and discussion)?|discussion|limitations?|conclusions?|future work|references|appendix)\s*$/i.test(
        value,
      ),
    );
  return line?.slice(0, 120) || null;
}
export function chunkPages(
  pages: PaperPage[],
  maxCharacters = 1900,
  overlap = 260,
): ChunkText[] {
  if (maxCharacters < 100 || overlap < 0 || overlap >= maxCharacters)
    throw new Error("Invalid chunk size or overlap.");
  const chunks: ChunkText[] = [];
  for (const page of pages) {
    const text = page.text.replace(/\u0000/g, "").trim();
    let start = 0;
    while (start < text.length) {
      let end = Math.min(start + maxCharacters, text.length);
      if (end < text.length) {
        const boundary = Math.max(
          text.lastIndexOf("\n", end - 1),
          text.lastIndexOf(". ", end - 1),
          text.lastIndexOf(" ", end - 1),
        );
        if (boundary > start + maxCharacters * 0.6) end = boundary + 1;
      }
      const content = text.slice(start, end).trim();
      if (content.length >= 20)
        chunks.push({
          id: randomUUID(),
          ordinal: chunks.length,
          page: page.page,
          section: page.section,
          content,
        });
      if (chunks.length > MAX_CHUNKS)
        throw new IngestionError(
          "This PDF contains too much text. Split it into smaller documents.",
        );
      if (end === text.length) break;
      start = Math.max(start + 1, end - overlap);
    }
  }
  return chunks;
}
export async function extractPDF(
  bytes: Buffer | Uint8Array,
  signal?: AbortSignal,
): Promise<{
  pages: PaperPage[];
  title: string | null;
  authors: string[];
  pageCount: number;
}> {
  if (bytes.length > 20 * 1024 * 1024)
    throw new IngestionError("PDF exceeds the 20 MB limit.");
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    disableFontFace: true,
    useWorkerFetch: false,
  });
  const abort = () => {
    void loading.destroy();
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    const pdf = await loading.promise;
    if (pdf.numPages > MAX_PAGES)
      throw new IngestionError(
        `PDFs are limited to ${MAX_PAGES} pages. Split this document and upload the parts.`,
      );
    const metadata = await pdf.getMetadata().catch(() => null);
    const info = (metadata?.info || {}) as {
      Title?: unknown;
      Author?: unknown;
    };
    const rawTitle =
      typeof info.Title === "string"
        ? info.Title.replace(/\u0000/g, "").trim()
        : "";
    const title =
      rawTitle.length >= 6 &&
      rawTitle.length <= 300 &&
      !/^(untitled|document|microsoft word|latex|template)/i.test(rawTitle)
        ? rawTitle
        : null;
    const authors =
      typeof info.Author === "string"
        ? info.Author.split(/;|\s+and\s+/)
            .map((author) => author.replace(/\u0000/g, "").trim())
            .filter((author) => author.length > 1 && author.length <= 120)
            .slice(0, 30)
        : [];
    const pages: PaperPage[] = [];
    let characters = 0;
    let previousSection: string | null = null;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      signal?.throwIfAborted();
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) =>
          "str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : "",
        )
        .join("")
        .replace(/[\t ]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/\u0000/g, "")
        .trim();
      characters += text.length;
      if (characters > 2_000_000)
        throw new IngestionError(
          "This PDF contains too much text. Split it into smaller documents.",
        );
      previousSection = detectSection(text) || previousSection;
      pages.push({ page: pageNumber, text, section: previousSection });
      page.cleanup();
    }
    if (characters < 80)
      throw new IngestionError(
        "This PDF has no readable text. Scanned PDFs require OCR before upload.",
      );
    return { pages, title, authors, pageCount: pdf.numPages };
  } catch (error) {
    if (signal?.aborted || error instanceof IngestionError) throw error;
    if (error instanceof Error && error.name === "PasswordException")
      throw new IngestionError(
        "This PDF is password protected. Upload an unlocked copy.",
      );
    if (
      error instanceof Error &&
      ["InvalidPDFException", "FormatError"].includes(error.name)
    )
      throw new IngestionError(
        "This PDF is damaged or could not be read. Upload a valid PDF.",
      );
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    await loading.destroy().catch(() => undefined);
  }
}
export async function claimJob(): Promise<IngestionJob | null> {
  return transaction(async (db) => {
    // A dead worker's final attempt becomes a visible terminal failure instead of remaining stuck.
    // All paths that change both tables lock the paper before the job, including
    // deletion (which cascades to jobs), retry, publication and failure recording.
    const expiredPapers = await db.query<{ id: string }>(
      `SELECT p.id FROM papers p JOIN jobs j ON j.paper_id=p.id
      WHERE j.status='running' AND j.lease_until<now() AND j.attempts >= $1
      ORDER BY p.id LIMIT 50 FOR UPDATE OF p SKIP LOCKED`,
      [MAX_ATTEMPTS],
    );
    const exhausted = await db.query<{ paper_id: string }>(
      `UPDATE jobs SET status='failed',error='Processing stopped after three attempts. Retry the paper to start again.',lease_token=NULL,lease_until=NULL WHERE paper_id=ANY($2::uuid[]) AND status='running' AND lease_until < now() AND attempts >= $1 RETURNING paper_id`,
      [MAX_ATTEMPTS, expiredPapers.rows.map((row) => row.id)],
    );
    if (exhausted.rows.length)
      await db.query(
        `UPDATE papers SET status='failed',error='Processing stopped after three attempts. Retry the paper to start again.',updated_at=now() WHERE id=ANY($1::uuid[])`,
        [exhausted.rows.map((row) => row.paper_id)],
      );
    const candidate = await db.query<{
      id: string;
      paper_id: string;
      user_id: string;
      file_data: Buffer;
      title: string;
      attempts: number;
    }>(
      `
      SELECT j.id,j.paper_id,j.attempts,p.user_id,p.file_data,p.title FROM jobs j JOIN papers p ON p.id=j.paper_id
      WHERE j.attempts < $1 AND ((j.status='queued' AND j.available_at<=now()) OR (j.status='running' AND j.lease_until<now()))
      ORDER BY j.available_at,j.created_at LIMIT 1 FOR UPDATE OF p SKIP LOCKED`,
      [MAX_ATTEMPTS],
    );
    const row = candidate.rows[0];
    if (!row) return null;
    const leaseToken = randomUUID();
    // Recheck after locking the parent: a heartbeat can renew only the job row
    // while the candidate is being selected.
    const claimed = await db.query(
      `UPDATE jobs SET status='running',attempts=attempts+1,lease_token=$2,lease_until=now()+($3 * interval '1 second'),error=NULL
      WHERE id=$1 AND attempts<$4 AND ((status='queued' AND available_at<=now()) OR (status='running' AND lease_until<now()))`,
      [row.id, leaseToken, LEASE_SECONDS, MAX_ATTEMPTS],
    );
    if (!claimed.rowCount) return null;
    await db.query(
      `UPDATE papers SET status='processing',error=NULL,updated_at=now() WHERE id=$1`,
      [row.paper_id],
    );
    return { ...row, lease_token: leaseToken, attempts: row.attempts + 1 };
  });
}
async function renewLease(job: IngestionJob): Promise<boolean> {
  const result = await query(
    `UPDATE jobs SET lease_until=now()+($3 * interval '1 second') WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_until>now()`,
    [job.id, job.lease_token, LEASE_SECONDS],
  );
  return result.rowCount === 1;
}
async function recordFailure(
  job: IngestionJob,
  error: unknown,
  shutdown: boolean,
): Promise<void> {
  if (error instanceof LostLeaseError) return;
  const permanent = error instanceof IngestionError;
  const terminal = !shutdown && (permanent || job.attempts >= MAX_ATTEMPTS);
  const message = permanent ? error.message : publicAIError(error);
  await transaction(async (db) => {
    const paper = await db.query(
      "SELECT id FROM papers WHERE id=$1 AND user_id=$2 FOR UPDATE",
      [job.paper_id, job.user_id],
    );
    if (!paper.rowCount) return;
    const result = await db.query(
      `UPDATE jobs SET status=$3,error=$4,lease_token=NULL,lease_until=NULL,available_at=now()+($5 * interval '1 second'),attempts=greatest(0,attempts-$6) WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_until>now() RETURNING paper_id`,
      [
        job.id,
        job.lease_token,
        terminal ? "failed" : "queued",
        message,
        shutdown ? 0 : 10 * 2 ** (job.attempts - 1),
        shutdown ? 1 : 0,
      ],
    );
    if (result.rowCount)
      await db.query(
        `UPDATE papers SET status=$2,error=$3,updated_at=now() WHERE id=$1`,
        [
          job.paper_id,
          terminal ? "failed" : "queued",
          terminal ? message : null,
        ],
      );
  });
}
export async function processJob(
  job: IngestionJob,
  shutdownSignal?: AbortSignal,
): Promise<void> {
  const controller = new AbortController();
  const shutdown = () => controller.abort(shutdownSignal?.reason);
  shutdownSignal?.addEventListener("abort", shutdown, { once: true });
  if (shutdownSignal?.aborted) shutdown();
  let renewing = false;
  const timer = setInterval(() => {
    if (renewing) return;
    renewing = true;
    void renewLease(job)
      .then((owned) => {
        if (!owned)
          controller.abort(
            new LostLeaseError("Ingestion lease is no longer owned."),
          );
      })
      .catch(() =>
        controller.abort(
          new LostLeaseError("Ingestion lease could not be renewed."),
        ),
      )
      .finally(() => {
        renewing = false;
      });
  }, 25_000);
  timer.unref();
  try {
    const pdf = await extractPDF(job.file_data, controller.signal);
    const chunks = chunkPages(pdf.pages);
    if (!chunks.length)
      throw new IngestionError(
        "No usable text could be extracted from this PDF.",
      );
    const vectors = await embedTexts(
      chunks.map((chunk) => chunk.content),
      controller.signal,
    );
    const embedded: EmbeddedChunk[] = chunks.map((chunk, index) => ({
      ...chunk,
      embedding: vectors[index],
    }));
    const queryVectors = await embedTexts(ANALYSIS_QUERIES, controller.signal);
    const analysis = await analyzeEvidence(
      selectAnalysisEvidence(embedded, queryVectors),
      controller.signal,
    );
    controller.signal.throwIfAborted();
    await transaction(async (db) => {
      const paper = await db.query(
        `SELECT id FROM papers WHERE id=$1 AND user_id=$2 FOR UPDATE`,
        [job.paper_id, job.user_id],
      );
      if (!paper.rowCount) throw new LostLeaseError("Paper was deleted.");
      const lease = await db.query(
        `SELECT id FROM jobs WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_until>now() FOR UPDATE`,
        [job.id, job.lease_token],
      );
      if (!lease.rowCount)
        throw new LostLeaseError("Ingestion lease is no longer owned.");
      await db.query(`DELETE FROM chunks WHERE paper_id=$1 AND user_id=$2`, [
        job.paper_id,
        job.user_id,
      ]);
      // Bounded batches keep protocol messages small and publish the complete paper atomically.
      for (let offset = 0; offset < embedded.length; offset += 32) {
        const batch = embedded.slice(offset, offset + 32);
        const values: unknown[] = [];
        const tuples = batch.map((chunk, index) => {
          values.push(
            chunk.id,
            job.user_id,
            job.paper_id,
            chunk.ordinal,
            chunk.page,
            chunk.section,
            chunk.content,
            vectorLiteral(chunk.embedding),
          );
          return `(${Array.from({ length: 8 }, (_, field) => `$${index * 8 + field + 1}${field === 7 ? "::vector" : ""}`).join(",")})`;
        });
        await db.query(
          `INSERT INTO chunks(id,user_id,paper_id,ordinal,page,section,content,embedding) VALUES ${tuples.join(",")}`,
          values,
        );
      }
      await db.query(
        `UPDATE papers SET status='ready',error=NULL,page_count=$2,analysis=$3::jsonb,embedding_model=$4,title=CASE WHEN title=$7 THEN coalesce($5,title) ELSE title END,authors=$6,updated_at=now() WHERE id=$1`,
        [
          job.paper_id,
          pdf.pageCount,
          JSON.stringify(analysis),
          embeddingModel(),
          pdf.title,
          pdf.authors,
          job.title,
        ],
      );
      await db.query(
        `UPDATE jobs SET status='complete',lease_token=NULL,lease_until=NULL,error=NULL WHERE id=$1 AND lease_token=$2`,
        [job.id, job.lease_token],
      );
    });
    console.info(
      JSON.stringify({
        event: "ingestion.complete",
        job: job.id,
        paper: job.paper_id,
        pages: pdf.pageCount,
        chunks: chunks.length,
      }),
    );
  } catch (error) {
    const reason = controller.signal.aborted ? controller.signal.reason : error;
    console.error(
      JSON.stringify({
        event: "ingestion.failed",
        job: job.id,
        paper: job.paper_id,
        attempt: job.attempts,
        error:
          reason instanceof Error ? reason.message : "Unknown processing error",
      }),
    );
    await recordFailure(job, reason, !!shutdownSignal?.aborted);
  } finally {
    clearInterval(timer);
    shutdownSignal?.removeEventListener("abort", shutdown);
  }
}
