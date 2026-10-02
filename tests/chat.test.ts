/** The database and streaming endpoint are real; only the external AI is mocked. */
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const state = vi.hoisted(() => ({
  db: undefined as PGlite | undefined,
  userId: "",
}));
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
vi.mock("../server/auth", () => ({
  requireUser: async () => ({ id: state.userId }),
  rateLimit: vi.fn(),
}));
vi.mock("../server/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/ai")>()),
  requireAiConfigured: vi.fn(),
  streamAnswer: vi.fn(),
}));
vi.mock("../server/retrieval", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/retrieval")>()),
  retrieveChunks: vi.fn(),
}));
import { embeddingModel, streamAnswer } from "../server/ai";
import { retrieveChunks } from "../server/retrieval";
import { chatResponse } from "../server/chat";

let paperId: string;
let otherPaperId: string;
beforeAll(async () => {
  state.db = await PGlite.create({ extensions: { vector } });
  const migrations = new URL("../db/migrations/", import.meta.url);
  for (const name of (await readdir(migrations))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await state.db.exec(await readFile(new URL(name, migrations), "utf8"));
  }
}, 30_000);
afterAll(async () => {
  await state.db?.close();
});
beforeEach(async () => {
  vi.clearAllMocks();
  await state.db!.exec("TRUNCATE users CASCADE");
  state.userId = randomUUID();
  await state.db!.query(
    "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Researcher','test-only')",
    [state.userId, `${state.userId}@example.test`],
  );
  paperId = randomUUID();
  otherPaperId = randomUUID();
  for (const id of [paperId, otherPaperId]) {
    await state.db!.query(
      `INSERT INTO papers(id,user_id,title,filename,file_data,file_size,sha256,status,embedding_model)
      VALUES($1,$2,'Research source','source.pdf',$3,1,$4,'ready',$5)`,
      [id, state.userId, Buffer.from("x"), randomUUID(), embeddingModel()],
    );
  }
  vi.mocked(retrieveChunks).mockResolvedValue([
    {
      id: randomUUID(),
      paper_id: paperId,
      title: "Research source",
      page: 1,
      section: "Results",
      content: "The result is grounded in this retrieved passage.",
      score: 0.9,
    },
  ]);
  vi.mocked(streamAnswer).mockImplementation(async function* () {
    yield "Grounded result [1].";
  });
});
function request(input: object) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
function question(overrides = {}) {
  return {
    message: "What are the findings?",
    paper_ids: [paperId],
    mode: "chat",
    request_id: randomUUID(),
    ...overrides,
  };
}

describe("persistent chat and idempotent retries", () => {
  it("persists a cited response and replays an identical request without a second provider call", async () => {
    const input = question();
    const response = await chatResponse(request(input));
    const text = await response.text();
    expect(text).toContain("event: meta");
    expect(text).toContain("event: done");
    const saved = (
      await state.db!.query<{
        content: string;
        status: string;
        citations: unknown[];
      }>("SELECT content,status,citations FROM messages WHERE role='assistant'")
    ).rows[0];
    expect(saved.content).toBe("Grounded result [1].");
    expect(saved.status).toBe("complete");
    expect(saved.citations).toHaveLength(1);
    const replay = await chatResponse(request(input));
    expect(await replay.text()).toContain("Grounded result [1].");
    expect(streamAnswer).toHaveBeenCalledTimes(1);
    expect(
      (await state.db!.query("SELECT id FROM messages")).rows,
    ).toHaveLength(2);
  });
  it("rejects reusing a request ID with different paper scope, mode, or text", async () => {
    const input = question();
    await (await chatResponse(request(input))).text();
    for (const overrides of [
      { paper_ids: [otherPaperId] },
      { mode: "compare", paper_ids: [paperId, otherPaperId] },
      { message: "Different question" },
    ])
      await expect(
        chatResponse(request({ ...input, ...overrides })),
      ).rejects.toMatchObject({ status: 409, code: "REQUEST_ID_REUSED" });
    expect(streamAnswer).toHaveBeenCalledTimes(1);
  });
  it("retains the original scope after a later turn changes the conversation selection", async () => {
    const first = question();
    await (await chatResponse(request(first))).text();
    const conversationId = (
      await state.db!.query<{ id: string }>("SELECT id FROM conversations")
    ).rows[0].id;
    const second = question({
      paper_ids: [otherPaperId],
      conversation_id: conversationId,
    });
    await (await chatResponse(request(second))).text();
    expect(await (await chatResponse(request(first))).text()).toContain(
      "event: done",
    );
    expect(streamAnswer).toHaveBeenCalledTimes(2);
  });
  it("records partial provider failures as failed and releases the conversation lease", async () => {
    vi.mocked(streamAnswer).mockImplementationOnce(async function* () {
      yield "Partial result [1].";
      throw new Error("Provider connection interrupted");
    });
    const response = await chatResponse(request(question()));
    const text = await response.text();
    expect(text).toContain("event: error");
    expect(text).not.toContain("event: done");
    const message = (
      await state.db!.query<{ content: string; status: string }>(
        "SELECT content,status FROM messages WHERE role='assistant'",
      )
    ).rows[0];
    expect(message).toEqual({
      content: "Partial result [1].",
      status: "failed",
    });
    expect(
      (
        await state.db!.query<{ generation_token: string | null }>(
          "SELECT generation_token FROM conversations",
        )
      ).rows[0].generation_token,
    ).toBeNull();
  });
  it("does not resurrect a conversation deleted while the answer streams", async () => {
    vi.mocked(streamAnswer).mockImplementationOnce(async function* () {
      yield "Partial result [1].";
      await state.db!.query("DELETE FROM conversations WHERE user_id=$1", [
        state.userId,
      ]);
    });
    const text = await (await chatResponse(request(question()))).text();
    expect(text).toContain("event: error");
    expect(text).not.toContain("event: done");
    expect(
      (await state.db!.query("SELECT id FROM conversations")).rows,
    ).toEqual([]);
    expect((await state.db!.query("SELECT id FROM messages")).rows).toEqual([]);
  });
});
