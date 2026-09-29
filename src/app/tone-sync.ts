/**
 * My tones across devices: the library file format and how two libraries merge. Pure module (no DOM,
 * no storage), used by Export / Import now and by OneDrive sync next (owner request 2026-09-29:
 * "can my tones be available on both devices and stay in sync?").
 *
 * Saved tones are never edited, only added or deleted, so a merge is: every tone either side has,
 * minus every tone either side deleted. Deletions are kept as tombstones (id + when) so a tone
 * deleted on one device doesn't come back from the other. Nothing here talks to the amp: a tone is
 * checked against the amp's known models when it's tried or saved, as before.
 */
import type { SavedTone } from './tone-db.js';

export const LIBRARY_FORMAT = 'myspark-tones';
/** 1: tones only (first Export). 2: adds `deleted`. */
export const LIBRARY_VERSION = 2;

export interface Tombstone {
  id: string;
  deletedAt: string;
}

export interface ToneLibrary {
  format: typeof LIBRARY_FORMAT;
  version: number;
  exportedAt: string;
  tones: SavedTone[];
  deleted: Tombstone[];
}

export function buildLibrary(tones: SavedTone[], deleted: Tombstone[], now = new Date()): ToneLibrary {
  return { format: LIBRARY_FORMAT, version: LIBRARY_VERSION, exportedAt: now.toISOString(), tones, deleted };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Enough shape to list the tone and hand it to the preset checks later; anything else is skipped. */
function isTone(v: unknown): v is SavedTone {
  if (!isObject(v) || !isText(v.id) || typeof v.name !== 'string' || !isText(v.createdAt)) return false;
  if (!['ai', 'amp', 'tonecloud'].includes(v.source as string)) return false;
  const p = v.preset;
  return isObject(p) && Array.isArray(p.effects) && typeof p.name === 'string';
}

/**
 * Reads a library file (Export's JSON). Throws when it isn't one; tones that don't have the expected
 * shape are left out and counted, not guessed at.
 */
export function parseLibrary(text: string): { library: ToneLibrary; skipped: number } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('not a JSON file');
  }
  if (!isObject(raw) || raw.format !== LIBRARY_FORMAT) throw new Error('not a mySpark tones file');
  if (typeof raw.version !== 'number' || raw.version > LIBRARY_VERSION) throw new Error(`unsupported version ${String(raw.version)}`);
  const list = Array.isArray(raw.tones) ? raw.tones : [];
  const tones = list.filter(isTone);
  const deleted = (Array.isArray(raw.deleted) ? raw.deleted : []).filter(
    (d): d is Tombstone => isObject(d) && isText(d.id) && isText(d.deletedAt),
  );
  return {
    library: buildLibrary(tones, deleted, new Date(isText(raw.exportedAt) ? raw.exportedAt : 0)),
    skipped: list.length - tones.length,
  };
}

export interface MergeResult {
  tones: SavedTone[];
  deleted: Tombstone[];
  /** Tones this side gains. */
  added: SavedTone[];
  /** Ids this side loses (deleted on the other side). */
  removed: string[];
}

/** Merges `incoming` into `local`. Same id on both sides: local's copy stays (tones aren't edited). */
export function mergeLibraries(local: Pick<ToneLibrary, 'tones' | 'deleted'>, incoming: Pick<ToneLibrary, 'tones' | 'deleted'>): MergeResult {
  const deleted = new Map<string, Tombstone>();
  for (const t of [...local.deleted, ...incoming.deleted]) {
    const had = deleted.get(t.id);
    if (!had || t.deletedAt < had.deletedAt) deleted.set(t.id, t);
  }
  const localIds = new Set(local.tones.map((t) => t.id));
  const added = incoming.tones.filter((t, i, all) => !localIds.has(t.id) && !deleted.has(t.id) && all.findIndex((x) => x.id === t.id) === i);
  const removed = local.tones.filter((t) => deleted.has(t.id)).map((t) => t.id);
  const tones = [...local.tones.filter((t) => !deleted.has(t.id)), ...added].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { tones, deleted: [...deleted.values()], added, removed };
}

/* ------------------------------------------------------------------ short-term history
   Owner, 2026-09-29: "may need a short term vcs on the tone files". Before every change to My tones
   (save, delete, import, sync, restore) the library as it was is kept as a snapshot, so a bad merge
   or a wrong delete can be undone. Only recent ones are kept. */

export const HISTORY_MAX = 20;
export const HISTORY_DAYS = 30;

export interface Snapshot {
  id: string;
  takenAt: string;
  /** What was about to happen, e.g. 'import "tones.json"'. */
  reason: string;
  tones: SavedTone[];
}

/** Adds a snapshot (newest first) and drops ones past the count or age limit. */
export function addSnapshot(history: Snapshot[], snapshot: Snapshot, now = new Date()): Snapshot[] {
  const oldest = new Date(now.getTime() - HISTORY_DAYS * 86_400_000).toISOString();
  return [snapshot, ...history]
    .filter((s) => s.takenAt >= oldest)
    .sort((a, b) => b.takenAt.localeCompare(a.takenAt))
    .slice(0, HISTORY_MAX);
}

/**
 * Going back to a snapshot: tones added since are deleted (they stay in history), tones deleted
 * since come back. A tone that comes back gets a new id, because its old id is tombstoned and other
 * devices would delete it again on the next merge.
 */
export function planRestore(
  current: SavedTone[],
  snapshot: Snapshot,
  newId: () => string,
): { add: SavedTone[]; removeIds: string[] } {
  const keep = new Set(snapshot.tones.map((t) => t.id));
  const have = new Set(current.map((t) => t.id));
  return {
    add: snapshot.tones.filter((t) => !have.has(t.id)).map((t) => ({ ...t, id: newId() })),
    removeIds: current.filter((t) => !keep.has(t.id)).map((t) => t.id),
  };
}
