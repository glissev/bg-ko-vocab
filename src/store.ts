import { get, set } from 'idb-keyval';
import type { Entry } from '../shared/types';
import { api } from './api';

const CACHE_KEY = 'entries-v1';
let entries: Entry[] = [];
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
  set(CACHE_KEY, entries).catch(() => {});
}

/**
 * The whole vocabulary lives on the client: shown instantly from IndexedDB,
 * then refreshed from the server. Search and sorting never hit the database.
 */
export const store = {
  get entries(): readonly Entry[] {
    return entries;
  },

  async load() {
    const cached = await get<Entry[]>(CACHE_KEY).catch(() => undefined);
    if (cached) {
      entries = cached;
      listeners.forEach((fn) => fn());
    }
    try {
      entries = await api.listEntries();
      emit();
    } catch (err) {
      if (!cached) throw err;
      throw Object.assign(err as Error, { usingCache: true });
    }
  },

  upsert(...rows: Entry[]) {
    for (const row of rows) {
      const i = entries.findIndex((e) => e.id === row.id);
      if (i >= 0) entries[i] = row;
      else entries.push(row);
    }
    emit();
  },

  remove(id: number) {
    entries = entries.filter((e) => e.id !== id);
    emit();
  },

  tags(): string[] {
    const all = new Set<string>();
    for (const e of entries) e.tags?.split(',').forEach((t) => t && all.add(t));
    return [...all].sort((a, b) => a.localeCompare(b, 'bg'));
  },

  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
