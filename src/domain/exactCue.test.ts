import { describe, expect, it } from "vitest";
import { advance, initialOrder, setPharmacy, setPrescriptionSelected } from "./refill";
import {
  createExactCue,
  cueSpokenText,
  isCueCurrent,
  publicExactCue,
  recordFingerprint,
} from "./exactCue";

function reviewOrder() {
  let order = setPrescriptionSelected(initialOrder(), "atorvastatin", true).order;
  order = advance(order);
  order = setPharmacy(order, "Marmora");
  return advance(order);
}

describe("exact cue", () => {
  it("binds the spoken review to the exact choices, version, and ETag", () => {
    const order = reviewOrder();
    const cue = createExactCue(order, '"etag-1234567890abcdef"', "agent", "cue-test-12345678");

    expect(cue.spokenText).toContain("Atorvastatin 20 mg");
    expect(cue.spokenText).toContain("Marmora Community Pharmacy");
    expect(cue.spokenText).toContain("record version 1");
    expect(isCueCurrent(cue, order, '"etag-1234567890abcdef"')).toBe(true);
    expect(publicExactCue(cue)?.recordFingerprint).toBe("etag-1234567");
  });

  it("invalidates when choices or authoritative identity change", () => {
    const order = reviewOrder();
    const cue = createExactCue(order, '"etag-one"', "screen-reader", "cue-test-12345678");
    const changedPharmacy = setPharmacy(order, "Riverside");

    expect(isCueCurrent(cue, changedPharmacy, '"etag-one"')).toBe(false);
    expect(isCueCurrent(cue, order, '"etag-two"')).toBe(false);
    expect(isCueCurrent(cue, { ...order, version: 2 }, '"etag-one"')).toBe(false);
  });

  it("keeps public record references short and labels missing records", () => {
    expect(recordFingerprint(null)).toBe("waiting");
    expect(recordFingerprint('"1234567890abcdef"')).toBe("1234567890ab");
    expect(cueSpokenText(reviewOrder())).toMatch(/Confirm only if every detail is correct/);
  });
});
