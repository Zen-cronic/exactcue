import { useSyncExternalStore } from "react";
import {
  advance,
  availableSlots,
  describeStep,
  goBack,
  orderSummary,
  selectedPrescriptions,
  setFulfillment,
  setInsurance,
  setPrescriptionSelected,
  stepBlocker,
  submitOrder,
  STEP_ORDER,
  type StepId,
} from "./domain/refill";
import { getOrder, resetOrder, setOrder, subscribe } from "./store";
import { useWebMcp } from "./webmcp/useWebMcp";

const STEP_LABELS: Record<StepId, string> = {
  prescriptions: "Prescriptions",
  insurance: "Payment",
  fulfillment: "Pickup / delivery",
  review: "Review",
  done: "Done",
};

export default function App() {
  const order = useSyncExternalStore(subscribe, getOrder);
  const { supported, tools } = useWebMcp(order.step);
  const blocker = stepBlocker(order);

  return (
    <div className="page">
      <header className="masthead">
        <div className="brand">
          Handsfree <span className="rx">℞</span>
        </div>
        <p className="tagline">
          The refill, done by <em>your</em> agent — because reading a page and completing a
          task are not the same thing.
        </p>
      </header>

      {supported ? (
        <p className="banner banner-ok" role="status">
          WebMCP is active on this page. Ask your browser agent to “refill my prescriptions”,
          or use the controls below — both drive the same order.
        </p>
      ) : (
        <p className="banner banner-warn" role="status">
          This browser has not exposed WebMCP, so the page is running in manual mode. To see the
          agent operate it, open in Chrome 149+ with{" "}
          <code>chrome://flags/#enable-webmcp-testing</code> enabled (or the ChatGPT desktop
          in-app browser). The controls below still work by hand.
        </p>
      )}

      <div className="layout">
        <main className="flow" aria-label="Prescription refill">
          <ol className="stepper" aria-label="Progress">
            {STEP_ORDER.filter((s) => s !== "done").map((s) => (
              <li
                key={s}
                aria-current={order.step === s ? "step" : undefined}
                className={order.step === s ? "step step-current" : "step"}
              >
                {STEP_LABELS[s]}
              </li>
            ))}
          </ol>

          {order.step === "prescriptions" && (
            <fieldset>
              <legend>Which prescriptions should we refill?</legend>
              {order.prescriptions.map((rx) => (
                <label key={rx.id} className="row">
                  <input
                    type="checkbox"
                    checked={rx.selected}
                    onChange={(e) => setOrder(setPrescriptionSelected(order, rx.id, e.target.checked))}
                  />
                  <span>
                    <strong>{rx.name}</strong> — {rx.doctor}, {rx.refillsLeft} refills left
                  </span>
                </label>
              ))}
            </fieldset>
          )}

          {order.step === "insurance" && (
            <fieldset>
              <legend>How would you like to pay?</legend>
              {order.insurancePlans.map((plan) => (
                <label key={plan.id} className="row">
                  <input
                    type="radio"
                    name="insurance"
                    checked={order.chosenInsuranceId === plan.id}
                    onChange={() => setOrder(setInsurance(order, plan.id))}
                  />
                  <span>
                    <strong>{plan.name}</strong> {plan.memberId !== "—" && <>· {plan.memberId}</>}
                  </span>
                </label>
              ))}
            </fieldset>
          )}

          {order.step === "fulfillment" && (
            <fieldset>
              <legend>Pickup or delivery?</legend>
              <div className="segmented">
                <button
                  type="button"
                  className={order.fulfillmentMethod === "pickup" ? "seg seg-on" : "seg"}
                  onClick={() => setOrder(setFulfillment(order, "pickup", null))}
                >
                  Pickup
                </button>
                <button
                  type="button"
                  className={order.fulfillmentMethod === "delivery" ? "seg seg-on" : "seg"}
                  onClick={() => setOrder(setFulfillment(order, "delivery", null))}
                >
                  Delivery
                </button>
              </div>
              {order.fulfillmentMethod && (
                <div className="slots">
                  {availableSlots(order).map((slot) => (
                    <label key={slot} className="row">
                      <input
                        type="radio"
                        name="slot"
                        checked={order.fulfillmentSlot === slot}
                        onChange={() => setOrder(setFulfillment(order, order.fulfillmentMethod!, slot))}
                      />
                      <span>{slot}</span>
                    </label>
                  ))}
                </div>
              )}
              {order.fulfillmentMethod === "delivery" && (
                <p className="hint">Delivering to {order.deliveryAddress}.</p>
              )}
            </fieldset>
          )}

          {order.step === "review" && (
            <fieldset>
              <legend>Review your refill</legend>
              <pre className="summary">{orderSummary(order)}</pre>
              <button type="button" className="primary" onClick={() => setOrder(submitOrder(order))}>
                Confirm & submit
              </button>
            </fieldset>
          )}

          {order.step === "done" && (
            <div className="done" role="status">
              <h2>Refill submitted ✅</h2>
              <p>
                Confirmation <strong>{order.confirmationNumber}</strong>.
              </p>
              <pre className="summary">{orderSummary(order)}</pre>
              <button type="button" onClick={() => resetOrder()}>
                Start another refill
              </button>
            </div>
          )}

          {order.step !== "done" && (
            <div className="nav">
              <button type="button" onClick={() => setOrder(goBack(order))} disabled={order.step === "prescriptions"}>
                Back
              </button>
              {order.step !== "review" && (
                <button
                  type="button"
                  className="primary"
                  onClick={() => setOrder(advance(order))}
                  disabled={blocker !== null}
                >
                  Continue
                </button>
              )}
            </div>
          )}

          {blocker && order.step !== "done" && (
            <p className="hint hint-block">{blocker}</p>
          )}
        </main>

        <aside className="agentpane" aria-label="Agent view">
          <h2>What the agent can do now</h2>
          <p className="agentpane-sub">
            The tools available to the agent change with the step — this is the live list from{" "}
            <code>document.modelContext.getTools()</code>.
          </p>
          {supported ? (
            <ul className="toollist">
              {tools.length === 0 && <li className="muted">No tools registered.</li>}
              {tools.map((t) => (
                <li key={t.name}>
                  <code>{t.name}</code>
                  <span className="tooldesc">{t.description}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              Tools register only when WebMCP is active. In manual mode the list is empty by design.
            </p>
          )}

          <div className="narration" aria-live="polite" aria-atomic="true">
            <h3>Now</h3>
            <pre>{describeStep(order)}</pre>
          </div>
          <p className="selected-count muted">
            {selectedPrescriptions(order).length} prescription(s) selected.
          </p>
        </aside>
      </div>

      <footer className="foot">
        Coordination only — Handsfree gives no medical advice. Synthetic demo data.
      </footer>
    </div>
  );
}
