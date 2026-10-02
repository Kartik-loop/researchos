import { describe, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  EMBEDDING_DIMENSIONS,
  validateAnalysis,
  vectorLiteral,
} from "../server/ai";
import { chunkPages, detectSection, extractPDF } from "../server/ingestion";
import {
  citationsFromChunks,
  cosineSimilarity,
  selectAnalysisEvidence,
  type EmbeddedChunk,
} from "../server/retrieval";
vi.mock("../server/auth", () => ({ requireUser: vi.fn(), rateLimit: vi.fn() }));
import { chatSchema, CitationFilter, sseEvent } from "../server/chat";

describe("page-aware PDF ingestion", () => {
  it("extracts real text and page numbers from a multi-page PDF", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.setTitle("Experimental Study of Research Retrieval");
    for (const text of [
      "Abstract\nWe evaluate document retrieval on a scientific benchmark with three methods and rigorous evaluation.",
      "Conclusion\nThe retrieval method improves accuracy. Future work will investigate longer context windows.",
    ]) {
      const page = pdf.addPage();
      page.drawText(text, { x: 45, y: 750, size: 12, font, lineHeight: 20 });
    }
    const result = await extractPDF(await pdf.save());
    expect(result.pageCount).toBe(2);
    expect(result.pages.map((page) => page.page)).toEqual([1, 2]);
    expect(result.pages[1].text).toContain("Future work");
    expect(result.title).toBe("Experimental Study of Research Retrieval");
    expect(result.pages[0].section).toBe("Abstract");
  });
  it("rejects image-only or empty PDFs instead of inventing text", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    await expect(extractPDF(await pdf.save())).rejects.toThrow("OCR");
  });
  it("preserves page ownership and overlapping context in bounded chunks", () => {
    const first = "A meaningful sentence about experimental methods. ".repeat(
      120,
    );
    const chunks = chunkPages(
      [
        { page: 1, text: first, section: "Methods" },
        {
          page: 2,
          text: "Distinct second page result and limitations.",
          section: "Results",
        },
      ],
      500,
      100,
    );
    expect(chunks.length).toBeGreaterThan(10);
    expect(chunks.every((chunk) => chunk.content.length <= 500)).toBe(true);
    expect(chunks.at(-1)?.page).toBe(2);
    expect(chunks.at(-1)?.content).not.toContain("experimental methods");
    expect(chunks[1].content.slice(0, 120)).toContain(
      chunks[0].content.slice(-60).trim(),
    );
    expect(new Set(chunks.map((chunk) => chunk.id)).size).toBe(chunks.length);
    expect(chunks.map((chunk) => chunk.ordinal)).toEqual(
      chunks.map((_, index) => index),
    );
  });
  it("finds real section headings without treating a sentence as a heading", () => {
    expect(
      detectSection(
        "The results are promising.\n4.2 Limitations\nFurther work is needed.",
      ),
    ).toBe("4.2 Limitations");
    expect(
      detectSection("This paper has many limitations we discuss below."),
    ).toBeNull();
  });
  it("honors the exact chunk bound when punctuation appears at the cutoff", () => {
    const chunks = chunkPages(
      [
        {
          page: 1,
          text: `${"x".repeat(100)}. ${"y".repeat(100)}`,
          section: null,
        },
      ],
      100,
      0,
    );
    expect(chunks.every((chunk) => chunk.content.length <= 100)).toBe(true);
  });
});

