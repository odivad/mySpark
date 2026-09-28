/**
 * SparkTransport against a fake amp (test/fixtures/fake-amp.ts). Where the amp's reply matters,
 * it is built from real Spark 2 captures (SOURCED: SparklingTones). These tests prove the
 * transport follows SparklingTones' description of the amp; only the owner's hardware test
 * proves it works on the Spark LIVE.
 */
import { describe, expect, it } from 'vitest';
import {
  CMD_ACTION,
  MessageAssembler,
  SOFTWARE_PRESET,
  type Preset,
  type SparkMessage,
  assemblePresetPayload,
  buildChunk,
  commands,
  parsePreset,
  settingsWithBpm,
} from '../src/spark/protocol.js';
import { SparkTransport, type SparkTiming } from '../src/spark/transport.js';
import { presetDifferences } from '../src/spark/verify.js';
import { FakeAmp } from './fixtures/fake-amp.js';
import { PRESET0_CHUNKS } from './fixtures/sparklingtones.js';

const FAST: Partial<SparkTiming> = {
  sendGap: 0,
  defaultTimeout: 100,
  presetAckTimeout: 100,
  presetReadTimeout: 200,
  libraryReadGap: 0,
  storeSwitchDelay: 0,
  loadSettleDelay: 0,
};

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Preset 0 from the real Spark 2 capture. */
function capturedPreset0Payload(): number[] {
  const messages: SparkMessage[] = [];
  const asm = new MessageAssembler((m) => messages.push(m));
  PRESET0_CHUNKS.forEach((c) => asm.feed(c));
  return assemblePresetPayload(messages).payload;
}

async function connected(amp = new FakeAmp()): Promise<{ amp: FakeAmp; t: SparkTransport; log: string[] }> {
  const log: string[] = [];
  const t = new SparkTransport({ bluetooth: amp.bluetooth, timing: FAST, onLog: (l) => log.push(l) });
  await t.connect();
  return { amp, t, log };
}

const writes = (amp: FakeAmp, sub: number): SparkMessage[] =>
  amp.received.filter((m) => m.cmd === CMD_ACTION && m.sub === sub);

describe('connect', () => {
  it('filters on service 0xffc0 and reports the device name', async () => {
    const amp = new FakeAmp();
    const statuses: string[] = [];
    const t = new SparkTransport({ bluetooth: amp.bluetooth, timing: FAST, onStatus: (s) => statuses.push(s) });
    expect(await t.connect()).toBe('Spark LIVE BLE');
    expect(amp.requestedFilters).toEqual([[{ services: [0xffc0] }]]);
    expect(t.connected).toBe(true);
    expect(statuses).toEqual(['connecting', 'connecting', 'connected']);
  });

  it('fails clearly without Web Bluetooth', async () => {
    await expect(new SparkTransport().connect()).rejects.toThrow(/Web Bluetooth/);
  });

  it('refuses to send when not connected', async () => {
    await expect(new SparkTransport().send(commands.getName())).rejects.toThrow(/Not connected/);
  });
});

