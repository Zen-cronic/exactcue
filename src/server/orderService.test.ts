import { describe, expect, it } from "vitest";
import type { SubmitOrderRequest } from "../api/orderContract";
import { parseDemoSessionId, type DemoSessionId } from "../api/demoSession";
import { initialOrder } from "../domain/refill";
import { createOrderHandler, createSessionOrderHandler } from "./orderHttp";
import { InMemoryOrderRepository } from "./orderRepository";
import { submitOrderIntent } from "./orderService";

function intent(etag: string, version = 1): SubmitOrderRequest {
  return {
    expectedVersion: version,
    expectedEtag: etag,
    selectedPrescriptionIds: ["rx-1", "rx-2"],
    chosenPharmacyId: "ph-1",
    confirmed: true,
  };
}

describe("authoritative refill submit", () => {
  it("commits a matching reviewed record exactly once", async () => {
    const repository = new InMemoryOrderRepository();
    const before = await repository.read();

    const result = await submitOrderIntent(repository, "local-memory", intent(before.etag));

    expect(result.status).toBe(200);
    expect(result.body.kind).toBe("submitted");
    if (result.body.kind !== "submitted") throw new Error("expected submitted result");
    expect(result.body.current.order.step).toBe("done");
    expect(result.body.current.order.version).toBe(2);
    expect(result.body.current.order.confirmationNumber).toMatch(/^RX-/);
    expect(result.body.current.etag).not.toBe(before.etag);
  });

  it("fails closed when another session changes the ETag", async () => {
    const repository = new InMemoryOrderRepository();
    const stale = await repository.read();
    const changed = { ...stale.order, version: stale.order.version + 1 };
    await repository.replaceFromAnotherSession(changed);

    const result = await submitOrderIntent(repository, "local-memory", intent(stale.etag));

    expect(result.status).toBe(409);
    expect(result.body.kind).toBe("conflict");
    if (result.body.kind !== "conflict") throw new Error("expected conflict result");
    expect(result.body.message).toMatch(/Nothing was submitted/);
    expect(result.body.current.order.step).toBe("prescriptions");
    expect(result.body.current.order.version).toBe(2);
  });

  it("rejects a replay of the token used by a successful commit", async () => {
    const repository = new InMemoryOrderRepository();
    const before = await repository.read();
    const first = await submitOrderIntent(repository, "local-memory", intent(before.etag));
    expect(first.status).toBe(200);

    const replay = await submitOrderIntent(repository, "local-memory", intent(before.etag));
    expect(replay.status).toBe(409);
    expect(replay.body.kind).toBe("conflict");
  });

  it("revalidates prescription eligibility on the authoritative record", async () => {
    const repository = new InMemoryOrderRepository();
    const before = await repository.read();
    const result = await submitOrderIntent(repository, "local-memory", {
      ...intent(before.etag),
      selectedPrescriptionIds: ["rx-3"],
    });

    expect(result.status).toBe(400);
    expect(result.body.kind).toBe("invalid");
    expect(result.body.message).toMatch(/no longer eligible/);
    expect((await repository.read()).order).toEqual(initialOrder());
  });

  it("requires an explicit confirmation bit", async () => {
    const repository = new InMemoryOrderRepository();
    const before = await repository.read();
    const result = await submitOrderIntent(repository, "local-memory", {
      ...intent(before.etag),
      confirmed: false,
    });

    expect(result.status).toBe(400);
    expect(result.body.kind).toBe("invalid");
  });
});
describe("order HTTP handler", () => {
  it("returns no-store authoritative reads and typed conflicts", async () => {
    const repository = new InMemoryOrderRepository();
    const handler = createOrderHandler(repository, "local-memory");
    const getResponse = await handler(new Request("http://handsfree.test/api/order"));
    const view = await getResponse.json();

    expect(getResponse.status).toBe(200);
    expect(getResponse.headers.get("cache-control")).toBe("no-store");
    expect(view.storage).toBe("local-memory");

    await repository.replaceFromAnotherSession({ ...view.order, version: 2 });
    const postResponse = await handler(
      new Request("http://handsfree.test/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(intent(view.etag)),
      }),
    );
    const conflict = await postResponse.json();

    expect(postResponse.status).toBe(409);
    expect(conflict.kind).toBe("conflict");
    expect(conflict.current.order.version).toBe(2);
  });

  it("fails safely on malformed JSON and unsupported methods", async () => {
    const handler = createOrderHandler(new InMemoryOrderRepository(), "local-memory");
    const invalid = await handler(
      new Request("http://handsfree.test/api/order", { method: "POST", body: "{" }),
    );
    const unsupported = await handler(
      new Request("http://handsfree.test/api/order", { method: "DELETE" }),
    );

    expect(invalid.status).toBe(400);
    expect((await invalid.json()).message).toMatch(/Nothing was submitted/);
    expect(unsupported.status).toBe(405);
  });
});

describe("synthetic demo sessions", () => {
  it("accepts only bounded path-safe session identifiers", () => {
    expect(parseDemoSessionId("demo-12345678")).toBe("demo-12345678");
    expect(parseDemoSessionId("DEMO-ABCDEF12")).toBe("demo-abcdef12");
    expect(parseDemoSessionId("../../orders")).toBeNull();
    expect(parseDemoSessionId("demo-short")).toBeNull();
    expect(parseDemoSessionId(`demo-${"a".repeat(59)}`)).toBeNull();
  });

  it("isolates authoritative records between valid sessions", async () => {
    const repositories = new Map<DemoSessionId, InMemoryOrderRepository>();
    const handler = createSessionOrderHandler((sessionId) => {
      const repository = repositories.get(sessionId) ?? new InMemoryOrderRepository();
      repositories.set(sessionId, repository);
      return repository;
    }, "local-memory");
    const sessionA = "demo-aaaaaaaa";
    const sessionB = "demo-bbbbbbbb";

    const aBefore = await handler(new Request(`http://handsfree.test/api/order?session=${sessionA}`));
    const aView = await aBefore.json();
    const commitA = await handler(
      new Request(`http://handsfree.test/api/order?session=${sessionA}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(intent(aView.etag)),
      }),
    );
    const bRead = await handler(new Request(`http://handsfree.test/api/order?session=${sessionB}`));
    const bView = await bRead.json();

    expect(commitA.status).toBe(200);
    expect((await commitA.json()).current.order.version).toBe(2);
    expect(bView.order.version).toBe(1);
    expect(bView.order.step).toBe("prescriptions");
    expect(repositories.size).toBe(2);
  });

  it("rejects missing or malformed sessions before creating a repository", async () => {
    let factoryCalls = 0;
    const handler = createSessionOrderHandler(() => {
      factoryCalls += 1;
      return new InMemoryOrderRepository();
    }, "local-memory");

    const missing = await handler(new Request("http://handsfree.test/api/order"));
    const malformed = await handler(
      new Request("http://handsfree.test/api/order?session=../../private"),
    );

    expect(missing.status).toBe(400);
    expect(malformed.status).toBe(400);
    expect(factoryCalls).toBe(0);
  });
});
