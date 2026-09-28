/**
 * Protocol tests, ported from SparklingTones `test/protocol-test.html` (MIT, Copyright (c) 2026
 * Massimo Togni), commit f25379d. Effect-catalogue checks are left out until that catalogue is
 * ported. See THIRD_PARTY_NOTICES.md.
 */
import { describe, expect, it } from 'vitest';
import {
  CHAIN,
  CMD_ACTION,
  CMD_QUERY,
  LIVE_TARGET,
  MessageAssembler,
  Reader,
  SOFTWARE_TARGET,
  type Preset,
  type SparkMessage,
  assemblePresetPayload,
  bpmFromSettings,
  buildChunk,
  commands,
  encByte,
  encFloat,
  encPrefixedString,
  encode,
  pack7bit8bit,
  parseMessage,
  parsePreset,
  presetChecksum,
  serializePreset,
  settingsWithBpm,
  slotLabel,
  slotTarget,
  splitPresetIntoChunks,
  validatePreset,
} from '../src/spark/protocol.js';
import { KNOB_REVERB, LIVE_PAYLOAD, PRESET0_CHUNKS, WORKING } from './fixtures/sparklingtones.js';

const toHex = (a: readonly number[]): string => a.map((b) => b.toString(16).padStart(2, '0')).join(' ');
const hexToBytes = (s: string): number[] => s.trim().split(/\s+/).map((h) => parseInt(h, 16));
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const presetMessages = PRESET0_CHUNKS.map(parseMessage);
const assembled = assemblePresetPayload(presetMessages);
const preset = parsePreset(assembled.payload);

describe('7/8-bit packing and messages', () => {
  const knob = parseMessage(KNOB_REVERB);

  it('parses a captured message with a valid checksum', () => {
    expect(knob.checksumOk).toBe(true);
    expect([knob.cmd, knob.sub]).toEqual([0x03, 0x37]);
  });

  it('unpack → pack is the identity on the capture', () => {
    expect(pack7bit8bit(knob.data)).toEqual(KNOB_REVERB.slice(6, -1));
  });

  it('the encoder reproduces the 0x0337 payload byte for byte', () => {
    const rebuilt = [...encPrefixedString('bias.reverb'), ...encByte(0), ...encFloat(0.8598611354827881), 0x00];
    expect(rebuilt).toEqual(knob.data);
  });
});

describe('prefixed strings', () => {
  it('reads back what encPrefixedString writes', () => {
    expect(new Reader(encPrefixedString('Spark 2')).prefixedString()).toBe('Spark 2');
  });

  it('reads the amp name from a real capture (0x0311)', () => {
    const msg = parseMessage(hexToBytes('f0 01 01 6b 03 11 02 07 27 53 70 61 72 6b 00 20 32 f7'));
    expect(new Reader(msg.data).prefixedString()).toBe('Spark 2');
  });

  it('reads the serial number from a real capture (0x0323)', () => {
    const msg = parseMessage(
      hexToBytes('f0 01 02 02 03 23 02 0f 2f 53 35 30 31 31 00 47 31 34 38 31 34 33 00 39 37 34 f7'),
    );
    expect(new Reader(msg.data).prefixedString()).toBe('S5011G148143974');
  });
});

describe('messages confirmed on hardware', () => {
  it('0x0115 reverb OFF matches the message that worked', () => {
    expect(toHex(encode(commands.effectOnOff('bias.reverb', false), 0x05))).toBe(WORKING.fxOff);
  });

  it('0x0138 preset change matches the message that worked', () => {
    expect(toHex(encode(commands.changePreset(1), 0x01))).toBe(WORKING.preset);
  });

  it('changeParam clamps out-of-range values to 0..1', () => {
    expect(commands.changeParam('x', 0, 5).data.slice(-6, -1)).toEqual(encFloat(1.0));
  });

  it('has no 0x0127 save command (ACKs but does not save on Spark 2)', () => {
    expect((commands as Record<string, unknown>).savePreset).toBeUndefined();
  });
});

