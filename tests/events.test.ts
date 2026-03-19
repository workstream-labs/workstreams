import { describe, it, expect } from "bun:test";
import { EventBus } from "@workstreams/core";
import type { WorkstreamEvent, EventType } from "@workstreams/core";

function makeEvent(type: EventType, name?: string): WorkstreamEvent {
  return { type, timestamp: new Date().toISOString(), name };
}

describe("EventBus", () => {
  it("emits to specific listeners", () => {
    const bus = new EventBus();
    const received: WorkstreamEvent[] = [];

    bus.on("node:running", (e) => received.push(e));

    bus.emit(makeEvent("node:running", "a"));
    bus.emit(makeEvent("node:success", "b")); // should not be received

    expect(received).toHaveLength(1);
    expect(received[0].name).toBe("a");
  });

  it("emits to wildcard listeners", () => {
    const bus = new EventBus();
    const received: WorkstreamEvent[] = [];

    bus.on("*", (e) => received.push(e));

    bus.emit(makeEvent("node:running", "a"));
    bus.emit(makeEvent("node:success", "b"));

    expect(received).toHaveLength(2);
  });

  it("calls both specific and wildcard listeners", () => {
    const bus = new EventBus();
    const specific: WorkstreamEvent[] = [];
    const wildcard: WorkstreamEvent[] = [];

    bus.on("node:running", (e) => specific.push(e));
    bus.on("*", (e) => wildcard.push(e));

    bus.emit(makeEvent("node:running", "a"));

    expect(specific).toHaveLength(1);
    expect(wildcard).toHaveLength(1);
  });

  it("supports unsubscribe", () => {
    const bus = new EventBus();
    const received: WorkstreamEvent[] = [];

    const unsub = bus.on("node:running", (e) => received.push(e));

    bus.emit(makeEvent("node:running", "a"));
    unsub();
    bus.emit(makeEvent("node:running", "b"));

    expect(received).toHaveLength(1);
    expect(received[0].name).toBe("a");
  });

  it("replays buffered events", () => {
    const bus = new EventBus();

    bus.emit(makeEvent("node:running", "a"));
    bus.emit(makeEvent("node:success", "a"));

    const replayed = bus.replay();
    expect(replayed).toHaveLength(2);
    expect(replayed[0].type).toBe("node:running");
    expect(replayed[1].type).toBe("node:success");
  });

  it("replay returns a copy (not the internal buffer)", () => {
    const bus = new EventBus();
    bus.emit(makeEvent("node:running", "a"));

    const replayed = bus.replay();
    replayed.push(makeEvent("node:failed", "z"));

    expect(bus.replay()).toHaveLength(1);
  });

  it("ring buffer caps at 1000 events", () => {
    const bus = new EventBus();
    for (let i = 0; i < 1050; i++) {
      bus.emit(makeEvent("log:line", `n-${i}`));
    }

    const replayed = bus.replay();
    expect(replayed).toHaveLength(1000);
    // oldest events should have been evicted
    expect(replayed[0].name).toBe("n-50");
    expect(replayed[999].name).toBe("n-1049");
  });

  it("handles emit with no listeners", () => {
    const bus = new EventBus();
    // should not throw
    bus.emit(makeEvent("node:running", "a"));
    expect(bus.replay()).toHaveLength(1);
  });

  it("supports multiple listeners on same event", () => {
    const bus = new EventBus();
    const a: string[] = [];
    const b: string[] = [];

    bus.on("node:running", (e) => a.push(e.name!));
    bus.on("node:running", (e) => b.push(e.name!));

    bus.emit(makeEvent("node:running", "x"));

    expect(a).toEqual(["x"]);
    expect(b).toEqual(["x"]);
  });
});
