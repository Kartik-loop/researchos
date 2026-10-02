/** Isolated database tests. Provider calls are mocked here only, never in the app. */
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const state = vi.hoisted(() => ({ db: undefined as PGlite | undefined }));
vi.mock("../server/db", () => {
  const wrap =
    (database: PGlite | Transaction) =>
    async (sql: string, params: unknown[] = []) => {
      const result = await database.query(sql, params);
      return {
        rows: result.rows,
        rowCount: result.affectedRows || result.rows.length,
      };
    };
  return {
    query: (sql: string, params?: unknown[]) => wrap(state.db!)(sql, params),
    transaction: (
      operation: (client: { query: ReturnType<typeof wrap> }) => unknown,
    ) => state.db!.transaction(async (db) => operation({ query: wrap(db) })),
  };
});
vi.mock("../server/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/ai")>();
  return {
    ...actual,
    embedTexts: vi.fn(async (texts: string[]) =>
      texts.map(() => [1, ...Array(1535).fill(0)]),
    ),
    analyzeEvidence: vi.fn(async () =>
      Object.fromEntries(
        [
          "summary",
          "contributions",
          "methodology",
          "datasets",
          "model",
          "results",
          "limitations",
          "future_work",
        ].map((key) => [
          key,
          { text: "This is test evidence from the source page.", pages: [1] },
        ]),
      ),
    ),
  };
});
import {
  analyzeEvidence,
  embedTexts,
  embeddingModel,
  vectorLiteral,
} from "../server/ai";
import { claimJob, processJob } from "../server/ingestion";
import { retrieveChunks } from "../server/retrieval";

let userId: string;
let sourcePDF: Uint8Array;
const vectorText = vectorLiteral([1, ...Array(1535).fill(0)]);
beforeAll(async () => {
  state.db = await PGlite.create({ extensions: { vector } });
  const migrations = new URL("../db/migrations/", import.meta.url);
  for (const name of (await readdir(migrations))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await state.db.exec(await readFile(new URL(name, migrations), "utf8"));
  }
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.setTitle("Verifiable Research Retrieval");
  pdf
    .addPage()
    .drawText(
      "Abstract\nThis study evaluates retrieval using a benchmark dataset. Results demonstrate improved accuracy.\nConclusion\nThe research needs larger datasets in future work.",
      { x: 40, y: 750, font, size: 10, lineHeight: 18 },
    );
  sourcePDF = await pdf.save();
}, 30_000);
afterAll(async () => {
  await state.db?.close();
});
beforeEach(async () => {
  vi.clearAllMocks();
  await state.db!.exec("TRUNCATE users CASCADE");
  userId = randomUUID();
  await state.db!.query(
    `INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Researcher','unused-test-hash')`,
    [userId, `${userId}@example.test`],
  );
});
async function addPaper(owner = userId, bytes = sourcePDF): Promise<string> {
  const id = randomUUID();
  await state.db!.query(
    `INSERT INTO papers(id,user_id,title,filename,file_data,file_size,sha256) VALUES($1,$2,'Test paper','source.pdf',$3,$4,$5)`,
    [id, owner, bytes, bytes.byteLength, randomUUID()],
  );
  await state.db!.query(`INSERT INTO jobs(id,paper_id) VALUES($1,$2)`, [
    randomUUID(),
    id,
  ]);
  return id;
}
async function addReady(
  owner = userId,
  model = embeddingModel(),
): Promise<string> {
  const paper = await addPaper(owner);
  await state.db!.query(
    `UPDATE papers SET status='ready',embedding_model=$2 WHERE id=$1`,
    [paper, model],
  );
  await state.db!.query(
    `INSERT INTO chunks(id,user_id,paper_id,ordinal,page,section,content,embedding) VALUES($1,$2,$3,0,1,'Results','Retrieval benchmark dataset improves accuracy and runtime.',$4::vector)`,
    [randomUUID(), owner, paper, vectorText],
  );
  return paper;
}

