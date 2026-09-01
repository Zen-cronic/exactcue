// The WebMCP tool surface for ExactCue — the accessible control plane.
//
// Where a screen reader only lets a user READ and manually operate the DOM, these
// tools let the user's own browser agent DO the multi-step refill in their session.
// The available tools are scoped to the current step (via AbortController), so the
// agent is guided to exactly the actions that make sense right now, and the one
// committing action (submit_refill) is reached only after a spoken read-back.

import {
  advance,
  describeStep,
  goBack,
  orderSummary,
  setPharmacy,
  setPrescriptionSelected,
  stepBlocker,
  type RefillOrder,
  type StepId,
} from "../domain/refill";
import {
  actionBlocker,
  getOrder,
  hasCurrentReadBack,
  markReadBack,
  recoverFromConflict,
  setOrder,
  submitCurrentOrder,
} from "../store";
import { getModelContext, type ToolDefinition } from "./modelContext";

function str(params: Record<string, unknown>, key: string, fallback = ""): string {
  const v = params[key];
  return typeof v === "string" ? v : fallback;
}
function bool(params: Record<string, unknown>, key: string, fallback = true): boolean {
  const v = params[key];
  return typeof v === "boolean" ? v : fallback;
}

const alwaysTools: ToolDefinition[] = [
  {
    name: "describe_current_step",
    description:
      "Describe where the user is in the refill and what choices are available right now. " +
      "Call this first, and after any change, to narrate progress. Read-only.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: () => {
      const blocked = actionBlocker();
      return blocked ? `Authoritative record status: ${blocked}` : describeStep(getOrder());
    },
  },
  {
    name: "reload_current_record",
    description:
      "After a stale-record rejection, replace this session's review with the current authoritative record. Read the updated order back before asking the user to confirm again.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute: () => {
      recoverFromConflict();
      return `Current record loaded. ${describeStep(getOrder())}`;
    },
  },
];

const nextTool: ToolDefinition = {
  name: "go_to_next_step",
  description:
    "Advance from prescriptions to pickup, or pickup to review. This tool retires at review; " +
    "only submit_refill can complete an order.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  execute: () => {
    const unavailable = actionBlocker();
    if (unavailable) return `Cannot continue: ${unavailable}`;
    const blocker = stepBlocker(getOrder());
    if (blocker) return `Cannot continue yet: ${blocker}`;
    const next = advance(getOrder());
    setOrder(next);
    return `Now on step "${next.step}". ${describeStep(next)}`;
  },
};

const backTool: ToolDefinition = {
  name: "go_back",
  description: "Return to the previous step to change an earlier choice.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  execute: () => {
    const unavailable = actionBlocker();
    if (unavailable) return `Cannot go back: ${unavailable}`;
    const next = goBack(getOrder());
    setOrder(next);
    return `Back on step "${next.step}". ${describeStep(next)}`;
  },
};

const prescriptionTools: ToolDefinition[] = [
  {
    name: "set_prescription",
    description:
      "Select or unselect a prescription to refill, by name or id (e.g. 'atorvastatin' or " +
      "'blood pressure'). Set selected=false to remove one. A prescription with no refills left " +
      "cannot be added and the tool will say why.",
    inputSchema: {
      type: "object",
      properties: {
        prescription: { type: "string", description: "Name fragment or id of the prescription." },
        selected: { type: "boolean", description: "true to add, false to remove. Default true." },
      },
      required: ["prescription"],
      additionalProperties: false,
    },
    execute: (params) => {
      const unavailable = actionBlocker();
      if (unavailable) return `Cannot change prescriptions: ${unavailable}`;
      const { order, note } = setPrescriptionSelected(
        getOrder(),
        str(params, "prescription"),
        bool(params, "selected"),
      );
      setOrder(order);
      return note;
    },
  },
];

