/**
 * Positive Grid ToneCloud: search and fetch presets, and convert them to the amp's preset format.
 *
 * Unofficial, undocumented API (SOURCED: soundshed `sparkAPI.ts`; probed 2026-09-28): no login for
 * browsing, `Access-Control-Allow-Origin: *`, so the PWA calls it directly — never through a
 * third-party proxy. Personal use only: requests are user-initiated, small pages, no bulk download.
 * Positive Grid can change or block it at any time. Creator profiles are not shown or stored.
 *
 * Probed 2026-09-28: `preset_for=spark` is the only value returning presets (sparklive, spark2,
 * sparkgo return none); sampled presets all have `signal_chain_type: "in1"` (guitar input, 7 blocks).
 */
import type { Preset, PresetEffect } from '../spark/protocol.js';

export const TONECLOUD_API = 'https://api.positivegrid.com/v2';

export interface CloudSummary {
  id: string;
  name: string;
  description: string;
  category: string;
  downloads: number;
  likes: number;
  rating: number;
  /** Model ids in chain order, from `preset_meta.dspId` — lets unsafe presets be flagged before fetching. */
  models: string[];
  /** `in1` = guitar input (CH1-style 7-block chain). Others unseen so far. */
  chain: string;
  updated: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Pure: one search-result item → summary. Unknown shapes give empty fields rather than throwing. */
export function toSummary(raw: unknown): CloudSummary | null {
  if (!isObject(raw)) return null;
  const id = str(raw.id) || str(raw._id);
  if (!id) return null;
  const meta = isObject(raw.preset_meta) ? raw.preset_meta : {};
  const models = Array.isArray(meta.dspId) ? meta.dspId.filter((m): m is string => typeof m === 'string') : [];
  return {
    id,
    name: str(raw.name).trim() || '(no name)',
    description: str(raw.description),
    category: str(raw.category),
    downloads: num(raw.num_downloads),
    likes: num(raw.num_likes),
    rating: num(raw.rating_avg),
    models,
    chain: str(raw.signal_chain_type),
    updated: str(raw.updated_on),
  };
}

/**
 * Pure: a ToneCloud `preset_data` (JSON string or object) → the amp's preset shape.
 * `sigpath[] {dspId, active, params[{index, value}]}` maps onto effects; `meta` onto the name
 * fields. Throws with a reason when the data isn't a usable preset. The caller must still check the
 * models against the amp before sending (validatePreset with known models).
 */
export function cloudToPreset(presetData: unknown): Preset {
  let data: unknown = presetData;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      throw new Error('preset_data is not valid JSON');
    }
  }
  if (!isObject(data)) throw new Error('preset_data is not an object');
  const meta = isObject(data.meta) ? data.meta : {};
  if (!Array.isArray(data.sigpath)) throw new Error('preset_data has no sigpath');

  const effects: PresetEffect[] = data.sigpath.map((block: unknown, i: number) => {
    if (!isObject(block) || typeof block.dspId !== 'string') throw new Error(`block ${i + 1} has no dspId`);
    const params = Array.isArray(block.params) ? block.params : [];
    return {
      name: block.dspId,
      enabled: block.active === true,
      params: params.map((p: unknown, j: number) => {
        if (!isObject(p) || !Number.isInteger(p.index) || typeof p.value !== 'number') {
          throw new Error(`block ${i + 1} (${block.dspId}) param ${j + 1} is malformed`);
        }
        return { index: p.index as number, value: p.value };
      }),
    };
  });

  const bpm = num(data.bpm) || 120;
  return {
    bank: 0x00,
    number: 0x00,
    uuid: str(meta.id),
    name: str(meta.name) || 'ToneCloud preset',
    version: str(meta.version) || '0.7',
    description: str(meta.description),
    icon: str(meta.icon) || 'icon.png',
    bpm,
    effects,
    tail: [],
    checksum: null,
  };
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  // No credentials, no cookies: browsing needs none.
  const res = await fetch(url, { credentials: 'omit', signal });
  if (!res.ok) throw new Error(`ToneCloud answered ${res.status}`);
  return res.json();
}

/**
 * Sort choices. ToneCloud's `order` accepts `latest`, `popular` (sorted by likes, highest first) and
 * `alphabet` (probed 2026-09-28; SOURCED: soundshed). `likes`/`downloads` are ignored by the server,
 * so "downloads" asks for `popular` and re-sorts the loaded results in the app.
 */
export type CloudOrder = 'likes' | 'downloads' | 'latest' | 'title';
const SERVER_ORDER: Record<CloudOrder, string> = { likes: 'popular', downloads: 'popular', latest: 'latest', title: 'alphabet' };

/** Sorts loaded results the way the chosen order means (server order is kept where it's right). */
export function sortResults(list: readonly CloudSummary[], order: CloudOrder): CloudSummary[] {
  const out = [...list];
  if (order === 'likes') out.sort((a, b) => b.likes - a.likes);
  else if (order === 'downloads') out.sort((a, b) => b.downloads - a.downloads);
  else if (order === 'title') out.sort((a, b) => a.name.trim().localeCompare(b.name.trim(), undefined, { sensitivity: 'base' }));
  return out;
}

export async function searchPresets(
  keyword: string,
  page = 1,
  pageSize = 20,
  order: CloudOrder = 'likes',
  signal?: AbortSignal,
): Promise<CloudSummary[]> {
  const q = new URLSearchParams({ page: String(page), page_size: String(pageSize), preset_for: 'spark', order: SERVER_ORDER[order] });
  if (keyword.trim()) q.set('keyword', keyword.trim());
  const data = await getJson(`${TONECLOUD_API}/preset?${q}`, signal);
  if (!Array.isArray(data)) throw new Error('Unexpected ToneCloud search answer');
  return data.map(toSummary).filter((s): s is CloudSummary => s !== null);
}

export async function fetchPreset(id: string, signal?: AbortSignal): Promise<{ summary: CloudSummary; preset: Preset }> {
  if (!/^[0-9a-f]{24}$/i.test(id)) throw new Error('Not a ToneCloud preset id');
  const data = await getJson(`${TONECLOUD_API}/preset/${id}`, signal);
  const summary = toSummary(data);
  if (!summary || !isObject(data)) throw new Error('Unexpected ToneCloud preset answer');
  return { summary, preset: cloudToPreset(data.preset_data) };
}
