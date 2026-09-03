import {
  AnimatePresence,
  LayoutGroup,
  MotionConfig,
  motion,
  useReducedMotion,
} from "motion/react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { isCueSpeechSupported, startCueSpeech } from "./cueSpeech";
import {
  cueSpokenText,
  publicExactCue,
  recordFingerprint,
} from "./domain/exactCue";
import {
  advance,
  chosenPharmacy,
  eligibilityBlock,
  goBack,
  isEligible,
  selectedPrescriptions,
  setPharmacy,
  setPrescriptionSelected,
  stepBlocker,
  type RefillOrder,
  type StepId,
} from "./domain/refill";
import {
  getSession,
  hasCurrentReadBack,
  loadAuthoritativeOrder,
  markReadBack,
  recoverFromConflict,
  rehearseStaleConflict,
  setOrder,
  startFreshDemo,
  submitCurrentOrder,
  subscribe,
  type SessionPhase,
} from "./store";
import { useWebMcp } from "./webmcp/useWebMcp";

const STEPS: Array<{ id: StepId; label: string }> = [
  { id: "prescriptions", label: "Choose" },
  { id: "pickup", label: "Pickup" },
  { id: "review", label: "Hear" },
  { id: "done", label: "Receipt" },
];

const TRUST_STAGES = ["Intent", "Cue", "Check", "Receipt"] as const;

function stageIndex(step: StepId, phase: SessionPhase): number {
  if (step === "done") return 3;
  if (phase === "submitting" || phase === "conflict") return 2;
  if (step === "review") return 1;
  return 0;
}

function statusCopy(step: StepId, phase: SessionPhase, hasCue: boolean): string {
  if (phase === "loading") return "Reading the authoritative record";
  if (phase === "submitting") return "Checking this cue against the current record";
  if (phase === "conflict") return "Stale cue stopped with no write";
  if (phase === "error") return "Authoritative service unavailable; nothing submitted";
  if (step === "done") return "Authoritative receipt verified";
  if (step === "review" && hasCue) return "Exact cue reviewed; explicit confirmation required";
  if (step === "review") return "Exact cue ready to hear or review";
  if (step === "pickup") return "Pickup choice is still a draft";
  return "Refill choices are still a draft";
}

function primaryTool(step: StepId, phase: SessionPhase): string {
  if (phase === "conflict") return "reload_current_record";
  if (step === "prescriptions") return "set_prescription";
  if (step === "pickup") return "set_pharmacy";
  if (step === "review") return "review_order → submit_refill";
  return "describe_current_step";
}

function Mark({ kind = "cue" }: { kind?: "cue" | "check" | "stop" }) {
  return (
    <span className={`mark mark-${kind}`} aria-hidden="true">
      {kind === "check" ? "✓" : kind === "stop" ? "!" : "●"}
    </span>
  );
}

