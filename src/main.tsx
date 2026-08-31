import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

// Note: intentionally not wrapped in <StrictMode>. StrictMode double-invokes
// effects in dev, which would register the WebMCP tools twice.
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
