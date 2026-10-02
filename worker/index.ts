import { setTimeout as delay } from "node:timers/promises";
import { pool } from "../server/db";
import { claimJob, processJob } from "../server/ingestion";

const shutdown = new AbortController();
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    console.info(JSON.stringify({ event: "worker.stopping", signal }));
    shutdown.abort(new Error("Worker is shutting down."));
  });
console.info(JSON.stringify({ event: "worker.started" }));
try {
  while (!shutdown.signal.aborted) {
    try {
      const job = await claimJob();
      if (job) await processJob(job, shutdown.signal);
      else await delay(1500, undefined, { signal: shutdown.signal });
    } catch (error) {
      if (shutdown.signal.aborted) break;
      console.error(
        JSON.stringify({
          event: "worker.error",
          error:
            error instanceof Error
              ? error.message
              : "Unexpected worker failure",
        }),
      );
      await delay(5000, undefined, { signal: shutdown.signal }).catch(
        () => undefined,
      );
    }
  }
} finally {
  await pool.end();
}