function TrustStage({ order, phase }: { order: RefillOrder; phase: SessionPhase }) {
  const reducedMotion = useReducedMotion();
  const active = stageIndex(order.step, phase);
  const selected = selectedPrescriptions(order);
  const pharmacy = chosenPharmacy(order);
  const isStopped = phase === "conflict";

  return (
    <div className={`trust-stage${isStopped ? " trust-stage-stopped" : ""}`} aria-label={statusCopy(order.step, phase, false)}>
      <div className="trust-stage-top">
        <span>LIVE ACTION CUSTODY</span>
        <code>record v{order.version}</code>
      </div>
      <ol className="trust-rail">
        {TRUST_STAGES.map((label, index) => (
          <li key={label} className={index < active ? "complete" : index === active ? "active" : ""}>
            <span>{index < active ? "✓" : index + 1}</span>
            <strong>{label}</strong>
          </li>
        ))}
      </ol>
      <div className="trust-line" aria-hidden="true">
        <motion.span
          animate={{ scaleX: Math.max(0.04, active / (TRUST_STAGES.length - 1)) }}
          initial={false}
          transition={reducedMotion ? { duration: 0 } : { duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
      <motion.div
        className="floating-cue"
        layoutId="trust-cue"
        transition={{ layout: { duration: reducedMotion ? 0 : 0.5, ease: [0.22, 1, 0.36, 1] } }}
      >
        <div className="floating-cue-head">
          <Mark kind={isStopped ? "stop" : order.step === "done" ? "check" : "cue"} />
          <div>
            <span>{isStopped ? "CUE STOPPED" : order.step === "done" ? "SERVER RECEIPT" : "EXACT CUE"}</span>
            <strong>{selected.length ? `${selected.length} refill${selected.length > 1 ? "s" : ""}` : "Waiting for intent"}</strong>
          </div>
        </div>
        <p>{selected.map((item) => item.name).join(" · ") || "Your reviewed request will collect here."}</p>
        <div className="floating-cue-foot">
          <span>{pharmacy?.name ?? "Pickup not chosen"}</span>
          <strong>{isStopped ? "NO WRITE" : phase === "submitting" ? "CHECKING" : order.step === "done" ? "COMMITTED" : "DRAFT"}</strong>
        </div>
      </motion.div>
    </div>
  );
}

function Stepper({ step }: { step: StepId }) {
  const active = STEPS.findIndex((item) => item.id === step);
  return (
    <ol className="stepper" aria-label="Refill progress">
      {STEPS.map((item, index) => (
        <li
          key={item.id}
          className={index < active ? "complete" : index === active ? "current" : ""}
          aria-current={index === active ? "step" : undefined}
        >
          <span>{index < active ? "✓" : index + 1}</span>
          <strong>{item.label}</strong>
        </li>
      ))}
    </ol>
  );
}

function ExactCueCard({ order, etag }: { order: RefillOrder; etag: string | null }) {
  const cue = publicExactCue(getSession().exactCue);
  const prescriptions = selectedPrescriptions(order);
  const pharmacy = chosenPharmacy(order);
  return (
    <motion.article className="exact-cue-card" layoutId="exact-cue" aria-label="Exact refill cue">
      <header>
        <div className="cue-title"><Mark kind={order.step === "done" ? "check" : "cue"} /><div><span>EXACT CUE</span><strong>{cue?.cueId.slice(0, 17) ?? "forms when reviewed"}</strong></div></div>
        <code>v{order.version} · {recordFingerprint(etag)}</code>
      </header>
      <div className="cue-body">
        <div><span>REFILL</span><strong>{prescriptions.map((item) => item.name).join(" + ")}</strong></div>
        <div><span>PICKUP</span><strong>{pharmacy ? `${pharmacy.name} · ${pharmacy.address}` : "Not chosen"}</strong></div>
      </div>
      <footer>
        <span>{cue ? `Reviewed via ${cue.reviewedVia.replace("-", " ")}` : "Not reviewed yet"}</span>
        <strong>{cue?.status.toUpperCase() ?? "DRAFT"}</strong>
      </footer>
    </motion.article>
  );
}

interface SceneProps {
  order: RefillOrder;
  interactive: boolean;
  etag: string | null;
  judgeMode: boolean;
  phase: SessionPhase;
  speechState: "idle" | "speaking" | "finished" | "unavailable";
  onHear: () => void;
  onStop: () => void;
  onReviewed: () => void;
  onNavigate: (next: RefillOrder) => void;
}

function StepScene({
  order,
  interactive,
  etag,
  judgeMode,
  phase,
  speechState,
  onHear,
  onStop,
  onReviewed,
  onNavigate,
}: SceneProps) {
  const blocker = stepBlocker(order);
  const reviewed = hasCurrentReadBack();

  if (phase === "loading") {
    return <div className="loading-scene"><span className="loader" aria-hidden="true" /><div><h2 tabIndex={-1}>Reading the current record</h2><p>Actions unlock only after the server responds.</p></div></div>;
  }

  if (order.step === "prescriptions") {
    return (
      <section className="step-scene" aria-labelledby="step-heading">
        <div className="scene-heading"><p>STEP 1 · INTENT</p><h2 id="step-heading" tabIndex={-1}>What should the agent refill?</h2><span>Only eligible prescriptions can enter the cue.</span></div>
        <fieldset disabled={!interactive}>
          <legend className="sr-only">Choose eligible prescriptions</legend>
          <div className="choice-list">
            {order.prescriptions.map((prescription) => {
              const eligible = isEligible(prescription);
              return (
                <motion.label key={prescription.id} layoutId={`rx-${prescription.id}`} className={`choice-card${prescription.selected ? " selected" : ""}${eligible ? "" : " disabled"}`}>
                  <input type="checkbox" checked={prescription.selected} disabled={!interactive || !eligible} onChange={(event) => setOrder(setPrescriptionSelected(order, prescription.id, event.target.checked).order)} />
                  <span className="choice-control" aria-hidden="true">{prescription.selected ? "✓" : ""}</span>
                  <span className="choice-copy"><strong>{prescription.name}</strong><small>{prescription.doctor} · filled {prescription.lastFilled}</small></span>
                  <span className={`availability ${eligible ? "ready" : "blocked"}`}>{eligible ? `${prescription.refillsLeft} left` : "Needs prescriber"}</span>
                  {!eligible && <span className="choice-reason">{eligibilityBlock(prescription)}</span>}
                </motion.label>
              );
            })}
          </div>
        </fieldset>
        <div className="scene-actions scene-actions-end"><span>{selectedPrescriptions(order).length} selected</span><button className="primary" disabled={!interactive || blocker !== null} onClick={() => onNavigate(advance(order))}>Continue to pickup <span aria-hidden="true">→</span></button></div>
      </section>
    );
  }

  if (order.step === "pickup") {
    return (
      <section className="step-scene" aria-labelledby="step-heading">
        <div className="scene-heading"><p>STEP 2 · PICKUP</p><h2 id="step-heading" tabIndex={-1}>Where should it be ready?</h2><span>Address and payment details stay outside this synthetic demo.</span></div>
        <fieldset disabled={!interactive}>
          <legend className="sr-only">Choose a pickup pharmacy</legend>
          <div className="choice-list pharmacy-list">
            {order.pharmacies.map((pharmacy) => (
              <motion.label key={pharmacy.id} layoutId={`pharmacy-${pharmacy.id}`} className={`choice-card${order.chosenPharmacyId === pharmacy.id ? " selected" : ""}`}>
                <input type="radio" name="pharmacy" checked={order.chosenPharmacyId === pharmacy.id} onChange={() => setOrder(setPharmacy(order, pharmacy.id))} />
                <span className="choice-control radio" aria-hidden="true">{order.chosenPharmacyId === pharmacy.id ? "●" : ""}</span>
                <span className="choice-copy"><strong>{pharmacy.name}</strong><small>{pharmacy.address}</small></span>
                <span className="availability ready">Pickup</span>
              </motion.label>
            ))}
          </div>
        </fieldset>
        <div className="scene-actions"><button onClick={() => onNavigate(goBack(order))}>← Back</button><button className="primary" disabled={!interactive || blocker !== null} onClick={() => onNavigate(advance(order))}>Build exact cue <span aria-hidden="true">→</span></button></div>
      </section>
    );
  }

  if (order.step === "review") {
    return (
      <section className="step-scene review-scene" aria-labelledby="step-heading">
        <div className="scene-heading"><p>STEP 3 · YOUR CUE</p><h2 id="step-heading" tabIndex={-1}>Hear exactly what will happen.</h2><span>Confirmation unlocks only after this current cue is reviewed.</span></div>
        <ExactCueCard order={order} etag={etag} />
        <blockquote className="cue-transcript"><span>READBACK</span><p>{cueSpokenText(order)}</p></blockquote>
        <div className="review-controls">
          {speechState === "speaking" ? (
            <button className="listen active" aria-pressed="true" onClick={onStop}><span aria-hidden="true" className="sound-bars"><i /><i /><i /></span> Stop reading</button>
          ) : (
            <button className="listen" onClick={onHear} disabled={speechState === "unavailable"}><span aria-hidden="true">◖))</span> {speechState === "unavailable" ? "Speech unavailable" : "Hear exact cue"}</button>
          )}
          <button className="text-action" onClick={onReviewed}>{reviewed ? "✓ Cue reviewed" : "I reviewed the visible cue"}</button>
        </div>
        <div className="consent-boundary">
          <div><span>HUMAN DECISION</span><strong>{reviewed ? "Ready for your confirmation" : "Review required"}</strong><p>The agent cannot confirm for you.</p></div>
          <button className="primary commit" disabled={!interactive || !reviewed} onClick={() => void submitCurrentOrder(true)}>{phase === "submitting" ? "Checking current record…" : "I confirm · check and submit"}</button>
        </div>
        {judgeMode && (
          <div className="judge-rehearsal">
            <div><span>JUDGE PROOF MODE</span><strong>Can a stale tab submit twice?</strong><p>Uses two real requests against this synthetic record. The second must receive 409 and make no write.</p></div>
            <button disabled={!interactive || !reviewed} onClick={() => void rehearseStaleConflict()}>Rehearse stale tab</button>
          </div>
        )}
        <div className="scene-actions scene-actions-start"><button onClick={() => onNavigate(goBack(order))} disabled={!interactive}>← Change details</button></div>
      </section>
    );
  }

  return (
    <section className="done-scene" aria-labelledby="step-heading">
      <motion.div className="success-orbit" initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}><Mark kind="check" /></motion.div>
      <p>AUTHORITATIVE RECORD v{order.version}</p>
      <h2 id="step-heading" tabIndex={-1}>Current cue. Current receipt.</h2>
      <span>The server accepted the exact order that was reviewed and confirmed.</span>
      <ExactCueCard order={order} etag={etag} />
      <div className="receipt-number"><span>CONFIRMATION</span><strong>{order.confirmationNumber}</strong></div>
      <button onClick={() => void startFreshDemo()}>Start a fresh synthetic demo</button>
    </section>
  );
}

