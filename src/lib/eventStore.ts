import type { NostrEvent } from '@nostrify/nostrify';
import { mergeEvents } from '@/lib/eventMerge';

/**
 * The app's database.
 *
 * There is no server here and there is not going to be one, so the durable
 * store has to live in the browser. `localStorage` was already doing that job
 * and had run out of room to do it — the query cache there is capped at 1.5MB
 * and has an eviction handler wired to it, which is what running out of room
 * looks like when you have not admitted it yet. A single contact list from a
 * well-connected account can be 40KB on its own.
 *
 * IndexedDB has hundreds of megabytes and stores structured values without
 * serialising them by hand. What it does not have is synchronous reads, and
 * the first paint cannot wait for a transaction — so every scope read in this
 * session is mirrored in memory, the mirror is warmed once at boot, and the
 * synchronous path reads the mirror.
 *
 * Scopes are named by the caller and hold a merged union rather than the last
 * response. See `eventMerge` for why that distinction is the whole point.
 */

const DB_NAME = 'nostrfeed';
const STORE = 'scopes';

/**
 * Bumped when the stored shape changes.
 *
 * A schema change deletes and recreates the object store rather than migrating
 * it: everything in here can be refetched from relays, so the cost of throwing
 * it away is one slow load, and the cost of a migration bug is an app that
 * crashes on data nobody can inspect.
 */
const DB_VERSION = 1;

/** Past this a stored scope is more misleading than helpful. */
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface StoredScope {
  scope: string;
  events: NostrEvent[];
  savedAt: number;
}

/** Everything read or written this session, so the sync path has an answer. */
const mirror = new Map<string, NostrEvent[]>();

/**
 * Opened once and shared.
 *
 * Held as the promise rather than the database so concurrent callers during
 * startup wait on one `open` instead of racing several.
 */
let connection: Promise<IDBDatabase | null> | undefined;

function open(): Promise<IDBDatabase | null> {
  if (connection) return connection;

  connection = new Promise<IDBDatabase | null>((resolve) => {
    // Absent in tests, in workers without it, and in some private modes. The
    // memory mirror alone is a working cache for the length of a session.
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }

    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);
        db.createObjectStore(STORE, { keyPath: 'scope' });
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      // Another tab is holding an older version open. Waiting would hang the
      // caller; memory-only is degraded but never stuck.
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return connection;
}

function transact(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest
): Promise<unknown> {
  return new Promise((resolve) => {
    try {
      const request = work(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
    } catch {
      // Store missing, database closing, quota refused — all of which mean
      // this read or write does not happen, and none of which are worth an
      // error somebody has to see
      resolve(undefined);
    }
  });
}

/** Whether a stored scope is recent enough to believe. */
export function isFresh(stored: StoredScope, now = Date.now()): boolean {
  return now - stored.savedAt < MAX_AGE_MS;
}

/**
 * What is already known for a scope, without waiting.
 *
 * Empty until the mirror has been warmed, which is deliberate: a caller that
 * would rather wait for the truth should await `recall`.
 */
export function recallSync(scope: string): NostrEvent[] {
  return mirror.get(scope) ?? [];
}

/** What is already known for a scope, reading storage if the mirror is cold. */
export async function recall(scope: string): Promise<NostrEvent[]> {
  const held = mirror.get(scope);
  if (held) return held;

  const db = await open();
  if (!db) return [];

  const stored = (await transact(db, 'readonly', (store) =>
    store.get(scope)
  )) as StoredScope | undefined;

  const events = stored && isFresh(stored) ? stored.events : [];

  mirror.set(scope, events);
  return events;
}

/**
 * Adds what a relay just said to what was already known, and returns the whole.
 *
 * The return value is the union rather than the argument, so a caller can use
 * this as its query function directly and get the better answer without
 * knowing that a store exists.
 */
export async function remember(
  scope: string,
  events: readonly NostrEvent[],
  cap?: number
): Promise<NostrEvent[]> {
  const merged = mergeEvents(await recall(scope), events, cap);

  mirror.set(scope, merged);

  const db = await open();
  if (db) {
    const record: StoredScope = { scope, events: merged, savedAt: Date.now() };
    await transact(db, 'readwrite', (store) => store.put(record));
  }

  return merged;
}

/** Drops one scope. */
export async function forget(scope: string): Promise<void> {
  mirror.delete(scope);

  const db = await open();
  if (db) await transact(db, 'readwrite', (store) => store.delete(scope));
}

/**
 * Drops everything.
 *
 * Signing out has to reach this, or the next person to use the browser is
 * handed the last one's cached follower lists and notifications.
 */
export async function forgetAll(): Promise<void> {
  mirror.clear();

  const db = await open();
  if (db) await transact(db, 'readwrite', (store) => store.clear());
}

/**
 * Loads every stored scope into the mirror, dropping the stale ones.
 *
 * Called once at startup so `recallSync` has answers by the time the first
 * component asks. Deliberately not awaited by the app: a slow disk should
 * delay nothing, it should only mean the first render paints from the network
 * like it used to.
 */
export async function warmEventStore(now = Date.now()): Promise<void> {
  const db = await open();
  if (!db) return;

  const stored = (await transact(db, 'readonly', (store) =>
    store.getAll()
  )) as StoredScope[] | undefined;

  if (!stored) return;

  for (const record of stored) {
    if (isFresh(record, now)) {
      // A scope already read this session is newer than the disk copy
      if (!mirror.has(record.scope)) mirror.set(record.scope, record.events);
    } else {
      await transact(db, 'readwrite', (store) => store.delete(record.scope));
    }
  }
}

/** Empties the memory mirror. For tests, which share a module instance. */
export function resetMirror(): void {
  mirror.clear();
}
