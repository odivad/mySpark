/**
 * App logic with no DOM: labels, formatting, backups. Kept separate so Vitest can test it.
 */
import { CHAIN, type Preset, slotLabel } from '../spark/protocol.js';
import type { SlotRead } from '../spark/transport.js';
import { MODEL_INFO, knobName } from '../spark/catalog.js';

/** CH1 preset slots on the Spark LIVE: A1–A4, B1–B4. VERIFIED-HW: Spark LIVE. */
export const LIVE_SLOT_COUNT = 8;

/** What the app may ask of / do with the connected amp, chosen from its BLE name. */
export interface AmpProfile {
  id: 'live' | 'go' | 'unknown';
  label: string;
  slotCount: number;
  /** Guitar/Music/Master levels (0x0133/0x0233). */
  hasLevels: boolean;
  /** Two channels (CH2 banks 0x03/0x04, 0x021a). */
  hasChannels: boolean;
  /** Writes are only built for the LIVE (the transport refuses others too). */
  canWrite: boolean;
  /** Preset switching (0x0138) allowed even when other writes aren't (Spark GO). */
  canSwitch: boolean;
  /** The built-in tuner (0x0165), allowed on its own on the GO. */
  hasTuner: boolean;
  /** Whole-preset uploads: Try (temporary buffer) and Save to amp (slot). */
  canUpload: boolean;
}

/**
 * Spark LIVE: everything VERIFIED-HW. Spark GO ("Spark GO BLE", owner's GO 2026-09-28): answers
 * name/serial/current preset and reads slots 0–2; no answer to 0x0233 levels or 0x021a; one short
 * reply for slots 4–7 (it has 4 slots: SOURCED soundshed). Pedal edits, uploads, switching and tuner use the LIVE's commands with the block header (official app captures).
 */
export function profileFor(deviceName: string | null): AmpProfile {
  if (deviceName === 'Spark LIVE BLE') {
    return { id: 'live', label: 'Spark LIVE', slotCount: LIVE_SLOT_COUNT, hasLevels: true, hasChannels: true, canWrite: true, canSwitch: true, hasTuner: true, canUpload: true };
  }
  if (deviceName === 'Spark GO BLE') {
    return { id: 'go', label: 'Spark GO', slotCount: 4, hasLevels: false, hasChannels: false, canWrite: true, canSwitch: true, hasTuner: true, canUpload: true };
  }
  return { id: 'unknown', label: deviceName ?? 'Spark', slotCount: 4, hasLevels: false, hasChannels: false, canWrite: false, canSwitch: false, hasTuner: false, canUpload: false };
}

/** Chain position of the amp block. SOURCED: SparklingTones; VERIFIED-HW: Spark LIVE. */
export const AMP_BLOCK = 3;

/**
 * Amp-block knob names by param index. SOURCED: SparklingTones src/spark-effetti.js (from soundshed);
 * VERIFIED-HW on the Spark LIVE for 0–3 (capture 3, 2026-09-28). Master (4) has no panel knob.
 */
export const AMP_KNOBS = ['Gain', 'Treble', 'Middle', 'Bass', 'Volume'] as const;

/** Display name of a chain position. */
export function blockName(block: number): string {
  return CHAIN[block] ?? `Block ${block + 1}`;
}

/**
 * Display name of a param: from the effect catalogue when the model is known (SOURCED), the
 * verified amp knob names otherwise, and an honest number when nothing is known.
 */
export function paramName(block: number, index: number, modelId?: string): string {
  const fromCatalogue = modelId ? knobName(modelId, index) : null;
  if (fromCatalogue) return fromCatalogue;
  if (block === AMP_BLOCK && index < AMP_KNOBS.length) return AMP_KNOBS[index];
  return `P${index}`;
}

/** Knob names that are switches or selectors, not continuous knobs: a slider would send in-between values. */
// Digital Delay's MODE is a continuous range knob (ToneCloud presets store 0.30–0.70), so it isn't listed.
const SWITCH_LIKE = /^(mode selector|limit\/compress|chorus ?\/ ?vibrato|hp\/lp|bpm|type)$/i;

/**
 * Which params get a slider (CH1 only). Amp block: the verified knobs. Other blocks: the knobs the
 * catalogue names (SOURCED), except switch/selector knobs (Mode, Limit/Compress, Chorus/Vibrato,
 * HP/LP, BPM, reverb Type) and params beyond the named knobs — on Noise Gate and Reverb that extra
 * param is the block's on/off (SparklingTones), which the footswitch handles.
 * Owner request 2026-09-28: sliders on all effects.
 */
export function isEditableParam(block: number, index: number, modelId?: string): boolean {
  if (block === AMP_BLOCK) return index < AMP_KNOBS.length;
  if (!modelId) return false;
  const info = MODEL_INFO[modelId];
  if (!info || index >= info.knobs.length) return false;
  if (info.choices?.[index] || info.switches?.includes(index)) return false;
  return !SWITCH_LIKE.test(info.knobs[index]);
}

/** The amp stores 0–1; the panel and the official app show 0–10. */
export function formatValue(value: number): string {
  return (value * 10).toFixed(1);
}

export interface BackupSlot {
  slot: number;
  label: string;
  preset: Preset | null;
}

export interface PresetBackup {
  format: 'myspark-backup';
  version: 1;
  createdAt: string;
  device: string | null;
  serial: string | null;
  /** Every slot that was read, including ones that did not answer (preset: null). */
  slots: BackupSlot[];
}

export function buildBackup(
  slots: readonly SlotRead[],
  info: { device: string | null; serial: string | null },
  now: Date = new Date(),
): PresetBackup {
  return {
    format: 'myspark-backup',
    version: 1,
    createdAt: now.toISOString(),
    device: info.device,
    serial: info.serial,
    slots: slots.map(({ slot, preset }) => ({ slot, label: slotLabel(slot).label, preset })),
  };
}

export function backupFileName(backup: PresetBackup): string {
  const stamp = backup.createdAt.replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z');
  return `myspark-backup-${stamp}.json`;
}
