import type { EventLogEntry } from "@bbn/shared";
import { db } from "../db/client.js";
import { currentSeason } from "../accounts/seasons.js";

/** Recent entries kept in memory for the console; everything is also saved to the database. */
const MEMORY_ENTRIES = 500;

type Listener = (entry: EventLogEntry) => void;

/**
 * Everything notable that happened: joins, announcements, Diary Room sessions,
 * moderation, tasks, applications. One log for the whole server (game rooms and
 * the HTTP API both write to it); open consoles subscribe to new entries.
 */
class EventLog {
  private readonly entries: EventLogEntry[] = [];
  private readonly listeners = new Set<Listener>();
  private nextId = 1;

  /** Load recent history from the database (call once at startup). */
  async load(): Promise<void> {
    const rows = await db.eventLog.findMany({ orderBy: { id: "desc" }, take: MEMORY_ENTRIES });
    for (const r of rows.reverse()) this.entries.push({ id: r.id, at: r.createdAt.getTime(), type: r.type, text: r.text });
    this.nextId = (rows.at(-1)?.id ?? 0) + 1;
  }

  add(type: string, text: string): void {
    const entry: EventLogEntry = { id: this.nextId++, at: Date.now(), type, text };
    this.entries.push(entry);
    if (this.entries.length > MEMORY_ENTRIES) this.entries.shift();
    console.log(`[event] ${type}: ${text}`);
    for (const l of this.listeners) l(entry);
    void this.persist(entry);
  }

  all(): EventLogEntry[] {
    return [...this.entries];
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async persist(entry: EventLogEntry): Promise<void> {
    try {
      const season = await currentSeason();
      await db.eventLog.create({
        data: { id: entry.id, type: entry.type, text: entry.text, createdAt: new Date(entry.at), seasonId: season?.id ?? null },
      });
    } catch (err) {
      console.error("[event] failed to save", err);
    }
  }
}

export const eventLog = new EventLog();
