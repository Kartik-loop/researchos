# ResearchOS architecture (pre-implementation design)

ResearchOS is a Next.js App Router application, a PostgreSQL database with pgvector, and an independent Node ingestion worker. React components consume authenticated JSON endpoints and SSE chat streams. Route handlers validate input and delegate domain work to server modules. No browser calls an AI provider directly.

## Database

`db/migrations/001_initial.sql` defines the complete initial schema before implementation. Users own papers, collections, conversations, and messages. Composite foreign keys enforce ownership of collection memberships and chunks. Sessions contain hashes of opaque tokens. PDF bytes are private PostgreSQL bytea values: transactional upload/delete with a 20 MB bound; move the storage adapter to private object storage for large installations. Page-level overlapping chunks use 1536-dimensional pgvector embeddings and full-text indexes. Exact vector search preserves tenant-filtered recall; add and benchmark tenant-aware approximate indexes when scaling. Jobs have fenced, renewable leases, retries, and visible failure states. Messages persist source mappings and stream status.

## API contracts

- `POST /api/auth/register` `{name,email,password}`, `POST /api/auth/login` `{email,password}`, `POST /api/auth/logout`, `GET /api/auth/me` → `{user}`.
- `GET /api/papers?q=&collection=&tag=` → `{papers}`; `POST /api/papers` multipart `file` → `{paper}` (202).
- `GET /api/papers/:id` → `{paper}`; `PATCH` `{title?,tags?,collection_ids?}`; `DELETE`; `GET /api/papers/:id/file`; `POST /api/papers/:id/retry`.
- `GET /api/collections` → `{collections}`; `POST` `{name}` → `{collection}`; `DELETE /api/collections/:id`.
- `GET /api/conversations` → `{conversations}`; `GET /api/conversations/:id` → `{conversation,messages}`; `DELETE`.
- `POST /api/chat` `{message,paper_ids,mode,conversation_id?,request_id}` → SSE `meta` `{conversation_id,message_id,citations}`, `delta` `{text}`, `done` `{message_id}`, or `error` `{error}`.
- `GET /api/graph` → `{nodes,edges}`; `GET /api/health` → operational readiness without secrets.

All non-public routes resolve the user from an HttpOnly session, all mutations enforce Origin, and all queries restrict ownership. Errors use `{error,code?}` and appropriate HTTP status. Chat context is bounded retrieval, separately per selected paper for comparisons, with immutable page-aware source mappings. Retrieved paper text is untrusted evidence, never system instructions.

## Ingestion and AI

The worker claims a job using `FOR UPDATE SKIP LOCKED`, extracts PDF text with page indices, chunks with overlap, requests embeddings in bounded batches, and constructs analysis from bounded evidence covering the paper. It publishes chunks, analysis, and readiness atomically only if its lease still belongs to it. Unsupported/scanned PDFs and provider failures surface recoverable errors. Embedding model metadata prevents retrieval across incompatible embeddings. The provider adapter supports OpenAI-compatible embeddings and streaming chat, with explicit environment configuration and no fake fallback.

## Frontend and folder structure

`app/`: Next.js pages, global styles, layouts and thin API routes. `components/`: workspace shell, authentication, library, upload dialog, paper reader, research chat, comparison, graph and reusable accessible dialogs. `server/`: database, sessions, validation, AI, retrieval, storage and domain services. `worker/`: separate polling process and ingestion jobs. `db/migrations/`: versioned SQL. `scripts/`: migration/development helpers. `tests/`: security, pipeline, streaming and integration verification. `docs/`: operational and design documentation.

The visual direction is a restrained research desk: translucent narrow sidebar, graphite typography, cool neutral surfaces, a single blue action color, list-oriented library, spacious reader and source-aware conversation. Empty, loading, error, light/dark and narrow-screen states are first-class. Keyboard shortcuts are Cmd/Ctrl+K (search), Cmd/Ctrl+U (upload), Escape (dialogs), and Enter (send; Shift+Enter for newline).
