import type { Config } from "@netlify/functions";
import { createSessionOrderHandler } from "../../src/server/orderHttp";
import { NetlifyBlobOrderRepository } from "../../src/server/netlifyBlobOrderRepository";
import { createRequestLogEntry } from "../../src/server/requestTelemetry";

const handler = createSessionOrderHandler(
  (sessionId) => new NetlifyBlobOrderRepository(sessionId),
  "netlify-blobs",
);

export default async (request: Request): Promise<Response> => {
  const started = performance.now();
  const response = await handler(request);
  console.info(JSON.stringify(createRequestLogEntry(request, response, performance.now() - started)));
  return response;
};

export const config: Config = { path: "/api/order" };
