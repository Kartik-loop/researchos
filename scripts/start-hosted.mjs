import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Free hosting shares one service between web and worker. Any child failure
// stops the whole service so the platform can restart both consistently.
const cwd = fileURLToPath(new URL("../", import.meta.url));
const env = {
  ...process.env,
  NODE_ENV: "production",
  HOSTNAME: "0.0.0.0",
  APP_URL: process.env.APP_URL || process.env.RENDER_EXTERNAL_URL,
};
if (!env.APP_URL || !env.DATABASE_URL || !env.AI_API_KEY) {
  console.error(
    "Set APP_URL (or RENDER_EXTERNAL_URL), DATABASE_URL, and AI_API_KEY before starting.",
  );
  process.exit(1);
}
const children = new Set();
let stopping = false;
let exitCode = 0;
let deadline;
function stop(code) {
  if (stopping) return;
  stopping = true;
  exitCode = code;
  if (!children.size) process.exit(code);
  for (const child of children) child.kill("SIGTERM");
  deadline = setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
  }, 20_000);
  deadline.unref();
}
process.once("SIGTERM", () => stop(0));
process.once("SIGINT", () => stop(0));
function launch(name, args, onSuccess) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: "inherit" });
  children.add(child);
  child.once("error", () => {
    console.error(`${name} could not start.`);
    stop(1);
  });
  child.once("close", (code) => {
    children.delete(child);
    if (stopping) {
      if (!children.size) {
        clearTimeout(deadline);
        process.exit(exitCode);
      }
      return;
    }
    if (code === 0 && onSuccess) onSuccess();
    else {
      console.error(`${name} exited; restarting the service is required.`);
      stop(1);
    }
  });
}
launch("Migrations", ["--import", "tsx", "scripts/migrate.ts"], () => {
  launch("Web", [".next/standalone/server.js"]);
  launch("Worker", ["--import", "tsx", "worker/index.ts"]);
});
