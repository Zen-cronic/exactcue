import type { StorageMode } from "../api/orderContract";

export interface RequestLogEntry {
  event: "http_request";
  requestId: string;
  method: string;
  status: number;
  durationMs: number;
  storage: StorageMode;
}

/** Metadata-only log receipt. Never include URL, session, ETag, body, or response data. */
export function createRequestLogEntry(
  request: Request,
  response: Response,
  durationMs: number,
): RequestLogEntry {
  const requestId = response.headers.get("X-ExactCue-Request-Id") ?? "missing";
  const storageHeader = response.headers.get("X-ExactCue-Storage");
  const storage: StorageMode = storageHeader === "netlify-blobs" ? "netlify-blobs" : "local-memory";
  return {
    event: "http_request",
    requestId,
    method: request.method,
    status: response.status,
    durationMs: Math.max(0, Math.round(durationMs)),
    storage,
  };
}
