// Handsfree domain: a multi-step pharmacy prescription-refill flow.
// Pure and framework-free so the UI, the WebMCP tool handlers, and (iteration 2)
// a Netlify Function can all drive the exact same state machine.
//
// This is a coordination flow (choose refills, insurance, delivery) — it gives no
// medical advice and makes no clinical judgement.

export type StepId = "prescriptions" | "insurance" | "fulfillment" | "review" | "done";

export const STEP_ORDER: StepId[] = ["prescriptions", "insurance", "fulfillment", "review", "done"];

export interface Prescription {
  id: string;
  name: string;
  doctor: string;
  refillsLeft: number;
  lastFilled: string;
  selected: boolean;
}

export interface InsurancePlan {
  id: string;
  name: string;
  memberId: string;
}

export type FulfillmentMethod = "pickup" | "delivery";

export interface RefillOrder {
  step: StepId;
  patientName: string;
  prescriptions: Prescription[];
  insurancePlans: InsurancePlan[];
  chosenInsuranceId: string | null;
  fulfillmentMethod: FulfillmentMethod | null;
  fulfillmentSlot: string | null;
  deliveryAddress: string;
  confirmationNumber: string | null;
}

export const DELIVERY_SLOTS = [
  "Thursday 4–6 PM",
  "Friday 9–11 AM",
  "Saturday 1–3 PM",
] as const;

export const PICKUP_SLOTS = [
  "Today after 5 PM",
  "Tomorrow morning",
  "Tomorrow afternoon",
] as const;

export function initialOrder(): RefillOrder {
  return {
    step: "prescriptions",
    patientName: "Marcus Reyes",
    prescriptions: [
      {
        id: "rx-1",
        name: "Atorvastatin 20 mg",
        doctor: "Dr. Nguyen",
        refillsLeft: 3,
        lastFilled: "2026-08-02",
        selected: false,
      },
      {
        id: "rx-2",
        name: "Lisinopril 10 mg",
        doctor: "Dr. Nguyen",
        refillsLeft: 2,
        lastFilled: "2026-08-02",
        selected: false,
      },
      {
        id: "rx-3",
        name: "Metformin 500 mg",
        doctor: "Dr. Osei",
        refillsLeft: 5,
        lastFilled: "2026-07-19",
        selected: false,
      },
    ],
    insurancePlans: [
      { id: "ins-1", name: "BlueShield Standard", memberId: "BSX-4471902" },
      { id: "ins-2", name: "Pay out of pocket", memberId: "—" },
    ],
    chosenInsuranceId: null,
    fulfillmentMethod: null,
    fulfillmentSlot: null,
    deliveryAddress: "412 Marmora St, Apt 3",
    confirmationNumber: null,
  };
}

export function selectedPrescriptions(order: RefillOrder): Prescription[] {
  return order.prescriptions.filter((rx) => rx.selected);
}

/** Which selectable slots apply to the currently chosen fulfillment method. */
export function availableSlots(order: RefillOrder): readonly string[] {
  return order.fulfillmentMethod === "delivery" ? DELIVERY_SLOTS : PICKUP_SLOTS;
}

/** Match a prescription by id or by a loose name fragment (agents pass names). */
export function findPrescription(order: RefillOrder, ref: string): Prescription | undefined {
  const needle = ref.trim().toLowerCase();
  return (
    order.prescriptions.find((rx) => rx.id === needle) ??
    order.prescriptions.find((rx) => rx.name.toLowerCase().includes(needle))
  );
}

export function setPrescriptionSelected(
  order: RefillOrder,
  ref: string,
  selected: boolean,
): RefillOrder {
  const target = findPrescription(order, ref);
  if (!target) return order;
  return {
    ...order,
    prescriptions: order.prescriptions.map((rx) =>
      rx.id === target.id ? { ...rx, selected } : rx,
    ),
  };
}

/** Returns a human/agent-readable reason the current step is not yet complete, or null. */
export function stepBlocker(order: RefillOrder): string | null {
  switch (order.step) {
    case "prescriptions":
      return selectedPrescriptions(order).length === 0
        ? "No prescriptions are selected yet."
        : null;
    case "insurance":
      return order.chosenInsuranceId === null ? "No insurance option chosen yet." : null;
    case "fulfillment":
      if (!order.fulfillmentMethod) return "Choose pickup or delivery.";
      if (!order.fulfillmentSlot) return "Choose a time slot.";
      return null;
    case "review":
      return null;
    case "done":
      return null;
  }
}

