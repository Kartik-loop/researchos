# ResearchOS

[![CI](https://github.com/Kartik-loop/researchos/actions/workflows/ci.yml/badge.svg)](https://github.com/Kartik-loop/researchos/actions/workflows/ci.yml)

[Local setup](#quick-start-local-development) · [API reference](docs/API.md) · [Deployment](docs/DEPLOYMENT.md) · [Free hosting](docs/FREE-HOSTING.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

A private research workspace for PDF papers: a searchable library, collections and tags, page-linked analysis, streaming research conversations, structured comparisons, and an interactive relationship graph. The application starts empty. Papers, accounts, processing state and conversations are backed by a database; no sample results stand in for functionality.

Email verification and password recovery use the Gmail API. See [account security setup](docs/ACCOUNT-SECURITY.md) for credentials, safe rollout, and database maintenance. Verification stays optional until `EMAIL_VERIFICATION_REQUIRED=true`.

## Architecture

ResearchOS has three running services: a **Next.js 16 / React 19** application, **PostgreSQL with pgvector**, and an independent **TypeScript ingestion worker**. The UI calls authenticated HTTP endpoints; only the server and worker access the AI provider. A one-shot migration command prepares the database before services start.

```text
Browser ── JSON / streaming SSE ── Next.js API ── PostgreSQL + pgvector
                                      │                  ▲
                                      │                  │ durable jobs
                                      ▼                  │
                                  AI provider ◀── PDF ingestion worker
```

The [pre-implementation architecture](docs/ARCHITECTURE.md), [database migration](db/migrations/001_initial.sql), and [API reference](docs/API.md) define the main contracts. The database stores users, hashed sessions, papers and PDF bytes, page chunks and vectors, leased processing jobs, collections and memberships, conversations and messages, and rate limits. Ownership is checked in every domain query; composite foreign keys protect cross-account memberships and chunks.

PDF uploads are stored transactionally with a processing job. The worker extracts page text, creates overlapping chunks, requests 1,536-dimensional embeddings, retrieves evidence for eight analysis fields, and publishes the result atomically. Renewable, fenced leases prevent an expired worker from publishing stale work. Transient failures retry; unreadable papers show a recoverable error.

Chat combines exact vector search with PostgreSQL full-text search using reciprocal-rank fusion. Comparisons retrieve evidence separately for every selected paper and for seven requested dimensions. The model receives bounded excerpts and recent conversation context. Citations retain the paper, page, available section and source excerpt. Answers stream over server-sent events and persist to the database, including interrupted status.

| Folder           | Responsibility                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| `app/`           | Next.js shell, global styles, error boundaries, thin API route handlers                          |
| `components/`    | Workspace/library, authentication, paper reader, chat/comparison, graph and dialogs              |
| `server/`        | Database access, authentication, validation, paper services, AI adapter, retrieval and ingestion |
| `worker/`        | Independent job polling process and graceful shutdown                                            |
| `db/migrations/` | Ordered, transactional SQL migrations                                                            |
| `scripts/`       | Migration runner and persistent local development database                                       |
| `tests/`         | Unit, pipeline and HTTP integration verification                                                 |
| `docs/`          | Architecture, API contracts and deployment operations                                            |

## Quick start: local development

Requires Node.js **22.13 or newer** and npm. Commands below run from this `researchos` directory.

```sh
npm ci
cp .env.example .env.local
```

Edit `.env.local`:

```dotenv
APP_URL=http://localhost:3000
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/postgres
DATABASE_SSL=false
DB_POOL_SIZE=5
AI_API_KEY=your-provider-key
AI_BASE_URL=https://api.openai.com/v1
AI_CHAT_MODEL=gpt-4.1-mini
AI_EMBEDDING_MODEL=text-embedding-3-small
ALLOW_REGISTRATION=true
```

For Gemini, use your Google AI Studio key as `AI_API_KEY` and replace the three provider settings above:

```dotenv
AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
AI_CHAT_MODEL=gemini-3.8-flash
AI_EMBEDDING_MODEL=gemini-embedding-001
```

Restart both the web app and ingestion worker after changing provider settings. Existing papers indexed with another embedding model need re-ingestion (delete and re-upload); failed papers can use Retry. Provider access and free-tier quotas depend on your Google project.

Start the development database in one terminal:

```sh
npm run db:local
```

This runs PGlite with pgvector on `127.0.0.1:54329` and persists its data under `.local/postgres`. It is a convenient development database, **not a production PostgreSQL server**. Its socket does not enforce authentication. Keep it on loopback and do not expose or port-forward it. The URL's development credentials are placeholders for this local socket.

In a second terminal, migrate once and start the web app:

```sh
npm run db:migrate
npm run dev
```

In a third terminal, start ingestion:

```sh
npm run worker
```

Open [localhost:3000](http://localhost:3000), create an account with a password of at least 12 characters, and upload a text-based PDF. Keep all three processes running. Library management and authentication work without an AI key; analysis, embeddings and chat require a valid key and provider access. Processing failures are visible and can be retried after configuration is fixed. Restart the app and worker when changing environment variables.

## Full PostgreSQL with Docker

Requires Docker Engine/Desktop with Compose v2. Copy `.env.example` to `.env.local` if you have not already. Add a new random, URL-safe database password as `POSTGRES_PASSWORD`; for example, generate one with `openssl rand -hex 32`. Set `AI_API_KEY` and keep `APP_URL=http://localhost:3000` for local use.

```sh
docker compose --env-file .env.local up --build -d
docker compose --env-file .env.local ps
docker compose --env-file .env.local logs -f worker
```

Compose starts PostgreSQL 17 with pgvector, waits for database readiness, completes migrations, then starts the web app and worker. It overrides `DATABASE_URL` to use its private `db` service. No database port is published; the web app binds to host loopback. The named `postgres-data` volume survives normal container restarts and `docker compose down`. Do not remove that volume if you need the stored research.

For an existing PostgreSQL 16/17 server, install pgvector, create a database and role, set `DATABASE_URL`, and run `npm run db:migrate`. The migration role must be allowed to enable `vector`, or an administrator must enable the extension first. No Redis or separate vector service is required. See [deployment operations](docs/DEPLOYMENT.md) for runtime roles, TLS, backup, and upgrades.

## Environment variables

Next.js loads `.env.local`. The local migration and worker scripts explicitly load that file. Container commands instead consume injected environment variables directly. Secrets are excluded from source control and Docker build context.

| Variable                       | Default / requirement                                                  | Purpose                                                                                                              |
| ------------------------------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `APP_URL`                      | `http://localhost:3000` for development; set explicitly for deployment | Exact browser origin for mutation checks and HTTPS session-cookie policy; use your public HTTPS origin in production |
| `DATABASE_URL`                 | Required                                                               | PostgreSQL connection string; URL-encode special characters in credentials                                           |
| `DATABASE_SSL`                 | `false`                                                                | Set `true` to require database TLS with certificate verification; install the provider CA when necessary             |
| `DB_POOL_SIZE`                 | `10`                                                                   | Maximum connections per app/worker process; budget for every replica                                                 |
| `AI_API_KEY`                   | Required for AI operations                                             | Server-side provider key; never expose with a `NEXT_PUBLIC_` prefix                                                  |
| `OPENAI_API_KEY`               | Optional fallback                                                      | Used when `AI_API_KEY` is unset                                                                                      |
| `AI_BASE_URL`                  | `https://api.openai.com/v1`                                            | OpenAI-compatible API endpoint                                                                                       |
| `AI_CHAT_MODEL`                | `gpt-4.1-mini`                                                         | Must support chat completions, streaming, JSON-object output and the completion token parameter used by the adapter  |
| `AI_EMBEDDING_MODEL`           | `text-embedding-3-small`                                               | Must accept `dimensions: 1536` and return 1,536 finite values per vector                                             |
| `ALLOW_REGISTRATION`           | Enabled unless exactly `false`                                         | Close public account creation after provisioning users                                                               |
| `POSTGRES_PASSWORD`            | Required by Compose; no default                                        | Initial database password; use a random hex value with the supplied Compose URL interpolation                        |
| `POSTGRES_USER`, `POSTGRES_DB` | `researchos` in Compose                                                | Compose database bootstrap identity and database name                                                                |
| `APP_PORT`                     | `3000` in Compose                                                      | Host loopback port; update `APP_URL` to match if changed                                                             |

The provider abstraction is in `server/ai.ts`. Uploaded text is sent to the configured provider for embeddings and analysis; retrieved excerpts are sent for chat. Review that provider's data policy for your papers. Changing embedding provider, endpoint or model changes the stored index identity. Existing papers need matching configuration or reindexing; the current UI requires deleting and re-uploading them to reindex. Save PDFs first if necessary.

OpenAI documents the supported embedding dimensions in its [embeddings guide](https://developers.openai.com/api/docs/guides/embeddings), and incremental chat completion output in its [streaming guide](https://developers.openai.com/api/docs/guides/streaming-responses). Provider compatibility must be tested against the chosen endpoint.

## Using the workspace

1. Upload a PDF and watch its queued/processing/ready state. Open it for metadata, the original document, and eight analysis fields: summary, contributions, methodology, datasets, model, results, limitations and future work.
2. Add tags or collection assignments in the paper reader. Search titles, authors, tags and extracted content from the library.
3. Ask a question about selected papers or your ready library. Open numbered source references to inspect the cited paper and page.
4. Select two to eight ready papers and choose **Compare** for a table of problem, dataset, method, architecture, results, limitations and computational requirements.
5. Use the graph to inspect relationships based on shared tags or semantic similarity. Pan the canvas, use the zoom controls, or Ctrl/Cmd+scroll to zoom. Select a node to inspect and open its paper.

Keyboard shortcuts: Cmd/Ctrl+K focuses search, Cmd/Ctrl+U opens upload, Escape closes dialogs, and Enter sends chat (Shift+Enter adds a newline). Light/dark appearance, responsive layouts, loading skeletons and empty/error states are included.

## Build and verification

```sh
npm run typecheck
npm test
npm run build
npm start
```

The worker remains a separate process in a production build. API integration tests require a running app, matching `.env.local`, and a **dedicated test database**. See [API verification](docs/API.md#verification). Stop ingestion workers when running the HTTP security test because it inspects intermediate queue state:

```sh
npm run test:integration
```

Tests use synthetic, explicitly identified fixtures and controlled provider responses to verify behavior. They are not content shown in the product. Automated checks do not establish answer quality against a live provider. Before relying on research output, run a real PDF through ingestion, ask a known-answer question, verify its page citation, compare two papers, restart the services, and confirm the stored paper and conversation return.

## Current limits

- PDFs: 20 MiB each, 300 pages, and at most 1,600 extracted chunks. Accounts: 1,000 papers or 500 MiB, 100 collections. The upload receive deadline is 30 seconds. Password-protected, scanned/image-only and malformed PDFs may fail; OCR is not implemented. Tables, equations, columns and section headings can extract imperfectly. Metadata depends on PDF metadata; publication year enrichment is not implemented.
- Analysis and answers cover retrieved evidence, not exhaustive document review. Valid source labels and page bounds are checked, but a citation does not mathematically prove that a claim is entailed. Model mistakes and retrieval omissions remain possible. No live-key AI quality certification is supplied.
- Search uses English text analysis plus metadata matching. Vector search is exact and suited to modest libraries; large deployments need measured indexing and query work. The graph shows the newest 100 papers and up to 200 edges of each relationship type. It does not extract bibliographic citation edges.
- Authentication uses scrypt passwords and 30-day opaque, hashed sessions with HttpOnly/SameSite cookies; HTTPS enables Secure cookies. Email verification, password reset, MFA, SSO, shared workspaces, account deletion and an administrative console are not implemented.
- PDF bytes live in PostgreSQL for transactional durability. Large installations should move them behind a private object-storage adapter. There is no antivirus/quarantine pipeline, OCR worker, export workflow or dedicated worker health endpoint.
- This is a deployable implementation, not an independent security audit or load certification. The supplied Docker configuration is a local/single-host starting point. See the [production deployment guide](docs/DEPLOYMENT.md) before public operation.

## Troubleshooting

| Symptom                                            | Check                                                                                          |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Database unavailable / HTTP 503                    | Database process, `DATABASE_URL`, extension and completed migration; use `/api/health`         |
| Mutation rejected with origin error                | Browser origin exactly matches `APP_URL`, including scheme and port                            |
| Paper stays queued                                 | Worker is running against the same database and its logs show successful connection            |
| Paper fails with AI configuration/credential error | Set a valid server-side key, check model access and credits, restart app/worker, and retry     |
| Chat reports incompatible embeddings               | Restore the original embedding configuration or reindex by deleting and re-uploading papers    |
| Chat appears all at once behind a proxy            | Disable proxy buffering/caching for SSE and allow a request duration of at least three minutes |

For the session API details see [Next.js cookies](https://nextjs.org/docs/app/api-reference/functions/cookies). For extension installation, vector operators and approximate-index tradeoffs see the [pgvector project documentation](https://github.com/pgvector/pgvector).
