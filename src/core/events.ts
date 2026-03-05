import type { WorkstreamEvent, EventType } from "./types";

type Listener = (event: WorkstreamEvent) => void;

const BUFFER_SIZE = 1000;

export class EventBus {
  private listeners = new Map<string, Set<Listener>>();
  private buffer: WorkstreamEvent[] = [];

  on(type: EventType | "*", listener: Listener): () => void {
    const key = type;
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)!.add(listener);

    return () => {
      this.listeners.get(key)?.delete(listener);
    };
  }

  emit(event: WorkstreamEvent): void {
    // Add to ring buffer
    this.buffer.push(event);
    if (this.buffer.length > BUFFER_SIZE) {
      this.buffer.shift();
    }

    // Notify specific listeners
    const specific = this.listeners.get(event.type);
    if (specific) {
      for (const fn of specific) fn(event);
    }

    // Notify wildcard listeners
    const wildcard = this.listeners.get("*");
    if (wildcard) {
      for (const fn of wildcard) fn(event);
    }
  }

  replay(): WorkstreamEvent[] {
    return [...this.buffer];
  }
}
