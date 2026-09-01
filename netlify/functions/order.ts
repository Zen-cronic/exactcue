import type { Config } from "@netlify/functions";
import { createSessionOrderHandler } from "../../src/server/orderHttp";
import { NetlifyBlobOrderRepository } from "../../src/server/netlifyBlobOrderRepository";

const handler = createSessionOrderHandler(
  (sessionId) => new NetlifyBlobOrderRepository(sessionId),
  "netlify-blobs",
);

export default handler;

export const config: Config = { path: "/api/order" };
