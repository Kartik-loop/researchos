# Verification record

Verified during implementation, with the final handoff on 2026-10-02.

## Passed

- TypeScript strict typecheck and Next.js production build. All application routes compile.
- 40 automated tests across six suites: real PDF text/page extraction, chunk boundaries, analysis validation, hybrid retrieval and tenant filtering, embedding compatibility, worker retries and expired leases, delete-during-ingestion safety, edited-title preservation, citation filtering, streaming completion/error persistence, idempotency, HTTP safeguards and upload bounds.
- HTTP integration checks against the running application and a persistent local PostgreSQL-compatible PGlite/pgvector database: registration and cookie authentication; multipart upload and deduplication; private PDF download; cross-account denial; collection membership and filtering; origin checks; retry; graph; conversation ownership; deletion and cascading cleanup.
- Production-build browser checks: registration into an empty library, collection creation and light/dark switching. The temporary browser-verification account was removed afterward.
- Production dependency audit after upgrading PDF.js to a patched release: zero reported vulnerabilities at the time of the check.

## Boundaries

- AI provider credentials were absent. Automated provider responses are test fixtures only; the application has no mock provider or fake library. Real-provider ingestion, streaming answer quality, and multi-paper comparison quality have **not** been live-verified.
- Pipeline tests use isolated actual PostgreSQL/pgvector via PGlite with controlled provider calls. They do not establish multi-process locking or load behavior on a full PostgreSQL deployment.
- Docker/Compose configuration was statically checked but not executed because Docker was unavailable.
- Responsive styles, keyboard interactions, upload dialogs, and the interactive graph are implemented. Exhaustive mobile, assistive-technology and browser coverage has not been performed.
- This verification is not a penetration test, security certification or production load test.

## Repeat locally

Run `npm run typecheck`, `npm test`, and `npm run build`. For HTTP checks, start the database and web app, stop the ingestion worker, and run `npm run test:integration`. That test creates and removes its own accounts; use a dedicated development/test database. Configure a live AI provider and follow the deployment guide's smoke checks before relying on generated research output.
