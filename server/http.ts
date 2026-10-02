import { z } from "zod";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
export const uuid = z.string().uuid().toLowerCase();
export function checkOrigin(req: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const expected = new URL(process.env.APP_URL || "http://localhost:3000")
    .origin;
  const origin = req.headers.get("origin");
  if (!origin || origin !== expected)
    throw new ApiError(
      403,
      "This request could not be verified. Refresh the page and try again.",
      "INVALID_ORIGIN",
    );
}
export function handle(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    let response: Response;
    try {
      checkOrigin(req);
      response = await fn(req);
    } catch (error) {
      if (error instanceof ApiError)
        response = Response.json(
          { error: error.message, code: error.code },
          { status: error.status },
        );
      else if (error instanceof z.ZodError)
        response = Response.json(
          { error: error.issues[0]?.message || "Invalid input." },
          { status: 400 },
        );
      else {
        const db = error as { code?: string } | null;
        if (db?.code === "23505")
          response = Response.json(
            { error: "This item already exists." },
            { status: 409 },
          );
        else if (db?.code === "23503")
          response = Response.json(
            { error: "The referenced item is no longer available." },
            { status: 409 },
          );
        else {
          console.error(
            "Request failed",
            error instanceof Error ? error.message : "Unknown error",
          );
          response = Response.json(
            {
              error:
                "The service is temporarily unavailable. Please try again.",
              code: "SERVICE_ERROR",
            },
            { status: 503 },
          );
        }
      }
    }
    // Keep streaming directives such as no-transform while preventing caches from
    // retaining authenticated successes, authorization errors or stale failures.
    const cacheControl = response.headers.get("Cache-Control");
    if (!cacheControl?.includes("no-store"))
      response.headers.set(
        "Cache-Control",
        cacheControl ? `${cacheControl}, no-store` : "no-store",
      );
    return response;
  };
}
export async function jsonBody<T>(
  req: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  // Bound the actual body, not only the client-controlled Content-Length.
  const reader = req.body?.getReader();
  if (!reader) throw new ApiError(400, "A request body is required.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 65536) {
      await reader.cancel();
      throw new ApiError(413, "Request is too large.");
    }
    chunks.push(value);
  }
  try {
    return schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch (e) {
    if (e instanceof z.ZodError) throw e;
    throw new ApiError(400, "Invalid JSON request.");
  }
}
