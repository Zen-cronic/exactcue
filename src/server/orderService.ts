import type {
  ConflictResponse,
  InvalidResponse,
  OrderView,
  StorageMode,
  SubmitOrderRequest,
  SubmittedResponse,
} from "../api/orderContract";
import { isEligible, submitOrder, type RefillOrder } from "../domain/refill";
import type { OrderRepository, VersionedOrder } from "./orderRepository";

export type ServiceSubmitResult =
  | { status: 200; body: SubmittedResponse }
  | { status: 400; body: InvalidResponse }
  | { status: 409; body: ConflictResponse };

function view(current: VersionedOrder, storage: StorageMode): OrderView {
  return { ...current, storage };
}

export async function readOrder(repository: OrderRepository, storage: StorageMode): Promise<OrderView> {
  return view(await repository.read(), storage);
}

function validateRequest(value: unknown): SubmitOrderRequest | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SubmitOrderRequest>;
  if (
    !Number.isInteger(candidate.expectedVersion) ||
    typeof candidate.expectedEtag !== "string" ||
    candidate.expectedEtag.length === 0 ||
    !Array.isArray(candidate.selectedPrescriptionIds) ||
    candidate.selectedPrescriptionIds.length === 0 ||
    !candidate.selectedPrescriptionIds.every((id) => typeof id === "string") ||
    new Set(candidate.selectedPrescriptionIds).size !== candidate.selectedPrescriptionIds.length ||
    typeof candidate.chosenPharmacyId !== "string" ||
    candidate.confirmed !== true
  ) {
    return null;
  }
  return candidate as SubmitOrderRequest;
}

function buildSubmittedOrder(authoritative: RefillOrder, request: SubmitOrderRequest): RefillOrder | string {
  if (authoritative.step === "done") {
    return "This refill was already submitted. Reload the current record before doing anything else.";
  }

  const selected = new Set(request.selectedPrescriptionIds);
  for (const id of selected) {
    const prescription = authoritative.prescriptions.find((item) => item.id === id);
    if (!prescription) return `Prescription ${id} is not part of the authoritative record.`;
    if (!isEligible(prescription)) {
      return `${prescription.name} is no longer eligible for refill and was not submitted.`;
    }
  }
  if (!authoritative.pharmacies.some((item) => item.id === request.chosenPharmacyId)) {
    return "The selected pickup pharmacy is not part of the authoritative record.";
  }

  const review: RefillOrder = {
    ...authoritative,
    step: "review",
    prescriptions: authoritative.prescriptions.map((item) => ({ ...item, selected: selected.has(item.id) })),
    chosenPharmacyId: request.chosenPharmacyId,
    confirmationNumber: null,
  };
  const submitted = submitOrder(review);
  return submitted.step === "done"
    ? submitted
    : "The authoritative record could not be submitted. Nothing was changed.";
}

function conflict(current: VersionedOrder, storage: StorageMode): ServiceSubmitResult {
  return {
    status: 409,
    body: {
      kind: "conflict",
      message:
        "This review is stale because the authoritative record changed. Nothing was submitted from this session. Reload the current record, hear the new read-back, and confirm again.",
      current: view(current, storage),
    },
  };
}
export async function submitOrderIntent(
  repository: OrderRepository,
  storage: StorageMode,
  input: unknown,
): Promise<ServiceSubmitResult> {
  const request = validateRequest(input);
  if (!request) {
    return {
      status: 400,
      body: { kind: "invalid", message: "The submit request is incomplete. Nothing was submitted." },
    };
  }

  const authoritative = await repository.read();
  if (request.expectedEtag !== authoritative.etag || request.expectedVersion !== authoritative.order.version) {
    return conflict(authoritative, storage);
  }

  const next = buildSubmittedOrder(authoritative.order, request);
  if (typeof next === "string") return { status: 400, body: { kind: "invalid", message: next } };

  const result = await repository.compareAndSwap(request.expectedEtag, next);
  if (result.status === "conflict") return conflict(result.current, storage);
  return {
    status: 200,
    body: {
      kind: "submitted",
      message: `Refill submitted as ${result.current.order.confirmationNumber}.`,
      current: view(result.current, storage),
    },
  };
}
