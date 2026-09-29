/**
 * Local tone library in IndexedDB, inside this browser on this device. Shared with other devices
 * through Export / Import (tone-sync.ts), which merge by id and keep deletions as tombstones.
 * Holds saved tones and the models seen on each amp (used as the known-model safety list when a
 * saved tone is applied later).
 */
import type { Preset, PresetEffect } from '../spark/protocol.js';
import { type MergeResult, type Snapshot, type Tombstone, addSnapshot } from './tone-sync.js';

export interface SavedTone {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  source: 'ai' | 'amp' | 'tonecloud';
  /** What was asked of the AI, for AI tones. */
  request?: string;
  preset: Preset;
}

const DB_NAME = 'myspark';
const DB_VERSION = 1;
const TONES = 'tones';
const META = 'meta';

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TONES)) db.createObjectStore(TONES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error('Could not open the tone library'));
    };
  });
  return dbPromise;
}

function run<T>(store: string, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = op(tx.objectStore(store));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error ?? new Error('Tone library error'));
        tx.onabort = () => reject(tx.error ?? new Error('Tone library write aborted'));
      }),
  );
}

export async function listTones(): Promise<SavedTone[]> {
  const all = await run<SavedTone[]>(TONES, 'readonly', (s) => s.getAll() as IDBRequest<SavedTone[]>);
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveTone(tone: SavedTone): Promise<IDBValidKey> {
  await takeSnapshot(`before saving "${tone.name}"`);
  return run(TONES, 'readwrite', (s) => s.put(tone));
}

/* Short-term history (tone-sync.ts): the library as it was before each change. */

export async function getHistory(): Promise<Snapshot[]> {
  const row = await run<{ key: string; history: Snapshot[] } | undefined>(META, 'readonly', (s) => s.get('history'));
  return row?.history ?? [];
}

async function takeSnapshot(reason: string): Promise<void> {
  const tones = await listTones();
  const history = addSnapshot(await getHistory(), { id: crypto.randomUUID(), takenAt: new Date().toISOString(), reason, tones });
  await run(META, 'readwrite', (s) => s.put({ key: 'history', history }));
}

/** Goes back to a snapshot (planRestore's plan). The state before it is kept as a snapshot too. */
export async function applyRestore(snapshot: Snapshot, plan: { add: SavedTone[]; removeIds: string[] }): Promise<void> {
  await takeSnapshot(`before restoring the version from ${new Date(snapshot.takenAt).toLocaleString()}`);
  const deleted = await getDeleted();
  const now = new Date().toISOString();
  for (const id of plan.removeIds) if (!deleted.some((d) => d.id === id)) deleted.push({ id, deletedAt: now });
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([TONES, META], 'readwrite');
    const tones = tx.objectStore(TONES);
    for (const t of plan.add) tones.put(t);
    for (const id of plan.removeIds) tones.delete(id);
    tx.objectStore(META).put({ key: 'deleted', deleted });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Tone library error'));
    tx.onabort = () => reject(tx.error ?? new Error('Tone library write aborted'));
  });
}

/** Deletes a tone and remembers the deletion, so a merge with another device doesn't bring it back. */
export async function deleteTone(id: string, name = 'a tone'): Promise<void> {
  await takeSnapshot(`before deleting "${name}"`);
  await run(TONES, 'readwrite', (s) => s.delete(id));
  const deleted = await getDeleted();
  if (!deleted.some((d) => d.id === id)) {
    deleted.push({ id, deletedAt: new Date().toISOString() });
    await run(META, 'readwrite', (s) => s.put({ key: 'deleted', deleted }));
  }
}

export async function getDeleted(): Promise<Tombstone[]> {
  const row = await run<{ key: string; deleted: Tombstone[] } | undefined>(META, 'readonly', (s) => s.get('deleted'));
  return row?.deleted ?? [];
}

/** Writes a merge's outcome: new tones in, tones deleted elsewhere out, the combined tombstones kept. */
export async function applyMerge(merge: MergeResult, reason: string): Promise<void> {
  // Deletions learned from the other side are always kept; a snapshot only when tones change.
  if (merge.added.length || merge.removed.length) await takeSnapshot(reason);
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([TONES, META], 'readwrite');
    const tones = tx.objectStore(TONES);
    for (const t of merge.added) tones.put(t);
    for (const id of merge.removed) tones.delete(id);
    tx.objectStore(META).put({ key: 'deleted', deleted: merge.deleted });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Tone library error'));
    tx.onabort = () => reject(tx.error ?? new Error('Tone library write aborted'));
  });
}

/** Models ever read from the amp with this BLE name. */
export async function getSeenModels(device: string): Promise<Set<string>> {
  const row = await run<{ key: string; models: string[] } | undefined>(META, 'readonly', (s) => s.get(`models:${device}`));
  return new Set(row?.models ?? []);
}

export async function addSeenModels(device: string, models: Iterable<string>): Promise<Set<string>> {
  const all = await getSeenModels(device);
  for (const m of models) all.add(m);
  await run(META, 'readwrite', (s) => s.put({ key: `models:${device}`, models: [...all].sort() }));
  return all;
}

/**
 * Blocks (model + the params it had) confirmed on the amp with this BLE name, per chain position:
 * read from its slots or live sound, or switched to and verified by read-back. The newest
 * params seen for a model win.
 */
export async function getKnownBlocks(device: string): Promise<PresetEffect[][]> {
  const row = await run<{ key: string; blocks: PresetEffect[][] } | undefined>(META, 'readonly', (s) => s.get(`blocks:${device}`));
  return row?.blocks ?? [];
}

export async function addKnownBlocks(device: string, palette: readonly (readonly PresetEffect[])[]): Promise<PresetEffect[][]> {
  const blocks = await getKnownBlocks(device);
  palette.forEach((list, i) => {
    blocks[i] ??= [];
    for (const effect of list) {
      const at = blocks[i].findIndex((e) => e.name === effect.name);
      if (at >= 0) blocks[i][at] = effect;
      else blocks[i].push(effect);
    }
  });
  await run(META, 'readwrite', (s) => s.put({ key: `blocks:${device}`, blocks }));
  await addSeenModels(device, palette.flat().map((e) => e.name));
  return blocks;
}