describe('MessageAssembler', () => {
  it('reassembles a fragmented message', () => {
    const received: SparkMessage[] = [];
    const asm = new MessageAssembler((m) => received.push(m));
    for (let i = 0; i < KNOB_REVERB.length; i += 20) asm.feed(KNOB_REVERB.slice(i, i + 20));
    expect(received).toHaveLength(1);
    expect(received[0].raw).toEqual(KNOB_REVERB);
  });

  it('drops orphan bytes before F0', () => {
    const received: SparkMessage[] = [];
    new MessageAssembler((m) => received.push(m)).feed([0x11, 0x22, 0x33]);
    expect(received).toHaveLength(0);
  });

  it('a listener that throws does not block later messages', () => {
    const received: SparkMessage[] = [];
    const asm = new MessageAssembler((m) => {
      received.push(m);
      if (received.length === 1) throw new Error('broken listener');
    });
    expect(() => asm.feed(KNOB_REVERB)).toThrow();
    asm.feed(KNOB_REVERB);
    expect(received).toHaveLength(2);
  });

  const stream = PRESET0_CHUNKS.flat();
  for (const cut of [1, 7, 20, 39, 100]) {
    it(`sixteen messages in a row, fragments of ${cut}: all arrive intact and reassemble`, () => {
      const arrived: SparkMessage[] = [];
      const asm = new MessageAssembler((m) => arrived.push(m));
      for (let i = 0; i < stream.length; i += cut) asm.feed(stream.slice(i, i + cut));
      expect(arrived).toHaveLength(PRESET0_CHUNKS.length);
      expect(assemblePresetPayload(arrived).complete).toBe(true);
      expect(arrived.every((m) => m.checksumOk)).toBe(true);
    });
  }

  it('a truncated message does not merge with the next one', () => {
    const received: SparkMessage[] = [];
    const asm = new MessageAssembler((m) => received.push(m));
    asm.feed(KNOB_REVERB.slice(0, 12));
    asm.feed(KNOB_REVERB);
    expect(received).toHaveLength(1);
    expect(received[0].raw).toEqual(KNOB_REVERB);
  });
});

describe('saved preset (0x0301)', () => {
  it('all chunks have valid checksums and assemble completely', () => {
    expect(presetMessages.every((m) => m.checksumOk)).toBe(true);
    expect([assembled.total, assembled.received, assembled.complete]).toEqual([16, 16, true]);
  });

  it('decodes the preset', () => {
    expect([preset.bank, preset.number]).toEqual([0, 0]);
    expect(preset.uuid).toHaveLength(36);
    expect(preset.bpm).toBe(120);
    expect(preset.effects.map((e) => e.name)).toEqual([
      'bias.noisegate', 'LA2AComp', 'ProCoRat', 'Twin', 'ChorusAnalog', 'DelayRe201', 'bias.reverb',
    ]);
    expect(preset.effects.every((e) => e.params.length > 0)).toBe(true);
    expect(preset.effects.every((e) => e.params.every((p) => p.value >= 0 && p.value <= 1))).toBe(true);
    expect(preset.checksum).toBe(0xe0);
    expect(preset.tail.map((v) => +v.toFixed(3))).toEqual([9990, 0.5]);
  });

  it('serializePreset rebuilds the payload byte for byte', () => {
    expect(serializePreset(preset)).toEqual(assembled.payload);
  });

  it('presetChecksum reproduces the one the amp declared', () => {
    expect(presetChecksum(assembled.payload.slice(0, -1))).toBe(0xe0);
  });
});

describe('slot labels', () => {
  it('maps slots 0–7 to A1–A4, B1–B4', () => {
    expect([0, 3, 4, 5, 7].map((n) => slotLabel(n).label)).toEqual(['A1', 'A4', 'B1', 'B2', 'B4']);
    expect(slotLabel(5)).toEqual({ bank: 'B', position: 2, label: 'B2' });
  });
});

