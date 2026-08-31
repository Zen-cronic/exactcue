import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server mirrors the production WebMCP headers so the imperative API is
// active on localhost (Origin-Agent-Cluster: ?1, Permissions-Policy: tools).
export default defineConfig({
  plugins: [react()],
  server: {
    headers: {
      "Origin-Agent-Cluster": "?1",
      "Permissions-Policy": "tools=(self)",
    },
  },
});
