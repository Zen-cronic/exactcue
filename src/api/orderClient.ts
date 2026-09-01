import {
  isOrderView,
  type OrderView,
  type SubmitOrderRequest,
  type SubmitOrderResponse,
} from "./orderContract";
import type { DemoSessionId } from "./demoSession";

export function orderEndpoint(sessionId: DemoSessionId): string {
  return `/api/order?session=${encodeURIComponent(sessionId)}`;
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error(`The order service returned an unreadable response (${response.status}).`);
  }
}

export async function fetchAuthoritativeOrder(sessionId: DemoSessionId): Promise<OrderView> {
  const response = await fetch(orderEndpoint(sessionId), {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const body = await responseJson(response);
  if (!response.ok || !isOrderView(body)) {
    throw new Error("The authoritative order could not be loaded. Nothing can be submitted.");
  }
  return body;
}

export async function submitAuthoritativeOrder(
  sessionId: DemoSessionId,
  request: SubmitOrderRequest,
): Promise<SubmitOrderResponse> {
  const response = await fetch(orderEndpoint(sessionId), {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const body = (await responseJson(response)) as SubmitOrderResponse;
  if (body.kind === "submitted" || body.kind === "conflict" || body.kind === "invalid" || body.kind === "error") {
    return body;
  }
  throw new Error("The order service returned an unknown result. Nothing was submitted.");
}
