"use client";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  MessagesSquare,
  FileText,
  RefreshCw,
  Trash2,
  Pencil,
  Check,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { Paper, Collection, PaperAnalysis } from "@/server/types";
import { api, Modal, Skeleton, Spinner } from "./ui";
const fields: [keyof PaperAnalysis, string][] = [
  ["summary", "Overview"],
  ["contributions", "Key contributions"],
  ["methodology", "Methodology"],
  ["datasets", "Datasets"],
  ["model", "Model & algorithm"],
  ["results", "Results"],
  ["limitations", "Limitations"],
  ["future_work", "Future work"],
];
export function PaperReader({
  id,
  initialPage,
  documentInitially = false,
  collections,
  onBack,
  onAsk,
  onChange,
  onDeleted,
}: {
  id: string;
  initialPage: number;
  documentInitially?: boolean;
  collections: Collection[];
  onBack: () => void;
  onAsk: (id: string) => void;
  onChange: () => void;
  onDeleted: () => void;
}) {
  const [paper, setPaper] = useState<Paper | null>(null),
    [error, setError] = useState(""),
    [tab, setTab] = useState<"analysis" | "document">(
      documentInitially ? "document" : "analysis",
    ),
    [page, setPage] = useState(initialPage),
    [edit, setEdit] = useState(false),
    [deleting, setDeleting] = useState(false),
    [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(""),
    [tags, setTags] = useState(""),
    [memberships, setMemberships] = useState<string[]>([]);
  async function load() {
    try {
      const d = await api<{ paper: Paper }>(`/api/papers/${id}`);
      setPaper(d.paper);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, [id]); // identity resets this reader in the parent
  useEffect(() => {
    if (!paper || !["queued", "processing"].includes(paper.status)) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [paper?.status]);
  function openEdit() {
    if (!paper) return;
    setTitle(paper.title);
    setTags(paper.tags.join(", "));
    setMemberships(paper.collection_ids || []);
    setEdit(true);
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/api/papers/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title,
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          collection_ids: memberships,
        }),
      });
      setEdit(false);
      await load();
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await api(`/api/papers/${id}`, { method: "DELETE" });
      onDeleted();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setDeleting(false);
    }
  }
  async function retry() {
    setBusy(true);
    try {
      await api(`/api/papers/${id}/retry`, { method: "POST" });
      await load();
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="reader">
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={16} />
        Back to workspace
      </button>
      {error && (
        <p className="error-banner" role="alert">
          {error}
          <button className="text-button" onClick={() => void load()}>
            Try again
          </button>
        </p>
      )}
      {!paper ? (
        !error && <Skeleton />
      ) : (
        <>
          <div className="reader-heading">
            <span className="eyebrow">
              {paper.year || "RESEARCH PAPER"}
              {paper.page_count ? ` / ${paper.page_count} PAGES` : ""}
            </span>
            <h1>{paper.title}</h1>
            <p className="muted">
              {paper.authors.join(", ") || paper.filename}
            </p>
            <div className="reader-actions">
              <button
                className="button primary"
                disabled={paper.status !== "ready"}
                onClick={() => onAsk(id)}
              >
                <MessagesSquare size={17} />
                Ask this paper
              </button>
              <button className="button" onClick={openEdit}>
                <Pencil size={15} />
                Edit details
              </button>
              <a
                className="button"
                href={`/api/papers/${id}/file`}
                target="_blank"
                rel="noreferrer"
              >
                <ArrowUpRight size={17} />
                Open PDF
              </a>
              <button
                className="icon-button danger"
                title="Delete paper"
                aria-label="Delete paper"
                onClick={() => setDeleting(true)}
              >
                <Trash2 size={17} />
              </button>
            </div>
            <div className="tags">
              {paper.tags.map((t) => (
                <span className="tag" key={t}>
                  {t}
                </span>
              ))}
            </div>
          </div>
          <div className="reader-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={tab === "analysis"}
              className={tab === "analysis" ? "active" : ""}
              onClick={() => setTab("analysis")}
            >
              Research brief
            </button>
            <button
              role="tab"
              aria-selected={tab === "document"}
              className={tab === "document" ? "active" : ""}
              onClick={() => setTab("document")}
            >
              Original document
            </button>
          </div>
          {tab === "document" ? (
            <div className="pdf-view">
              <div className="pdf-toolbar">
                <span>
                  <FileText size={16} />
                  Original PDF
                </span>
                <div>
                  <button
                    className="icon-button"
                    disabled={page <= 1}
                    aria-label="Previous page"
                    onClick={() => setPage((p) => p - 1)}
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <label className="page-input">
                    Page
                    <input
                      type="number"
                      aria-label="PDF page"
                      min={1}
                      max={paper.page_count || 999}
                      value={page}
                      onChange={(e) =>
                        setPage(
                          Math.max(
                            1,
                            Math.min(
                              paper.page_count || 999,
                              Number(e.target.value),
                            ),
                          ),
                        )
                      }
                    />
                  </label>
                  <button
                    className="icon-button"
                    disabled={page >= (paper.page_count || 1)}
                    aria-label="Next page"
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>
              <iframe
                key={page}
                title={`${paper.title}, page ${page}`}
                src={`/api/papers/${id}/file#page=${page}&view=FitH`}
              />
              <p className="muted pdf-fallback">
                PDF not displaying?{" "}
                <a
                  href={`/api/papers/${id}/file#page=${page}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open the document in a new tab
                </a>
                .
              </p>
            </div>
          ) : paper.status === "ready" && paper.analysis ? (
            <div className="analysis-layout">
              <nav aria-label="Research brief sections">
                {fields.map(([key, label]) => (
                  <a href={`#brief-${key}`} key={key}>
                    {label}
                  </a>
                ))}
              </nav>
              <div className="analysis-body">
                <div className="analysis-note">
                  AI-generated from this paper. Check the linked pages before
                  citing a finding.
                </div>
                {fields.map(([key, label]) => (
                  <section id={`brief-${key}`} key={key}>
                    <h2>{label}</h2>
                    <p>
                      {paper.analysis?.[key]?.text ||
                        "Not reported in the retrieved evidence."}
                    </p>
                    {!!paper.analysis?.[key]?.pages?.length && (
                      <div className="source-pages">
                        {paper.analysis[key].pages.map((p) => (
                          <button
                            key={p}
                            onClick={() => {
                              setPage(p);
                              setTab("document");
                            }}
                          >
                            <FileText size={12} />
                            p. {p}
                            <ArrowUpRight size={11} />
                          </button>
                        ))}
                      </div>
                    )}
                  </section>
                ))}
              </div>
            </div>
          ) : (
            <div className="processing-panel">
              <span className="empty-icon">
                {paper.status === "failed" ? (
                  <RefreshCw size={28} />
                ) : (
                  <Spinner />
                )}
              </span>
              <h2>
                {paper.status === "failed"
                  ? "This paper needs attention"
                  : "Getting to know your paper"}
              </h2>
              <p>
                {paper.status === "failed"
                  ? paper.error
                  : "We’re extracting the text, connecting the key ideas, and preparing your research brief. You can read the original PDF while we work."}
              </p>
              {paper.status === "failed" && (
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => void retry()}
                >
                  {busy ? <Spinner /> : <RefreshCw size={16} />}Retry processing
                </button>
              )}
            </div>
          )}
        </>
      )}
      <Modal open={edit} onOpenChange={setEdit} title="Edit paper details">
        <form onSubmit={save}>
          <label>
            Title
            <input
              required
              maxLength={300}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            Tags<span className="field-hint">Separate tags with commas</span>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="language models, retrieval, evaluation"
            />
          </label>
          {collections.length > 0 && (
            <fieldset className="collection-checkboxes">
              <legend>Collections</legend>
              {collections.map((c) => (
                <label key={c.id}>
                  <input
                    type="checkbox"
                    checked={memberships.includes(c.id)}
                    onChange={(e) =>
                      setMemberships((m) =>
                        e.target.checked
                          ? [...m, c.id]
                          : m.filter((x) => x !== c.id),
                      )
                    }
                  />
                  {c.name}
                </label>
              ))}
            </fieldset>
          )}
          {error && (
            <p className="error-banner" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              className="button"
              onClick={() => setEdit(false)}
            >
              Cancel
            </button>
            <button className="button primary" disabled={busy}>
              {busy ? <Spinner /> : <Check size={16} />}Save details
            </button>
          </div>
        </form>
      </Modal>
      <Modal
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this paper?"
        description="The PDF, its research brief, and searchable text will be removed permanently. Existing conversations remain, but links to this paper will no longer open."
      >
        <div className="dialog-actions">
          <button className="button" onClick={() => setDeleting(false)}>
            Keep paper
          </button>
          <button
            className="button destructive"
            disabled={busy}
            onClick={() => void remove()}
          >
            {busy ? <Spinner /> : "Delete paper"}
          </button>
        </div>
      </Modal>
    </section>
  );
}
