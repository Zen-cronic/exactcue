import { useEffect, useSyncExternalStore } from "react";
import {
  advance,
  describeStep,
  eligibilityBlock,
  goBack,
  isEligible,
  orderSummary,
  selectedPrescriptions,
  setPharmacy,
  setPrescriptionSelected,
  stepBlocker,
  STEP_ORDER,
  type StepId,
} from "./domain/refill";
import {
  getSession,
  loadAuthoritativeOrder,
  recoverFromConflict,
  setOrder,
  startFreshDemo,
  submitCurrentOrder,
  subscribe,
} from "./store";
import { useWebMcp } from "./webmcp/useWebMcp";

const STEP_LABELS: Record<StepId, string> = {
  prescriptions: "Prescriptions",
  pickup: "Pickup",
  review: "Review",
  done: "Done",
};

function etagLabel(etag: string | null): string {
  if (!etag) return "waiting";
  return etag.replaceAll('"', "").slice(0, 16);
}

export default function App() {
  const session = useSyncExternalStore(subscribe, getSession);
  const order = session.order;
  const { supported, tools } = useWebMcp(order.step);
  const blocker = stepBlocker(order);
  const interactive = session.phase === "ready";

  useEffect(() => {
    void loadAuthoritativeOrder();
  }, []);

  return (
    <div className="page">
      <header className="masthead">
        <div>
          <div className="eyebrow">Accessible agent control plane</div>
          <div className="brand">Handsfree <span className="rx">℞</span></div>
        </div>
        <p className="tagline">
          Marcus hears the exact refill. His agent commits only if the record is still current.
        </p>
      </header>

      <section className="proofbar" aria-label="Authoritative record status">
        <div>
          <span className={`pulse pulse-${session.phase}`} aria-hidden="true" />
          <strong>{session.storage === "netlify-blobs" ? "NETLIFY BLOBS" : "LOCAL PROOF SERVER"}</strong>
          <span>{session.phase}</span>
        </div>
        <div><span>record</span> v{order.version}</div>
        <div><span>ETag</span> <code>{etagLabel(session.etag)}</code></div>
        <div><span>run</span> <code>{session.sessionId.slice(5, 13)}</code></div>
      </section>

      {supported ? (
        <p className="banner banner-ok" role="status">
          WebMCP active. Ask your agent to “refill my prescriptions for pickup.” The page and agent
          share this same server-backed order.
        </p>
      ) : (
        <p className="banner banner-warn" role="status">
          Manual mode: this browser has not exposed WebMCP. Use Chrome with experimental WebMCP
          enabled and the Model Context Tool Inspector to drive the semantic tools.
        </p>
      )}

      {session.phase === "conflict" && session.conflict && (
        <section className="conflict" role="alert" aria-labelledby="conflict-title">
          <div className="conflict-mark" aria-hidden="true">!</div>
          <div>
            <p className="kicker">FAIL-CLOSED · NO WRITE MADE</p>
            <h2 id="conflict-title">This review is stale.</h2>
            <p>{session.message}</p>
            <div className="version-shift">
              <span>Your review <strong>v{order.version}</strong></span>
              <span aria-hidden="true">→</span>
              <span>Current record <strong>v{session.conflict.order.version}</strong></span>
            </div>
            <button type="button" className="primary" onClick={recoverFromConflict}>
              Load current record
            </button>
          </div>
        </section>
      )}

      {session.phase === "error" && (
        <section className="service-error" role="alert">
          <p className="kicker">NOTHING SUBMITTED</p>
          <h2>Authoritative service unavailable</h2>
          <p>{session.message}</p>
          <button type="button" onClick={() => void loadAuthoritativeOrder()}>Retry server read</button>
        </section>
      )}

      <div className="layout">
        <main className="flow" aria-label="Prescription refill" aria-busy={session.phase === "loading" || session.phase === "submitting"}>
          <div className="patientline">
            <div className="avatar" aria-hidden="true">MR</div>
            <div><span>Patient</span><strong>{order.patientName}</strong></div>
            <div className="synthetic">SYNTHETIC RECORD</div>
          </div>

          <ol className="stepper" aria-label="Progress">
            {STEP_ORDER.filter((step) => step !== "done").map((step) => (
              <li key={step} aria-current={order.step === step ? "step" : undefined} className={order.step === step ? "step step-current" : "step"}>
                <span>{STEP_ORDER.indexOf(step) + 1}</span>{STEP_LABELS[step]}
              </li>
            ))}
          </ol>

          {session.phase === "loading" && (
            <div className="loading" role="status"><span /> Reading the authoritative record…</div>
          )}

          {order.step === "prescriptions" && (
            <fieldset disabled={!interactive}>
              <legend>Which prescriptions should we refill?</legend>
              <p className="fieldhelp">Your agent gets the same eligibility rules shown here.</p>
              {order.prescriptions.map((prescription) => {
                const block = eligibilityBlock(prescription);
                return (
                  <label key={prescription.id} className={isEligible(prescription) ? "row" : "row row-disabled"} title={block ?? undefined}>
                    <input
                      type="checkbox"
                      checked={prescription.selected}
                      disabled={!interactive || !isEligible(prescription)}
                      onChange={(event) => setOrder(setPrescriptionSelected(order, prescription.id, event.target.checked).order)}
                    />
                    <span className="rowcopy">
                      <strong>{prescription.name}</strong>
                      <small>{prescription.doctor} · last filled {prescription.lastFilled}</small>
                    </span>
                    <span className={isEligible(prescription) ? "pill pill-ok" : "pill pill-blocked"}>
                      {isEligible(prescription) ? `${prescription.refillsLeft} left` : "prescriber auth"}
                    </span>
                  </label>
                );
              })}
            </fieldset>
          )}

          {order.step === "pickup" && (
            <fieldset disabled={!interactive}>
              <legend>Where should we send it for pickup?</legend>
              <p className="fieldhelp">No delivery address or payment data is shared with the agent.</p>
              {order.pharmacies.map((pharmacy) => (
                <label key={pharmacy.id} className="row">
                  <input
                    type="radio"
                    name="pharmacy"
                    checked={order.chosenPharmacyId === pharmacy.id}
                    onChange={() => setOrder(setPharmacy(order, pharmacy.id))}
                  />
                  <span className="rowcopy"><strong>{pharmacy.name}</strong><small>{pharmacy.address}</small></span>
                </label>
              ))}
            </fieldset>
          )}

          {order.step === "review" && (
            <fieldset disabled={!interactive || session.phase === "submitting"}>
              <legend>Hear it. Confirm it. Then commit.</legend>
              <p className="fieldhelp">The server will accept this exact review only while v{order.version} and its ETag still match.</p>
              <pre className="summary">{orderSummary(order)}</pre>
              <button type="button" className="primary submit" onClick={() => void submitCurrentOrder()}>
                {session.phase === "submitting" ? "Checking current record…" : "I confirm — submit refill"}
              </button>
            </fieldset>
          )}

          {order.step === "done" && (
            <div className="done" role="status">
              <div className="donecheck" aria-hidden="true">✓</div>
              <p className="kicker">AUTHORITATIVE RECORD v{order.version}</p>
              <h2>Refill complete</h2>
              <p>Confirmation <strong>{order.confirmationNumber}</strong></p>
              <pre className="summary">{orderSummary(order)}</pre>
              <button type="button" onClick={() => void startFreshDemo()}>Start a fresh synthetic demo</button>
            </div>
          )}

          {order.step !== "done" && (
            <div className="nav">
              <button type="button" onClick={() => setOrder(goBack(order))} disabled={!interactive || order.step === "prescriptions"}>Back</button>
              {order.step !== "review" && (
                <button type="button" className="primary" onClick={() => setOrder(advance(order))} disabled={!interactive || blocker !== null}>Continue</button>
              )}
            </div>
          )}
          {blocker && interactive && order.step !== "done" && <p className="hint hint-block">{blocker}</p>}
          {session.message && session.phase === "ready" && <p className="hint" role="status">{session.message}</p>}
        </main>

        <aside className="agentpane" aria-label="Agent view">
          <div className="agenthead">
            <div><span className="agentdot" aria-hidden="true" /><span>LIVE TOOL SURFACE</span></div>
            <strong>{tools.length} tools</strong>
          </div>
          <h2>What Marcus’s agent can do now</h2>
          <p className="agentpane-sub">This is the live result of <code>document.modelContext.getTools()</code>. Tools retire as the task moves.</p>
          {supported ? (
            <ul className="toollist">
              {tools.length === 0 && <li className="muted">Registering tools…</li>}
              {tools.map((tool) => (
                <li key={tool.name}><code>{tool.name}</code><span className="tooldesc">{tool.description}</span></li>
              ))}
            </ul>
          ) : (
            <p className="muted">Tools register only when WebMCP is active. Manual controls remain usable.</p>
          )}
          <div className="narration" aria-live="polite" aria-atomic="true">
            <h3>Spoken context</h3><pre>{describeStep(order)}</pre>
          </div>
          <div className="receipt">
            <span>Selected</span><strong>{selectedPrescriptions(order).length}</strong>
            <span>Commit guard</span><strong>version + ETag</strong>
          </div>
        </aside>
      </div>

      <footer className="foot">Coordination only · no medical advice · synthetic demo data</footer>
    </div>
  );
}
