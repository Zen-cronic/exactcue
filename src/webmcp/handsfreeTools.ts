// The WebMCP tool surface for Handsfree — the accessible control plane.
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
  submitOrder,
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

const alwaysTools: ToolDefinition[] = [
  {
    name: "describe_current_step",
    description:
      "Describe where the user is in the refill and what choices are available right now. " +
      "Call this first, and after any change, to narrate progress. Read-only.",
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
    execute: () => orderSummary(getOrder()),
  },
  {
    name: "submit_refill",
    description:
      "Submit the refill. Only call this after the user has heard the read-back from review_order " +
      "and confirmed out loud. Returns the confirmation number.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute: () => {
      const next = submitOrder(getOrder());
      if (next.step !== "done") return "Cannot submit yet — review the order and ensure a prescription and pharmacy are chosen.";
      setOrder(next);
      return `Refill submitted. Confirmation ${next.confirmationNumber}. ${orderSummary(next)}`;
    },
  },
];

const stepTools: Record<StepId, ToolDefinition[]> = {
  prescriptions: prescriptionTools,
  pickup: pickupTools,
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
