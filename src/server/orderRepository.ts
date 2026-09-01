import { initialOrder, type RefillOrder } from "../domain/refill";

export interface VersionedOrder {
  order: RefillOrder;
  etag: string;
}

export type CompareAndSwapResult =
  | { status: "committed"; current: VersionedOrder }
  | { status: "conflict"; current: VersionedOrder };

export interface OrderRepository {
  read(): Promise<VersionedOrder>;
  compareAndSwap(expectedEtag: string, next: RefillOrder): Promise<CompareAndSwapResult>;
}

function cloneOrder(order: RefillOrder): RefillOrder {
  return structuredClone(order);
}

/** Deterministic adapter for unit tests and the local Vite proof server. */
export class InMemoryOrderRepository implements OrderRepository {
  private order: RefillOrder;
  private revision = 1;

  constructor(seed: RefillOrder = initialOrder()) {
    this.order = cloneOrder(seed);
  }

  private etag(): string {
    return `"local-${this.revision}"`;
  }

  async read(): Promise<VersionedOrder> {
    return { order: cloneOrder(this.order), etag: this.etag() };
  }

  async compareAndSwap(expectedEtag: string, next: RefillOrder): Promise<CompareAndSwapResult> {
    if (expectedEtag !== this.etag()) {
      return { status: "conflict", current: await this.read() };
    }
    this.order = cloneOrder(next);
    this.revision += 1;
    return { status: "committed", current: await this.read() };
  }

  /** Test/proof hook representing an update made by another browser session. */
  async replaceFromAnotherSession(next: RefillOrder): Promise<VersionedOrder> {
    this.order = cloneOrder(next);
    this.revision += 1;
    return this.read();
  }
}