describe('live state', () => {
  const live = parsePreset(LIVE_PAYLOAD);

  it('decodes with bank 1, no tail floats', () => {
    expect([live.bank, live.number]).toEqual([1, 0]);
    expect(live.name).toBe('Clean Tube ');
    expect(live.effects.map((e) => e.name)).toEqual([
      'bias.noisegate', 'LA2AComp', 'DistortionTS9', 'AcousticAmpV2', 'GuitarEQ6', 'DelayRe201', 'bias.reverb',
    ]);
    expect(live.effects.filter((e) => !e.enabled).map((e) => e.name)).toEqual(['DistortionTS9', 'DelayRe201']);
    expect(live.tail).toEqual([]);
    expect(live.checksum).toBe(0x4c);
  });

  it('serializePreset rebuilds the live state byte for byte', () => {
    expect(serializePreset(live, LIVE_TARGET)).toEqual(LIVE_PAYLOAD);
  });
});

describe('sending a preset (0x0101)', () => {
  it('a number targets a slot in bank 0, changing only the first two bytes', () => {
    const toSlot3 = serializePreset(preset, 3);
    expect(toSlot3.slice(0, 2)).toEqual([0, 3]);
    expect(toSlot3.slice(2, -1)).toEqual(assembled.payload.slice(2, -1));
    expect(toSlot3[toSlot3.length - 1]).toBe(0xe0);
  });

  it('addresses match the read commands', () => {
    expect(serializePreset(preset, LIVE_TARGET).slice(0, 2)).toEqual(commands.getLiveState().data);
    expect(serializePreset(preset, slotTarget(6)).slice(0, 2)).toEqual(commands.getPreset(6).data);
    expect(serializePreset(preset, slotTarget(2)).slice(0, 2)).toEqual([0x00, 0x02]);
    expect(serializePreset(preset, SOFTWARE_TARGET).slice(0, 2)).toEqual([0x00, 0x7f]);
  });

  it('omitTail removes the two tail floats and recomputes the checksum', () => {
    const noTail = serializePreset(preset, LIVE_TARGET, { omitTail: true });
    expect(assembled.payload.length - noTail.length).toBe(10);
    expect(noTail[noTail.length - 1]).toBe(presetChecksum(noTail.slice(0, -1)));
    expect(noTail.slice(2, -1)).toEqual(assembled.payload.slice(2, -11));
  });

  it('splits like the amp does: 16 chunks of 39-byte messages', () => {
    const chunks = splitPresetIntoChunks(serializePreset(preset, LIVE_TARGET));
    expect(chunks).toHaveLength(16);
    expect([chunks[0].slice(0, 3), chunks[15].slice(0, 3)]).toEqual([[16, 0, 25], [16, 15, 8]]);
    expect(chunks.every((c) => c[2] === c.length - 3)).toBe(true);
    expect(chunks.slice(0, 15).map((c) => buildChunk(0x01, 0x01, c, 1).length)).toEqual(new Array(15).fill(39));
    expect(Math.max(...PRESET0_CHUNKS.map((c) => c.length))).toBe(39);
  });

  it('generated chunks reassemble into the original payload', () => {
    const payload = serializePreset(preset, LIVE_TARGET);
    const messages = splitPresetIntoChunks(payload).map((data, i) => parseMessage(buildChunk(0x01, 0x01, data, i + 1)));
    expect(assemblePresetPayload(messages).payload).toEqual(payload);
  });

  it('an exact multiple of the chunk size makes no empty chunk', () => {
    expect(splitPresetIntoChunks(new Array(256).fill(0), 128).map((c) => c[2])).toEqual([128, 128]);
  });
});

