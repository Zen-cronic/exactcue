import type { RefillOrder } from "../domain/refill";

export type StorageMode = "local-memory" | "netlify-blobs";

export interface OrderView {
  order: RefillOrder;
  etag: string;
  storage: StorageMode;
}

export interface SubmitOrderRequest {
  cueId: string;
  expectedVersion: number;
  expectedEtag: string;
  selectedPrescriptionIds: string[];
  chosenPharmacyId: string;
  confirmed: true;
}

export interface CommitReceipt {
  cueId: string;
  confirmationNumber: string;
  committedVersion: number;
}

export interface SubmittedResponse {
  kind: "submitted";
  message: string;
  current: OrderView;
  receipt: CommitReceipt;
}

export interface ConflictResponse {
  kind: "conflict";
  message: string;
  current: OrderView;
  attemptedCueId: string;
  noWrite: true;
}

export interface InvalidResponse {
  kind: "invalid";
  message: string;
}

export interface ErrorResponse {
  kind: "error";
  message: string;
}

export type SubmitOrderResponse = SubmittedResponse | ConflictResponse | InvalidResponse | ErrorResponse;

export function isOrderView(value: unknown): value is OrderView {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<OrderView>;
  return (
    typeof candidate.etag === "string" &&
    (candidate.storage === "local-memory" || candidate.storage === "netlify-blobs") &&
    !!candidate.order &&
    typeof candidate.order === "object" &&
    typeof candidate.order.version === "number" &&
    typeof candidate.order.step === "string"
  );
}
