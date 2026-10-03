"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { readAPIResponse } from "../lib/api-response";
import {
  BookOpen,
  Library,
  Network,
  MessagesSquare,
  Columns3,
  Search,
  Plus,
  ArrowUpRight,
  Upload,
  Folder,
  FileText,
  Moon,
  Sun,
  LogOut,
  Menu,
  X,
  ArrowRight,
  AlertCircle,
  Trash2,
  Check,
  Tag,
  SlidersHorizontal,
} from "lucide-react";
import type {
  User,
  Paper,
  Collection,
  Conversation,
  GraphData,
} from "@/server/types";
import { AuthScreen } from "./auth-screen";
import { api, Modal, Empty, Skeleton, Spinner } from "./ui";
import { PaperReader } from "./paper-reader";
import { ResearchChat } from "./research-chat";
import { ResearchGraph } from "./research-graph";
type View = "library" | "chat" | "compare" | "graph";
export function Workspace() {
  const [user, setUser] = useState<User | null>(null),
    [initial, setInitial] = useState(true),
    [bootError, setBootError] = useState("");
  const [papers, setPapers] = useState<Paper[]>([]),
    [chatPapers, setChatPapers] = useState<Paper[]>([]),
    [readerDocument, setReaderDocument] = useState(false),
    [collections, setCollections] = useState<Collection[]>([]),
    [conversations, setConversations] = useState<Conversation[]>([]);
  const [view, setView] = useState<View>("library"),
    [collection, setCollection] = useState(""),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [selected, setSelected] = useState<string[]>([]),
    [activePaper, setActivePaper] = useState<string | null>(null),
    [page, setPage] = useState(1),
    [conversation, setConversation] = useState<string | undefined>(),
    [chatScope, setChatScope] = useState<string[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false),
    [uploading, setUploading] = useState(false),
    [uploadError, setUploadError] = useState(""),
    [dragging, setDragging] = useState(false);
  const [collectionOpen, setCollectionOpen] = useState(false),
    [collectionName, setCollectionName] = useState(""),
    [saving, setSaving] = useState(false),
    [collectionError, setCollectionError] = useState("");
  const [mobile, setMobile] = useState(false),
    [dark, setDark] = useState(false),
    [toast, setToast] = useState(""),
    [graph, setGraph] = useState<GraphData | null>(null),
    [graphLoading, setGraphLoading] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null),
    fileRef = useRef<HTMLInputElement>(null);
  const searchSequence = useRef(0);
  const notify = (message: string) => setToast(message);
  const loadPapers = useCallback(
    async (q = query, c = collection, quiet = false) => {
      const seq = ++searchSequence.current;
      if (!quiet) setLoading(true);
      try {
        const d = await api<{ papers: Paper[] }>(
          `/api/papers?q=${encodeURIComponent(q)}&collection=${encodeURIComponent(c)}`,
        );
        if (seq === searchSequence.current) {
          setPapers(d.papers);
          setError("");
        }
      } catch (e) {
        if (seq === searchSequence.current) setError((e as Error).message);
      } finally {
        if (seq === searchSequence.current) setLoading(false);
      }
    },
    [query, collection],
  );
  const loadAux = useCallback(async () => {
    try {
      const [c, h, p] = await Promise.all([
        api<{ collections: Collection[] }>("/api/collections"),
        api<{ conversations: Conversation[] }>("/api/conversations"),
        api<{ papers: Paper[] }>("/api/papers"),
      ]);
      setCollections(c.collections);
      setConversations(h.conversations);
      setChatPapers(p.papers);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  const loadSession = useCallback(async () => {
    setInitial(true);
    setBootError("");
    try {
      const res = await fetch("/api/auth/me");
      if (res.status === 401) {
        setUser(null);
        return;
      }
      const d = await readAPIResponse<{ user: User }>(res);
      setUser(d.user);
    } catch (e) {
      setBootError((e as Error).message);
    } finally {
      setInitial(false);
    }
  }, []);
  useEffect(() => {
    void loadSession();
    setDark(document.documentElement.dataset.theme === "dark");
  }, [loadSession]);
  useEffect(() => {
    if (user) {
      const timer = setTimeout(() => void loadPapers(), 220);
      return () => clearTimeout(timer);
    }
  }, [user, loadPapers]);
  useEffect(() => {
    if (user) void loadAux();
  }, [user, loadAux]);
  useEffect(() => {
    if (
      !user ||
      !papers.some((p) => p.status === "queued" || p.status === "processing")
    )
      return;
    const timer = setInterval(
      () => void loadPapers(query, collection, true),
      3000,
    );
    return () => clearInterval(timer);
  }, [papers, user, loadPapers, query, collection]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setView("library");
        setActivePaper(null);
        setTimeout(() => searchRef.current?.focus(), 20);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "u") {
        e.preventDefault();
        if (user) setUploadOpen(true);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [user]);
  useEffect(() => {
    if (view !== "graph" || !user) return;
    let cancelled = false;
    setGraphLoading(true);
    api<GraphData>("/api/graph")
      .then((d) => {
        if (!cancelled) setGraph(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setGraphLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [view, user, papers]);
  function navigate(v: View, c = "") {
    setView(v);
    setCollection(c);
    setActivePaper(null);
    if (v === "chat" || v === "compare") void loadAux();
    setMobile(false);
    setError("");
    if (v === "chat") {
      setConversation(undefined);
      setChatScope(selected);
    }
  }
  function openPaper(id: string, p?: number) {
    setActivePaper(id);
    setPage(p || 1);
    setReaderDocument(p !== undefined);
  }
  function askPapers(ids: string[], compare = false) {
    void loadAux();
    setChatScope(ids);
    setConversation(undefined);
    setView(compare ? "compare" : "chat");
    setActivePaper(null);
  }
  function theme() {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    localStorage.setItem("researchos-theme", next ? "dark" : "light");
  }
  async function upload(files: FileList | File[] | null) {
    if (!files?.length) return;
    setUploading(true);
    setUploadError("");
    let count = 0;
    try {
      for (const file of Array.from(files)) {
        if (file.size > 20 * 1024 * 1024)
          throw new Error(`${file.name} exceeds the 20 MB limit.`);
        const form = new FormData();
        form.set("file", file);
        const { paper } = await api<{ paper: Paper }>("/api/papers", {
          method: "POST",
          body: form,
        });
        if (collection)
          await api(`/api/papers/${paper.id}`, {
            method: "PATCH",
            body: JSON.stringify({ collection_ids: [collection] }),
          });
        count++;
      }
      setUploadOpen(false);
      notify(
        `${count} ${count === 1 ? "paper" : "papers"} added. Processing will continue in the background.`,
      );
    } catch (e) {
      setUploadError((e as Error).message);
    } finally {
      setUploading(false);
      void loadPapers();
      void loadAux();
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  async function addCollection(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setCollectionError("");
    try {
      const d = await api<{ collection: Collection }>("/api/collections", {
        method: "POST",
        body: JSON.stringify({ name: collectionName }),
      });
      setCollectionOpen(false);
      setCollectionName("");
      await loadAux();
      navigate("library", d.collection.id);
    } catch (e) {
      setCollectionError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST" });
      setUser(null);
      setPapers([]);
      setSelected([]);
      setCollections([]);
      setConversations([]);
      setGraph(null);
      setActivePaper(null);
      setConversation(undefined);
      setChatScope([]);
      setView("library");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const currentCollection = collections.find((c) => c.id === collection);
  const visible = papers.filter(
    (p) =>
      filter === "all" ||
      (filter === "ready" ? p.status === "ready" : p.status !== "ready"),
  );
  const ready = papers.filter((p) => p.status === "ready");
  if (initial)
    return (
      <div className="boot">
        <span className="brand-symbol">
          <BookOpen size={24} />
        </span>
        <span>Opening your workspace</span>
        <Spinner />
      </div>
    );
  if (bootError)
    return (
      <main className="fatal-error">
        <AlertCircle size={32} />
        <h1>Your workspace is temporarily unavailable.</h1>
        <p>{bootError}</p>
        <button className="button primary" onClick={() => void loadSession()}>
          Try again
        </button>
      </main>
    );
  if (!user) return <AuthScreen onAuth={setUser} />;
  return (
    <div className="workspace">
      {mobile && (
        <button
          className="sidebar-scrim"
          onClick={() => setMobile(false)}
          aria-label="Close navigation"
        />
      )}
      <aside className={`sidebar ${mobile ? "is-open" : ""}`}>
        <a className="brand" href="/" aria-label="ResearchOS home">
          <span className="brand-symbol">
            <BookOpen size={20} />
          </span>
          ResearchOS
        </a>
        <div className="workspace-label">
          <span className="workspace-avatar">
            {user.name.charAt(0).toUpperCase()}
          </span>
          <div>
            <strong>Personal workspace</strong>
            <span>{user.name}</span>
            <span className="workspace-email" title={user.email}>
              {user.email}
            </span>
          </div>
        </div>
        <div className="nav-caption">WORKSPACE</div>
        <nav aria-label="Main navigation">
          <button
            className={`nav-item ${view === "library" && !collection ? "active" : ""}`}
            onClick={() => navigate("library")}
          >
            <Library size={18} />
            Library
          </button>
          <button
            className={`nav-item ${view === "chat" ? "active" : ""}`}
            onClick={() => navigate("chat")}
          >
            <MessagesSquare size={18} />
            Research chat
          </button>
          <button
            className={`nav-item ${view === "compare" ? "active" : ""}`}
            onClick={() => {
              setConversation(undefined);
              setChatScope(selected);
              navigate("compare");
            }}
          >
            <Columns3 size={18} />
            Compare papers
          </button>
          <button
            className={`nav-item ${view === "graph" ? "active" : ""}`}
            onClick={() => navigate("graph")}
          >
            <Network size={18} />
            Research graph
          </button>
        </nav>
        <div className="nav-caption">
          COLLECTIONS
          <button
            className="icon-button"
            aria-label="Create collection"
            onClick={() => setCollectionOpen(true)}
          >
            <Plus size={15} />
          </button>
        </div>
        <nav aria-label="Collections">
          {collections.map((c) => (
            <button
              key={c.id}
              className={`nav-item ${collection === c.id && view === "library" ? "active" : ""}`}
              onClick={() => navigate("library", c.id)}
            >
              <Folder size={17} />
              <span className="truncate">{c.name}</span>
              <span className="nav-count">{c.paper_count}</span>
            </button>
          ))}
          {!collections.length && (
            <button
              className="nav-item muted"
              onClick={() => setCollectionOpen(true)}
            >
              <Plus size={16} />
              New collection
            </button>
          )}
        </nav>
        {conversations.length > 0 && (
          <>
            <div className="nav-caption">RECENT CONVERSATIONS</div>
            <nav className="recent-chats" aria-label="Recent conversations">
              {conversations.map((c) => (
                <button
                  className="nav-item"
                  key={c.id}
                  onClick={() => {
                    setConversation(c.id);
                    setChatScope(c.paper_ids);
                    setView(c.mode);
                    setActivePaper(null);
                    setMobile(false);
                  }}
                >
                  <MessagesSquare size={15} />
                  <span className="truncate">{c.title}</span>
                </button>
              ))}
            </nav>
          </>
        )}
        <div className="sidebar-bottom">
          <div className="keyboard-hint">
            <span>Find in your library</span>
            <kbd>⌘ K</kbd>
          </div>
          <div className="account-row">
            <span className="account-avatar">
              {user.name.charAt(0).toUpperCase()}
            </span>
            <span className="truncate">{user.name}</span>
            <button
              className="icon-button"
              aria-label={dark ? "Use light theme" : "Use dark theme"}
              title="Toggle theme"
              onClick={theme}
            >
              {dark ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <button
              className="icon-button"
              aria-label="Sign out"
              title="Sign out"
              onClick={() => void logout()}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <span className="slash">/</span>
            <strong>
              {activePaper
                ? "Paper reader"
                : view === "library"
                  ? currentCollection?.name || "Library"
                  : view === "chat"
                    ? "Research chat"
                    : view === "compare"
                      ? "Compare papers"
                      : "Research graph"}
            </strong>
          </div>
          <button className="button small" onClick={() => setUploadOpen(true)}>
            <Plus size={15} />
            Add papers
          </button>
        </header>
        {error && (
          <div className="error-banner workspace-error" role="alert">
            <AlertCircle size={17} />
            <span>{error}</span>
            <button
              className="text-button"
              onClick={() => {
                void loadPapers();
                void loadAux();
              }}
            >
              Retry
            </button>
            <button
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => setError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {activePaper && (
          <PaperReader
            key={activePaper}
            id={activePaper}
            initialPage={page}
            documentInitially={readerDocument}
            collections={collections}
            onBack={() => setActivePaper(null)}
            onAsk={(id) => askPapers([id])}
            onChange={() => {
              void loadPapers();
              void loadAux();
            }}
            onDeleted={() => {
              setSelected((s) => s.filter((id) => id !== activePaper));
              setActivePaper(null);
              void loadPapers();
              void loadAux();
              notify("Paper deleted.");
            }}
          />
        )}
        <div hidden={!!activePaper}>
          {view === "library" ? (
            <section className="library-content">
              <div className="page-heading">
                <div>
                  <span className="eyebrow">YOUR RESEARCH, IN ONE PLACE</span>
                  <h1>
                    {currentCollection?.name || "Library"}
                    <span className="heading-count">{papers.length}</span>
                  </h1>
                  <p className="muted">
                    A little less searching. A little more discovery.
                  </p>
                </div>
                <button
                  className="button primary"
                  onClick={() => setUploadOpen(true)}
                >
                  <Upload size={17} />
                  Upload papers
                </button>
              </div>
              <div className="library-toolbar">
                <div className="search-field">
                  <Search size={18} />
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search papers, authors, or ideas…"
                    aria-label="Search papers"
                  />
                  {query ? (
                    <button
                      className="icon-button"
                      aria-label="Clear search"
                      onClick={() => setQuery("")}
                    >
                      <X size={14} />
                    </button>
                  ) : (
                    <kbd>⌘ K</kbd>
                  )}
                </div>
                <div
                  className="filter-tabs"
                  role="group"
                  aria-label="Paper status"
                >
                  {[
                    ["all", "All papers"],
                    ["ready", "Ready"],
                    ["processing", "Processing"],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      className={filter === id ? "selected" : ""}
                      onClick={() => setFilter(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {selected.length > 0 && (
                <div className="selection-toolbar">
                  <span>
                    <Check size={16} />
                    {selected.length} selected
                  </span>
                  <div>
                    <button
                      className="text-button"
                      onClick={() => askPapers(selected)}
                    >
                      <MessagesSquare size={16} />
                      Ask a question
                    </button>
                    <button
                      className="button small primary"
                      disabled={selected.length < 2 || selected.length > 8}
                      onClick={() => askPapers(selected, true)}
                    >
                      <Columns3 size={16} />
                      Compare
                    </button>
                    <button
                      className="icon-button"
                      aria-label="Clear selection"
                      onClick={() => setSelected([])}
                    >
                      <X size={17} />
                    </button>
                  </div>
                </div>
              )}
              {loading ? (
                <Skeleton />
              ) : !papers.length ? (
                <Empty
                  icon={<BookOpen size={36} strokeWidth={1.2} />}
                  title={
                    query ? "No papers found" : "Make room for your next idea."
                  }
                  description={
                    query
                      ? "Try a different title, author, topic, or phrase."
                      : "Add your first paper. ResearchOS will organize the details, surface the key ideas, and help you ask better questions."
                  }
                  action={
                    <button
                      className="button primary"
                      onClick={() =>
                        query ? setQuery("") : setUploadOpen(true)
                      }
                    >
                      {query ? "Clear search" : "Upload your first paper"}
                      <ArrowUpRight size={17} />
                    </button>
                  }
                />
              ) : !visible.length ? (
                <Empty
                  icon={<SlidersHorizontal size={30} />}
                  title="No papers in this view"
                  description="Try another filter to see more of your library."
                  action={
                    <button className="button" onClick={() => setFilter("all")}>
                      Show all papers
                    </button>
                  }
                />
              ) : (
                <div className="paper-list">
                  <div className="list-heading">
                    <span>PAPER</span>
                    <span>STATUS</span>
                    <span>ADDED</span>
                  </div>
                  {visible.map((p) => (
                    <div
                      className={`paper-row ${selected.includes(p.id) ? "is-selected" : ""}`}
                      key={p.id}
                    >
                      <div className="paper-main">
                        <input
                          type="checkbox"
                          aria-label={`Select ${p.title}`}
                          checked={selected.includes(p.id)}
                          disabled={p.status !== "ready"}
                          onChange={(e) =>
                            setSelected((s) =>
                              e.target.checked
                                ? [...s, p.id]
                                : s.filter((id) => id !== p.id),
                            )
                          }
                        />
                        <button
                          className="paper-cover"
                          tabIndex={-1}
                          aria-label={`Open ${p.title}`}
                          onClick={() => openPaper(p.id)}
                        >
                          <FileText size={25} strokeWidth={1.3} />
                          <span>PDF</span>
                        </button>
                        <div className="paper-text">
                          <button
                            className="paper-title"
                            onClick={() => openPaper(p.id)}
                          >
                            {p.title}
                          </button>
                          <p>
                            {p.authors.length
                              ? p.authors.slice(0, 3).join(", ")
                              : p.filename}
                            {p.year && (
                              <>
                                <span className="meta-dot">·</span>
                                {p.year}
                              </>
                            )}
                            {p.page_count && (
                              <>
                                <span className="meta-dot">·</span>
                                {p.page_count} pages
                              </>
                            )}
                          </p>
                          {p.tags.length > 0 && (
                            <div className="tags">
                              {p.tags.slice(0, 4).map((tag) => (
                                <button
                                  key={tag}
                                  className="tag"
                                  onClick={() => setQuery(tag)}
                                >
                                  {tag}
                                </button>
                              ))}
                            </div>
                          )}
                          {p.status === "failed" && (
                            <span className="paper-error">
                              {p.error ||
                                "Processing failed. Open this paper to retry."}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className={`status status-${p.status}`}>
                        {p.status === "queued" || p.status === "processing" ? (
                          <Spinner />
                        ) : p.status === "ready" ? (
                          <Check size={13} />
                        ) : (
                          <AlertCircle size={13} />
                        )}{" "}
                        {p.status === "ready"
                          ? "Ready"
                          : p.status === "queued"
                            ? "Queued"
                            : p.status === "processing"
                              ? "Processing"
                              : "Needs attention"}
                      </span>
                      <span className="paper-date">
                        {new Date(p.created_at).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="library-footer">
                <span>
                  {papers.length
                    ? `${ready.length} papers ready to explore`
                    : "Your library starts with a single paper."}
                </span>
                <span>PDF files · Up to 20 MB each</span>
              </div>
            </section>
          ) : view === "graph" ? (
            <section className="graph-page">
              <div className="page-heading">
                <div>
                  <span className="eyebrow">SEE THE CONNECTIONS</span>
                  <h1>Research graph</h1>
                  <p className="muted">
                    Explore shared topics and similarities across your papers.
                  </p>
                </div>
              </div>
              {graphLoading && !graph ? (
                <Skeleton />
              ) : graph ? (
                <ResearchGraph data={graph} onOpen={openPaper} />
              ) : (
                <Empty
                  icon={<Network size={30} />}
                  title="Graph unavailable"
                  description="Your graph will appear once the connection is restored."
                />
              )}
            </section>
          ) : (
            <ResearchChat
              key={conversation || `${view}-${chatScope.join(",")}`}
              mode={view === "compare" ? "compare" : "chat"}
              conversationId={conversation}
              initialPaperIds={chatScope}
              papers={chatPapers}
              onOpenPaper={openPaper}
              onSaved={() => void loadAux()}
            />
          )}
        </div>
      </main>
      <Modal
        open={uploadOpen}
        onOpenChange={(o) => {
          if (!uploading) setUploadOpen(o);
        }}
        title="Add to your library"
        description="Upload a PDF. We’ll find the key ideas and make the paper searchable."
      >
        <div
          className={`upload-zone ${dragging ? "dragging" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!uploading) void upload(e.dataTransfer.files);
          }}
        >
          <span className="upload-icon">
            {uploading ? <Spinner /> : <Upload size={27} strokeWidth={1.5} />}
          </span>
          <h3>{uploading ? "Adding your papers…" : "Drop your papers here"}</h3>
          <p>PDF files, up to 20 MB each</p>
          <button
            className="button"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            Choose files
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="application/pdf,.pdf"
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => void upload(e.target.files)}
          />
        </div>
        {uploadError && (
          <p className="error-banner" role="alert">
            {uploadError}
          </p>
        )}
        <div className="upload-note">
          <BookOpen size={17} />
          <p>
            Text-based PDFs work best. Scanned documents need a text layer
            before they can be analyzed.
          </p>
        </div>
        <p className="privacy-copy">
          To create summaries and answers, excerpts are sent to your workspace’s
          configured AI provider.
        </p>
      </Modal>
      <Modal
        open={collectionOpen}
        onOpenChange={setCollectionOpen}
        title="New collection"
        description="Give a project, topic, or reading list a home."
      >
        <form onSubmit={addCollection}>
          <label>
            Collection name
            <input
              autoFocus
              required
              maxLength={80}
              placeholder="e.g. Efficient language models"
              value={collectionName}
              onChange={(e) => setCollectionName(e.target.value)}
            />
          </label>
          {collectionError && (
            <p className="error-banner" role="alert">
              {collectionError}
            </p>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              className="button"
              onClick={() => setCollectionOpen(false)}
            >
              Cancel
            </button>
            <button className="button primary" disabled={saving}>
              {saving ? <Spinner /> : "Create collection"}
            </button>
          </div>
        </form>
      </Modal>
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}