describe('validatePreset', () => {
  const models = preset.effects.map((e) => e.name);

  it('a preset read from the amp passes cleanly', () => {
    expect(validatePreset(preset)).toEqual({ errors: [], warnings: [] });
    expect(validatePreset(preset, models).errors).toEqual([]);
  });

  it('a non-numeric value is an error naming the effect', () => {
    const p = copy(preset);
    (p.effects[0].params[0] as { value: unknown }).value = null;
    const { errors } = validatePreset(p);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(preset.effects[0].name);
  });

  it('a string instead of a number is an error', () => {
    const p = copy(preset);
    (p.effects[1].params[0] as { value: unknown }).value = 'half';
    expect(validatePreset(p).errors).toHaveLength(1);
  });

  it('a preset without UUID cannot be sent', () => {
    const p = copy(preset) as Partial<Preset>;
    delete p.uuid;
    expect(validatePreset(p).errors).toEqual(['Missing UUID']);
  });

  it('a value outside 0..1 is only a warning', () => {
    const p = copy(preset);
    p.effects[0].params[0].value = 1.5;
    const r = validatePreset(p);
    expect([r.errors.length, r.warnings.length]).toEqual([0, 1]);
  });

  it('an unknown model is an error (the thing that freezes the amp), only when a list is given', () => {
    const p = copy(preset);
    p.effects[2].name = 'TrebleBooster';
    const { errors } = validatePreset(p, models);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('TrebleBooster');
    expect(validatePreset(p).errors).toEqual([]);
  });

  it('over 15 effects is an error; an unusual count is a warning', () => {
    const many = copy(preset);
    many.effects = new Array(16).fill(0).map(() => copy(preset.effects[0]));
    expect(validatePreset(many).errors).toHaveLength(1);

    const six = copy(preset);
    six.effects = six.effects.slice(0, 6);
    const r = validatePreset(six);
    expect([r.errors.length, r.warnings[0]]).toEqual([0, '6 effects instead of the usual 7']);
  });

  it('stops at a missing effect chain', () => {
    const p = copy(preset) as Partial<Preset>;
    delete p.effects;
    expect(validatePreset(p).errors).toEqual(['Missing effect chain']);
  });
});

describe('seven-position chain', () => {
  it('has seven categories, amp fourth', () => {
    expect(CHAIN).toHaveLength(7);
    expect([CHAIN[3], preset.effects[3].name]).toEqual(['Amp', 'Twin']);
  });
});

describe('bpm inside the looper settings', () => {
  // Real captures: 133 bpm with 0xcc prefix and uint16 duration; 120 bpm bare with byte duration.
  const SETTINGS_133 = [0xcc, 0x85, 0x04, 0x04, 0xc2, 0xc3, 0xc2, 0xcd, 0xea, 0x60];
  const SETTINGS_120 = [0x78, 0x04, 0x04, 0xc2, 0xc3, 0xc2, 0x3c];

  it('reads bpm with and without the 0xcc prefix', () => {
    expect(bpmFromSettings(SETTINGS_133)).toBe(133);
    expect(bpmFromSettings(SETTINGS_120)).toBe(120);
    expect(bpmFromSettings([])).toBeNull();
  });

  it('changes only the bpm field, adding or removing the prefix', () => {
    expect(settingsWithBpm(SETTINGS_133, 100)).toEqual([0x64, 0x04, 0x04, 0xc2, 0xc3, 0xc2, 0xcd, 0xea, 0x60]);
    expect(settingsWithBpm(SETTINGS_120, 140)).toEqual([0xcc, 0x8c, 0x04, 0x04, 0xc2, 0xc3, 0xc2, 0x3c]);
    expect([settingsWithBpm(SETTINGS_120, 127)[0], settingsWithBpm(SETTINGS_120, 128)[0]]).toEqual([0x7f, 0xcc]);
    expect(settingsWithBpm(SETTINGS_120, 90)).toHaveLength(SETTINGS_120.length);
  });

  it('rounds, and round-trips', () => {
    expect(bpmFromSettings(settingsWithBpm(SETTINGS_120, 119.6))).toBe(120);
    expect(bpmFromSettings(settingsWithBpm(SETTINGS_133, 96))).toBe(96);
  });

  it('rejects out-of-range bpm and missing settings', () => {
    for (const bad of [0, 19, 301, 1000, NaN]) expect(() => settingsWithBpm(SETTINGS_120, bad)).toThrow();
    expect(() => settingsWithBpm(null, 120)).toThrow();
  });

  it('0x0176 has no trailing 0x00', () => {
    expect(commands.setLooperSettings(SETTINGS_120).data).toEqual(SETTINGS_120);
    const get = commands.getLooperSettings();
    expect([get.cmd, get.sub, get.data.length]).toEqual([CMD_QUERY, 0x76, 0]);
    const set = commands.setLooperSettings(SETTINGS_120);
    expect([set.cmd, set.sub]).toEqual([CMD_ACTION, 0x76]);
  });
});
