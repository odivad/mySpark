import { describe, expect, it } from 'vitest';
import { AMP_BLOCK, backupFileName, blockName, buildBackup, formatValue, isEditableParam, paramName } from '../src/app/model.js';
import { MessageAssembler, type SparkMessage, assemblePresetPayload, parsePreset } from '../src/spark/protocol.js';
import { PRESET0_CHUNKS } from './fixtures/sparklingtones.js';

function preset0() {
  const messages: SparkMessage[] = [];
  const asm = new MessageAssembler((m) => messages.push(m));
  PRESET0_CHUNKS.forEach((c) => asm.feed(c));
  return parsePreset(assemblePresetPayload(messages).payload);
}

describe('labels', () => {
  it('names amp knobs by index order, not panel order (VERIFIED-HW: Spark LIVE)', () => {
    expect([0, 1, 2, 3, 4].map((i) => paramName(AMP_BLOCK, i))).toEqual(['Gain', 'Treble', 'Middle', 'Bass', 'Volume']);
  });

  it('only lets the amp block’s named knobs be edited', () => {
    expect([0, 1, 2, 3, 4].every((i) => isEditableParam(AMP_BLOCK, i))).toBe(true);
    expect(isEditableParam(AMP_BLOCK, 5)).toBe(false);
    expect(isEditableParam(6, 0)).toBe(false);
  });

  it('gives sliders to named pedal knobs, but not to switches, selectors or the hidden on/off', () => {
    expect(isEditableParam(2, 0, 'ProCoRat')).toBe(true); // Distortion
    expect(isEditableParam(5, 2, 'DelayMono')).toBe(true); // D.Time
    expect(isEditableParam(5, 3, 'DelayMono')).toBe(true); // Mode: a continuous range knob (ToneCloud values 0.30–0.70)
    expect(isEditableParam(5, 4, 'DelayMono')).toBe(false); // BPM: an on/off dropdown instead
    expect(isEditableParam(1, 0, 'LA2AComp')).toBe(false); // Limit/Compress
    expect(isEditableParam(6, 0, 'bias.reverb')).toBe(true); // Level
    expect(isEditableParam(6, 6, 'bias.reverb')).toBe(false); // Type: dropdown
    expect(isEditableParam(6, 7, 'bias.reverb')).toBe(false); // hidden on/off
    expect(isEditableParam(0, 2, 'bias.noisegate')).toBe(false); // hidden on/off
    expect(isEditableParam(1, 0, 'MicComp')).toBe(false); // CH2 model, knobs unknown
    expect(isEditableParam(4, 1, 'Cloner')).toBe(false); // a true/false switch in the official app's data
    expect(isEditableParam(4, 0, 'Cloner')).toBe(true);
    expect(isEditableParam(2, 0, 'NotAModel')).toBe(false);
  });

  it('leaves other blocks numbered', () => {
    expect(paramName(0, 1)).toBe('P1');
    expect(paramName(AMP_BLOCK, 7)).toBe('P7');
  });

  it('names chain positions', () => {
    expect(blockName(3)).toBe('Amp');
    expect(blockName(9)).toBe('Block 10');
  });

  it('shows values 0–10 like the panel', () => {
    expect(formatValue(0.71)).toBe('7.1');
    expect(formatValue(1)).toBe('10.0');
  });
});

describe('backup', () => {
  it('keeps every slot read, labels it, and survives a JSON round trip', () => {
    const p = preset0();
    const backup = buildBackup(
      [
        { slot: 0, preset: p },
        { slot: 4, preset: null },
      ],
      { device: 'Spark LIVE BLE', serial: 'S123' },
      new Date('2026-09-28T23:59:01.123Z'),
    );
    expect(backup.slots.map((s) => s.label)).toEqual(['A1', 'B1']);
    expect(backup.slots[1].preset).toBeNull();
    expect(JSON.parse(JSON.stringify(backup)).slots[0].preset).toEqual(p);
    expect(backupFileName(backup)).toBe('myspark-backup-2026-09-28T23-59-01Z.json');
  });
});
