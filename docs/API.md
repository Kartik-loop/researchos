# ResearchOS HTTP API

All application endpoints use the authenticated `researchos_session` HttpOnly cookie. Send mutations from the configured `APP_URL` origin. Responses use JSON and `Cache-Control: no-store`; successful deletions return `204` with no body. Error responses have `{ "error": "Actionable message", "code": "OPTIONAL_CODE" }`.

| Endpoint | Request | Response |
| --- | --- | --- |
| `GET /api/papers` | Optional `q`, `tag`, `collection` query parameters | `{papers}` with metadata, processing state, and collection IDs; detailed analysis loads on the detail endpoint |
| `POST /api/papers` | Multipart form with exactly one `file` | `202 {paper}` after durable storage and ingestion queueing |
| `GET /api/papers/:id` | — | `{paper}` |
| `PATCH /api/papers/:id` | Any of `{title,tags,collection_ids}` | `{paper}`; collection assignments replace the previous set |
| `DELETE /api/papers/:id` | — | `204`; deletes PDF, chunks, collection memberships, and ingestion job |
| `GET /api/papers/:id/file` | — | Authenticated inline PDF |
| `POST /api/papers/:id/retry` | — | `202 {paper}` for failed papers only |
| `GET /api/collections` | — | `{collections}` including `paper_count` |
| `POST /api/collections` | `{name}` | `201 {collection}` |
| `DELETE /api/collections/:id` | — | `204`; member papers remain in the library |
| `GET /api/conversations` | — | `{conversations}`; latest 100 conversations |
| `GET /api/conversations/:id` | — | `{conversation,messages}` in chronological order |
| `DELETE /api/conversations/:id` | — | `204`; includes message deletion |
| `GET /api/graph` | — | `{nodes,edges}` for the latest 100 papers |
| `GET /api/health` | Public endpoint | `{status,database,ai_configured}`; database outage returns `503` |

See [ARCHITECTURE.md](./ARCHITECTURE.md) for authentication and streaming chat contracts.

## Upload and library limits

PDF uploads have a 20 MB file limit and a 30-second body-receive deadline. The server bounds actual streamed bytes, validates the `%PDF-` signature, sanitizes the original filename, and stores PDF data privately. The worker subsequently validates and extracts the complete PDF. A signature check is not a claim that every PDF is readable.

Each account can store up to 1,000 papers or 500 MB, whichever comes first. Uploads for an account serialize the quota and SHA-256 duplicate checks in one database transaction. A duplicate PDF in the same account returns `409 DUPLICATE_PAPER`. Different accounts may independently upload the same PDF. Upload and retry endpoints allow 30 requests per hour per account.

Paper titles are limited to 300 characters; papers accept up to 20 tags of 40 characters and 100 collection IDs. Accounts may create up to 100 collections, with names up to 80 characters. All references are validated against the current account; foreign IDs return `404` or an empty filtered list without disclosing the owner.

## Search and graph meaning

Search combines title/author/tag substring matching and PostgreSQL English full-text search over extracted chunks. Queued or failed papers remain searchable by title and tags. Semantic vector retrieval powers the AI chat independently. Empty query parameters are treated as absent filters.

Graph topic edges represent shared user tags. Semantic edges represent cosine similarity of average chunk embeddings, with a minimum score of 0.75 and only matching embedding configurations compared. The graph returns at most 200 topic and 200 semantic edges. Scores describe semantic proximity and do not establish agreement, causation, or a bibliographic citation. This implementation does not fabricate citation edges.

Deleting a paper removes it from stored conversation selections. Historical messages retain citation excerpts as research records; links to a deleted PDF no longer open. Deleting a conversation deletes its messages and those excerpts.

## Verification

`npm test -- tests/uploads.test.ts` checks malformed uploads, deceptive filename/MIME combinations, duplicate multipart files, and actual streamed-body limits. Against a running app and a dedicated migrated test database, with ingestion workers stopped, run `npx tsx --env-file=.env.local tests/api-security.ts`. This creates two temporary accounts and genuine PDF fixtures, exercises HTTP authentication, owner isolation, CSRF rejection, file persistence, filters, collections, retry, graph, and cascading deletion, then removes its temporary accounts. The test requires matching `DATABASE_URL` and `APP_URL` values for the running app.
