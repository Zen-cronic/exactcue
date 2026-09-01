import { describe, expect, it } from "vitest";
import {
  advance,
  canAdvance,
  eligibilityBlock,
  initialOrder,
  isEligible,
  orderSummary,
  selectedPrescriptions,
  setPharmacy,
  setPrescriptionSelected,
  stepBlocker,
  submitOrder,
} from "./refill";

describe("refill flow (collapsed: prescriptions -> pickup -> review -> done)", () => {
  it("cannot advance the first step with nothing selected", () => {
    const order = initialOrder();
    expect(stepBlocker(order)).toMatch(/No prescriptions/);
    expect(canAdvance(order)).toBe(false);
  });

  it("selects a prescription by loose name fragment", () => {
    const { order } = setPrescriptionSelected(initialOrder(), "atorvastatin", true);
    expect(selectedPrescriptions(order)).toHaveLength(1);
    expect(canAdvance(order)).toBe(true);
  });

  it("refuses to add a prescription with no refills left, with a reason", () => {
    const metformin = initialOrder().prescriptions.find((r) => r.name.includes("Metformin"))!;
    expect(isEligible(metformin)).toBe(false);
    expect(eligibilityBlock(metformin)).toMatch(/prescriber authorization/);
    const { order, note } = setPrescriptionSelected(initialOrder(), "metformin", true);
    expect(selectedPrescriptions(order)).toHaveLength(0);
    expect(note).toMatch(/prescriber authorization/);
  });

  it("walks the whole flow to a confirmation number and bumps the version", () => {
    let order = initialOrder();
    order = setPrescriptionSelected(order, "atorvastatin", true).order;
    order = setPrescriptionSelected(order, "lisinopril", true).order;
    order = advance(order); // -> pickup
    expect(order.step).toBe("pickup");
    expect(stepBlocker(order)).toMatch(/pickup pharmacy/);
    order = setPharmacy(order, "Marmora");
    order = advance(order); // -> review
    expect(order.step).toBe("review");
    const before = order.version;
    order = submitOrder(order);
    expect(order.step).toBe("done");
    expect(order.version).toBe(before + 1);
    expect(order.confirmationNumber).toBeTruthy();
    expect(orderSummary(order)).toMatch(/Confirmation/);
  });

  it("does not submit before the review step", () => {
    const { order } = setPrescriptionSelected(initialOrder(), "atorvastatin", true);
    expect(submitOrder(order).step).not.toBe("done");
  });

  it("cannot navigate from review to a false completed state", () => {
    let order = initialOrder();
    order = setPrescriptionSelected(order, "atorvastatin", true).order;
    order = advance(order);
    order = setPharmacy(order, "Marmora");
    order = advance(order);

    expect(order.step).toBe("review");
    expect(canAdvance(order)).toBe(false);
    expect(stepBlocker(order)).toMatch(/review_order.*submit_refill/);
    expect(advance(order)).toEqual(order);
    expect(order.confirmationNumber).toBeNull();
  });
});
