/**
 * Read-back comparison: the check behind "a write succeeds only once read back from the amp"
 * (knowledge/approved-patterns.md §1). Pure module. Written for mySpark, not ported.
 */
import type { Preset } from './protocol.js';

/**
 * What the amp should hold after a preset write, compared field by field with what it reports.
 * Returns human-readable differences; an empty list means the read-back matches.
 *
 * Floats travel as float32, so the expected value is rounded to float32 before comparing.
 * Not compared: `bank`/`number` (the target address, not content), `tail` (not sent — see
 * SparkTransport.writePreset), the trailing checksum, and params the amp reports that weren't sent
 * (it fills in params a preset leaves out). Every param that was sent must match.
 *
 * VERIFIED-HW (Spark LIVE, 2026-09-28): after loadPreset, live state (0x0201 [0x01, 0x00]) reports
 * metadata and chain exactly as written, so this full comparison passes. Not yet checked for a
 * slot read-back after storePreset.
 */
/**
 * The hidden on/off param of Noise Gate and Reverb (SOURCED: SparklingTones, measured on a Spark 2;
 * the official app doesn't show it). Not compared: the block's `enabled` flag is the real state.
 */
const HIDDEN_ON_OFF: Record<string, number> = { 'bias.noisegate': 2, 'bias.reverb': 7 };

export function presetDifferences(expected: Preset, actual: Preset): string[] {
  const diffs: string[] = [];
  const f32 = Math.fround;

  for (const field of ['uuid', 'name', 'version', 'description', 'icon'] as const) {
    if (expected[field] !== actual[field]) {
      diffs.push(`${field}: expected ${JSON.stringify(expected[field])}, amp has ${JSON.stringify(actual[field])}`);
    }
  }
  if (f32(expected.bpm) !== actual.bpm) diffs.push(`bpm: expected ${expected.bpm}, amp has ${actual.bpm}`);

  if (expected.effects.length !== actual.effects.length) {
    diffs.push(`chain length: expected ${expected.effects.length}, amp has ${actual.effects.length}`);
    return diffs;
  }
  expected.effects.forEach((e, i) => {
    const a = actual.effects[i];
    const where = `block ${i + 1}`;
    if (e.name !== a.name) diffs.push(`${where}: expected model ${e.name}, amp has ${a.name}`);
    if (e.enabled !== a.enabled) diffs.push(`${where} (${e.name}): expected ${e.enabled ? 'on' : 'off'}`);
    // Compare by param index, skipping the block's hidden on/off value (Noise Gate #2, Reverb #7).
    // The amp mirrors `enabled` there (compared above), but not reliably: the Spark GO reports it in
    // live state but not in the slot, and a slot can store 0 for a block that is on (owner's GO,
    // 2026-09-29: "Upright Bass" 7 vs 8 params; "Swell" gate #2 0 vs 1).
    const allowOneSided = HIDDEN_ON_OFF[e.name];
    const byIndex = new Map(a.params.map((q) => [q.index, q]));
    for (const p of e.params) {
      const q = byIndex.get(p.index);
      byIndex.delete(p.index);
      if (!q) {
        if (p.index !== allowOneSided) diffs.push(`${where} (${e.name}) param ${p.index}: expected ${p.value}, amp has none`);
        continue;
      }
      if (p.index !== allowOneSided && f32(p.value) !== q.value) diffs.push(`${where} (${e.name}) param ${p.index}: expected ${p.value}, amp has ${q.value}`);
    }
    // Params left in byIndex are ones the amp reports but we didn't send. Not a difference: the amp
    // fills in params a preset leaves out (owner's amp, 2026-09-29: "Californication" sent Phaser
    // #0–1, the amp reported #2=0 and #3=0; ToneCloud presets store Phaser with all four).
  });
  return diffs;
}
