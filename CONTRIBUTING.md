# Contributing

Follow the local setup in [README.md](README.md). Use the Node version in `.nvmrc` and install dependencies with `npm ci`.

Create a focused branch from `main` and open a pull request explaining the problem, change, and validation. Keep API route handlers thin; put business logic in `server/`. Validate input and enforce account ownership on every data access.

Before submitting, run:

```sh
npm test
npm run typecheck
npm run build:hosted
```

Automated unit and database pipeline tests use isolated test data and do not require an AI key. Live integration scripts require a running local stack; use dedicated test accounts. Never run destructive tests against a user's research library.

Add new ordered database migrations instead of editing applied migrations. Document environment variables in `.env.example` and deployment guides. Use Prettier on changed files. Do not commit keys, `.env.local`, database files, uploaded PDFs, or screenshots containing personal research.

Report security issues privately as described in [SECURITY.md](SECURITY.md).
