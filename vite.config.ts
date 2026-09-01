import type { IncomingMessage, ServerResponse } from "node:http";
import react from "@vitejs/plugin-react";
import { defineConfig, type Connect, type Plugin } from "vite";
import type { DemoSessionId } from "./src/api/demoSession";
import { createSessionOrderHandler } from "./src/server/orderHttp";
import { InMemoryOrderRepository } from "./src/server/orderRepository";

function requestBody(request: IncomingMessage): Promise<string | undefined> {
  if (request.method === "GET" || request.method === "HEAD") return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    request.on("data", (chunk: Uint8Array) => chunks.push(chunk));
    request.on("end", () => resolve(chunks.length ? Buffer.concat(chunks).toString("utf8") : undefined));
    request.on("error", reject);
  });
}

async function writeResponse(response: Response, target: ServerResponse): Promise<void> {
  target.statusCode = response.status;
  response.headers.forEach((value, key) => target.setHeader(key, value));
  target.end(new Uint8Array(await response.arrayBuffer()));
}

/** Runs the exact Function service over memory for local dev and built-artifact proof. */
function localOrderApi(): Plugin {
  const repositories = new Map<DemoSessionId, InMemoryOrderRepository>();
  const handler = createSessionOrderHandler((sessionId) => {
    const existing = repositories.get(sessionId);
    if (existing) return existing;
    const created = new InMemoryOrderRepository();
    repositories.set(sessionId, created);
    return created;
  }, "local-memory");
  const middleware: Connect.NextHandleFunction = async (request, response, next) => {
    if (!request.url?.startsWith("/api/order")) return next();
    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
        else if (value !== undefined) headers.set(key, value);
      }
      const webRequest = new Request(`http://${request.headers.host ?? "localhost"}${request.url}`, {
        method: request.method,
        headers,
        body: await requestBody(request),
      });
      await writeResponse(await handler(webRequest), response);
    } catch (error) {
      next(error as Error);
    }
  };
  return {
    name: "handsfree-local-order-api",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

// Local servers mirror the production WebMCP headers. The distinctive fixed
// port preserves the operator's existing collision-avoidance configuration.
export default defineConfig({
  plugins: [react(), localOrderApi()],
  server: {
    port: 5820,
    strictPort: true,
    headers: {
      "Origin-Agent-Cluster": "?1",
      "Permissions-Policy": "tools=(self)",
    },
  },
  preview: {
    port: 5820,
    strictPort: true,
  },
});
