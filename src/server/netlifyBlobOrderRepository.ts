import { getStore } from "@netlify/blobs";
import type { DemoSessionId } from "../api/demoSession";
import { initialOrder, type RefillOrder } from "../domain/refill";
import type { CompareAndSwapResult, OrderRepository, VersionedOrder } from "./orderRepository";

const STORE_NAME = "exactcue-orders";

function requireEntry(entry: { data: unknown; etag?: string } | null): VersionedOrder | null {
  if (entry === null) return null;
  if (!entry.etag || !entry.data || typeof entry.data !== "object") {
    throw new Error("The authoritative order entry is malformed.");
  }
  const order = entry.data as Partial<RefillOrder>;
  if (
    typeof order.version !== "number" ||
    typeof order.step !== "string" ||
    !Array.isArray(order.prescriptions) ||
    !Array.isArray(order.pharmacies)
  ) {
    throw new Error("The authoritative order payload is malformed.");
  }
  return { order: order as RefillOrder, etag: entry.etag };
}

/** Site-wide Netlify Blobs adapter. Conditional writes are the production CAS. */
export class NetlifyBlobOrderRepository implements OrderRepository {
  private readonly store = getStore(STORE_NAME);
  private readonly orderKey: string;

  constructor(sessionId: DemoSessionId) {
    this.orderKey = `sessions/${sessionId}/marcus-refill`;
  }

  private async readExisting(): Promise<VersionedOrder | null> {
    const entry = await this.store.getWithMetadata(this.orderKey, { type: "json", consistency: "strong" });
    return requireEntry(entry);
  }

  async read(): Promise<VersionedOrder> {
    const existing = await this.readExisting();
    if (existing) return existing;

    const seed = initialOrder();
    const created = await this.store.setJSON(this.orderKey, seed, { onlyIfNew: true });
    if (created.modified && created.etag) return { order: seed, etag: created.etag };

    const winner = await this.readExisting();
    if (!winner) throw new Error("The authoritative order could not be initialized.");
    return winner;
  }

  async compareAndSwap(expectedEtag: string, next: RefillOrder): Promise<CompareAndSwapResult> {
    const write = await this.store.setJSON(this.orderKey, next, { onlyIfMatch: expectedEtag });
    if (write.modified && write.etag) {
      return { status: "committed", current: { order: next, etag: write.etag } };
    }
    return { status: "conflict", current: await this.read() };
  }
}
