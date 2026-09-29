/**
 * Local tone library in IndexedDB, inside this browser on this device. Not synced anywhere.
 * Holds saved tones and the models seen on each amp (used as the known-model safety list when a
 * saved tone is applied later).
 */
import type { Preset, PresetEffect } from '../spark/protocol.js';

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

export function saveTone(tone: SavedTone): Promise<IDBValidKey> {
  return run(TONES, 'readwrite', (s) => s.put(tone));
}

export function deleteTone(id: string): Promise<undefined> {
  return run(TONES, 'readwrite', (s) => s.delete(id));
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
