import type { EventLogEntry } from "@bbn/shared";
import { db } from "../db/client.js";

/** Recent entries kept in memory for the console; everything is also saved to the database. */
const MEMORY_ENTRIES = 500;

/** An entry plus the season (house) it belongs to; null for platform-wide events. */
interface StoredEntry extends EventLogEntry {
  seasonId: string | null;
}

type Listener = (entry: EventLogEntry, seasonId: string | null) => void;

/**
 * Everything notable that happened: joins, announcements, Diary Room sessions,
 * moderation, tasks, applications. One log for the whole server (game rooms and
 * the HTTP API both write to it); open consoles subscribe to new entries.
 */
class EventLog {
  private readonly entries: StoredEntry[] = [];
  private readonly listeners = new Set<Listener>();
  private nextId = 1;

  /** Load recent history from the database (call once at startup). */
  async load(): Promise<void> {
    const rows = await db.eventLog.findMany({ orderBy: { id: "desc" }, take: MEMORY_ENTRIES });
    for (const r of rows.reverse()) {
      this.entries.push({ id: r.id, at: r.createdAt.getTime(), type: r.type, text: r.text, seasonId: r.seasonId });
    }
    this.nextId = (rows.at(-1)?.id ?? 0) + 1;
  }

  add(type: string, text: string, seasonId: string | null): void {
    const entry: StoredEntry = { id: this.nextId++, at: Date.now(), type, text, seasonId };
    this.entries.push(entry);
    if (this.entries.length > MEMORY_ENTRIES) this.entries.shift();
    console.log(`[event] ${type}: ${text}`);
    const { seasonId: _s, ...publicEntry } = entry;
    for (const l of this.listeners) l(publicEntry, seasonId);
    void this.persist(entry);
  }

  /** Recent entries for one season's console. */
  forSeason(seasonId: string): EventLogEntry[] {
    return this.entries.filter((e) => e.seasonId === seasonId).map(({ seasonId: _s, ...e }) => e);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async persist(entry: StoredEntry): Promise<void> {
    try {
      await db.eventLog.create({
        data: { id: entry.id, type: entry.type, text: entry.text, createdAt: new Date(entry.at), seasonId: entry.seasonId },
      });
    } catch (err) {
      console.error("[event] failed to save", err);
    }
  }
}

export const eventLog = new EventLog();
