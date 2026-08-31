// One shared refill order that both the human UI and the WebMCP tool handlers
// read and mutate — so the page a sighted judge watches and the tools the agent
// calls are always the same live state.

import { initialOrder, type RefillOrder } from "./domain/refill";

type Listener = () => void;

let current: RefillOrder = initialOrder();
const listeners = new Set<Listener>();

export function getOrder(): RefillOrder {
  return current;
}

export function setOrder(next: RefillOrder): void {
  current = next;
  for (const listener of listeners) listener();
}

export function resetOrder(): void {
  setOrder(initialOrder());
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
