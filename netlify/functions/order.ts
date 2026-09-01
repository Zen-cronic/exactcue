import type { Config } from "@netlify/functions";
import { createOrderHandler } from "../../src/server/orderHttp";
import { NetlifyBlobOrderRepository } from "../../src/server/netlifyBlobOrderRepository";

const handler = createOrderHandler(new NetlifyBlobOrderRepository(), "netlify-blobs");

export default handler;

export const config: Config = { path: "/api/order" };
