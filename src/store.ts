// One client session shared by the human UI and WebMCP tools. The server owns
// the authoritative order; local choices are an uncommitted review proposal.

import { fetchAuthoritativeOrder, submitAuthoritativeOrder } from "./api/orderClient";
import type { OrderView, StorageMode } from "./api/orderContract";
import {
  createDemoSessionId,
  parseDemoSessionId,
  type DemoSessionId,
} from "./api/demoSession";
import { initialOrder, selectedPrescriptions, type RefillOrder } from "./domain/refill";

export type SessionPhase = "loading" | "ready" | "submitting" | "conflict" | "error";

interface ReviewReceipt {
  expectedVersion: number;
  expectedEtag: string;
  selectedPrescriptionIds: string[];
  chosenPharmacyId: string;
}

export interface OrderSession {
  sessionId: DemoSessionId;
  order: RefillOrder;
  etag: string | null;
  storage: StorageMode | null;
  phase: SessionPhase;
  message: string | null;
  conflict: OrderView | null;
  reviewReceipt: ReviewReceipt | null;
}

export type SubmitSessionResult =
  | { kind: "submitted"; message: string }
  | { kind: "conflict"; message: string }
  | { kind: "invalid"; message: string }
  | { kind: "error"; message: string };

type Listener = () => void;

const SESSION_STORAGE_KEY = "exactcue-demo-session";

function putSessionInUrl(sessionId: DemoSessionId, mode: "push" | "replace"): void {
  const url = new URL(window.location.href);
  url.searchParams.set("session", sessionId);
  if (mode === "push") window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
  window.sessionStorage.setItem(SESSION_STORAGE_KEY, sessionId);
}

function initialSessionId(): DemoSessionId {
  const fromUrl = parseDemoSessionId(new URL(window.location.href).searchParams.get("session"));
  if (fromUrl) {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, fromUrl);
    return fromUrl;
  }
  const stored = parseDemoSessionId(window.sessionStorage.getItem(SESSION_STORAGE_KEY));
  const sessionId = stored ?? createDemoSessionId();
  putSessionInUrl(sessionId, "replace");
  return sessionId;
}

let current: OrderSession = {
  sessionId: initialSessionId(),
  order: initialOrder(),
  etag: null,
  storage: null,
  phase: "loading",
  message: null,
  conflict: null,
  reviewReceipt: null,
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
  publish({ ...current, order: next, message: null, conflict: null, reviewReceipt: null });
}

export function markReadBack(): void {
  if (
    current.phase !== "ready" ||
    current.order.step !== "review" ||
    !current.etag ||
    !current.order.chosenPharmacyId
  ) return;
  publish({
    ...current,
    reviewReceipt: {
      expectedVersion: current.order.version,
      expectedEtag: current.etag,
      selectedPrescriptionIds: selectedPrescriptions(current.order).map((item) => item.id),
      chosenPharmacyId: current.order.chosenPharmacyId,
    },
  });
}

export function hasCurrentReadBack(): boolean {
  if (
    current.phase !== "ready" ||
    current.order.step !== "review" ||
    !current.etag ||
    !current.order.chosenPharmacyId ||
    !current.reviewReceipt
  ) return false;
  const selectedIds = selectedPrescriptions(current.order).map((item) => item.id);
  return (
    current.reviewReceipt.expectedVersion === current.order.version &&
    current.reviewReceipt.expectedEtag === current.etag &&
    current.reviewReceipt.chosenPharmacyId === current.order.chosenPharmacyId &&
    current.reviewReceipt.selectedPrescriptionIds.length === selectedIds.length &&
    current.reviewReceipt.selectedPrescriptionIds.every((id, index) => id === selectedIds[index])
  );
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
  publish({ ...current, phase: "loading", message: null, conflict: null, reviewReceipt: null });
  try {
    const view = await fetchAuthoritativeOrder(current.sessionId);
    publish({
      sessionId: current.sessionId,
      order: view.order,
      etag: view.etag,
      storage: view.storage,
      phase: "ready",
      message: "Authoritative record loaded. Agent actions are now enabled.",
      conflict: null,
      reviewReceipt: null,
    });
  } catch (error) {
    publish({
      ...current,
      phase: "error",
      message: errorMessage(error),
      conflict: null,
      reviewReceipt: null,
    });
  }
}

export async function submitCurrentOrder(confirmed: boolean): Promise<SubmitSessionResult> {
  const blocker = actionBlocker();
  if (blocker) return { kind: "error", message: blocker };
  if (!confirmed) {
    return { kind: "invalid", message: "Explicit confirmation is required. Nothing was submitted." };
  }
  if (!hasCurrentReadBack() || !current.reviewReceipt) {
    return { kind: "invalid", message: "The exact current order must be read back before confirmation. Nothing was submitted." };
  }

  const submittedSession = current;
  const receipt = current.reviewReceipt;
  publish({ ...current, phase: "submitting", message: "Checking the current record…" });
  try {
    const result = await submitAuthoritativeOrder(submittedSession.sessionId, {
      ...receipt,
      confirmed,
    });

    if (result.kind === "submitted") {
      publish({
        sessionId: submittedSession.sessionId,
        order: result.current.order,
        etag: result.current.etag,
        storage: result.current.storage,
        phase: "ready",
        message: result.message,
        conflict: null,
        reviewReceipt: null,
      });
      return { kind: "submitted", message: result.message };
    }
    if (result.kind === "conflict") {
      publish({
        ...submittedSession,
        phase: "conflict",
        message: result.message,
        conflict: result.current,
        reviewReceipt: null,
      });
      return { kind: "conflict", message: result.message };
    }

    publish({ ...submittedSession, phase: "ready", message: result.message, reviewReceipt: null });
    return { kind: result.kind, message: result.message };
  } catch (error) {
    const message = errorMessage(error);
    publish({ ...submittedSession, phase: "error", message, reviewReceipt: null });
    return { kind: "error", message };
  }
}

export function recoverFromConflict(): void {
  if (!current.conflict) return;
  publish({
    sessionId: current.sessionId,
    order: current.conflict.order,
    etag: current.conflict.etag,
    storage: current.conflict.storage,
    phase: "ready",
    message: "Current record loaded. Hear the updated read-back before confirming again.",
    conflict: null,
    reviewReceipt: null,
  });
}

export async function startFreshDemo(): Promise<void> {
  const sessionId = createDemoSessionId();
  putSessionInUrl(sessionId, "push");
  publish({
    sessionId,
    order: initialOrder(),
    etag: null,
    storage: null,
    phase: "loading",
    message: "Starting a fresh isolated synthetic demo…",
    conflict: null,
    reviewReceipt: null,
  });
  await loadAuthoritativeOrder();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
