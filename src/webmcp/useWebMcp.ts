import { useEffect, useRef, useState } from "react";
import { getModelContext, isWebMcpSupported, type RegisteredTool } from "./modelContext";
import { createToolController } from "./handsfreeTools";
import type { StepId } from "../domain/refill";

/**
 * Wires the ExactCue tool surface to the browser's WebMCP runtime and exposes the
 * live list of currently-registered tools, so the UI can mirror what the agent's
 * inspector sees and prove the tool set changes with each step.
 */
export function useWebMcp(step: StepId): { supported: boolean; tools: RegisteredTool[] } {
  const supported = isWebMcpSupported();
  const controllerRef = useRef<ReturnType<typeof createToolController> | null>(null);
  const [tools, setTools] = useState<RegisteredTool[]>([]);

  async function refresh(): Promise<void> {
    const mc = getModelContext();
    if (!mc) return;
    setTools(await mc.getTools());
  }

  useEffect(() => {
    const controller = createToolController();
    controllerRef.current = controller;
    void controller.start().then(refresh);
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    void controllerRef.current?.syncStep(step).then(refresh);
  }, [step]);

  return { supported, tools };
}
