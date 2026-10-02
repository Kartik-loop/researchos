import { afterEach, expect, it, vi } from "vitest";
import { readAPIResponse, requestAPI } from "../lib/api-response";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const html = () =>
  new Response("<!DOCTYPE html><h1>Unavailable</h1>", {
    status: 502,
    headers: { "content-type": "text/html" },
  });
it("replaces proxy HTML with an actionable error", async () => {
  await expect(readAPIResponse(html())).rejects.toThrow(
    "temporarily unavailable",
  );
});
it("preserves useful JSON validation errors", async () => {
  await expect(
    readAPIResponse(
      Response.json(
        { error: "Email or password is incorrect." },
        { status: 401 },
      ),
    ),
  ).rejects.toThrow("Email or password");
});
it("recovers a transient read without losing returned data", async () => {
  vi.useFakeTimers();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(html())
    .mockResolvedValueOnce(Response.json({ papers: ["saved-paper"] }));
  vi.stubGlobal("fetch", fetcher);
  const pending = requestAPI("/api/papers");
  await vi.runAllTimersAsync();
  await expect(pending).resolves.toEqual({ papers: ["saved-paper"] });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("never automatically repeats a write", async () => {
  const fetcher = vi.fn().mockResolvedValue(html());
  vi.stubGlobal("fetch", fetcher);
  await expect(requestAPI("/api/papers", { method: "POST" })).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
