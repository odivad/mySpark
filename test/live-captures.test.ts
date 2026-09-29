/**
 * Decoding real Spark LIVE traffic (VERIFIED-HW vectors from the owner's amp, official app snoop log).
 */
import { describe, expect, it } from 'vitest';
import {
  BANK,
  MessageAssembler,
  type SparkMessage,
  assemblePresetPayload,
  commands,
  parseChannelPresets,
  parsePreset,
  serializePreset,
} from '../src/spark/protocol.js';
import { SparkTransport } from '../src/spark/transport.js';
import { FakeAmp } from './fixtures/fake-amp.js';
import {
  LIVE_CH1_SLOT1_CHUNKS,
  LIVE_CH2_SLOT0_CHUNKS,
  LIVE_CHANNEL_PRESETS,
} from './fixtures/live-captures.js';

function assemble(chunks: number[][]): number[] {
  const messages: SparkMessage[] = [];
  const asm = new MessageAssembler((m) => messages.push(m));
  chunks.forEach((c) => asm.feed(c));
  expect(messages.every((m) => m.checksumOk)).toBe(true);
  const r = assemblePresetPayload(messages);
  expect(r.complete).toBe(true);
  return r.payload;
}

describe('Spark LIVE captures', () => {
  it('decodes a CH1 preset: 7 blocks, Lead Guitar Style Tone 1, and re-serializes byte for byte', () => {
    const payload = assemble(LIVE_CH1_SLOT1_CHUNKS);
    const p = parsePreset(payload);
    expect(p.name).toBe('Lead Guitar Style Tone 1');
    expect([p.bank, p.number]).toEqual([0x00, 0x01]);
    expect(p.effects.map((e) => e.name)).toEqual([
      'bias.noisegate', 'BlueComp', 'KlonCentaurSilver', 'Invader', 'GuitarEQ6', 'VintageDelay', 'bias.reverb',
    ]);
    expect(serializePreset(p)).toEqual(payload);
  });

  it('decodes a CH2 preset: 4 blocks, Vocal - Lead, and re-serializes byte for byte', () => {
    const payload = assemble(LIVE_CH2_SLOT0_CHUNKS);
    const p = parsePreset(payload);
    expect(p.name).toBe('Vocal - Lead');
    expect([p.bank, p.number]).toEqual([BANK.ch2Slot, 0x00]);
    expect(p.effects.map((e) => e.name)).toEqual(['MicComp', 'Preamp73', 'BassEQ6', 'bias.reverb']);
    // serializePreset writes bank 0x00 unless told otherwise, so pass CH2's own address.
    expect(serializePreset(p, { bank: p.bank, number: p.number })).toEqual(payload);
  });

  it('decodes 0x031a: which preset each channel is on', () => {
    expect(parseChannelPresets(LIVE_CHANNEL_PRESETS)).toEqual([
      { channel: 0, preset: 3, flag: true },
      { channel: 1, preset: 0, flag: false },
    ]);
    // The one-channel form the amp sends unprompted when a knob moves (capture 2).
    expect(parseChannelPresets([0x91, 0x00, 0x03, 0xc3])).toEqual([{ channel: 0, preset: 3, flag: true }]);
  });

  it('builds the official app’s padded read and channel query', () => {
    expect(commands.getPresetAt(BANK.ch2Slot, 4).data).toEqual([0x03, 0x04, ...new Array(30).fill(0)]);
    expect(commands.getChannelPresets()).toEqual({ cmd: 0x02, sub: 0x1a, data: [0x92, 0x00, 0x01] });
  });

  it('reads a CH2 slot through the transport', async () => {
    const amp = new FakeAmp({ slots: new Map() });
    amp.banks.set(`${BANK.ch2Slot}:0`, assemble(LIVE_CH2_SLOT0_CHUNKS));
    const t = new SparkTransport({ bluetooth: amp.bluetooth, timing: { sendGap: 0, presetReadTimeout: 200, defaultTimeout: 100 } });
    await t.connect();
    const p = await t.readPresetAt(BANK.ch2Slot, 0);
    expect(p?.name).toBe('Vocal - Lead');
  });
});
