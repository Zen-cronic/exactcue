import { describe, expect, it, vi } from "vitest";
import { startCueSpeech } from "./cueSpeech";

describe("exact cue speech", () => {
  it("starts only when called and returns a stop control", () => {
    const speak = vi.fn();
    const cancel = vi.fn();
    const utterance = { rate: 1, pitch: 1 } as SpeechSynthesisUtterance;
    const makeUtterance = vi.fn(() => utterance);

    const stop = startCueSpeech(
      "Review this exact cue",
      {},
      { speak, cancel },
      makeUtterance,
    );

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(makeUtterance).toHaveBeenCalledWith("Review this exact cue");
    expect(utterance.rate).toBe(0.94);
    expect(speak).toHaveBeenCalledWith(utterance);
    stop();
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it("forwards speech lifecycle callbacks", () => {
    const onStart = vi.fn();
    const onEnd = vi.fn();
    const onError = vi.fn();
    const utterance = {} as SpeechSynthesisUtterance;

    startCueSpeech(
      "Cue",
      { onStart, onEnd, onError },
      { speak: vi.fn(), cancel: vi.fn() },
      () => utterance,
    );

    utterance.onstart?.({} as SpeechSynthesisEvent);
    utterance.onend?.({} as SpeechSynthesisEvent);
    utterance.onerror?.({} as SpeechSynthesisErrorEvent);
    expect(onStart).toHaveBeenCalledOnce();
    expect(onEnd).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledOnce();
  });
});
