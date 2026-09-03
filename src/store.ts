// One client session shared by the human UI and WebMCP tools. The server owns
// the authoritative order; local choices are an uncommitted review proposal.

import { fetchAuthoritativeOrder, submitAuthoritativeOrder } from "./api/orderClient";
import type { CommitReceipt, OrderView, StorageMode } from "./api/orderContract";
import {
  createDemoSessionId,
  parseDemoSessionId,
  type DemoSessionId,
} from "./api/demoSession";
import { initialOrder, type RefillOrder } from "./domain/refill";
import {
  createExactCue,
  isCueCurrent,
  type CueReviewMethod,
  type ExactCueSnapshot,
} from "./domain/exactCue";

export type SessionPhase = "loading" | "ready" | "submitting" | "conflict" | "error";

export interface OrderSession {
  sessionId: DemoSessionId;
  order: RefillOrder;
  etag: string | null;
  storage: StorageMode | null;
  phase: SessionPhase;
  message: string | null;
  conflict: OrderView | null;
  exactCue: ExactCueSnapshot | null;
  commitReceipt: CommitReceipt | null;
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
  exactCue: null,
  commitReceipt: null,
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
  publish({ ...current, order: next, message: null, conflict: null, exactCue: null, commitReceipt: null });
}

export function markReadBack(reviewedVia: CueReviewMethod = "agent"): ExactCueSnapshot | null {
  if (
    current.phase !== "ready" ||
    current.order.step !== "review" ||
    !current.etag ||
    !current.order.chosenPharmacyId
  ) return null;
  const exactCue = isCueCurrent(current.exactCue, current.order, current.etag)
    ? { ...current.exactCue, reviewedVia }
    : createExactCue(current.order, current.etag, reviewedVia);
  publish({
    ...current,
    exactCue,
    message: `Exact cue reviewed via ${reviewedVia.replace("-", " ")}.`,
  });
  return exactCue;
}

export function hasCurrentReadBack(): boolean {
  if (
    current.phase !== "ready" ||
    current.order.step !== "review" ||
    !current.etag ||
    !current.order.chosenPharmacyId ||
    !current.exactCue
  ) return false;
  return isCueCurrent(current.exactCue, current.order, current.etag);
}

export function getExactCue(): ExactCueSnapshot | null {
  return current.exactCue;
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
  publish({ ...current, phase: "loading", message: null, conflict: null, exactCue: null, commitReceipt: null });
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
      exactCue: null,
      commitReceipt: null,
    });
  } catch (error) {
    publish({
      ...current,
      phase: "error",
      message: errorMessage(error),
      conflict: null,
      exactCue: null,
      commitReceipt: null,
    });
  }
}

export async function submitCurrentOrder(confirmed: boolean): Promise<SubmitSessionResult> {
  const blocker = actionBlocker();
  if (blocker) return { kind: "error", message: blocker };
  if (!confirmed) {
    return { kind: "invalid", message: "Explicit confirmation is required. Nothing was submitted." };
  }
  if (!hasCurrentReadBack() || !current.exactCue) {
    return { kind: "invalid", message: "The exact current order must be read back before confirmation. Nothing was submitted." };
  }

  const submittedSession = current;
  const cue = current.exactCue;
  publish({
    ...current,
    phase: "submitting",
    message: "Checking the exact cue against the current record…",
    exactCue: { ...cue, status: "checking" },
  });
  try {
    const result = await submitAuthoritativeOrder(submittedSession.sessionId, {
      cueId: cue.cueId,
      expectedVersion: cue.expectedVersion,
      expectedEtag: cue.expectedEtag,
      selectedPrescriptionIds: cue.selectedPrescriptionIds,
      chosenPharmacyId: cue.chosenPharmacyId,
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
        exactCue: { ...cue, status: "committed" },
        commitReceipt: result.receipt,
      });
      return { kind: "submitted", message: result.message };
    }
    if (result.kind === "conflict") {
      publish({
        ...submittedSession,
        phase: "conflict",
        message: result.message,
        conflict: result.current,
        exactCue: { ...cue, status: "stale" },
        commitReceipt: null,
      });
      return { kind: "conflict", message: result.message };
    }

    publish({ ...submittedSession, phase: "ready", message: result.message, exactCue: null, commitReceipt: null });
    return { kind: result.kind, message: result.message };
  } catch (error) {
    const message = errorMessage(error);
    publish({ ...submittedSession, phase: "error", message, exactCue: { ...cue, status: "reviewed" }, commitReceipt: null });
    return { kind: "error", message };
  }
}

/** Runs a real two-request compare-and-swap proof using only synthetic session data. */
export async function rehearseStaleConflict(): Promise<SubmitSessionResult> {
  const blocker = actionBlocker();
  if (blocker) return { kind: "error", message: blocker };
  if (!hasCurrentReadBack() || !current.exactCue) {
    return { kind: "invalid", message: "Review the exact cue before starting the stale-tab rehearsal." };
  }

  const staleSession = current;
  const cue = current.exactCue;
  const request = {
    cueId: cue.cueId,
    expectedVersion: cue.expectedVersion,
    expectedEtag: cue.expectedEtag,
    selectedPrescriptionIds: cue.selectedPrescriptionIds,
    chosenPharmacyId: cue.chosenPharmacyId,
    confirmed: true as const,
  };
  publish({
    ...current,
    phase: "submitting",
    message: "Rehearsal: another tab is committing this synthetic cue first…",
    exactCue: { ...cue, status: "checking" },
  });

  try {
    const competing = await submitAuthoritativeOrder(staleSession.sessionId, request);
    if (competing.kind !== "submitted") {
      const message = `The rehearsal could not stage the competing commit. ${competing.message}`;
      publish({
        ...staleSession,
        phase: competing.kind === "conflict" ? "conflict" : "error",
        message,
        conflict: competing.kind === "conflict" ? competing.current : null,
        exactCue: { ...cue, status: competing.kind === "conflict" ? "stale" : "reviewed" },
        commitReceipt: null,
      });
      return { kind: competing.kind, message };
    }

    const staleAttempt = await submitAuthoritativeOrder(staleSession.sessionId, request);
    if (staleAttempt.kind !== "conflict") {
      const message = "The stale-tab rehearsal did not receive the required conflict. Stop and retry with a fresh session.";
      publish({ ...staleSession, phase: "error", message, exactCue: { ...cue, status: "reviewed" }, commitReceipt: null });
      return { kind: "error", message };
    }

    publish({
      ...staleSession,
      phase: "conflict",
      message: "Rehearsal complete: another tab committed first; this stale tab was rejected with no second write.",
      conflict: staleAttempt.current,
      exactCue: { ...cue, status: "stale" },
      commitReceipt: null,
    });
    return { kind: "conflict", message: staleAttempt.message };
  } catch (error) {
    const message = errorMessage(error);
    publish({ ...staleSession, phase: "error", message, exactCue: { ...cue, status: "reviewed" }, commitReceipt: null });
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
    exactCue: null,
    commitReceipt: null,
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
    exactCue: null,
    commitReceipt: null,
  });
  await loadAuthoritativeOrder();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
