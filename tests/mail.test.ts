import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { sendAccountEmail } from "../server/mail";
beforeEach(() => {
  vi.stubEnv("GMAIL_CLIENT_ID", "test-client");
  vi.stubEnv("GMAIL_CLIENT_SECRET", "test-secret");
  vi.stubEnv("GMAIL_REFRESH_TOKEN", "test-refresh");
  vi.stubEnv("EMAIL_FROM", "sender@example.test");
  vi.stubEnv("APP_URL", "https://research.example.test");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("uses Gmail HTTPS and sends a fragment token without exposing OAuth credentials in the email", async () => {
  const f = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ access_token: "test-access" }))
    .mockResolvedValueOnce(Response.json({ id: "sent" }));
  vi.stubGlobal("fetch", f);
  await sendAccountEmail("owner@example.test", "reset", "a".repeat(64));
  expect(f.mock.calls[0][0]).toBe("https://oauth2.googleapis.com/token");
  expect(f.mock.calls[1][0]).toBe(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
  );
  const raw = Buffer.from(
    JSON.parse(f.mock.calls[1][1].body).raw,
    "base64url",
  ).toString();
  const body = Buffer.from(
    raw.split("\r\n\r\n")[1].replace(/\r\n/g, ""),
    "base64",
  ).toString();
  expect(body).toContain("/account/reset#token=");
  expect(raw).not.toContain("test-refresh");
});
it("rejects email header injection", async () => {
  await expect(
    sendAccountEmail(
      "victim@example.test\r\nBcc: thief@example.test",
      "verify",
      "a".repeat(64),
    ),
  ).rejects.toThrow();
});
it("redacts upstream failures", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("test-secret")));
  await expect(
    sendAccountEmail("owner@example.test", "verify", "a".repeat(64)),
  ).rejects.toThrow("email could not be sent");
});