const pickupTools: ToolDefinition[] = [
  {
    name: "set_pharmacy",
    description: "Choose the pickup pharmacy by name or id (e.g. 'Marmora' or 'Riverside').",
    inputSchema: {
      type: "object",
      properties: { pharmacy: { type: "string", description: "Name fragment or id of the pharmacy." } },
      required: ["pharmacy"],
      additionalProperties: false,
    },
    execute: (params) => {
      const unavailable = actionBlocker();
      if (unavailable) return `Cannot change pickup: ${unavailable}`;
      const before = getOrder();
      const next = setPharmacy(before, str(params, "pharmacy"));
      if (next === before) return `No pharmacy matched "${str(params, "pharmacy")}".`;
      setOrder(next);
      const p = next.pharmacies.find((x) => x.id === next.chosenPharmacyId);
      return `Pickup set to ${p?.name}, ${p?.address}.`;
    },
  },
];

const reviewTools: ToolDefinition[] = [
  {
    name: "review_order",
    description: "Read back the full order for the user to confirm before submitting. Read-only.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: () => {
      const unavailable = actionBlocker();
      if (unavailable) return `Cannot review yet: ${unavailable}`;
      markReadBack();
      return `${orderSummary(getOrder())}\nAsk the user to confirm this exact current order before calling submit_refill with confirmed set to true.`;
    },
  },
  {
    name: "submit_refill",
    description:
      "Submit the refill. Only call this after the user has heard the read-back from review_order " +
      "and explicitly confirmed it. Set confirmed to true only after that confirmation. Returns the confirmation number.",
    inputSchema: {
      type: "object",
      properties: {
        confirmed: {
          type: "boolean",
          description: "True only after the user explicitly confirms the exact review_order read-back.",
        },
      },
      required: ["confirmed"],
      additionalProperties: false,
    },
    execute: async (params) => {
      const unavailable = actionBlocker();
      if (unavailable) return `Cannot submit: ${unavailable}`;
      if (!bool(params, "confirmed", false)) {
        return "Cannot submit: explicit user confirmation is required. Nothing was submitted.";
      }
      if (!hasCurrentReadBack()) {
        return "Cannot submit yet. Call review_order, read the exact current order to the user, and wait for their confirmation.";
      }
      const result = await submitCurrentOrder(true);
      if (result.kind === "submitted") return `${result.message} ${orderSummary(getOrder())}`;
      return `${result.message} No write was made by this session.`;
    },
  },
];

const stepTools: Record<StepId, ToolDefinition[]> = {
  prescriptions: [nextTool, ...prescriptionTools],
  pickup: [backTool, nextTool, ...pickupTools],
  review: [backTool, ...reviewTools],
  done: [],
};

/** Registers always-on tools once, then keeps step-scoped tools in sync with the flow. */
export function createToolController() {
  let started = false;
  let stepController: AbortController | null = null;
  let currentStep: StepId | null = null;
  const alwaysController = new AbortController();

  async function start(): Promise<void> {
    if (started) return;
    const mc = getModelContext();
    if (!mc) return;
    started = true;
    for (const tool of alwaysTools) {
      await mc.registerTool(tool, { signal: alwaysController.signal });
    }
  }

  async function syncStep(step: RefillOrder["step"]): Promise<void> {
    const mc = getModelContext();
    if (!mc) return;
    await start();
    if (step === currentStep) return;
    currentStep = step;
    const retiringController = stepController;
    stepController = new AbortController();
    // A navigation tool can trigger this sync while its own WebMCP invocation is
    // still resolving. Retire the prior surface on the next task so Chrome can
    // deliver that tool's response before its AbortSignal unregisters it.
    if (retiringController) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      retiringController.abort();
    }
    for (const tool of stepTools[step]) {
      await mc.registerTool(tool, { signal: stepController.signal });
    }
  }

  function dispose(): void {
    stepController?.abort();
    alwaysController.abort();
    started = false;
    currentStep = null;
  }

  return { start, syncStep, dispose };
}
