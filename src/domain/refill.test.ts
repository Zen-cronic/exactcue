import { describe, expect, it } from "vitest";
import {
  advance,
  canAdvance,
  initialOrder,
  orderSummary,
  selectedPrescriptions,
  setFulfillment,
  setInsurance,
  setPrescriptionSelected,
  stepBlocker,
  submitOrder,
} from "./refill";

describe("refill flow", () => {
  it("cannot advance the first step with nothing selected", () => {
    const order = initialOrder();
    expect(stepBlocker(order)).toMatch(/No prescriptions/);
    expect(canAdvance(order)).toBe(false);
  });

  it("selects a prescription by loose name fragment", () => {
    const order = setPrescriptionSelected(initialOrder(), "atorvastatin", true);
    expect(selectedPrescriptions(order)).toHaveLength(1);
    expect(canAdvance(order)).toBe(true);
  });

  it("walks the whole flow to a confirmation number", () => {
    let order = initialOrder();
    order = setPrescriptionSelected(order, "atorvastatin", true);
    order = setPrescriptionSelected(order, "lisinopril", true);
    order = advance(order); // -> insurance
    expect(order.step).toBe("insurance");
    order = setInsurance(order, "BlueShield");
    order = advance(order); // -> fulfillment
    expect(order.step).toBe("fulfillment");
    order = setFulfillment(order, "delivery", "Thursday");
    expect(order.fulfillmentSlot).toBe("Thursday 4–6 PM");
    order = advance(order); // -> review
    expect(order.step).toBe("review");
    order = submitOrder(order);
    expect(order.step).toBe("done");
    expect(order.confirmationNumber).toBeTruthy();
    expect(orderSummary(order)).toMatch(/Confirmation/);
  });

  it("will not advance fulfillment without a slot", () => {
    let order = initialOrder();
    order = setPrescriptionSelected(order, "metformin", true);
    order = advance(order);
    order = setInsurance(order, "out of pocket");
    order = advance(order);
    order = setFulfillment(order, "pickup", null); // no slot
    expect(stepBlocker(order)).toMatch(/time slot/);
    expect(canAdvance(order)).toBe(false);
  });

  it("does not submit before the review step", () => {
    const order = setPrescriptionSelected(initialOrder(), "atorvastatin", true);
    expect(submitOrder(order).step).not.toBe("done");
  });
});