describe("retrieval and evidence validation", () => {
  it("requires exact finite vectors and rejects zero vectors", () => {
    expect(() => vectorLiteral([1])).toThrow();
    expect(() => vectorLiteral(Array(EMBEDDING_DIMENSIONS).fill(0))).toThrow();
    expect(() =>
      vectorLiteral(Array(EMBEDDING_DIMENSIONS).fill(NaN)),
    ).toThrow();
    expect(vectorLiteral(Array(EMBEDDING_DIMENSIONS).fill(0.5))).toContain(
      "0.5",
    );
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
  });
  it("covers the beginning, middle, conclusions and per-field retrieved evidence within budget", () => {
    const chunks: EmbeddedChunk[] = Array.from({ length: 20 }, (_, index) => ({
      id: `${index}`,
      ordinal: index,
      page: index + 1,
      section: index === 19 ? "Conclusion" : null,
      content: "x".repeat(100),
      embedding: [index === 7 ? 1 : 0, 1],
    }));
    const evidence = selectAnalysisEvidence(chunks, [[1, 0]], 1000);
    expect(evidence.map((item) => item.page)).toEqual(
      expect.arrayContaining([1, 8, 11, 20]),
    );
    expect(
      evidence.reduce((sum, item) => sum + item.content.length, 0),
    ).toBeLessThanOrEqual(1000);
  });
  it("rejects fabricated pages and unreferenced factual summaries", () => {
    const keys = [
      "summary",
      "contributions",
      "methodology",
      "datasets",
      "model",
      "results",
      "limitations",
      "future_work",
    ];
    const analysis: Record<string, { text: string; pages: number[] }> =
      Object.fromEntries(
        keys.map((key) => [
          key,
          { text: "Not reported in retrieved evidence.", pages: [] },
        ]),
      );
    expect(validateAnalysis(analysis, new Set([1]))).toHaveProperty("summary");
    analysis.results = { text: "Accuracy improves to 90%.", pages: [2] };
    expect(() => validateAnalysis(analysis, new Set([1]))).toThrow("outside");
    analysis.results = { text: "Accuracy improves to 90%.", pages: [] };
    expect(() => validateAnalysis(analysis, new Set([1]))).toThrow(
      "without a source",
    );
  });
  it("maps citations to immutable paper and page IDs", () => {
    const citations = citationsFromChunks([
      {
        id: "chunk",
        paper_id: "paper",
        title: "Research",
        page: 7,
        section: "Results",
        content: "Measured evidence.",
        score: 0.2,
      },
    ]);
    expect(citations[0]).toEqual({
      label: 1,
      chunk_id: "chunk",
      paper_id: "paper",
      title: "Research",
      page: 7,
      section: "Results",
      excerpt: "Measured evidence.",
    });
  });
});

describe("stream integrity", () => {
  it("filters hallucinated citations even across token boundaries", () => {
    const filter = new CitationFilter(new Set([1, 12]));
    const answer = [
      filter.push("First ["),
      filter.push("1] and [9"),
      filter.push("99]. Second [1"),
      filter.push("2]."),
      filter.push("", true),
    ].join("");
    expect(answer).toBe("First [1] and [source unavailable]. Second [12].");
  });
  it("never emits a long invalid citation split over multiple provider tokens", () => {
    const filter = new CitationFilter(new Set([1]));
    const answer = [
      filter.push("Result [1234567"),
      filter.push("89]."),
      filter.push("", true),
    ].join("");
    expect(answer).toBe("Result [source unavailable].");
    expect(() => filter.push(`[${"9".repeat(65)}`)).toThrow(
      "invalid source reference",
    );
  });
  it("encodes multiline content as a single safe SSE data field", () => {
    const result = new TextDecoder().decode(
      sseEvent("delta", { text: "line one\n\nevent: forged" }),
    );
    expect(result.split("\n")).toHaveLength(4);
    expect(result).toContain("\\n\\nevent: forged");
  });
  it("requires two distinct papers for comparisons and a UUID retry token", () => {
    const id = "123e4567-e89b-42d3-a456-426614174000";
    expect(
      chatSchema.safeParse({
        message: "Compare",
        paper_ids: [id, id],
        mode: "compare",
        request_id: id,
      }).success,
    ).toBe(false);
    expect(
      chatSchema.safeParse({
        message: "Question",
        paper_ids: [],
        mode: "chat",
        request_id: "bad",
      }).success,
    ).toBe(false);
  });
});