function ProofPanel({ supported, tools, order, phase, judgeMode }: { supported: boolean; tools: ReturnType<typeof useWebMcp>["tools"]; order: RefillOrder; phase: SessionPhase; judgeMode: boolean }) {
  const session = getSession();
  return (
    <aside className="proof-panel" aria-label="Why this action is safe">
      <div className="proof-panel-head"><div><span>WHY THIS IS SAFE</span><strong>{supported ? "Agent and page share custody" : "Manual fallback active"}</strong></div><span className={`connection-dot ${supported ? "live" : "manual"}`} aria-hidden="true" /></div>
      <div className="proof-grid">
        <div><span>Record</span><strong>v{order.version}</strong></div>
        <div><span>Fingerprint</span><code>{recordFingerprint(session.etag)}</code></div>
        <div><span>Storage</span><strong>{session.storage === "netlify-blobs" ? "Netlify Blobs" : "Local proof"}</strong></div>
        <div><span>State</span><strong>{phase}</strong></div>
      </div>
      <div className="active-action"><span>ACTIVE WEBMCP ACTION</span><code>{primaryTool(order.step, phase)}</code></div>
      <details>
        <summary>{supported ? `${tools.length} available tools` : "Enable WebMCP"}<span aria-hidden="true">+</span></summary>
        {supported ? <ul>{tools.map((tool) => <li key={tool.name}><code>{tool.name}</code><span>{tool.description}</span></li>)}</ul> : <p>Use Chrome 149+ with experimental WebMCP enabled. Every task remains available through the visible controls.</p>}
      </details>
      <div className="safety-contract">
        <div><Mark kind="check" /><span><strong>Exact readback</strong><small>One cue, shared by user and agent</small></span></div>
        <div><Mark kind="check" /><span><strong>Human confirmation</strong><small>Required immediately before commit</small></span></div>
        <div><Mark kind="check" /><span><strong>Current-record guard</strong><small>Version + ETag compare-and-swap</small></span></div>
      </div>
      {judgeMode && <div className="judge-flag">JUDGE MODE · REAL SYNTHETIC CONFLICT PROOF</div>}
    </aside>
  );
}

