// Typings + thin helpers for the experimental WebMCP imperative API.
// Reference: https://developer.chrome.com/docs/ai/webmcp/imperative-api
// The API is not yet in lib.dom, so we declare it here.

export interface ToolDefinition {
  name: string;
  description: string;
  // JSON Schema (draft-07 style) describing the tool's parameters.
  inputSchema: Record<string, unknown>;
  // Receives the parsed params object, returns a human/agent-readable string.
  execute: (params: Record<string, unknown>) => Promise<string> | string;
  annotations?: Record<string, unknown>;
}

export interface RegisterToolOptions {
  // Aborting this signal unregisters the tool — how we make the available
  // tool set track custody state.
  signal?: AbortSignal;
}

export interface RegisteredTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  origin?: string;
  annotations?: Record<string, unknown>;
  execute?: (params: Record<string, unknown>) => Promise<string> | string;
}

export interface ModelContext {
  registerTool(tool: ToolDefinition, options?: RegisterToolOptions): Promise<void>;
  getTools(): Promise<RegisteredTool[]>;
  executeTool(tool: RegisteredTool, argsJson: string): Promise<string>;
}

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
}

export function getModelContext(): ModelContext | undefined {
  if (typeof document === "undefined") return undefined;
  return document.modelContext;
}

export function isWebMcpSupported(): boolean {
  return !!getModelContext();
}
