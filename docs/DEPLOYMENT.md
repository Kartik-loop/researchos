# Deploying ResearchOS

ResearchOS runs as a long-lived Node web process, a separately supervised ingestion worker, and PostgreSQL with pgvector. Deploy the tested commit and lockfile as one release. An API key with access to the configured embedding and chat models is needed for the AI flows. No credentials are bundled.

## Recommended shape

Use a container/VM platform for the web and worker, a managed PostgreSQL 16/17 database with pgvector, and an HTTPS reverse proxy. The web process requires streaming support and requests lasting up to 175 seconds. The worker continuously polls durable jobs and must outlive individual web requests. If a serverless frontend is used, host this worker independently and verify the platform's request duration, upload body and streaming limits against the application.

The included multi-stage [Dockerfile](../Dockerfile) builds a standalone Next.js app image and a TypeScript worker/migration image. Both run as the non-root `node` user. The worker image intentionally includes development dependencies because `tsx` is the runtime for its TypeScript entry points. Build-time context excludes secrets and local databases. At deployment, inject secrets through the platform's secret store.

The [Compose configuration](../compose.yaml) is a usable single-host development/staging setup: pgvector PostgreSQL 17, an initial migration, app and worker, a persistent database volume, dropped app/worker Linux capabilities, and loopback-only web exposure. It does not provision HTTPS, backups, a production secret manager, high availability or observability.

## First deployment

1. Provision PostgreSQL and confirm `CREATE EXTENSION vector` is available. Take the extension name and version from your database provider's support matrix. Create a migration role with DDL permission and a separate runtime role with only the application table privileges it needs. The supplied Compose bootstrap account is suitable for local setup; a production runtime should not use that database superuser.
2. Configure `APP_URL` to the final public **HTTPS** origin. Set `DATABASE_URL`, `DATABASE_SSL=true` for remote managed PostgreSQL, a pool size that fits all replicas, the AI key/endpoint/model variables, and registration policy. Ensure Node trusts the database's certificate chain; never disable certificate verification to make a failed TLS connection pass.
3. Build `app` and `worker` targets from the same commit. Run migration once with the migration role and the worker image command `node --import tsx scripts/migrate.ts`. Migrations are ordered, recorded in `schema_migrations`, transactional, and serialized by an advisory lock. Do not edit already-applied migrations.
4. Start the app with `node server.js` from its standalone image. Start the independent worker with `node --import tsx worker/index.ts`. Both need the same database and AI configuration. Run each behind a restart policy and capture stdout/stderr without secrets.
5. Route HTTPS to app port 3000, preserve the browser's `Origin`, disable response buffering and caching on `/api/chat`, and permit at least three minutes for chat. Permit multipart uploads slightly over 20 MiB for form overhead; the application enforces the 20 MiB file bound itself.
6. Check `/api/health`, create the intended accounts, and complete the real-provider smoke test below. If the deployment is private, set `ALLOW_REGISTRATION=false` after provisioning and restart the web service. Registration has no invitation/admin provisioning flow yet.

The runtime role needs SELECT/INSERT/UPDATE/DELETE on the application tables. Users have UUID primary keys rather than sequence-generated IDs. The migration role should own the schema and tables. For future migrations, arrange default privileges for the runtime role. Restrict database network ingress to the app, worker and trusted administration paths.

## Single-host Compose commands

From the application directory, copy `.env.example` to `.env.local`, set the AI configuration, and add `POSTGRES_PASSWORD` using a new random hex string (generate one with `openssl rand -hex 32`). Compose requires it explicitly and supplies no password default. Its connection URL uses that string directly, so stick to hex or another URL-safe value. Keep `APP_URL=http://localhost:3000` for local testing; use your actual HTTPS origin behind a configured production proxy.

```sh
docker compose --env-file .env.local up --build -d
docker compose --env-file .env.local ps
docker compose --env-file .env.local logs --tail 100 app worker migrate
```

The host port is `127.0.0.1:3000`; PostgreSQL is accessible only inside the Compose network. Connect a host reverse proxy to the loopback web port or configure an intentional proxy service. Never expose the PGlite development socket to provide production database access.

Compose sets `DATABASE_URL` for its `db` service and `DATABASE_SSL=false` for that private local network, overriding values from `env_file`. For a managed remote database, deploy the images with the managed connection settings instead of this bundled database topology. Container entry points read injected environment directly; no `.env.local` is copied into the image.

To stop the stack while retaining research data:

```sh
docker compose --env-file .env.local down
```

Do not add `--volumes` or remove `postgres-data` unless data deletion is intended. Changing `POSTGRES_PASSWORD` in the file does not change the password of an already-initialized database; rotate the role password through PostgreSQL and update all dependent secrets together.

## Updates and rollback

Back up the database and verify the release in staging. Build both targets, run migrations as a controlled release step, then deploy app and worker. For the supplied single-host Compose topology, this sequence introduces brief downtime and ensures the migration runs again for a new release:

```sh
docker compose --env-file .env.local build
docker compose --env-file .env.local stop app worker
docker compose --env-file .env.local run --rm migrate
docker compose --env-file .env.local up -d app worker
```

