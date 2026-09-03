import { useEffect, useSyncExternalStore } from "react";
import {
  advance,
  chosenPharmacy,
  describeStep,
  eligibilityBlock,
  goBack,
  isEligible,
  selectedPrescriptions,
  setPharmacy,
  setPrescriptionSelected,
  stepBlocker,
  STEP_ORDER,
  type RefillOrder,
  type StepId,
} from "./domain/refill";
import {
  getSession,
  loadAuthoritativeOrder,
  markReadBack,
  recoverFromConflict,
  setOrder,
  startFreshDemo,
  submitCurrentOrder,
  subscribe,
} from "./store";
import { useWebMcp } from "./webmcp/useWebMcp";

const STEP_LABELS: Record<StepId, string> = {
  prescriptions: "Choose",
  pickup: "Pickup",
  review: "Confirm",
  done: "Done",
};

function etagLabel(etag: string | null): string {
  if (!etag) return "waiting";
  return etag.replaceAll('"', "").slice(0, 16);
}

function currentAction(step: StepId, phase: ReturnType<typeof getSession>["phase"]): string {
  if (phase === "loading") return "Read current record";
  if (phase === "submitting") return "Check record freshness";
  if (phase === "conflict") return "Reload current record";
  if (phase === "error") return "Retry authoritative read";
  if (step === "prescriptions") return "Choose eligible refills";
  if (step === "pickup") return "Set pickup pharmacy";
  if (step === "review") return "Read back, then confirm";
  return "Verify receipt";
}

function primaryTool(step: StepId, phase: ReturnType<typeof getSession>["phase"]): string {
  if (phase === "conflict") return "reload_current_record";
  if (step === "prescriptions") return "set_prescription";
  if (step === "pickup") return "set_pharmacy";
  if (step === "review") return "review_order → submit_refill";
  return "describe_current_step";
}

