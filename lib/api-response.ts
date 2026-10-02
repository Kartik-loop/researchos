export class APIResponseError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryable = false,
  ) {
    super(message);
  }
}

export async function readAPIResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const temporary = [502, 503, 504].includes(response.status);
  const unavailable =
    "The server is temporarily unavailable or restarting. Wait a moment, then retry. Your saved library will remain available.";
  if (!response.headers.get("content-type")?.includes("application/json")) {
    await response.body?.cancel();
    throw new APIResponseError(
      unavailable,
      response.status,
      temporary || response.ok,
    );
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new APIResponseError(
      "The server returned an incomplete response. Please retry.",
      response.status,
      temporary || response.ok,
    );
  }
  if (!response.ok) {
    const message =
      data &&
      typeof data === "object" &&
      "error" in data &&
      typeof data.error === "string"
        ? data.error
        : "The request could not be completed. Please retry.";
    throw new APIResponseError(message, response.status, temporary);
  }
  return data as T;
}

export async function requestAPI<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  const readOnly = (options?.method || "GET").toUpperCase() === "GET";
  for (let attempt = 0; ; attempt++) {
    options?.signal?.throwIfAborted();
    try {
      return await readAPIResponse<T>(await fetch(url, options));
    } catch (error) {
      // Never replay uploads, account changes, or chat POSTs automatically.
      if (
        !readOnly ||
        attempt >= 2 ||
        !(error instanceof APIResponseError) ||
        !error.retryable
      )
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
}
