import type { ErrorResponse, StorageMode } from "../api/orderContract";
import { parseDemoSessionId, type DemoSessionId } from "../api/demoSession";
import type { OrderRepository } from "./orderRepository";
import { readOrder, submitOrderIntent } from "./orderService";

const JSON_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function withRequestReceipts(
  storage: StorageMode,
  handle: () => Promise<Response>,
): Promise<Response> {
  const requestId = crypto.randomUUID();
  const started = performance.now();
  const response = await handle();
  response.headers.set("Server-Timing", `app;dur=${Math.max(0, performance.now() - started).toFixed(1)}`);
  response.headers.set("X-Handsfree-Request-Id", requestId);
  response.headers.set("X-Handsfree-Storage", storage);
  return response;
}

async function handleOrderRequest(
  request: Request,
  repository: OrderRepository,
  storage: StorageMode,
): Promise<Response> {
  try {
    if (request.method === "GET") return json(await readOrder(repository, storage));
    if (request.method === "POST") {
      let input: unknown;
      try {
        input = await request.json();
      } catch {
        return json(
          { kind: "invalid", message: "The request body must be valid JSON. Nothing was submitted." },
          400,
        );
      }
      const result = await submitOrderIntent(repository, storage, input);
      return json(result.body, result.status);
    }
    return json({ kind: "error", message: "Only GET and POST are supported." } satisfies ErrorResponse, 405);
  } catch {
    return json(
      {
        kind: "error",
        message: "The authoritative order service is unavailable. Nothing was submitted.",
      } satisfies ErrorResponse,
      503,
    );
  }
}

export function createOrderHandler(
  repository: OrderRepository,
  storage: StorageMode,
): (request: Request) => Promise<Response> {
  return (request: Request) =>
    withRequestReceipts(storage, () => handleOrderRequest(request, repository, storage));
}

export function createSessionOrderHandler(
  repositoryFor: (sessionId: DemoSessionId) => OrderRepository,
  storage: StorageMode,
): (request: Request) => Promise<Response> {
  return (request: Request) => withRequestReceipts(storage, async () => {
    const sessionId = parseDemoSessionId(new URL(request.url).searchParams.get("session"));
    if (!sessionId) {
      return json(
        {
          kind: "invalid",
          message: "A valid synthetic demo session is required. Nothing was submitted.",
        },
        400,
      );
    }
    return handleOrderRequest(request, repositoryFor(sessionId), storage);
  });
}