Migration failure must stop the release. SQL down-migrations are not supplied. Prefer additive migrations that allow the previous app image to run; otherwise restore a tested backup as part of a planned recovery. Do not run multiple database engines against the same data directory or reuse a PG17 data volume with an incompatible PostgreSQL major version.

Pin deployment images to immutable digests in your release system, update dependencies regularly, and record the migration level with the app release. The convenience Docker tags are intentionally readable, but are not immutable release identifiers.

## Health, performance and recovery

`GET /api/health` checks database connectivity, the vector extension, and core tables. It returns 503 when database readiness fails, or 200 with `status: "degraded"` if no AI key is configured. `ai_configured: true` checks presence only; it does not verify the key, credits, model access, network reachability or worker progress. Do not interpret a green HTTP probe as an AI end-to-end test.

Monitor worker logs, job age, retries and failures, streaming error rates, latency, provider token/cost usage, database storage and pool saturation. Workers claim one job at a time; multiple workers can run with `FOR UPDATE SKIP LOCKED` and fenced leases. Account for every process when sizing database connections. Worker shutdown aborts current work and permits safe retry. An ungraceful exit is recoverable after the lease expires.

Set resource limits after measuring representative PDFs. Extraction of up to 300 pages and 1,600 chunks requires more memory than a static frontend. Add a dedicated worker heartbeat and workload-specific alerts before unattended operation at scale. Application rate limits are persisted in PostgreSQL; add trusted edge-level abuse controls for public traffic.

Schedule cleanup of expired rows in `sessions` and `rate_limits`; the current release checks expiry but does not run periodic cleanup. Run maintenance with an appropriate database role and avoid deleting active entries. Track retained conversations and source excerpts when defining data-retention policies.

## Backup and storage

Back up PostgreSQL with encrypted, off-host retention and test restoration. The database currently contains everything durable: account/password hashes, PDF bytes, chunks/vectors, analysis, conversations and citations. Provider keys remain in the deployment secret store and need their own recovery procedure. Prefer managed snapshots and point-in-time recovery for production.

For a local Compose logical backup, this command writes a PostgreSQL custom-format archive to the current directory:

```sh
docker compose --env-file .env.local exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > researchos-backup.dump
```

Treat that archive as sensitive. Restore first to an isolated test database with pgvector installed and verify account login, file download, retrieval and conversation history. Never test destructive restore commands against the only copy of research data.

At larger scale, introduce a private object-storage adapter with authorized reads and transactional/outbox coordination for upload/delete, then migrate PDF blobs deliberately. The current implementation has no object-storage credentials or unused adapter configuration to set.

## Release smoke test

Run automated tests against a separate database and the intended Node/PostgreSQL versions. Use dedicated test accounts and actual text-based PDFs to check:

1. Registration/login/logout, refresh persistence and denied access from a second account.
2. Upload, duplicate detection, worker processing, eight analysis fields and PDF download.
3. Tags, collection assignment, search, deletion and persistence across service restarts.
4. Streaming chat with a known-answer question, valid page links, cancellation and reopening history.
5. Two-paper comparison covering all seven dimensions, both papers cited, absent facts identified.
6. Graph nodes, tag/similarity edges, pan/zoom, and narrow-screen/light/dark appearance.
7. Missing/invalid provider credentials, temporary database loss, malformed PDFs and worker restart behavior.

A controlled provider fixture verifies pipeline behavior but not real model answer quality. A build or passing unit suite is likewise not a substitute for the live-provider test. Record the tested commit, provider/model configuration and test evidence with each release.

## Remaining production work

The implementation provides authenticated ownership checks, hashed session tokens, scrypt passwords, Origin enforcement, request validation and limits, private file reads, database-backed rate limits and bounded retrieval. A public deployment still warrants an independent security review and load testing for its traffic and data sensitivity.

The current content security policy permits inline scripts/styles and `unsafe-eval` for framework compatibility. Review and implement a nonce-based production policy before making stronger CSP claims. HTTPS transport is required for Secure cookies; `APP_URL` must accurately reflect that public origin. See the [Next.js cookie documentation](https://nextjs.org/docs/app/api-reference/functions/cookies) for cookie options.

Plan email verification/password recovery, MFA/SSO, account deletion/export, retention and audit logs if needed by the audience. Add OCR, malware scanning/quarantine, bibliography extraction and scientific table extraction as separate capabilities. The graph currently represents shared tags and semantic similarity, not bibliographic citations. For large libraries, benchmark tenant-scoped approximate vector indexes and graph batching rather than assuming the exact-search queries scale unchanged; see [pgvector indexing guidance](https://github.com/pgvector/pgvector#Indexing).

Keep embedding configurations stable per indexed corpus. Replacing the provider or embedding model requires reindexing; the current UI handles this by deleting and re-uploading the PDF. Changing the chat model also requires fresh output and citation evaluations. The adapter contract is documented with the [OpenAI embeddings](https://developers.openai.com/api/docs/guides/embeddings) and [streaming](https://developers.openai.com/api/docs/guides/streaming-responses) references; an OpenAI-compatible endpoint must be tested for the specific options the code sends.
