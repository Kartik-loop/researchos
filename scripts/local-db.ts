import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { mkdir } from "node:fs/promises";
// Development only. The socket has no authentication: bind exclusively to loopback.
await mkdir(".local", { recursive: true });
const db = await PGlite.create({
  dataDir: ".local/postgres",
  extensions: { vector },
});
const server = new PGLiteSocketServer({
  db,
  port: 54329,
  host: "127.0.0.1",
  maxConnections: 16,
});
await server.start();
console.log(
  "Development PostgreSQL + pgvector ready at 127.0.0.1:54329. Data persists in .local/postgres.",
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await server.stop();
  await db.close();
  process.exit(0);
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