describe('reading presets', () => {
  it('reassembles a real captured 0x0301 reply sent back with the request seq', async () => {
    const { amp, t } = await connected();
    // Replay the captured bytes, with the seq swapped for the one the transport uses.
    // The seq is outside the checksum, so the rest of each message stays byte-for-byte real.
    amp.silent = true;
    const pending = t.readPreset(0);
    await new Promise((r) => setTimeout(r, 5));
    const seq = amp.received.at(-1)!.seq;
    PRESET0_CHUNKS.forEach((c) => amp.notify([...c.slice(0, 2), seq, ...c.slice(3)]));

    const preset = await pending;
    expect(preset).not.toBeNull();
    expect(preset!.effects).toHaveLength(7);
    expect(preset).toEqual(parsePreset(capturedPreset0Payload()));
  });

  it('ignores reply chunks carrying another seq, and times out', async () => {
    const { amp, t, log } = await connected();
    amp.silent = true;
    const pending = t.readPreset(0);
    await new Promise((r) => setTimeout(r, 5));
    PRESET0_CHUNKS.forEach((c) => amp.notify([...c.slice(0, 2), 0x3e, ...c.slice(3)]));
    expect(await pending).toBeNull();
    expect(log.some((l) => /no complete reply \(0 good chunks, 16 messages/.test(l))).toBe(true);
  });

  it('reads a library of the given slot count and reports empty slots', async () => {
    const amp = new FakeAmp({ slots: new Map([[0, capturedPreset0Payload()]]) });
    const { t } = await connected(amp);
    const lib = await t.readLibrary(2);
    expect(lib.map((s) => s.slot)).toEqual([0, 1]);
    expect(lib[0].preset?.name).toBe(parsePreset(capturedPreset0Payload()).name);
    expect(lib[1].preset).toBeNull();
  });
});

describe('sequence numbers', () => {
  it('stay in 0x01..0x3e and wrap', async () => {
    const { amp, t } = await connected();
    for (let i = 0; i < 0x3f; i++) await t.send(commands.getName());
    const seqs = amp.received.map((m) => m.seq);
    expect(seqs[0]).toBe(0x01);
    expect(seqs[0x3d]).toBe(0x3e);
    expect(seqs[0x3e]).toBe(0x01);
  });
});

describe('send', () => {
  it('rejects on a BLE write error and keeps the queue working', async () => {
    const { amp, t } = await connected();
    amp.failNextWrite = true;
    await expect(t.send(commands.getName())).rejects.toThrow('GATT write failed');
    await expect(t.send(commands.getName())).resolves.toBeTypeOf('number');
    expect(amp.received).toHaveLength(1);
  });

  it('splits one message into several BLE writes when asked', async () => {
    const { amp, t } = await connected();
    await t.send(commands.effectOnOff('bias.reverb', false), { writeSize: 10 });
    expect(writes(amp, 0x15)).toHaveLength(1);
    expect(writes(amp, 0x15)[0].checksumOk).toBe(true);
  });

  it('refuses write commands to an amp that is not a Spark LIVE, but allows reads', async () => {
    const { amp, t } = await connected(new FakeAmp({ name: 'Some other Spark' }));
    await expect(t.send(commands.changePreset(1))).rejects.toThrow(/only the Spark LIVE/);
    await t.send(commands.getName());
    expect(amp.received.map((m) => m.sub)).toEqual([0x11]);
  });

  it('cancels pending waits on disconnect', async () => {
    const { amp, t } = await connected();
    amp.silent = true;
    const pending = t.readPreset(0, 5000);
    await new Promise((r) => setTimeout(r, 5));
    amp.dropConnection();
    expect(await pending).toBeNull();
    expect(t.connected).toBe(false);
  });
});

describe('tracking amp notifications', () => {
  it('records the current preset the amp announces (0x0338)', async () => {
    const { amp, t } = await connected();
    amp.notify(buildChunk(0x03, 0x38, [0x00, 0x05], 0x40));
    await new Promise((r) => setTimeout(r, 5));
    expect(t.state.currentPreset).toBe(5);
  });

  it('does not take a CH2 preset switch (bank 0x03, from the LIVE capture) as a CH1 slot', async () => {
    const { amp, t } = await connected();
    amp.notify(buildChunk(0x03, 0x38, [0x00, 0x04], 0x45));
    amp.notify(buildChunk(0x03, 0x38, [0x03, 0x00], 0x47));
    await new Promise((r) => setTimeout(r, 5));
    expect(t.state.currentPreset).toBe(4);
    expect(t.state.lastPresetSwitch).toEqual({ bank: 0x03, number: 0x00 });
  });
});

describe('loadPreset (software buffer 0x7f)', () => {
  it('uploads with one seq, switches to 0x7f, reads live state back and verifies', async () => {
    const { amp, t } = await connected();
    const preset = parsePreset(capturedPreset0Payload());
    const result = await t.loadPreset(preset);

    const chunks = writes(amp, 0x01);
    expect(new Set(chunks.map((m) => m.seq)).size).toBe(1);
    expect(result).toMatchObject({ sent: true, acks: chunks.length, chunksTotal: chunks.length, verified: true });
    expect(result.differences).toEqual([]);
    expect(writes(amp, 0x38).map((m) => m.data)).toEqual([[0x00, SOFTWARE_PRESET]]);
    expect(amp.slots.size).toBe(0); // no saved slot touched
  });

  it('refuses a malformed preset before sending anything', async () => {
    const { amp, t } = await connected();
    const bad = copy(parsePreset(capturedPreset0Payload()));
    (bad.effects[0].params[0] as { value: unknown }).value = 'loud';
    await expect(t.loadPreset(bad)).rejects.toThrow(/Preset not sent/);
    expect(amp.received).toHaveLength(0);
  });
});

describe('storePreset (saved slot)', () => {
  it('writes the slot, switches away and back, reads the slot back and verifies', async () => {
    const original = capturedPreset0Payload();
    const amp = new FakeAmp({ slots: new Map([[2, original]]) });
    const { t } = await connected(amp);
    const preset = copy(parsePreset(original));
    preset.effects[3].params[0].value = 0.25;

    const result = await t.storePreset(preset, 2, 8);
    expect(result.verified).toBe(true);
    expect(writes(amp, 0x38).map((m) => m.data[1])).toEqual([0, 2]);
    expect(parsePreset(amp.slots.get(2)!).effects[3].params[0].value).toBe(0.25);
  });

  it('reports NOT verified when the amp acks every chunk but keeps the old content', async () => {
    const original = capturedPreset0Payload();
    const amp = new FakeAmp({ slots: new Map([[2, original]]) });
    amp.ignoreWrites = true;
    const { t } = await connected(amp);
    const preset = copy(parsePreset(original));
    preset.effects[3].params[0].value = 0.25;

    const result = await t.storePreset(preset, 2, 8);
    expect(result.acks).toBe(result.chunksTotal); // every chunk acked…
    expect(result.verified).toBe(false); // …and still not written
    expect(result.differences).toHaveLength(1);
  });

  it('reports NOT verified when the slot cannot be read back', async () => {
    const { amp, t } = await connected();
    amp.silent = true;
    const result = await t.storePreset(parsePreset(capturedPreset0Payload()), 1, 8);
    expect(result).toMatchObject({ verified: false, differences: ['no read-back from the amp'] });
  });

  it('rejects slots outside the amp’s slot count', async () => {
    const { amp, t } = await connected();
    const preset = parsePreset(capturedPreset0Payload());
    await expect(t.storePreset(preset, 8, 8)).rejects.toThrow(/outside 0–7/);
    await expect(t.storePreset(preset, SOFTWARE_PRESET, 8)).rejects.toThrow();
    expect(amp.received).toHaveLength(0);
  });
});

describe('setBpm', () => {
  it('rewrites the amp’s own looper settings with only the bpm changed, no trailing 0x00, then verifies', async () => {
    const { amp, t } = await connected();
    const before = [...amp.looperSettings];
    const result = await t.setBpm(140);
    expect(writes(amp, 0x76).map((m) => m.data)).toEqual([settingsWithBpm(before, 140)]);
    expect(result).toEqual({ verified: true, requested: 140, readBack: 140 });
  });

  it('reports NOT verified when the amp ignores it', async () => {
    const { amp, t } = await connected();
    amp.ignoreWrites = true;
    expect(await t.setBpm(140)).toEqual({ verified: false, requested: 140, readBack: 120 });
  });
});

describe('presetDifferences', () => {
  const preset = (): Preset => parsePreset(capturedPreset0Payload());

  it('is empty for identical presets, ignoring address, tail and checksum', () => {
    const b = { ...preset(), bank: 1, number: 0, tail: [], checksum: null };
    expect(presetDifferences(preset(), b)).toEqual([]);
  });

  it('accepts float64 values that round to the float32 the amp stores', () => {
    const a = copy(preset());
    const b = copy(preset());
    a.effects[3].params[0].value = 0.1;
    b.effects[3].params[0].value = Math.fround(0.1);
    expect(presetDifferences(a, b)).toEqual([]);
  });

  it('names the block, model and param that differ', () => {
    const b = copy(preset());
    b.effects[2].enabled = !b.effects[2].enabled;
    b.effects[4].params[1].value = 0.5;
    const diffs = presetDifferences(preset(), b);
    expect(diffs).toHaveLength(2);
    expect(diffs[0]).toMatch(/^block 3 \(/);
    expect(diffs[1]).toMatch(/^block 5 \(.*\) param 1:/);
  });
});