function OrderCard({ order, etag }: { order: RefillOrder; etag: string | null }) {
  const pharmacy = chosenPharmacy(order);
  const prescriptions = selectedPrescriptions(order);

  return (
    <div className="ordercard" aria-label="Exact refill order">
      <div className="ordercard-row">
        <span>Refill</span>
        <strong>{prescriptions.map((item) => item.name).join(" + ") || "Nothing selected"}</strong>
      </div>
      <div className="ordercard-row">
        <span>Pickup</span>
        <strong>{pharmacy ? `${pharmacy.name} · ${pharmacy.address}` : "Not chosen"}</strong>
      </div>
      <div className="ordercard-guard">
        <span>Current-record guard</span>
        <code>v{order.version} · {etagLabel(etag)}</code>
      </div>
      {order.confirmationNumber && (
        <div className="ordercard-confirmation">
          <span>Confirmation</span>
          <strong>{order.confirmationNumber}</strong>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const session = useSyncExternalStore(subscribe, getSession);
  const order = session.order;
  const { supported, tools } = useWebMcp(order.step);
  const blocker = stepBlocker(order);
  const interactive = session.phase === "ready";
  const activeStepIndex = STEP_ORDER.indexOf(order.step);
  const action = currentAction(order.step, session.phase);
  const tool = primaryTool(order.step, session.phase);

  const hero = session.phase === "conflict"
    ? {
        kicker: "Current-state guard triggered",
        title: "Stale action stopped.",
        emphasis: "Nothing was written.",
        support: `Marcus reviewed v${order.version}; the server is already on v${session.conflict?.order.version ?? "?"}.`,
      }
    : order.step === "done" && order.confirmationNumber
      ? {
          kicker: "Authoritative receipt verified",
          title: "Refill confirmed.",
          emphasis: "Current record, current receipt.",
          support: "The server accepted the exact order Marcus heard and confirmed.",
        }
      : session.phase === "submitting"
        ? {
            kicker: "Commit check in progress",
            title: "Checking the record.",
            emphasis: "Commit only if it is current.",
            support: "ExactCue is matching the reviewed version and ETag at the server boundary.",
          }
        : {
            kicker: "An agent-safe prescription refill",
            title: "Refill what’s ready.",
            emphasis: "Nothing changes until you confirm.",
            support: "Marcus and his browser agent share one current order, checked by the server at commit.",
          };

  useEffect(() => {
    void loadAuthoritativeOrder();
  }, []);

  return (
    <div className="page">
      <header className="masthead">
        <div className="brandlock">
          <div className="brand">ExactCue <span className="cue" aria-hidden="true">●</span></div>
          <span className="brandline">The exact action. Your cue.</span>
        </div>
        <div className={`connection ${supported ? "connection-live" : "connection-manual"}`}>
          <span aria-hidden="true" />
          {supported ? "WebMCP connected" : "Manual controls"}
        </div>
      </header>

      <section className={`hero hero-${session.phase}`} aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow">{hero.kicker}</p>
          <h1 id="hero-title">{hero.title}<span>{hero.emphasis}</span></h1>
          <p className="hero-support">{hero.support}</p>
          {order.step === "prescriptions" && session.phase !== "conflict" && (
            <a className="hero-cta" href="#refill-action">Choose refills <span aria-hidden="true">→</span></a>
          )}
        </div>

        <div className={`commit-signal signal-${session.phase} signal-${order.step}`} aria-label={`Commit path: ${action}`}>
          <div className="signal-heading">
            <span>Current commit path</span>
            <strong>{action}</strong>
          </div>
          <div className="signal-track" aria-hidden="true"><span className="signal-fill" /><span className="signal-point" /></div>
          <ol>
            <li><span>Page</span><strong>record v{order.version}</strong></li>
            <li><span>Agent</span><strong>{tool}</strong></li>
            <li><span>Server</span><strong>{session.phase === "conflict" ? "blocked" : session.phase === "error" ? "offline" : order.step === "done" ? "receipted" : session.phase === "submitting" ? "checking" : "guarded"}</strong></li>
          </ol>
          <p>Version + ETag must still match before a refill can change.</p>
        </div>
      </section>

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
        <div className="banner banner-ok" role="status">
          <div><strong>WebMCP is live.</strong><span>Page and agent share this order.</span></div>
          <code>document.modelContext</code>
        </div>
      ) : (
        <div className="banner banner-warn" role="status">
          <div><strong>Manual controls are active.</strong><span>WebMCP is not exposed in this browser.</span></div>
          <details>
            <summary>Enable WebMCP</summary>
            <p>Use Chrome with experimental WebMCP enabled and the Model Context Tool Inspector.</p>
          </details>
        </div>
      )}

      {session.phase === "conflict" && session.conflict && (
        <section className="conflict" role="alert" aria-labelledby="conflict-title">
          <div className="conflict-mark" aria-hidden="true">!</div>
          <div className="conflict-copy">
            <p className="kicker">FAIL-CLOSED · NO WRITE MADE</p>
            <h2 id="conflict-title">v{order.version} is no longer current.</h2>
            <p>{session.message}</p>
            <button type="button" className="primary" onClick={recoverFromConflict}>Load current record <span aria-hidden="true">→</span></button>
          </div>
          <div className="version-shift" aria-label={`Reviewed version ${order.version}; current version ${session.conflict.order.version}`}>
            <span><small>Reviewed</small><strong>v{order.version}</strong></span>
            <span aria-hidden="true">→</span>
            <span><small>Current</small><strong>v{session.conflict.order.version}</strong></span>
            <em>No write</em>
          </div>
        </section>
      )}

      {session.phase === "error" && (
        <section className="service-error" role="alert">
          <p className="kicker">NOTHING SUBMITTED</p>
          <h2>Authoritative service unavailable</h2>
          <p>{session.message}</p>
          <button type="button" onClick={() => void loadAuthoritativeOrder()}>Retry current record</button>
        </section>
      )}

      <div className="layout">
        <main id="refill-action" className="flow" aria-label="Prescription refill" aria-busy={session.phase === "loading" || session.phase === "submitting"}>
          <div className="patientline">
            <div className="avatar" aria-hidden="true">MR</div>
            <div><span>Marcus’s refill</span><strong>{order.patientName}</strong></div>
            <div className="synthetic">SYNTHETIC RECORD</div>
          </div>

          <ol className="stepper" aria-label="Refill progress">
            {STEP_ORDER.filter((step) => step !== "done").map((step) => {
              const stepIndex = STEP_ORDER.indexOf(step);
              const isCurrent = order.step === step;
              const isComplete = activeStepIndex > stepIndex;
              return (
                <li
                  key={step}
                  aria-current={isCurrent ? "step" : undefined}
                  className={`step${isCurrent ? " step-current" : ""}${isComplete ? " step-complete" : ""}`}
                >
                  <span>{isComplete ? "✓" : stepIndex + 1}</span><strong>{STEP_LABELS[step]}</strong>
                </li>
              );
            })}
          </ol>

          {session.phase === "loading" && (
            <div className="loading" role="status"><span aria-hidden="true" /> <strong>Reading the current record</strong><small>Actions unlock when the server responds.</small></div>
          )}

          {order.step === "prescriptions" && (
            <fieldset disabled={!interactive}>
              <legend>Choose refills</legend>
              <p className="fieldhelp">{order.prescriptions.filter(isEligible).length} ready now · {order.prescriptions.filter((item) => !isEligible(item)).length} needs prescriber action</p>
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
                      <small>{prescription.doctor} · filled {prescription.lastFilled}</small>
                    </span>
                    <span className={isEligible(prescription) ? "pill pill-ok" : "pill pill-blocked"}>
                      {isEligible(prescription) ? `${prescription.refillsLeft} left` : "needs prescriber"}
                    </span>
                  </label>
                );
              })}
            </fieldset>
          )}

          {order.step === "pickup" && (
            <fieldset disabled={!interactive}>
              <legend>Choose pickup</legend>
              <p className="fieldhelp">Address and payment details stay outside this demo.</p>
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
              <legend>Hear the exact order</legend>
              <p className="fieldhelp">Confirm only after it matches what Marcus asked for.</p>
              <OrderCard order={order} etag={session.etag} />
              <button
                type="button"
                className="primary submit"
                onClick={() => {
                  markReadBack();
                  void submitCurrentOrder(true);
                }}
              >
                {session.phase === "submitting" ? "Checking current record…" : "I confirm · submit refill"}
              </button>
            </fieldset>
          )}

          {order.step === "done" && order.confirmationNumber && (
            <div className="done" role="status">
              <div className="donecheck" aria-hidden="true">✓</div>
              <p className="kicker">AUTHORITATIVE RECORD v{order.version}</p>
              <h2>Refill confirmed</h2>
              <p>The exact current order has a server receipt.</p>
              <OrderCard order={order} etag={session.etag} />
              <button type="button" onClick={() => void startFreshDemo()}>Start a fresh synthetic demo</button>
            </div>
          )}

          {order.step === "done" && !order.confirmationNumber && (
            <div className="service-error" role="alert">
              <p className="kicker">NOTHING SUBMITTED</p>
              <h2>Completion receipt missing</h2>
              <p>ExactCue will not claim success without an authoritative confirmation.</p>
              <button type="button" onClick={() => void loadAuthoritativeOrder()}>Reload current record</button>
            </div>
          )}

          {order.step !== "done" && (
            <div className="nav">
              <button type="button" onClick={() => setOrder(goBack(order))} disabled={!interactive || order.step === "prescriptions"}>Back</button>
              {order.step !== "review" && (
                <button type="button" className="primary" onClick={() => setOrder(advance(order))} disabled={!interactive || blocker !== null}>
                  {order.step === "prescriptions" ? "Continue to pickup" : "Continue to review"}
                </button>
              )}
            </div>
          )}
          {blocker && interactive && order.step !== "review" && order.step !== "done" && <p className="hint hint-block">{blocker}</p>}
          {session.message && session.phase === "ready" && <p className="hint" role="status">{session.message}</p>}
        </main>

        <aside className="agentpane" aria-label="Agent activity">
          <div className="agenthead">
            <div><span className="agentdot" aria-hidden="true" /><span>AGENT ACTIVITY</span></div>
            <strong>{supported ? `${tools.length} live` : "manual"}</strong>
          </div>
          <h2>{action}</h2>
          <div className="active-tool">
            <span>WebMCP action</span>
            <code>{tool}</code>
          </div>
          <div className="agent-bridge" aria-label="Shared page and agent state">
            <span><small>Page</small><strong>v{order.version}</strong></span>
            <i aria-hidden="true">↔</i>
            <span><small>Agent</small><strong>{selectedPrescriptions(order).length} selected</strong></span>
          </div>

          {supported ? (
            <>
              <div className="tool-preview" aria-label="Current WebMCP tools">
                {tools.slice(0, 3).map((registeredTool) => <code key={registeredTool.name}>{registeredTool.name}</code>)}
                {tools.length > 3 && <span>+{tools.length - 3}</span>}
              </div>
              <details className="disclosure">
                <summary>All {tools.length} WebMCP actions</summary>
                <ul className="toollist" tabIndex={0} aria-label="Registered WebMCP tools">
                  {tools.length === 0 && <li className="muted">Registering actions…</li>}
                  {tools.map((registeredTool) => (
                    <li key={registeredTool.name}><code>{registeredTool.name}</code><span className="tooldesc">{registeredTool.description}</span></li>
                  ))}
                </ul>
              </details>
            </>
          ) : (
            <p className="muted">The same refill remains available through the manual controls.</p>
          )}

          <details className="disclosure narration">
            <summary>Hear current context</summary>
            <pre>{describeStep(order)}</pre>
          </details>

          <div className="receipt">
            <span>Human decision</span><strong>required</strong>
            <span>Commit guard</span><strong>version + ETag</strong>
            <span>Data</span><strong>synthetic only</strong>
          </div>
        </aside>
      </div>

      <footer className="foot">Coordination only · no medical advice · synthetic demo data</footer>
    </div>
  );
}
