import {
  chosenPharmacy,
  orderSummary,
  selectedPrescriptions,
  type RefillOrder,
} from "./refill";

export type CueReviewMethod = "speech" | "screen-reader" | "agent";
export type ExactCueStatus = "reviewed" | "checking" | "committed" | "stale";

export interface ExactCueSnapshot {
  cueId: string;
  status: ExactCueStatus;
  summary: string;
  spokenText: string;
  expectedVersion: number;
  expectedEtag: string;
  selectedPrescriptionIds: string[];
  chosenPharmacyId: string;
  reviewedVia: CueReviewMethod;
}

export interface PublicExactCue {
  cueId: string;
  status: ExactCueStatus;
  summary: string;
  spokenText: string;
  recordVersion: number;
  recordFingerprint: string;
  reviewedVia: CueReviewMethod;
}

export function recordFingerprint(etag: string | null): string {
  if (!etag) return "waiting";
  return etag.replaceAll('"', "").slice(0, 12);
}

export function cueSpokenText(order: RefillOrder): string {
  const prescriptions = selectedPrescriptions(order).map((item) => item.name);
  const pharmacy = chosenPharmacy(order);
  return [
    `Exact cue for ${order.patientName}.`,
    `Refill ${prescriptions.join(" and ") || "no prescriptions"}.`,
    pharmacy
      ? `Pick up at ${pharmacy.name}, ${pharmacy.address}.`
      : "No pickup pharmacy selected.",
    `This review is bound to record version ${order.version}.`,
    "Confirm only if every detail is correct.",
  ].join(" ");
}

export function createExactCue(
  order: RefillOrder,
  etag: string,
  reviewedVia: CueReviewMethod,
  cueId = `cue-${crypto.randomUUID()}`,
): ExactCueSnapshot {
  if (order.step !== "review" || !order.chosenPharmacyId) {
    throw new Error("An exact cue can only be created for a complete review.");
  }
  return {
    cueId,
    status: "reviewed",
    summary: orderSummary(order),
    spokenText: cueSpokenText(order),
    expectedVersion: order.version,
    expectedEtag: etag,
    selectedPrescriptionIds: selectedPrescriptions(order).map((item) => item.id),
    chosenPharmacyId: order.chosenPharmacyId,
    reviewedVia,
  };
}

export function isCueCurrent(
  cue: ExactCueSnapshot | null,
  order: RefillOrder,
  etag: string | null,
): cue is ExactCueSnapshot {
  if (!cue || !etag || order.step !== "review" || !order.chosenPharmacyId) return false;
  const selectedIds = selectedPrescriptions(order).map((item) => item.id);
  return (
    cue.expectedVersion === order.version &&
    cue.expectedEtag === etag &&
    cue.chosenPharmacyId === order.chosenPharmacyId &&
    cue.selectedPrescriptionIds.length === selectedIds.length &&
    cue.selectedPrescriptionIds.every((id, index) => id === selectedIds[index])
  );
}

export function publicExactCue(cue: ExactCueSnapshot | null): PublicExactCue | null {
  if (!cue) return null;
  return {
    cueId: cue.cueId,
    status: cue.status,
    summary: cue.summary,
    spokenText: cue.spokenText,
    recordVersion: cue.expectedVersion,
    recordFingerprint: recordFingerprint(cue.expectedEtag),
    reviewedVia: cue.reviewedVia,
  };
}
