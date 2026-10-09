import type { EventLogEntry } from "@bbn/shared";

const MAX_ENTRIES = 500;

/** Everything notable that happened in the house, newest last. In memory for now (saved to the database from M7). */
export class EventLog {
  private readonly entries: EventLogEntry[] = [];
  private nextId = 1;

  constructor(private readonly onAdd: (entry: EventLogEntry) => void) {}

  add(type: string, text: string): void {
    const entry: EventLogEntry = { id: this.nextId++, at: Date.now(), type, text };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
    console.log(`[event] ${type}: ${text}`);
    this.onAdd(entry);
  }

  all(): EventLogEntry[] {
    return [...this.entries];
  }
}
