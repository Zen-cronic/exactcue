// One client session shared by the human UI and WebMCP tools. The server owns
// the authoritative order; local choices are an uncommitted review proposal.

import { fetchAuthoritativeOrder, submitAuthoritativeOrder } from "./api/orderClient";
import type { OrderView, StorageMode } from "./api/orderContract";
import { initialOrder, selectedPrescriptions, type RefillOrder } from "./domain/refill";

export type SessionPhase = "loading" | "ready" | "submitting" | "conflict" | "error";

export interface OrderSession {
  order: RefillOrder;
  etag: string | null;
  storage: StorageMode | null;
  phase: SessionPhase;
  message: string | null;
  conflict: OrderView | null;
  reviewed: boolean;
}

export type SubmitSessionResult =
  | { kind: "submitted"; message: string }
  | { kind: "conflict"; message: string }
  | { kind: "invalid"; message: string }
  | { kind: "error"; message: string };

type Listener = () => void;

let current: OrderSession = {
  order: initialOrder(),
  etag: null,
  storage: null,
  phase: "loading",
  message: null,
  conflict: null,
  reviewed: false,
};
const listeners = new Set<Listener>();

function publish(next: OrderSession): void {
  current = next;
  for (const listener of listeners) listener();
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The authoritative order service is unavailable. Nothing was submitted.";
}

export function getSession(): OrderSession {
  return current;
}

export function getOrder(): RefillOrder {
  return current.order;
}

export function setOrder(next: RefillOrder): void {
  if (current.phase !== "ready") return;
  publish({ ...current, order: next, message: null, conflict: null, reviewed: false });
}

export function markReviewed(): void {
  if (current.phase === "ready" && current.order.step === "review") {
    publish({ ...current, reviewed: true });
  }
}

export function hasCurrentReview(): boolean {
  return current.phase === "ready" && current.order.step === "review" && current.reviewed;
}

export function actionBlocker(): string | null {
  switch (current.phase) {
    case "loading":
      return "Wait while the authoritative record loads.";
    case "submitting":
      return "Wait while the authoritative server checks the confirmed order.";
    case "conflict":
      return "This session is stale. Reload the current record before continuing.";
    case "error":
      return "The authoritative order service is unavailable. Retry the read before continuing.";
    case "ready":
      return null;
  }
}

export async function loadAuthoritativeOrder(): Promise<void> {
  publish({ ...current, phase: "loading", message: null, conflict: null, reviewed: false });
  try {
    const view = await fetchAuthoritativeOrder();
    publish({
      order: view.order,
      etag: view.etag,
      storage: view.storage,
      phase: "ready",
      message: "Authoritative record loaded. Agent actions are now enabled.",
      conflict: null,
      reviewed: false,
    });
  } catch (error) {
    publish({
      ...current,
      phase: "error",
      message: errorMessage(error),
      conflict: null,
      reviewed: false,
    });
  }
}

export async function submitCurrentOrder(): Promise<SubmitSessionResult> {
  const blocker = actionBlocker();
  if (blocker) return { kind: "error", message: blocker };
  if (!current.etag || !current.order.chosenPharmacyId) {
    return { kind: "invalid", message: "The review is incomplete. Nothing was submitted." };
  }

  const submittedSession = current;
  const expectedEtag = current.etag;
  const chosenPharmacyId = current.order.chosenPharmacyId;
  publish({ ...current, phase: "submitting", message: "Checking the current record…" });
  try {
    const result = await submitAuthoritativeOrder({
      expectedVersion: submittedSession.order.version,
      expectedEtag,
      selectedPrescriptionIds: selectedPrescriptions(submittedSession.order).map((item) => item.id),
      chosenPharmacyId,
      confirmed: true,
    });

    if (result.kind === "submitted") {
      publish({
        order: result.current.order,
        etag: result.current.etag,
        storage: result.current.storage,
        phase: "ready",
        message: result.message,
        conflict: null,
        reviewed: false,
      });
      return { kind: "submitted", message: result.message };
    }
    if (result.kind === "conflict") {
      publish({
        ...submittedSession,
        phase: "conflict",
        message: result.message,
        conflict: result.current,
        reviewed: false,
      });
      return { kind: "conflict", message: result.message };
    }

    publish({ ...submittedSession, phase: "ready", message: result.message, reviewed: false });
    return { kind: result.kind, message: result.message };
  } catch (error) {
    const message = errorMessage(error);
    publish({ ...submittedSession, phase: "error", message, reviewed: false });
    return { kind: "error", message };
  }
}

export function recoverFromConflict(): void {
  if (!current.conflict) return;
  publish({
    order: current.conflict.order,
    etag: current.conflict.etag,
    storage: current.conflict.storage,
    phase: "ready",
    message: "Current record loaded. Hear the updated read-back before confirming again.",
    conflict: null,
    reviewed: false,
  });
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