describe("real PostgreSQL ingestion state machine", () => {
  it("claims once, extracts a real PDF, then atomically publishes analysis and vectors", async () => {
    const id = await addPaper();
    const job = await claimJob();
    expect(job?.paper_id).toBe(id);
    expect(job?.attempts).toBe(1);
    expect(await claimJob()).toBeNull();
    await processJob(job!);
    const paper = (
      await state.db!.query<{
        status: string;
        page_count: number;
        analysis: object;
      }>("SELECT status,page_count,analysis FROM papers WHERE id=$1", [id])
    ).rows[0];
    expect(paper.status).toBe("ready");
    expect(paper.page_count).toBe(1);
    expect(paper.analysis).toHaveProperty("summary");
    expect(
      (await state.db!.query("SELECT id FROM chunks WHERE paper_id=$1", [id]))
        .rows.length,
    ).toBeGreaterThan(0);
    expect(
      (
        await state.db!.query<{ status: string; lease_token: string | null }>(
          "SELECT status,lease_token FROM jobs WHERE paper_id=$1",
          [id],
        )
      ).rows[0],
    ).toEqual({ status: "complete", lease_token: null });
  }, 20_000);
  it("records an unreadable/scanned PDF as a terminal actionable error", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const id = await addPaper(userId, await pdf.save());
    await processJob((await claimJob())!);
    const row = (
      await state.db!.query<{ status: string; error: string }>(
        "SELECT status,error FROM papers WHERE id=$1",
        [id],
      )
    ).rows[0];
    expect(row.status).toBe("failed");
    expect(row.error).toContain("OCR");
    expect(embedTexts).not.toHaveBeenCalled();
  });
  it("preserves a title edited while the ingestion job is processing", async () => {
    const id = await addPaper();
    const job = (await claimJob())!;
    await state.db!.query("UPDATE papers SET title=$2 WHERE id=$1", [
      id,
      "My edited research title",
    ]);
    await processJob(job);
    const row = (
      await state.db!.query<{ title: string; status: string }>(
        "SELECT title,status FROM papers WHERE id=$1",
        [id],
      )
    ).rows[0];
    expect(row).toEqual({ title: "My edited research title", status: "ready" });
  });
  it("backs off a transient provider failure without publishing partial chunks", async () => {
    const id = await addPaper();
    vi.mocked(embedTexts).mockRejectedValueOnce(
      new Error("Transient test provider failure"),
    );
    await processJob((await claimJob())!);
    const row = (
      await state.db!.query<{
        status: string;
        attempts: number;
        delayed: boolean;
      }>(
        `SELECT status,attempts,available_at>now() AS delayed FROM jobs WHERE paper_id=$1`,
        [id],
      )
    ).rows[0];
    expect(row).toEqual({ status: "queued", attempts: 1, delayed: true });
    expect(await claimJob()).toBeNull();
    expect(
      (await state.db!.query("SELECT id FROM chunks WHERE paper_id=$1", [id]))
        .rows,
    ).toEqual([]);
  });
  it("fences an expired worker from publishing or changing another lease", async () => {
    const id = await addPaper();
    const job = (await claimJob())!;
    const nextToken = randomUUID();
    vi.mocked(analyzeEvidence).mockImplementationOnce(async () => {
      await state.db!.query("UPDATE jobs SET lease_token=$2 WHERE id=$1", [
        job.id,
        nextToken,
      ]);
      return {
        summary: { text: "Unpublished test result.", pages: [1] },
      } as Awaited<ReturnType<typeof analyzeEvidence>>;
    });
    await processJob(job);
    expect(
      (await state.db!.query("SELECT id FROM chunks WHERE paper_id=$1", [id]))
        .rows,
    ).toEqual([]);
    expect(
      (
        await state.db!.query<{ lease_token: string }>(
          "SELECT lease_token FROM jobs WHERE id=$1",
          [job.id],
        )
      ).rows[0].lease_token,
    ).toBe(nextToken);
    expect(
      (
        await state.db!.query<{ status: string }>(
          "SELECT status FROM papers WHERE id=$1",
          [id],
        )
      ).rows[0].status,
    ).toBe("processing");
  });
  it("does not record failure after losing a lease even before another worker claims it", async () => {
    const id = await addPaper();
    const job = (await claimJob())!;
    vi.mocked(embedTexts).mockImplementationOnce(async () => {
      await state.db!.query(
        "UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
        [job.id],
      );
      throw new Error("Provider connection failed after lease expiry");
    });
    await processJob(job);
    const row = (
      await state.db!.query<{ status: string; lease_token: string }>(
        "SELECT status,lease_token FROM jobs WHERE id=$1",
        [job.id],
      )
    ).rows[0];
    expect(row).toEqual({ status: "running", lease_token: job.lease_token });
    const replacement = await claimJob();
    expect(replacement?.attempts).toBe(2);
    expect(replacement?.lease_token).not.toBe(job.lease_token);
    expect(
      (await state.db!.query("SELECT id FROM chunks WHERE paper_id=$1", [id]))
        .rows,
    ).toEqual([]);
  });
  it("does not resurrect a paper deleted during processing", async () => {
    const id = await addPaper();
    const job = (await claimJob())!;
    vi.mocked(analyzeEvidence).mockImplementationOnce(async () => {
      await state.db!.query("DELETE FROM papers WHERE id=$1", [id]);
      return {
        summary: { text: "Unpublished test result.", pages: [1] },
      } as Awaited<ReturnType<typeof analyzeEvidence>>;
    });
    await processJob(job);
    expect(
      (await state.db!.query("SELECT id FROM papers WHERE id=$1", [id])).rows,
    ).toEqual([]);
    expect(
      (await state.db!.query("SELECT id FROM jobs WHERE paper_id=$1", [id]))
        .rows,
    ).toEqual([]);
  });
  it("recovers expired work but terminally fails an exhausted lease", async () => {
    const id = await addPaper();
    const original = (await claimJob())!;
    await state.db!.query(
      `UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id=$1`,
      [original.id],
    );
    const recovered = (await claimJob())!;
    expect(recovered.lease_token).not.toBe(original.lease_token);
    expect(recovered.attempts).toBe(2);
    await state.db!.query(
      `UPDATE jobs SET lease_until=now()-interval '1 second',attempts=3 WHERE id=$1`,
      [original.id],
    );
    expect(await claimJob()).toBeNull();
    expect(
      (
        await state.db!.query<{ status: string }>(
          "SELECT status FROM papers WHERE id=$1",
          [id],
        )
      ).rows[0].status,
    ).toBe("failed");
  });
});

describe("real hybrid vector/full-text retrieval", () => {
  it("restricts every retrieved source by ownership and embedding provider version", async () => {
    const other = randomUUID();
    await state.db!.query(
      `INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Other','unused-test-hash')`,
      [other, `${other}@example.test`],
    );
    const mine = await addReady();
    const theirs = await addReady(other);
    const incompatible = await addReady(userId, "other-provider#model#1536");
    const result = await retrieveChunks(
      userId,
      "retrieval benchmark",
      [],
      "chat",
    );
    expect(result.map((chunk) => chunk.paper_id)).toEqual([mine]);
    expect(
      await retrieveChunks(
        userId,
        "retrieval benchmark",
        [theirs, incompatible],
        "chat",
      ),
    ).toEqual([]);
  });
  it("retrieves evidence independently for every selected paper in comparisons", async () => {
    const first = await addReady();
    const second = await addReady();
    const result = await retrieveChunks(
      userId,
      "Compare these papers",
      [first, second],
      "compare",
    );
    expect(new Set(result.map((chunk) => chunk.paper_id))).toEqual(
      new Set([first, second]),
    );
    expect(new Set(result.map((chunk) => chunk.id)).size).toBe(result.length);
  });
});
