"use client";
import { useEffect, useRef, useState } from "react";
import { readAPIResponse } from "../lib/api-response";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  Columns3,
  FileText,
  MessagesSquare,
  Plus,
  Square,
  X,
  ArrowUpRight,
} from "lucide-react";
import type { Paper, Message, Citation, Conversation } from "@/server/types";
import { api, Skeleton, Spinner } from "./ui";
function Answer({
  content,
  citations,
  onOpen,
}: {
  content: string;
  citations: Citation[];
  onOpen: (id: string, page: number) => void;
}) {
  const marked = content.replace(/\[(\d+)\]/g, (match, n) =>
    citations.some((c) => c.label === Number(n))
      ? `[${n}](#citation-${n})`
      : match,
  );
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const n = Number(href?.match(/^#citation-(\d+)$/)?.[1]);
            const c = citations.find((x) => x.label === n);
            return c ? (
              <button
                className="inline-citation"
                title={`${c.title} · page ${c.page}`}
                onClick={() => onOpen(c.paper_id, c.page)}
              >
                {children}
              </button>
            ) : (
              <span>{children}</span>
            );
          },
        }}
      >
        {marked}
      </ReactMarkdown>
    </div>
  );
}
export function ResearchChat({
  mode,
  conversationId,
  initialPaperIds,
  papers,
  onOpenPaper,
  onSaved,
}: {
  mode: "chat" | "compare";
  conversationId?: string;
  initialPaperIds: string[];
  papers: Paper[];
  onOpenPaper: (id: string, page?: number) => void;
  onSaved: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]),
    [input, setInput] = useState(""),
    [selected, setSelected] = useState(initialPaperIds),
    [id, setId] = useState(conversationId),
    [loading, setLoading] = useState(!!conversationId),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [picker, setPicker] = useState(false);
  const abort = useRef<AbortController | null>(null),
    bottom = useRef<HTMLDivElement>(null),
    textarea = useRef<HTMLTextAreaElement>(null),
    requestKey = useRef<string | null>(null);
  const ready = papers.filter((p) => p.status === "ready");
  useEffect(() => {
    if (!conversationId) return;
    let ignore = false;
    api<{ conversation: Conversation; messages: Message[] }>(
      `/api/conversations/${conversationId}`,
    )
      .then((d) => {
        if (!ignore) {
          setMessages(d.messages);
          setSelected(d.conversation.paper_ids);
        }
      })
      .catch((e) => {
        if (!ignore) setError(e.message);
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [conversationId]);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    bottom.current?.scrollIntoView({
      behavior: busy ? "auto" : "smooth",
      block: "end",
    });
  }, [messages, busy]);
  async function send(text = input) {
    if (busy || loading || !text.trim()) return;
    if (mode === "compare" && (selected.length < 2 || selected.length > 8)) {
      setError("Choose between two and eight ready papers to compare.");
      return;
    }
    setBusy(true);
    setError("");
    setInput("");
    setPicker(false);
    const requestId = requestKey.current || crypto.randomUUID();
    requestKey.current = requestId;
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      status: "complete",
      citations: [],
      error: null,
    };
    const assistantId = crypto.randomUUID();
    setMessages((m) => [
      ...m,
      userMessage,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        status: "pending",
        citations: [],
        error: null,
      },
    ]);
    const controller = new AbortController();
    abort.current = controller;
    let accumulated = "",
      sources: Citation[] = [],
      serverMessageId = assistantId,
      completed = false;
    const update = (patch: Partial<Message>) =>
      setMessages((m) =>
        m.map((x) => (x.id === assistantId ? { ...x, ...patch } : x)),
      );
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          paper_ids: selected,
          mode,
          conversation_id: id,
          request_id: requestId,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const d = await readAPIResponse<{ error?: string }>(res);
        throw new Error(d.error || "Unable to start this answer.");
      }
      if (!res.headers.get("content-type")?.includes("text/event-stream"))
        throw new Error(
          "The server could not start the answer. Wait a moment, then retry.",
        );
      if (!res.body)
        throw new Error("The response stream could not be opened.");
      const reader = res.body.getReader(),
        decoder = new TextDecoder();
      let buffer = "";
      const process = (event: string) => {
        const lines = event.split("\n");
        const name = lines
          .find((l) => l.startsWith("event:"))
          ?.slice(6)
          .trim();
        const raw = lines
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join("\n");
        if (!raw) return;
        const data = JSON.parse(raw);
        if (name === "meta") {
          setId(data.conversation_id);
          sources = data.citations || [];
          serverMessageId = data.message_id || assistantId;
          update({ citations: sources, status: "streaming" });
        }
        if (name === "delta") {
          accumulated += data.text;
          update({ content: accumulated, status: "streaming" });
        }
        if (name === "done") {
          completed = true;
          update({ status: "complete" });
          requestKey.current = null;
        }
        if (name === "error")
          throw new Error(data.error || "The answer was interrupted.");
      };
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder
          .decode(value, { stream: true })
          .replace(/\r\n/g, "\n");
        let end;
        while ((end = buffer.indexOf("\n\n")) !== -1) {
          process(buffer.slice(0, end));
          buffer = buffer.slice(end + 2);
        }
      }
      if (buffer.trim()) process(buffer);
      if (!completed)
        throw new Error("The connection ended before the answer was saved.");
    } catch (e) {
      const cancelled = controller.signal.aborted;
      const msg = cancelled ? "Answer stopped." : (e as Error).message;
      setError(cancelled ? "" : msg);
      update({
        content: accumulated,
        status: cancelled ? "cancelled" : "failed",
        error: msg,
        citations: sources,
      });
      requestKey.current = null;
    } finally {
      setBusy(false);
      abort.current = null;
      onSaved();
    }
  }
  const comparison = mode === "compare";
  return (
    <section className="chat-page">
      <div className="chat-heading">
        <div>
          <span className="eyebrow">
            {comparison ? "A WIDER PERSPECTIVE" : "THINK WITH YOUR SOURCES"}
          </span>
          <h1>{comparison ? "Compare papers" : "Research chat"}</h1>
          <p className="muted">
            {comparison
              ? "Find where the methods, evidence, and tradeoffs diverge."
              : "Ask a question. Follow the evidence back to the page."}
          </p>
        </div>
        <button
          className="button"
          disabled={busy || loading}
          onClick={() => {
            setId(undefined);
            setMessages([]);
            setError("");
          }}
        >
          <Plus size={16} />
          New {comparison ? "comparison" : "chat"}
        </button>
      </div>
      <div className="scope-bar">
        <button
          className="scope-button"
          disabled={busy || !!id}
          onClick={() => setPicker(!picker)}
        >
          <BookOpen size={16} />
          {selected.length
            ? `${selected.length} ${selected.length === 1 ? "paper" : "papers"} selected`
            : comparison
              ? "Select papers to compare"
              : "All ready papers"}
          <ChevronDown size={15} />
        </button>
        <span className="scope-note">
          {id
            ? "Sources fixed for this conversation"
            : comparison
              ? "Choose 2–8 papers"
              : "Grounded in your library"}
        </span>
      </div>
      {picker && (
        <div className="scope-picker">
          {ready.length === 0 ? (
            <p className="muted">
              Upload a paper and wait for processing to finish.
            </p>
          ) : (
            <>
              {ready.map((p) => (
                <label key={p.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(p.id)}
                    disabled={!selected.includes(p.id) && selected.length >= 8}
                    onChange={(e) =>
                      setSelected((s) =>
                        e.target.checked
                          ? [...s, p.id]
                          : s.filter((x) => x !== p.id),
                      )
                    }
                  />
                  <span>{p.title}</span>
                </label>
              ))}
              <button className="button small" onClick={() => setPicker(false)}>
                Done
                <Check size={14} />
              </button>
            </>
          )}
        </div>
      )}
      <div className="conversation-scroll">
        {loading ? (
          <Skeleton />
        ) : messages.length === 0 ? (
          <div className="chat-empty">
            <span className="chat-emblem">
              {comparison ? (
                <Columns3 size={30} strokeWidth={1.25} />
              ) : (
                <MessagesSquare size={30} strokeWidth={1.25} />
              )}
            </span>
            <h2>
              {comparison
                ? "The differences are in the details."
                : "What are you curious about?"}
            </h2>
            <p>
              {comparison
                ? "Compare problems, datasets, methods, architectures, results, limitations, and computational needs — with evidence from each paper."
                : "Explore a method, untangle a result, or find the connection between ideas."}
            </p>
            {comparison ? (
              <button
                className="button primary"
                disabled={ready.length < 2}
                onClick={() =>
                  selected.length >= 2
                    ? void send("Compare these papers.")
                    : setPicker(true)
                }
              >
                {selected.length >= 2
                  ? "Compare selected papers"
                  : "Choose papers"}
                <ArrowUpRight size={16} />
              </button>
            ) : (
              <div className="suggestion-list">
                {[
                  "What are the main contributions?",
                  "What limitations should I keep in mind?",
                  "How do these papers approach the problem differently?",
                ].map((q) => (
                  <button
                    key={q}
                    disabled={!ready.length}
                    onClick={() => setInput(q)}
                  >
                    {q}
                    <ArrowUpRight size={15} />
                  </button>
                ))}
              </div>
            )}
            {!ready.length && (
              <p className="chat-requirement">
                Add a paper to your library to get started.
              </p>
            )}
          </div>
        ) : (
          messages.map((m, messageIndex) => (
            <article key={m.id} className={`message message-${m.role}`}>
              <div className="message-label">
                {m.role === "assistant" ? (
                  <>
                    <span className="mini-brand">
                      <BookOpen size={14} />
                    </span>
                    ResearchOS
                  </>
                ) : (
                  "You"
                )}
                {m.role === "assistant" &&
                  ["failed", "cancelled", "streaming", "pending"].includes(
                    m.status,
                  ) && (
                    <span className="message-status">
                      {m.status === "pending"
                        ? "Finding relevant passages…"
                        : m.status === "streaming"
                          ? "Writing…"
                          : m.status === "cancelled"
                            ? "Stopped"
                            : "Interrupted"}
                    </span>
                  )}
              </div>
              {m.role === "user" ? (
                <p className="user-message-text">{m.content}</p>
              ) : (
                <>
                  {m.content ? (
                    <Answer
                      content={m.content}
                      citations={m.citations}
                      onOpen={onOpenPaper}
                    />
                  ) : ["pending", "streaming"].includes(m.status) ? (
                    <div className="thinking">
                      <span />
                      <span />
                      <span />
                    </div>
                  ) : (
                    <p className="muted">
                      {m.error || "No answer was generated."}
                    </p>
                  )}
                  {["failed", "cancelled"].includes(m.status) && (
                    <button
                      className="button secondary"
                      disabled={busy || loading}
                      onClick={() => {
                        const question = messages
                          .slice(0, messageIndex)
                          .reverse()
                          .find((item) => item.role === "user");
                        if (question) {
                          requestKey.current = null;
                          void send(question.content);
                        }
                      }}
                    >
                      Retry answer
                    </button>
                  )}
                  {m.citations.length > 0 && (
                    <details className="source-details">
                      <summary>
                        {m.citations.length} retrieved sources
                        <ChevronDown size={14} />
                      </summary>
                      <div className="source-list">
                        {m.citations.map((c) => (
                          <button
                            key={c.label}
                            onClick={() => onOpenPaper(c.paper_id, c.page)}
                          >
                            <span className="source-number">{c.label}</span>
                            <div>
                              <strong>{c.title}</strong>
                              <span>
                                Page {c.page}
                                {c.section ? ` · ${c.section}` : ""}
                              </span>
                              <p>
                                {c.excerpt.slice(0, 180)}
                                {c.excerpt.length > 180 ? "…" : ""}
                              </p>
                            </div>
                            <ArrowUpRight size={15} />
                          </button>
                        ))}
                      </div>
                    </details>
                  )}
                </>
              )}
            </article>
          ))
        )}
        <div ref={bottom} />
      </div>
      <div className="composer-area">
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button
              className="icon-button"
              aria-label="Dismiss"
              onClick={() => setError("")}
            >
              <X size={15} />
            </button>
          </div>
        )}
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            ref={textarea}
            rows={2}
            maxLength={4000}
            aria-label="Ask your research question"
            placeholder={
              comparison
                ? "Ask about the differences between these papers…"
                : "Ask anything about your papers…"
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="composer-bottom">
            <span>
              <FileText size={14} />
              {selected.length
                ? `${selected.length} selected sources`
                : "Your research library"}
            </span>
            {busy ? (
              <button
                className="send-button stop"
                type="button"
                aria-label="Stop answer"
                onClick={() => abort.current?.abort()}
              >
                <Square size={15} />
              </button>
            ) : (
              <button
                className="send-button"
                aria-label="Send question"
                disabled={loading || !input.trim() || !ready.length}
              >
                <ArrowUp size={20} />
              </button>
            )}
          </div>
        </form>
        <p className="composer-disclaimer">
          AI can make mistakes. Verify claims against the original papers.
        </p>
      </div>
    </section>
  );
}
