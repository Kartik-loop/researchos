# Free personal deployment: Render + Neon

This configuration runs the web app and ingestion worker in one Render **Free** web service and stores papers, vectors, users, and conversations in Neon PostgreSQL. It is intended for a small personal workspace, not an always-on production service.

## Setup

1. Create free accounts at <https://dashboard.render.com/register> and <https://console.neon.tech/signup>. Do not upgrade plans for this setup.
2. Create a Neon Free project near your Render service's region. Copy its **direct** PostgreSQL connection string privately. Migrations use a session-level advisory lock, so avoid a transaction-pooling endpoint for this combined launcher. pgvector must be available; migration enables it.
3. Push the application source to a private GitHub repository. Do not include `.env.local`, `.local/`, `node_modules/`, or `.next/`.
4. In Render, create a Blueprint from that repository and select `render.yaml`. The blueprint explicitly requests one free web service, with no paid workers or Render database.
5. Enter `DATABASE_URL` and `AI_API_KEY` in Render's secret environment settings. Use the same Gemini key as local development. Do not put secrets in GitHub, chat, or the blueprint.
6. Deploy. The launcher uses Render's public HTTPS URL as `APP_URL`, runs migrations, then starts both web and worker. If you later use a custom domain, explicitly set `APP_URL` to its HTTPS origin.
7. Account registration is disabled by default. Import the existing local accounts and papers before using the deployment, or temporarily enable `ALLOW_REGISTRATION=true`, create your account, then disable it again. A new database does not automatically contain your local library. Never copy the local database directory into the deployment image.
8. Check `/api/health`, sign in, upload a small PDF, wait for processing, ask a cited question, and reopen the library in another browser.

## Limits

- Render sleeps after 15 minutes without inbound traffic; cold starts take time. Web and worker stop together. Durable queued jobs remain in PostgreSQL and resume after wake-up; interrupted jobs recover after their lease expires.
- Keep the app open while uploading/processing. Do not use artificial keep-alive traffic to defeat host limits.
- A free service shares limited RAM between Next.js and PDF processing. Large PDFs or concurrent activity can exhaust it.
- Neon storage includes the original PDF files and vectors. Free quotas are finite; check the dashboard before growing the library. Worker polling keeps database compute awake while the web service is running.
- Gemini quotas also apply. These providers' free plans and availability can change. Stay on free plans and do not enable paid overages.
- The existing Docker deployment remains available for a future paid deployment with separate workers.

References: [Render Free limits](https://render.com/docs/free), [Neon plans](https://neon.com/docs/introduction/plans).
