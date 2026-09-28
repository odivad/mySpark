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
 * SparkTransport.writePreset) and the trailing checksum.
 *
 * UNVERIFIED: that the amp reports back the metadata (uuid, name, version, description, icon)
 * exactly as written, especially for live state (0x0201 [0x01, 0x00]). If the first hardware
 * test shows metadata-only differences on a write that sounds right, record it in
 * knowledge/lessons-learned.md and relax this check with the owner's approval.
 */
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
    if (e.params.length !== a.params.length) {
      diffs.push(`${where} (${e.name}): expected ${e.params.length} params, amp has ${a.params.length}`);
      return;
    }
    e.params.forEach((p, j) => {
      const q = a.params[j];
      if (p.index !== q.index || f32(p.value) !== q.value) {
        diffs.push(`${where} (${e.name}) param ${p.index}: expected ${p.value}, amp has ${q.index}=${q.value}`);
      }
    });
  });
  return diffs;
}
