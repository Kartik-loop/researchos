import { readFile, readdir } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import {
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  it,
  expect,
  vi,
} from "vitest";
const state = vi.hoisted(() => ({
  db: undefined as PGlite | undefined,
  cookie: "",
  set: vi.fn(),
}));
vi.mock("../server/db", () => {
  const wrap =
    (db: PGlite | Transaction) =>
    async (sql: string, params: unknown[] = []) => {
      const r = await db.query(sql, params);
      return { rows: r.rows, rowCount: r.affectedRows || r.rows.length };
    };
  return {
    query: (sql: string, params?: unknown[]) => wrap(state.db!)(sql, params),
    transaction: (fn: (db: { query: ReturnType<typeof wrap> }) => unknown) =>
      state.db!.transaction(async (db) => fn({ query: wrap(db) })),
  };
});
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (state.cookie ? { value: state.cookie } : undefined),
    set: state.set,
    delete: vi.fn(),
  }),
}));
vi.mock("../server/mail", () => ({
  sendAccountEmail: vi.fn(),
  requireMailConfigured: vi.fn(),
}));
import {
  issueAccountToken,
  consumeAccountToken,
  requestAccountEmail,
} from "../server/account-tokens";
import {
  hashPassword,
  verifyPassword,
  createSession,
  requireUser,
} from "../server/auth";
import { sendAccountEmail } from "../server/mail";
import { requestLink, completeLink } from "../server/account-routes";
let userId: string;
let oldHash: string;
beforeAll(async () => {
  state.db = await PGlite.create({ extensions: { vector } });
  const dir = new URL("../db/migrations/", import.meta.url);
  for (const name of (await readdir(dir))
    .filter((x) => x.endsWith(".sql"))
    .sort())
    await state.db.exec(await readFile(new URL(name, dir), "utf8"));
}, 30000);
afterAll(async () => {
  await state.db?.close();
});
afterEach(() => vi.unstubAllEnvs());
beforeEach(async () => {
  vi.clearAllMocks();
  state.cookie = "";
  vi.stubEnv("EMAIL_VERIFICATION_REQUIRED", "false");
  vi.stubEnv("APP_URL", "http://localhost:3000");
  await state.db!.exec("TRUNCATE users,rate_limits CASCADE");
  userId = randomUUID();
  oldHash = await hashPassword("old-password-123");
  await state.db!.query(
    "INSERT INTO users(id,email,name,password_hash) VALUES($1,'owner@example.test','Owner',$2)",
    [userId, oldHash],
  );
});
const request = (body: object, origin = "http://localhost:3000") =>
  new Request("http://localhost:3000/api/auth/test", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
it("stores only token hashes and consumes verification exactly once", async () => {
  const token = await issueAccountToken(userId, "verify");
  const r = await state.db!.query<{ token_hash: string }>(
    "SELECT token_hash FROM account_tokens",
  );
  expect(r.rows[0].token_hash).not.toBe(token);
  await consumeAccountToken(token, "verify");
  await expect(consumeAccountToken(token, "verify")).rejects.toThrow(
    "expired or already",
  );
  expect(
    (await state.db!.query("SELECT email_verified_at FROM users")).rows[0],
  ).toMatchObject({ email_verified_at: expect.any(Date) });
});
it("rejects expired, wrong-purpose, and superseded links", async () => {
  const old = await issueAccountToken(userId, "reset");
  const current = await issueAccountToken(userId, "reset");
  await expect(
    consumeAccountToken(old, "reset", "new-password-123"),
  ).rejects.toThrow();
  await expect(consumeAccountToken(current, "verify")).rejects.toThrow();
  await state.db!.exec(
    "UPDATE account_tokens SET expires_at=now()-interval '1 second'",
  );
  await expect(
    consumeAccountToken(current, "reset", "new-password-123"),
  ).rejects.toThrow();
});
it("resets the password and revokes every session and outstanding token", async () => {
  await createSession(userId, oldHash);
  await issueAccountToken(userId, "verify");
  const token = await issueAccountToken(userId, "reset");
  await consumeAccountToken(token, "reset", "new-password-123");
  const r = await state.db!.query<{ password_hash: string }>(
    "SELECT password_hash FROM users",
  );
  expect(
    await verifyPassword("new-password-123", r.rows[0].password_hash),
  ).toBe(true);
  expect(
    await verifyPassword("old-password-123", r.rows[0].password_hash),
  ).toBe(false);
  expect((await state.db!.query("SELECT * FROM sessions")).rows).toHaveLength(
    0,
  );
  expect(
    (await state.db!.query("SELECT * FROM account_tokens")).rows,
  ).toHaveLength(0);
  await expect(createSession(userId, oldHash)).rejects.toThrow(
    "credentials changed",
  );
});
it("enforces verification for new and existing sessions only when enabled", async () => {
  await createSession(userId, oldHash);
  state.cookie = state.set.mock.calls[0][1];
  expect((await requireUser()).id).toBe(userId);
  vi.stubEnv("EMAIL_VERIFICATION_REQUIRED", "true");
  await expect(createSession(userId, oldHash)).rejects.toThrow(
    "Verify your email",
  );
  await expect(requireUser()).rejects.toThrow();
  await consumeAccountToken(
    await issueAccountToken(userId, "verify"),
    "verify",
  );
  await expect(createSession(userId, oldHash)).resolves.toBeUndefined();
});
it("returns identical recovery messages for known and unknown addresses", async () => {
  const route = requestLink("reset");
  const known = await route(request({ email: " OWNER@EXAMPLE.TEST " }));
  const unknown = await route(request({ email: "absent@example.test" }));
  expect(known.status).toBe(200);
  expect(await known.json()).toEqual(await unknown.json());
  expect(sendAccountEmail).toHaveBeenCalledTimes(1);
});
it("does not leak delivery failures and removes the unusable token", async () => {
  vi.mocked(sendAccountEmail).mockRejectedValueOnce(
    new Error("secret provider detail"),
  );
  await expect(
    requestAccountEmail("owner@example.test", "reset"),
  ).resolves.toBeUndefined();
  expect(
    (await state.db!.query("SELECT * FROM account_tokens")).rows,
  ).toHaveLength(0);
});
it("rejects cross-origin completion and weak passwords without consuming the token", async () => {
  const token = await issueAccountToken(userId, "reset");
  const route = completeLink("reset");
  expect(
    (
      await route(
        request(
          { token, password: "new-password-123" },
          "https://attacker.test",
        ),
      )
    ).status,
  ).toBe(403);
  expect((await route(request({ token, password: "short" }))).status).toBe(400);
  await expect(
    consumeAccountToken(token, "reset", "new-password-123"),
  ).resolves.toBeUndefined();
});
it("rate limits repeated email requests", async () => {
  const route = requestLink("reset");
  for (let i = 0; i < 3; i++)
    expect(
      (await route(request({ email: "absent@example.test" }))).status,
    ).toBe(200);
  expect((await route(request({ email: "absent@example.test" }))).status).toBe(
    429,
  );
});
