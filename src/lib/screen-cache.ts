// A tiny in-memory cache that survives screen unmount/remount, so navigating
// (back) to a screen shows its last-known data INSTANTLY instead of flashing a
// loading spinner. Screens still refetch on focus (real-time updates preserved) —
// the cache just removes the cold-remount flicker.
//
// Scope: process lifetime (cleared on app restart / reload). Keyed per
// screen+entity (e.g. `client:<id>`). Not persisted to disk — purely a UX warm
// cache, never a source of truth (RLS + the live query remain authoritative).

const store = new Map<string, unknown>();

/** Read a cached snapshot for `key` (undefined if never cached / key is null). */
export function readCache<T>(key: string | null | undefined): T | undefined {
  return key ? (store.get(key) as T | undefined) : undefined;
}

/** Write a snapshot for `key`. No-op when key is null (e.g. before id is known). */
export function writeCache<T>(key: string | null | undefined, value: T): void {
  if (key) store.set(key, value);
}

/** Drop a cached snapshot (e.g. after a delete) so it can't resurrect stale data. */
export function clearCache(key: string | null | undefined): void {
  if (key) store.delete(key);
}
