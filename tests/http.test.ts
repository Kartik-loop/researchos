import { describe, expect, it } from "vitest";
import { ApiError, handle } from "../server/http";

describe("authenticated API response boundary", () => {
  it("preserves SSE no-transform headers while disabling storage", async () => {
    const route = handle(
      async () =>
        new Response("event: done\n\n", {
          headers: { "Cache-Control": "no-cache, no-transform" },
        }),
    );
    const response = await route(new Request("http://localhost/api/chat"));
    expect(response.headers.get("Cache-Control")).toBe(
      "no-cache, no-transform, no-store",
    );
  });
  it("disables caching for authorization failures as well as success", async () => {
    const route = handle(async () => {
      throw new ApiError(401, "Sign in.");
    });
    const response = await route(new Request("http://localhost/api/papers"));
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "Sign in." });
  });
  it("rejects a cross-origin mutation before executing it", async () => {
    let called = false;
    const route = handle(async () => {
      called = true;
      return Response.json({ ok: true });
    });
    const response = await route(
      new Request("http://localhost/api/papers", {
        method: "DELETE",
        headers: { Origin: "https://attacker.example" },
      }),
    );
    expect(response.status).toBe(403);
    expect(called).toBe(false);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