export default function App() {
  const session = useSyncExternalStore(subscribe, getSession);
  const { supported, tools } = useWebMcp(session.order.step);
  const [speechState, setSpeechState] = useState<"idle" | "speaking" | "finished" | "unavailable">("idle");
  const stopSpeechRef = useRef<(() => void) | null>(null);
  const reducedMotion = useReducedMotion();
  const judgeMode = useMemo(() => new URL(window.location.href).searchParams.get("judge") === "1", []);
  const hasCue = !!session.exactCue;
  const currentStage = stageIndex(session.order.step, session.phase);

  useEffect(() => { void loadAuthoritativeOrder(); }, []);
  useEffect(() => () => { stopSpeechRef.current?.(); }, [session.order.step]);
  useEffect(() => {
    if (!isCueSpeechSupported()) setSpeechState("unavailable");
  }, []);

  function navigate(next: RefillOrder): void {
    if (next === session.order) return;
    stopSpeechRef.current?.();
    setSpeechState(isCueSpeechSupported() ? "idle" : "unavailable");
    setOrder(next);
    window.setTimeout(() => document.querySelector<HTMLElement>("#step-heading")?.focus(), reducedMotion ? 0 : 380);
  }

  function hearCue(): void {
    const cue = markReadBack("speech");
    if (!cue || !isCueSpeechSupported()) {
      setSpeechState("unavailable");
      return;
    }
    stopSpeechRef.current = startCueSpeech(cue.spokenText, {
      onStart: () => setSpeechState("speaking"),
      onEnd: () => setSpeechState("finished"),
      onError: () => setSpeechState("idle"),
    });
  }

  function stopSpeech(): void {
    stopSpeechRef.current?.();
    stopSpeechRef.current = null;
    setSpeechState("idle");
  }

  const announcement = session.message ?? statusCopy(session.order.step, session.phase, hasCue);

  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}>
      <LayoutGroup>
        <div className={`page phase-${session.phase}`}>
          <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
          <header className="masthead">
            <a className="brandlock" href="#top" aria-label="ExactCue home"><span className="brandmark" aria-hidden="true"><i /><i /></span><span><strong>ExactCue</strong><small>The exact action. Your cue.</small></span></a>
            <div className="masthead-center"><span>BLIND-FIRST ACTION CUSTODY</span></div>
            <div className={`connection ${supported ? "live" : "manual"}`}><span aria-hidden="true" />{supported ? "WebMCP live" : "Manual controls"}</div>
          </header>

          <main id="top">
            <section className="hero">
              <div className="hero-copy">
                <p className="eyebrow"><span>01</span> AGENT-ASSISTED REFILLS, WITH A HUMAN FINAL WORD</p>
                <h1>Let the agent prepare it.<br /> <em>You give the exact cue.</em></h1>
                <p className="hero-support">Hear one precise readback, confirm it yourself, and let the server commit only while that record is still current.</p>
                <a href="#refill-flow" className="hero-link">Start Marcus’s synthetic refill <span aria-hidden="true">↘</span></a>
              </div>
              <TrustStage order={session.order} phase={session.phase} />
            </section>

            <div className="journey-label"><span>THE TRUST JOURNEY</span><strong>{statusCopy(session.order.step, session.phase, hasCue)}</strong><code>{currentStage + 1}/4</code></div>

            <AnimatePresence mode="wait">
              {session.phase === "conflict" && session.conflict && (
                <motion.section key="conflict" className="conflict-banner" role="alert" initial={{ opacity: 0, y: -14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <Mark kind="stop" />
                  <div><p>STALE CUE · FAIL CLOSED</p><h2>Another tab reached the current record first.</h2><span>{session.message}</span></div>
                  <div className="version-compare"><span><small>Reviewed</small><strong>v{session.order.version}</strong></span><i aria-hidden="true">→</i><span><small>Current</small><strong>v{session.conflict.order.version}</strong></span><em>NO WRITE</em></div>
                  <button className="primary" onClick={recoverFromConflict}>Load current record →</button>
                </motion.section>
              )}
              {session.phase === "error" && (
                <motion.section key="error" className="error-banner" role="alert" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <Mark kind="stop" /><div><p>NOTHING SUBMITTED</p><h2>Authoritative service unavailable.</h2><span>{session.message}</span></div><button onClick={() => void loadAuthoritativeOrder()}>Retry current record</button>
                </motion.section>
              )}
            </AnimatePresence>

            <section id="refill-flow" className="workspace" aria-label="Prescription refill journey">
              <div className="flow-card" aria-busy={session.phase === "loading" || session.phase === "submitting"}>
                <div className="patient-bar"><div className="patient"><span className="avatar" aria-hidden="true">MR</span><span><small>SYNTHETIC PATIENT</small><strong>{session.order.patientName}</strong></span></div><Stepper step={session.order.step} /></div>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div key={`${session.order.step}-${session.phase === "loading" ? "loading" : "ready"}`} className="scene-wrap" initial={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 26 }} animate={{ opacity: 1, x: 0 }} exit={reducedMotion ? { opacity: 0 } : { opacity: 0, x: -18 }}>
                    <StepScene
                      order={session.order}
                      etag={session.etag}
                      interactive={session.phase === "ready"}
                      judgeMode={judgeMode}
                      phase={session.phase}
                      speechState={speechState}
                      onHear={hearCue}
                      onStop={stopSpeech}
                      onReviewed={() => { markReadBack("screen-reader"); setSpeechState((state) => state === "unavailable" ? state : "finished"); }}
                      onNavigate={navigate}
                    />
                  </motion.div>
                </AnimatePresence>
                {session.message && session.phase === "ready" && session.order.step !== "done" && <p className="flow-note">{session.message}</p>}
              </div>
              <ProofPanel supported={supported} tools={tools} order={session.order} phase={session.phase} judgeMode={judgeMode} />
            </section>
          </main>

          <footer><span>ExactCue</span><p>Coordination only · no medical advice · synthetic demonstration data</p><a href={judgeMode ? "/" : "/?judge=1"}>{judgeMode ? "Exit judge mode" : "Open judge proof"}</a></footer>
        </div>
      </LayoutGroup>
    </MotionConfig>
  );
}
