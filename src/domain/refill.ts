// ExactCue proof case: one deep pharmacy prescription-refill flow.
// Pure and framework-free so the UI, the WebMCP tool handlers, and the Netlify
// Function that owns the authoritative record can all drive the exact same state
// machine. Coordination only — no medical advice, no clinical judgement.

export type StepId = "prescriptions" | "pickup" | "review" | "done";

export const STEP_ORDER: StepId[] = ["prescriptions", "pickup", "review", "done"];

export interface Prescription {
  id: string;
  name: string;
  doctor: string;
  refillsLeft: number;
  lastFilled: string;
  selected: boolean;
}

export interface Pharmacy {
  id: string;
  name: string;
  address: string;
}

export interface RefillOrder {
  step: StepId;
  patientName: string;
  /** Optimistic-concurrency token owned by the server; every accepted change bumps it. */
  version: number;
  prescriptions: Prescription[];
  pharmacies: Pharmacy[];
  chosenPharmacyId: string | null;
  confirmationNumber: string | null;
}

export function isEligible(rx: Prescription): boolean {
  return rx.refillsLeft > 0;
}

export function initialOrder(): RefillOrder {
  return {
    step: "prescriptions",
    patientName: "Marcus Reyes",
    version: 1,
    prescriptions: [
      { id: "rx-1", name: "Atorvastatin 20 mg", doctor: "Dr. Nguyen", refillsLeft: 3, lastFilled: "2026-08-02", selected: false },
      { id: "rx-2", name: "Lisinopril 10 mg", doctor: "Dr. Nguyen", refillsLeft: 2, lastFilled: "2026-08-02", selected: false },
      { id: "rx-3", name: "Metformin 500 mg", doctor: "Dr. Osei", refillsLeft: 0, lastFilled: "2026-05-19", selected: false },
    ],
    pharmacies: [
      { id: "ph-1", name: "Marmora Community Pharmacy", address: "88 Marmora St" },
      { id: "ph-2", name: "Riverside Rx", address: "1220 Riverside Dr" },
    ],
    chosenPharmacyId: null,
    confirmationNumber: null,
  };
}

export function selectedPrescriptions(order: RefillOrder): Prescription[] {
  return order.prescriptions.filter((rx) => rx.selected);
}

export function findPrescription(order: RefillOrder, ref: string): Prescription | undefined {
  const needle = ref.trim().toLowerCase();
  return (
    order.prescriptions.find((rx) => rx.id === needle) ??
    order.prescriptions.find((rx) => rx.name.toLowerCase().includes(needle))
  );
}

/** Human/agent-readable reason a prescription can't be added, or null if it can. */
export function eligibilityBlock(rx: Prescription): string | null {
  return isEligible(rx)
    ? null
    : `${rx.name} has no refills left and needs prescriber authorization from ${rx.doctor} before it can be refilled.`;
}

export function setPrescriptionSelected(
  order: RefillOrder,
  ref: string,
  selected: boolean,
): { order: RefillOrder; note: string } {
  const target = findPrescription(order, ref);
  if (!target) return { order, note: `No prescription matched "${ref}".` };
  if (selected && !isEligible(target)) {
    return { order, note: eligibilityBlock(target)! };
  }
  const next = {
    ...order,
    prescriptions: order.prescriptions.map((rx) =>
      rx.id === target.id ? { ...rx, selected } : rx,
    ),
  };
  const chosen = selectedPrescriptions(next).map((rx) => rx.name);
  return { order: next, note: `Updated. Selected: ${chosen.join(", ") || "none"}.` };
}

export function setPharmacy(order: RefillOrder, ref: string): RefillOrder {
  const needle = ref.trim().toLowerCase();
  const pharmacy =
    order.pharmacies.find((p) => p.id === needle) ??
    order.pharmacies.find((p) => p.name.toLowerCase().includes(needle));
  if (!pharmacy) return order;
  return { ...order, chosenPharmacyId: pharmacy.id };
}

export function stepBlocker(order: RefillOrder): string | null {
  switch (order.step) {
    case "prescriptions":
      return selectedPrescriptions(order).length === 0 ? "No prescriptions are selected yet." : null;
    case "pickup":
      return order.chosenPharmacyId === null ? "No pickup pharmacy chosen yet." : null;
    case "review":
      return "The order is ready for read-back. Use review_order, then submit_refill after the user confirms.";
    case "done":
      return "This refill is already complete.";
  }
}

export function canAdvance(order: RefillOrder): boolean {
  return (order.step === "prescriptions" || order.step === "pickup") && stepBlocker(order) === null;
}

export function advance(order: RefillOrder): RefillOrder {
  if (!canAdvance(order)) return order;
  return { ...order, step: order.step === "prescriptions" ? "pickup" : "review" };
}

export function goBack(order: RefillOrder): RefillOrder {
  const idx = STEP_ORDER.indexOf(order.step);
  if (idx <= 0 || order.step === "done") return order;
  return { ...order, step: STEP_ORDER[idx - 1] };
}

export function chosenPharmacy(order: RefillOrder): Pharmacy | undefined {
  return order.pharmacies.find((p) => p.id === order.chosenPharmacyId);
}

function pseudoConfirmation(order: RefillOrder): string {
  const seed = selectedPrescriptions(order).length * 7 + order.version;
  return `RX-${(1000 + seed * 137).toString().slice(0, 4)}-${order.patientName.split(" ")[0].toUpperCase()}`;
}

/** The single committing action (client-side view). The authoritative commit runs
 *  server-side with an ETag compare-and-swap; see netlify/functions. */
export function submitOrder(order: RefillOrder): RefillOrder {
  if (order.step !== "review") return order;
  if (selectedPrescriptions(order).length === 0) return order;
  if (order.chosenPharmacyId === null) return order;
  return {
    ...order,
    step: "done",
    version: order.version + 1,
    confirmationNumber: pseudoConfirmation(order),
  };
}

export function orderSummary(order: RefillOrder): string {
  const rx = selectedPrescriptions(order);
  const pharmacy = chosenPharmacy(order);
  const lines = [
    `Patient: ${order.patientName}`,
    `Prescriptions (${rx.length}): ${rx.map((r) => r.name).join(", ") || "none selected"}`,
    `Pickup: ${pharmacy ? `${pharmacy.name}, ${pharmacy.address}` : "not chosen"}`,
    `Record version: ${order.version}`,
  ];
  if (order.confirmationNumber) lines.push(`Confirmation: ${order.confirmationNumber}`);
  return lines.join("\n");
}

/** Spoken-friendly description of where the user is and what they can do next. */
export function describeStep(order: RefillOrder): string {
  switch (order.step) {
    case "prescriptions": {
      const list = order.prescriptions
        .map((rx) => {
          const tag = rx.selected ? "[selected] " : !isEligible(rx) ? "[needs prescriber auth] " : "";
          return `${tag}${rx.name} from ${rx.doctor}, ${rx.refillsLeft} refills left`;
        })
        .join("; ");
      return `Step 1 of 3: choose prescriptions to refill. Available: ${list}.`;
    }
    case "pickup":
      return `Step 2 of 3: choose a pickup pharmacy. Options: ${order.pharmacies.map((p) => p.name).join(", ")}.`;
    case "review":
      return `Step 3 of 3: review and confirm.\n${orderSummary(order)}`;
    case "done":
      return `Done. ${orderSummary(order)}`;
  }
}
