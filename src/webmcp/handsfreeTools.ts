// The WebMCP tool surface for Handsfree — the accessible control plane.
//
// Where a screen reader only lets a user READ and manually operate the DOM, these
// tools let the user's own browser agent DO the multi-step task in their session.
// The available tools are scoped to the current step (via AbortController), so the
// agent is guided through exactly the actions that make sense right now.

import {
  advance,
  availableSlots,
  describeStep,
  goBack,
  orderSummary,
  setFulfillment,
  setInsurance,
  setPrescriptionSelected,
  stepBlocker,
  submitOrder,
  type FulfillmentMethod,
  type RefillOrder,
  type StepId,
} from "../domain/refill";
import { getOrder, setOrder } from "../store";
import { getModelContext, type ToolDefinition } from "./modelContext";

function str(params: Record<string, unknown>, key: string, fallback = ""): string {
  const v = params[key];
  return typeof v === "string" ? v : fallback;
}
function bool(params: Record<string, unknown>, key: string, fallback = true): boolean {
  const v = params[key];
  return typeof v === "boolean" ? v : fallback;
}

// Available in every step: orient the agent and move through the flow.
const alwaysTools: ToolDefinition[] = [
  {
    name: "describe_current_step",
    description:
      "Describe where the user is in the refill and what choices are available right now. " +
      "Call this first, and after any change, to narrate progress to the user. Read-only.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: () => describeStep(getOrder()),
  },
  {
    name: "go_to_next_step",
    description:
      "Advance to the next step of the refill. Fails with the reason if the current step is " +
      "incomplete (for example, nothing selected yet).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute: () => {
      const blocker = stepBlocker(getOrder());
      if (blocker) return `Cannot continue yet: ${blocker}`;
      const next = advance(getOrder());
      setOrder(next);
      return `Now on step "${next.step}". ${describeStep(next)}`;
    },
  },
  {
    name: "go_back",
    description: "Return to the previous step to change an earlier choice.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute: () => {
      const next = goBack(getOrder());
      setOrder(next);
      return `Back on step "${next.step}". ${describeStep(next)}`;
    },
  },
];

const prescriptionTools: ToolDefinition[] = [
  {
    name: "set_prescription",
    description:
      "Select or unselect a prescription to refill, by name or id (e.g. 'atorvastatin' or " +
      "'blood pressure'). Set selected=false to remove one.",
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
      const before = getOrder();
      const next = setPrescriptionSelected(before, str(params, "prescription"), bool(params, "selected"));
      if (next === before) return `No prescription matched "${str(params, "prescription")}".`;
      setOrder(next);
      const chosen = next.prescriptions.filter((rx) => rx.selected).map((rx) => rx.name);
      return `Updated. Currently selected: ${chosen.join(", ") || "none"}.`;
    },
  },
];

const insuranceTools: ToolDefinition[] = [
  {
    name: "set_insurance",
    description: "Choose how to pay, by plan name or id (e.g. 'BlueShield' or 'out of pocket').",
    inputSchema: {
      type: "object",
      properties: { plan: { type: "string", description: "Name fragment or id of the plan." } },
      required: ["plan"],
      additionalProperties: false,
    },
    execute: (params) => {
      const before = getOrder();
      const next = setInsurance(before, str(params, "plan"));
      if (next === before) return `No insurance option matched "${str(params, "plan")}".`;
      setOrder(next);
      const plan = next.insurancePlans.find((p) => p.id === next.chosenInsuranceId);
      return `Insurance set to ${plan?.name}.`;
    },
  },
];

const fulfillmentTools: ToolDefinition[] = [
  {
    name: "set_fulfillment",
    description:
      "Choose pickup or delivery and a time slot. Pass method='delivery' or 'pickup' and an " +
      "optional slot fragment (e.g. 'Thursday'). Call describe_current_step to hear the slots.",
    inputSchema: {
      type: "object",
      properties: {
        method: { type: "string", enum: ["pickup", "delivery"] },
        slot: { type: "string", description: "Time-slot fragment, e.g. 'Thursday' or 'tomorrow morning'." },
      },
      required: ["method"],
      additionalProperties: false,
    },
    execute: (params) => {
      const method = str(params, "method") as FulfillmentMethod;
      if (method !== "pickup" && method !== "delivery") return "method must be 'pickup' or 'delivery'.";
      const next = setFulfillment(getOrder(), method, str(params, "slot") || null);
      setOrder(next);
      if (!next.fulfillmentSlot) {
        return `Set to ${method}, but no matching slot. Available: ${availableSlots(next).join(", ")}.`;
      }
      return `Set to ${method}, ${next.fulfillmentSlot}.`;
    },
  },
];

const reviewTools: ToolDefinition[] = [
  {
    name: "review_order",
    description: "Read back the full order for the user to confirm before submitting. Read-only.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: () => orderSummary(getOrder()),
  },
  {
    name: "submit_refill",
    description:
      "Submit the refill order. Only call this after the user has confirmed the read-back. " +
      "Returns the confirmation number.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute: () => {
      const next = submitOrder(getOrder());
      if (next.step !== "done") return "Cannot submit yet — review the order and ensure a prescription is selected.";
      setOrder(next);
      return `Refill submitted. Confirmation ${next.confirmationNumber}. ${orderSummary(next)}`;
    },
  },
];

const stepTools: Record<StepId, ToolDefinition[]> = {
  prescriptions: prescriptionTools,
  insurance: insuranceTools,
  fulfillment: fulfillmentTools,
  review: reviewTools,
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
    stepController?.abort();
    stepController = new AbortController();
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
