export interface CueSpeechCallbacks {
  onStart?: () => void;
  onEnd?: () => void;
  onError?: () => void;
}

export function isCueSpeechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

export function startCueSpeech(
  text: string,
  callbacks: CueSpeechCallbacks = {},
  engine: Pick<SpeechSynthesis, "speak" | "cancel"> = window.speechSynthesis,
  makeUtterance: (copy: string) => SpeechSynthesisUtterance = (copy) => new SpeechSynthesisUtterance(copy),
): () => void {
  engine.cancel();
  const utterance = makeUtterance(text);
  utterance.rate = 0.94;
  utterance.pitch = 1;
  utterance.onstart = () => callbacks.onStart?.();
  utterance.onend = () => callbacks.onEnd?.();
  utterance.onerror = () => callbacks.onError?.();
  engine.speak(utterance);
  return () => engine.cancel();
}
