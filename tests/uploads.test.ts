import { describe, expect, it } from "vitest";
import { MAX_PDF_BYTES, readPdfUpload } from "../server/papers";

function upload(body: string, name = "study.pdf", type = "application/pdf") {
  const form = new FormData();
  form.set("file", new File([body], name, { type }));
  return new Request("http://localhost/api/papers", {
    method: "POST",
    body: form,
  });
}

describe("PDF upload trust boundary", () => {
  it("rejects executable or text content even when filename and MIME type claim PDF", async () => {
    await expect(
      readPdfUpload(upload("<script>alert(1)</script>")),
    ).rejects.toMatchObject({ status: 415 });
  });

  it("accepts PDF signature despite unhelpful browser MIME type and sanitizes filenames", async () => {
    const { bytes, filename } = await readPdfUpload(
      upload(
        "%PDF-1.7\nfixture",
        "../../study.pdf",
        "application/octet-stream",
      ),
    );
    expect(bytes.toString()).toBe("%PDF-1.7\nfixture");
    expect(filename).toBe("study.pdf");
  });

  it("bounds actual streamed bytes independently from Content-Length", async () => {
    const oversized = new Uint8Array(MAX_PDF_BYTES + 65 * 1024);
    let cancelled = false;
    const request = new Request("http://localhost/api/papers", {
      method: "POST",
      headers: {
        "Content-Type": "multipart/form-data; boundary=test",
        "Content-Length": "1",
      },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(oversized);
        },
        cancel() {
          cancelled = true;
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: string });
    await expect(readPdfUpload(request)).rejects.toMatchObject({ status: 413 });
    expect(cancelled).toBe(true);
  });

  it("rejects ambiguous multipart files and malformed multipart bodies", async () => {
    const form = new FormData();
    form.append("file", new File(["%PDF-1.7\none"], "one.pdf"));
    form.append("file", new File(["%PDF-1.7\ntwo"], "two.pdf"));
    await expect(
      readPdfUpload(
        new Request("http://localhost/api/papers", {
          method: "POST",
          body: form,
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      readPdfUpload(
        new Request("http://localhost/api/papers", {
          method: "POST",
          body: "invalid",
          headers: { "Content-Type": "multipart/form-data; boundary=nope" },
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