export function canAdvance(order: RefillOrder): boolean {
  return order.step !== "done" && stepBlocker(order) === null;
}

export function advance(order: RefillOrder): RefillOrder {
  if (!canAdvance(order)) return order;
  const idx = STEP_ORDER.indexOf(order.step);
  return { ...order, step: STEP_ORDER[idx + 1] };
}

export function goBack(order: RefillOrder): RefillOrder {
  const idx = STEP_ORDER.indexOf(order.step);
  if (idx <= 0 || order.step === "done") return order;
  return { ...order, step: STEP_ORDER[idx - 1] };
}

export function setInsurance(order: RefillOrder, ref: string): RefillOrder {
  const needle = ref.trim().toLowerCase();
  const plan =
    order.insurancePlans.find((p) => p.id === needle) ??
    order.insurancePlans.find((p) => p.name.toLowerCase().includes(needle));
  if (!plan) return order;
  return { ...order, chosenInsuranceId: plan.id };
}

export function setFulfillment(
  order: RefillOrder,
  method: FulfillmentMethod,
  slot: string | null,
): RefillOrder {
  const slots = method === "delivery" ? DELIVERY_SLOTS : PICKUP_SLOTS;
  const chosenSlot =
    slot && slots.some((s) => s.toLowerCase().includes(slot.trim().toLowerCase()))
      ? slots.find((s) => s.toLowerCase().includes(slot.trim().toLowerCase())) ?? null
      : null;
  return { ...order, fulfillmentMethod: method, fulfillmentSlot: chosenSlot };
}

function pseudoConfirmation(order: RefillOrder): string {
  const seed = selectedPrescriptions(order).length * 7 + (order.fulfillmentMethod === "delivery" ? 3 : 1);
  return `RX-${(1000 + seed * 137).toString().slice(0, 4)}-${order.patientName.split(" ")[0].toUpperCase()}`;
}

/** The single committing action. Requires a review step with no blockers. */
export function submitOrder(order: RefillOrder): RefillOrder {
  if (order.step !== "review") return order;
  if (selectedPrescriptions(order).length === 0) return order;
  return { ...order, step: "done", confirmationNumber: pseudoConfirmation(order) };
}

export function orderSummary(order: RefillOrder): string {
  const rx = selectedPrescriptions(order);
  const plan = order.insurancePlans.find((p) => p.id === order.chosenInsuranceId);
  const lines = [
    `Patient: ${order.patientName}`,
    `Prescriptions (${rx.length}): ${rx.map((r) => r.name).join(", ") || "none selected"}`,
    `Insurance: ${plan ? plan.name : "not chosen"}`,
    order.fulfillmentMethod === "delivery"
      ? `Delivery to ${order.deliveryAddress}${order.fulfillmentSlot ? `, ${order.fulfillmentSlot}` : ""}`
      : order.fulfillmentMethod === "pickup"
        ? `Pickup${order.fulfillmentSlot ? `, ${order.fulfillmentSlot}` : ""}`
        : "Fulfillment: not chosen",
  ];
  if (order.confirmationNumber) lines.push(`Confirmation: ${order.confirmationNumber}`);
  return lines.join("\n");
}

/** Spoken-friendly description of where the user is and what they can do next. */
export function describeStep(order: RefillOrder): string {
  switch (order.step) {
    case "prescriptions": {
      const list = order.prescriptions
        .map((rx) => `${rx.selected ? "[selected] " : ""}${rx.name} from ${rx.doctor}, ${rx.refillsLeft} refills left`)
        .join("; ");
      return `Step 1 of 4: choose prescriptions to refill. Available: ${list}.`;
    }
    case "insurance":
      return `Step 2 of 4: choose how to pay. Options: ${order.insurancePlans.map((p) => p.name).join(", ")}.`;
    case "fulfillment":
      return `Step 3 of 4: choose pickup or delivery and a time slot. Delivery slots: ${DELIVERY_SLOTS.join(", ")}. Pickup slots: ${PICKUP_SLOTS.join(", ")}.`;
    case "review":
      return `Step 4 of 4: review and confirm.\n${orderSummary(order)}`;
    case "done":
      return `Done. ${orderSummary(order)}`;
  }
}
