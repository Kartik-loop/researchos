import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ create: vi.fn(), embed: vi.fn() }));
vi.mock("openai", async (importOriginal) => {
  const original = await importOriginal<typeof import("openai")>();
  return {
    ...original,
    default: class {
      static APIError = original.default.APIError;
      chat = { completions: { create: state.create } };
      embeddings = { create: state.embed };
    },
  };
});
import { embedTexts, publicAIError, streamAnswer } from "../server/ai";

async function consume() {
  let result = "";
  for await (const text of streamAnswer([
    { role: "user", content: "Question" },
  ]))
    result += text;
  return result;
}
function providerStream(reason: string | null) {
  return (async function* () {
    yield {
      choices: [{ delta: { content: "Evidence [1]." }, finish_reason: null }],
    };
    if (reason) yield { choices: [{ delta: {}, finish_reason: reason }] };
  })();
}
beforeEach(() => {
  vi.stubEnv("AI_API_KEY", "test-only-key");
  state.create.mockReset();
  state.embed.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("Gemini embedding response compatibility", () => {
  const vector = Array(1536).fill(0.1);
  beforeEach(() => {
    vi.stubEnv(
      "AI_BASE_URL",
      "https://generativelanguage.googleapis.com/v1beta/openai/",
    );
  });
  it("accepts Gemini's omitted zero index without losing input alignment", async () => {
    const second = Array(1536).fill(0.2);
    state.embed.mockResolvedValue({
      data: [{ embedding: vector }, { index: 1, embedding: second }],
    });
    await expect(embedTexts(["first", "second"])).resolves.toEqual([
      vector,
      second,
    ]);
  });
  it("still rejects a missing nonzero index", async () => {
    state.embed.mockResolvedValue({
      data: [{ embedding: vector }, { embedding: vector }],
    });
    await expect(embedTexts(["first", "second"])).rejects.toThrow(
      "invalid batch",
    );
  });
  it("does not infer indices for other providers", async () => {
    vi.stubEnv("AI_BASE_URL", "https://api.openai.com/v1");
    state.embed.mockResolvedValue({ data: [{ embedding: vector }] });
    await expect(embedTexts(["first"])).rejects.toThrow("invalid batch");
  });
});

describe("provider streaming completion contract", () => {
  it("accepts an explicit successful completion", async () => {
    state.create.mockResolvedValue(providerStream("stop"));
    await expect(consume()).resolves.toBe("Evidence [1].");
  });
  it("rejects a stream that disconnects without a completion marker", async () => {
    state.create.mockResolvedValue(providerStream(null));
    await expect(consume()).rejects.toThrow("before confirming completion");
  });
  it("shows an actionable stream error instead of ingestion troubleshooting", async () => {
    state.create.mockResolvedValue(providerStream(null));
    const failure = await consume().catch((error) => error);
    expect(publicAIError(failure)).toContain("Retry this answer");
    expect(publicAIError(failure)).not.toContain("worker logs");
  });
  it.each(["length", "content_filter", "tool_calls"])(
    "does not mark a %s answer complete",
    async (reason) => {
      state.create.mockResolvedValue(providerStream(reason));
      await expect(consume()).rejects.toThrow();
    },
  );
});
