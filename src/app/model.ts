/**
 * App logic with no DOM: labels, formatting, backups. Kept separate so Vitest can test it.
 */
import { CHAIN, type Preset, slotLabel } from '../spark/protocol.js';
import type { SlotRead } from '../spark/transport.js';
import { knobName } from '../spark/catalog.js';

/** CH1 preset slots on the Spark LIVE: A1–A4, B1–B4. VERIFIED-HW: Spark LIVE. */
export const LIVE_SLOT_COUNT = 8;

/** Chain position of the amp block. SOURCED: SparklingTones; VERIFIED-HW: Spark LIVE. */
export const AMP_BLOCK = 3;

/**
 * Amp-block knob names by param index. SOURCED: SparklingTones src/spark-effetti.js (from soundshed);
 * VERIFIED-HW on the Spark LIVE for 0–3 (capture 3, 2026-09-28). Master (4) has no panel knob.
 */
export const AMP_KNOBS = ['Gain', 'Treble', 'Middle', 'Bass', 'Master'] as const;

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

/**
 * Which params the app lets you edit. Only the amp block's named knobs: their indices are verified
 * on the Spark LIVE, and they are continuous. Other blocks wait for the effect catalogue, which
 * also marks discrete params (e.g. reverb type) that a slider would set to in-between values.
 */
export function isEditableParam(block: number, index: number): boolean {
  return block === AMP_BLOCK && index < AMP_KNOBS.length;
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
