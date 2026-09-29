/**
 * Positive Grid Spark protocol — encoding and decoding. Pure module: no I/O, no DOM, no BLE.
 *
 * Ported from SparklingTones `src/spark-protocol.js` (MIT, Copyright (c) 2026 Massimo Togni),
 * commit f25379d. See THIRD_PARTY_NOTICES.md.
 *
 * Verification status (see CLAUDE.md):
 * - SparklingTones verified everything here on a real Spark 2 (SOURCED: SparklingTones).
 * - On the owner's Spark LIVE, through SparklingTones, 2026-09-28 (VERIFIED-HW: Spark LIVE):
 *   preset read, live-buffer upload, preset switch, changeParam, effectOnOff,
 *   changeEffectModel, slot write. See knowledge/lessons-learned.md.
 * - Spark GO: nothing here is verified. Soundshed says it is Spark 40-style.
 *
 * `SparkIO.ino:<line>` comments point at paulhamsh/Spark, SparklingTones' reference.
 */

/* ======================================================================
   7-bit / 8-bit packing
   Every group of up to 7 real bytes is preceded by a "bits8" byte holding their
   high bits, LSB-first. SOURCED: SparkIO.ino:1069 and SparklingTones captures.
   ====================================================================== */

export function pack7bit8bit(data: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < data.length; i += 7) {
    const group = data.slice(i, i + 7);
    let bits8 = 0;
    const stripped = group.map((b, idx) => {
      if (b & 0x80) {
        bits8 |= 1 << idx;
        return b & 0x7f;
      }
      return b;
    });
    out.push(bits8, ...stripped);
  }
  return out;
}

export function unpack7bit8bit(packed: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < packed.length; i += 8) {
    const bits8 = packed[i];
    const group = packed.slice(i + 1, i + 8);
    group.forEach((b, idx) => out.push(bits8 & (1 << idx) ? b | 0x80 : b));
  }
  return out;
}

/** 8-bit XOR over the already-packed data bytes, bits8 included. */
export function xorChecksum(bytes: readonly number[]): number {
  let cs = 0;
  for (const b of bytes) cs ^= b;
  return cs & 0xff;
}

/* ======================================================================
   Data types — msgpack-like, but not valid msgpack
   ====================================================================== */

export const TYPE = {
  INT_MAX: 0x7f,
  ARRAY_BASE: 0x90, // 0x90..0x9f = fixarray of 0..15
  STR_BASE: 0xa0, // 0xa0..0xbf = string of 0..31 chars
  FALSE: 0xc2,
  TRUE: 0xc3,
  FLOAT: 0xca, // + 4 bytes IEEE-754 big endian
  UINT8: 0xcc,
  UINT16: 0xcd,
  UINT32: 0xce,
  LONG_STR: 0xd9, // + 1 length byte + chars
} as const;

export function encFloat(v: number): number[] {
  const dv = new DataView(new ArrayBuffer(4));
  dv.setFloat32(0, v, false);
  return [TYPE.FLOAT, dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)];
}

function strBytes(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
  return out;
}

/** [len, 0xa0+len, ascii] — write_prefixed_string() in SparkIO.ino:825 */
export function encPrefixedString(s: string): number[] {
  return [s.length, TYPE.STR_BASE + s.length, ...strBytes(s)];
}

/** [0xa0+len, ascii] — write_string() in SparkIO.ino:836 */
export function encShortString(s: string): number[] {
  return [TYPE.STR_BASE + s.length, ...strBytes(s)];
}

/**
 * Short string if it fits in 31 chars, otherwise long string. `create_preset` does the
 * same (SparkIO.ino:1030); without it a long name would produce a `0xa0+len` tag that
 * spills into another type. Needed for presets from the official app, which has no
 * name length limit.
 */
export function encAutoString(s: string): number[] {
  return s.length <= 31 ? encShortString(s) : [TYPE.LONG_STR, s.length & 0xff, ...strBytes(s)];
}

export const encByte = (b: number): number[] => [b & 0xff];
export const encOnOff = (on: boolean): number[] => [on ? TYPE.TRUE : TYPE.FALSE];

/* ======================================================================
   Sequential reader. The format isn't valid msgpack, so the reader gives
   explicit control over what is expected at each step.
   ====================================================================== */

export class Reader {
  private i = 0;

  constructor(private readonly b: readonly number[]) {}

  get remaining(): number {
    return this.b.length - this.i;
  }

  peek(): number {
    return this.b[this.i];
  }

  u8(): number {
    return this.b[this.i++];
  }

  skip(n: number): void {
    this.i += n;
  }

  /** Integer: a raw 0x00–0x7f value, or 0xcc/0xcd/0xce with prefix. */
  int(): number {
    const b = this.u8();
    if (b <= TYPE.INT_MAX) return b;
    if (b === TYPE.UINT8) return this.u8();
    if (b === TYPE.UINT16) return (this.u8() << 8) | this.u8();
    if (b === TYPE.UINT32) {
      return ((this.u8() << 24) >>> 0) + (this.u8() << 16) + (this.u8() << 8) + this.u8();
    }
    throw new Error(`Expected integer at ${this.i - 1}, found 0x${b.toString(16)}`);
  }

  float(): number {
    const b = this.u8();
    if (b !== TYPE.FLOAT) throw new Error(`Expected float at ${this.i - 1}, found 0x${b.toString(16)}`);
    const dv = new DataView(new ArrayBuffer(4));
    for (let k = 0; k < 4; k++) dv.setUint8(k, this.u8());
    return dv.getFloat32(0, false);
  }

  bool(): boolean {
    const b = this.u8();
    if (b === TYPE.TRUE) return true;
    if (b === TYPE.FALSE) return false;
    throw new Error(`Expected boolean at ${this.i - 1}, found 0x${b.toString(16)}`);
  }

  string(): string {
    const b = this.u8();
    let len: number;
    if (b >= TYPE.STR_BASE && b <= 0xbf) len = b - TYPE.STR_BASE;
    else if (b === TYPE.LONG_STR) len = this.u8();
    else throw new Error(`Expected string at ${this.i - 1}, found 0x${b.toString(16)}`);
    let s = '';
    for (let k = 0; k < len; k++) s += String.fromCharCode(this.u8());
    return s;
  }

  /**
   * String preceded by a redundant length byte: [len, 0xa0+len, ascii]. The form the amp
   * uses in 0x0311 (name) and 0x0323 (serial), and the one encPrefixedString produces.
   */
  prefixedString(): string {
    const declared = this.int();
    const s = this.string();
    if (s.length !== declared) {
      throw new Error(`Declared length ${declared} but string of ${s.length}`);
    }
    return s;
  }

  arrayLen(): number {
    const b = this.u8();
    if (b >= TYPE.ARRAY_BASE && b <= 0x9f) return b - TYPE.ARRAY_BASE;
    throw new Error(`Expected array at ${this.i - 1}, found 0x${b.toString(16)}`);
  }
}

/**
 * Exploratory decode: reads values as long as it can, without expecting a structure.
 * For inspecting unknown messages, not for real parsing.
 */
export function decodeValues(data: readonly number[]): Array<string | number | boolean> {
  const r = new Reader(data);
  const out: Array<string | number | boolean> = [];
  while (r.remaining > 0) {
    const b = r.peek();
    try {
      if (b <= TYPE.INT_MAX) out.push(r.int());
      else if (b >= TYPE.ARRAY_BASE && b <= 0x9f) out.push(`array[${r.arrayLen()}]`);
      else if ((b >= TYPE.STR_BASE && b <= 0xbf) || b === TYPE.LONG_STR) out.push(JSON.stringify(r.string()));
      else if (b === TYPE.FALSE || b === TYPE.TRUE) out.push(r.bool());
      else if (b === TYPE.FLOAT) out.push(+r.float().toFixed(6));
      else if (b === TYPE.UINT8 || b === TYPE.UINT16 || b === TYPE.UINT32) out.push(r.int());
      else {
        out.push('?' + b.toString(16).padStart(2, '0'));
        r.skip(1);
      }
    } catch (e) {
      out.push('!' + (e as Error).message);
      break;
    }
  }
  return out;
}

/* ======================================================================
   Building messages
   chunk: F0 01 <seq> <checksum> <cmd> <sub> <packed data> F7
   ====================================================================== */

export function buildChunk(cmd: number, sub: number, rawData: readonly number[], seq: number): number[] {
  const packed = pack7bit8bit(rawData);
  return [0xf0, 0x01, seq & 0xff, xorChecksum(packed), cmd, sub, ...packed, 0xf7];
}

/**
 * 16-byte block header, byte 6 = total length. paulhamsh always sends it
 * (BlockOut::process, SparkIO.ino:1202). SparklingTones found it makes no difference on
 * the Spark 2 (sweep on 0x0201 up to 44 bytes, with and without). Soundshed documents it
 * for the Spark 40. UNVERIFIED for the Spark GO.
 */
export function wrapBlock(chunk: readonly number[]): number[] {
  const total = (16 + chunk.length) & 0xff;
  return [0x01, 0xfe, 0x00, 0x00, 0x53, 0xfe, total, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...chunk];
}

/* ======================================================================
   Commands
   Commands that refer to an effect need a trailing 0x00: without it the amp
   ACKs but does not apply the command (Spark 2 difference; VERIFIED-HW on
   the Spark LIVE for 0x0104, 0x0115, 0x0106).
   ====================================================================== */

export const CMD_ACTION = 0x01; // writes
export const CMD_QUERY = 0x02; // reads
export const CMD_NOTIFY = 0x03; // notifications from the amp
export const CMD_ACK = 0x04;

export interface SparkCommand {
  cmd: number;
  sub: number;
  data: number[];
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

export const commands = {
  /** [bank, target]. Bank is always 0 (Spark.ino:319). No trailing 0x00. VERIFIED-HW: Spark LIVE. */
  changePreset: (target: number, bank = 0x00): SparkCommand => ({
    cmd: CMD_ACTION,
    sub: 0x38,
    data: [...encByte(bank), ...encByte(target)],
  }),

  /** VERIFIED-HW: Spark LIVE. */
  effectOnOff: (name: string, on: boolean): SparkCommand => ({
    cmd: CMD_ACTION,
    sub: 0x15,
    data: [...encPrefixedString(name), ...encOnOff(on), 0x00],
  }),

  /** Knob change, value clamped to 0..1. Also used for the amp block. VERIFIED-HW: Spark LIVE. */
  changeParam: (name: string, param: number, value: number): SparkCommand => ({
    cmd: CMD_ACTION,
    sub: 0x04,
    data: [...encPrefixedString(name), ...encByte(param), ...encFloat(clamp01(value)), 0x00],
  }),

  // No `savePreset` (0x0127): on the Spark 2 it ACKs and does not save, in all four forms
  // SparklingTones tried. To write a slot, address it directly with 0x0101 — see the
  // transport's storePreset.

  /**
   * Change a block's model. Asking for a model the amp doesn't have can freeze it until
   * power-off (SparklingTones: `TrebleBooster`). Check with validatePreset first.
   * VERIFIED-HW: Spark LIVE (owner-chosen models).
   */
  changeEffectModel: (oldName: string, newName: string): SparkCommand => ({
    cmd: CMD_ACTION,
    sub: 0x06,
    data: [...encPrefixedString(oldName), ...encPrefixedString(newName), 0x00],
  }),

  /**
   * Looper settings, which are also **where the bpm lives**. 0x0176 must NOT have the
   * trailing 0x00 (like 0x0138 and 0x0175): with it the amp reads shifted fields, the
   * tempo doesn't change and the delay repeats forever (SparklingTones, 2026-08-28).
   * SOURCED; UNVERIFIED on the Spark LIVE.
   */
  getLooperSettings: (): SparkCommand => ({ cmd: CMD_QUERY, sub: 0x76, data: [] }),
  setLooperSettings: (d: readonly number[]): SparkCommand => ({ cmd: CMD_ACTION, sub: 0x76, data: Array.from(d) }),

  /** VERIFIED-HW: Spark LIVE (all 8 slots). */
  getPreset: (n: number): SparkCommand => ({ cmd: CMD_QUERY, sub: 0x01, data: [0x00, n & 0xff] }),
  /** VERIFIED-HW: Spark LIVE. */
  getLiveState: (): SparkCommand => ({ cmd: CMD_QUERY, sub: 0x01, data: [0x01, 0x00] }),

  /**
   * Reads a preset by [bank, number], padded to 32 bytes exactly as the official Spark app sends it
   * (owner's Spark LIVE, HCI snoop log 2026-09-28). Banks: 0x00 CH1 slot, 0x01 CH1 live,
   * 0x03 CH2 slot, 0x04 CH2 live — see BANK. Used for CH2, where only the official app's form is known.
   */
  getPresetAt: (bank: number, n: number): SparkCommand => ({
    cmd: CMD_QUERY,
    sub: 0x01,
    data: [bank & 0xff, n & 0xff, ...new Array<number>(30).fill(0)],
  }),

  /**
   * Asks which preset each channel is on: 0x021a [0x92, 0x00, 0x01] (fixarray of channels 0 and 1),
   * as the official app sends it. Reply 0x031a — see parseChannelPresets.
   */
  getChannelPresets: (): SparkCommand => ({ cmd: CMD_QUERY, sub: 0x1a, data: [0x92, 0x00, 0x01] }),
  getCurrentPreset: (): SparkCommand => ({ cmd: CMD_QUERY, sub: 0x10, data: [] }),
  getName: (): SparkCommand => ({ cmd: CMD_QUERY, sub: 0x11, data: [] }),
  getSerial: (): SparkCommand => ({ cmd: CMD_QUERY, sub: 0x23, data: [] }),
  getFirmware: (): SparkCommand => ({ cmd: CMD_QUERY, sub: 0x2f, data: [] }),

  /**
   * Amp-wide level (guitar, music, master), 0..1. **No trailing 0x00.** The amp sends no ACK;
   * only a read-back (getVolume) proves it. Observed on the owner's Spark LIVE: what the official
   * Spark app sends when its Guitar/Music/Master sliders move (HCI snoop log, 2026-09-28).
   * VERIFIED-HW: Spark LIVE — mySpark's sliders, read back, owner-tested 2026-09-28.
   */
  setVolume: (target: number, value: number): SparkCommand => ({
    cmd: CMD_ACTION,
    sub: 0x33,
    data: [...encByte(target), ...encFloat(clamp01(value))],
  }),

  /** Reads one level; the amp answers 0x0333 [float] with the request's seq. Same source. */
  getVolume: (target: number): SparkCommand => ({ cmd: CMD_QUERY, sub: 0x33, data: [...encByte(target)] }),
};

/**
 * Targets of 0x0133 / 0x0233 / 0x0333. From the official Spark app on the owner's Spark LIVE (HCI snoop
 * log, 2026-09-28): the owner moved Guitar, then Music, then Master, and the app wrote 00, then 05,
 * then 09. 09 is also what the amp reports when the back-panel MASTER VOL knob turns (capture 4).
 * The official app also reads 01, 03, 04 and 0e at connect; their meaning is UNVERIFIED — not used.
 */
export const VOLUME = {
  guitar: 0x00,
  music: 0x05,
  master: 0x09,
} as const;
export type VolumeName = keyof typeof VOLUME;

/* ----------------------------------------------------------------------
   BPM, which lives inside the looper settings. SOURCED: SparklingTones.
   The 0x0376 payload is `<bpm> <count> <bars> <freeIndicator> <click> <flag3>
   <duration>`. bpm uses msgpack positive-int encoding: below 128 the bare byte,
   from 128 up the 0xcc prefix.

   **Never build the other fields from scratch.** The last field changes shape
   between sessions (seen `3c` and `cd ea 60`), so the only safe way to change the
   tempo is to send back the settings the amp just reported, with only bpm replaced.
   ---------------------------------------------------------------------- */

export const BPM_MIN = 20;
export const BPM_MAX = 300;

function bpmFieldLength(data: readonly number[]): number {
  return data[0] === 0xcc ? 2 : 1;
}

/** The bpm inside a 0x0376 payload, or null if the payload is empty. */
export function bpmFromSettings(data: readonly number[] | null | undefined): number | null {
  if (!data || data.length === 0) return null;
  return data[0] === 0xcc ? data[1] : data[0];
}

/** The same settings with only the bpm changed. `previous` must be a 0x0376 payload just read from the amp. */
export function settingsWithBpm(previous: readonly number[] | null | undefined, bpm: number): number[] {
  if (!previous || previous.length === 0) {
    throw new Error('Need the looper settings just read from the amp');
  }
  const n = Math.round(bpm);
  if (!(n >= BPM_MIN && n <= BPM_MAX)) {
    throw new Error(`bpm outside ${BPM_MIN}–${BPM_MAX}: ${bpm}`);
  }
  const head = n >= 128 ? [0xcc, n] : [n];
  return head.concat(Array.from(previous).slice(bpmFieldLength(previous)));
}

/** Turns a command into the bytes to write to 0xFFC1. */
export function encode(command: SparkCommand, seq: number, withBlockHeader = false): number[] {
  const chunk = buildChunk(command.cmd, command.sub, command.data, seq);
  return withBlockHeader ? wrapBlock(chunk) : chunk;
}

/* ======================================================================
   Receiving
   ====================================================================== */

export interface SparkMessage {
  raw: number[];
  seq: number;
  cmd: number;
  sub: number;
  data: number[];
  checksumOk: boolean;
}

export function parseMessage(msg: readonly number[]): SparkMessage {
  const packed = Array.from(msg.slice(6, msg.length - 1));
  return {
    raw: Array.from(msg),
    seq: msg[2],
    cmd: msg[4],
    sub: msg[5],
    data: unpack7bit8bit(packed),
    checksumOk: xorChecksum(packed) === msg[3],
  };
}

/**
 * Reassembles BLE fragments into complete messages by looking for F0 … F7.
 *
 * Two rules that look like details and aren't:
 * - **An F0 mid-message restarts.** F0 and F7 can't appear inside a message (packed
 *   bytes are all below 0x80, and so is the XOR checksum), so an F0 in the middle means
 *   the previous message was truncated by a lost fragment. Without this rule the two
 *   merge into a message that doesn't exist.
 * - **The buffer is always cleared**, even if `onMessage` throws. Otherwise the delivered
 *   message stays in the buffer, every later byte is appended to it, and nothing is
 *   received again until reconnect.
 */
export class MessageAssembler {
  private buffer: number[] = [];

  constructor(private readonly onMessage: (message: SparkMessage) => void) {}

  feed(bytes: Iterable<number>): void {
    for (const b of bytes) {
      if (b === 0xf0) {
        this.buffer = [b];
        continue;
      }
      if (this.buffer.length === 0) continue; // drop orphan bytes before F0
      this.buffer.push(b);
      if (b === 0xf7) {
        const message = this.buffer;
        this.buffer = [];
        this.onMessage(parseMessage(message));
      }
    }
  }

  reset(): void {
    this.buffer = [];
  }
}

/* ======================================================================
   Presets (0x0301)
   Arrive over several chunks. After unpacking, each chunk starts with a 3-byte
   sub-header: [total chunks, index, useful bytes]. The last byte of the last
   chunk is a checksum, sum mod 256.
   ====================================================================== */

export interface AssembledPreset {
  total: number | null;
  received: number;
  complete: boolean;
  payload: number[];
}

export function assemblePresetPayload(messages: readonly SparkMessage[]): AssembledPreset {
  const chunks: number[][] = [];
  let total: number | null = null;
  for (const m of messages) {
    const [t, index, size] = m.data;
    total = t;
    chunks[index] = m.data.slice(3, 3 + size);
  }
  const received = chunks.filter(Boolean).length;
  return {
    total,
    received,
    complete: total !== null && received === total,
    payload: chunks.flat(),
  };
}

/** Constant marker between each parameter's index and value. Meaning unknown. */
export const PARAM_MARKER = 0x91;

export interface PresetParam {
  index: number;
  value: number;
}

export interface PresetEffect {
  name: string;
  enabled: boolean;
  params: PresetParam[];
}

export interface Preset {
  bank: number;
  number: number;
  uuid: string;
  name: string;
  version: string;
  description: string;
  icon: string;
  bpm: number;
  effects: PresetEffect[];
  /** Floats of unknown meaning after the chain. Saved presets have two (9990.0, 0.5); live state none. */
  tail: number[];
  checksum: number | null;
}

/**
 * Structure (Hamshere v3.x, confirmed on real Spark 2 captures; VERIFIED-HW on the Spark LIVE):
 *   bank, number, UUID, name, version, description, icon, BPM,
 *   array of 7 effects { name, enabled, array of params }, tail floats, checksum.
 * Each param is: index, 0x91 marker, float value.
 */
export function parsePreset(payload: readonly number[]): Preset {
  const r = new Reader(payload);
  const bank = r.int();
  const number = r.int();
  const uuid = r.string();
  const name = r.string();
  const version = r.string();
  const description = r.string();
  const icon = r.string();
  const bpm = r.float();
  const effects: PresetEffect[] = [];

  const effectCount = r.arrayLen();
  for (let i = 0; i < effectCount; i++) {
    const effect: PresetEffect = { name: r.string(), enabled: r.bool(), params: [] };
    const paramCount = r.arrayLen();
    for (let p = 0; p < paramCount; p++) {
      const index = r.int();
      const marker = r.u8();
      if (marker !== PARAM_MARKER) {
        throw new Error(`Unexpected marker 0x${marker.toString(16)} in param ${index} of ${effect.name}`);
      }
      effect.params.push({ index, value: r.float() });
    }
    effects.push(effect);
  }

  // Keep whatever tail floats are there so the preset re-serializes losslessly.
  const tail: number[] = [];
  while (r.remaining > 1 && r.peek() === TYPE.FLOAT) tail.push(r.float());

  const checksum = r.remaining > 0 ? r.u8() : null;
  if (r.remaining > 0) {
    throw new Error(`${r.remaining} unconsumed bytes at the end of the preset`);
  }
  return { bank, number, uuid, name, version, description, icon, bpm, effects, tail, checksum };
}

/**
 * Slots are addressed with a [bank, number] pair: 0x0201 with [0x00, n] reads slot n,
 * with [0x01, 0x00] reads the sound currently playing.
 *
 * The Spark 2 panel (and the Spark LIVE, per SparklingTones' display of it) shows slots
 * as two banks of four: A = slots 0–3, B = slots 4–7. SparklingTones notes red LEDs for
 * A and green for B on the Spark 2; UNVERIFIED on the Spark LIVE.
 */
export const SLOTS_PER_BANK = 4;

export interface SlotLabel {
  bank: 'A' | 'B';
  position: number;
  label: string;
}

export function slotLabel(n: number): SlotLabel {
  const bank = n < SLOTS_PER_BANK ? 'A' : 'B';
  const position = (n % SLOTS_PER_BANK) + 1;
  return { bank, position, label: bank + position };
}

/**
 * The seven chain positions, in order. The amp sends effects as an array of 7 without
 * labels, but the order is fixed. Parameters stay numbered: the amp doesn't send their
 * names, and an honest number beats an invented label.
 */
export const CHAIN = ['Noise gate', 'Comp / Wah', 'Drive', 'Amp', 'Modulation', 'Delay', 'Reverb'] as const;

/**
 * Preset banks on the Spark LIVE, from the official app's reads (owner's HCI snoop log, 2026-09-28):
 * CH1 = the guitar channel (7-block chain), CH2 = the mic/acoustic/bass channel (4-block chain).
 */
export const BANK = { ch1Slot: 0x00, ch1Live: 0x01, ch2Slot: 0x03, ch2Live: 0x04 } as const;

/**
 * CH2's four chain positions. Descriptive labels from the models seen there on the owner's LIVE
 * (MicComp/Comp76/LA2AComp/BassComp/VocalDrive/DistortionTS9 → Preamp73/ParaAcousticPreAmp/
 * SansAmpBassDriver → BassEQ6/GuitarEQ6/VocalChorus → bias.reverb/Vocal…Reverb), not names from a source.
 */
export const CHAIN_CH2 = ['Comp / Drive', 'Preamp', 'EQ / Mod', 'Reverb'] as const;

export interface ChannelPreset {
  channel: number;
  preset: number;
  /** Turns true when a knob moves (seen on the LIVE); likely "edited since loaded". UNVERIFIED. */
  flag: boolean;
}

/**
 * 0x031a: fixarray of [channel, preset, bool] triples, e.g. `92 00 03 c3 01 00 c2` = CH1 (0) on
 * slot 3 flagged, CH2 (1) on slot 0. VERIFIED-HW on the Spark LIVE (official app log, captures).
 * The amp also sends a one-channel form unprompted when knobs move (`91 00 03 c3`).
 */
export function parseChannelPresets(data: readonly number[]): ChannelPreset[] {
  const r = new Reader(data);
  const n = r.arrayLen();
  const out: ChannelPreset[] = [];
  for (let i = 0; i < n; i++) out.push({ channel: r.int(), preset: r.int(), flag: r.bool() });
  return out;
}

export interface PresetTarget {
  bank: number;
  number: number;
}

export const LIVE_TARGET: PresetTarget = { bank: 0x01, number: 0x00 };
export const slotTarget = (n: number): PresetTarget => ({ bank: 0x00, number: n });
/** The software buffer. Writing here plays a preset without overwriting a slot. VERIFIED-HW: Spark LIVE. */
export const SOFTWARE_PRESET = 0x7f;
export const SOFTWARE_TARGET: PresetTarget = { bank: 0x00, number: SOFTWARE_PRESET };

function normalizeTarget(target: PresetTarget | number | null | undefined, fallback: number): PresetTarget {
  if (target === undefined || target === null) return { bank: 0x00, number: fallback };
  if (typeof target === 'number') return slotTarget(target);
  return { bank: target.bank, number: target.number };
}

/**
 * Final preset checksum: sum mod 256 of the payload, excluding the first two bytes and
 * the checksum itself. The exclusion comes from `create_preset` (SparkIO.ino:1025).
 */
export function presetChecksum(payloadWithoutChecksum: readonly number[]): number {
  let sum = 0;
  for (let i = 2; i < payloadWithoutChecksum.length; i++) sum += payloadWithoutChecksum[i];
  return sum & 0xff;
}

export interface SerializeOptions {
  /** Don't write the tail floats: `create_preset` doesn't, and live state doesn't have them. */
  omitTail?: boolean;
}

/**
 * Inverse of parsePreset. Used to write presets and as a check: if re-serializing
 * reproduces the original bytes, the structure was interpreted correctly even where the
 * meaning of fields is unknown.
 *
 * @param target a slot number (bank 0), or a {bank, number} pair. Use SOFTWARE_TARGET to
 *               play without overwriting anything saved.
 */
export function serializePreset(
  preset: Preset,
  target?: PresetTarget | number | null,
  options: SerializeOptions = {},
): number[] {
  const dest = normalizeTarget(target, preset.number);
  const out = [
    ...encByte(dest.bank),
    ...encByte(dest.number),
    TYPE.LONG_STR,
    preset.uuid.length,
    ...strBytes(preset.uuid),
    ...encAutoString(preset.name),
    ...encAutoString(preset.version),
    ...encAutoString(preset.description),
    ...encAutoString(preset.icon),
    ...encFloat(preset.bpm),
    TYPE.ARRAY_BASE + preset.effects.length,
  ];

  for (const effect of preset.effects) {
    out.push(...encAutoString(effect.name));
    out.push(...encOnOff(effect.enabled));
    out.push(TYPE.ARRAY_BASE + effect.params.length);
    for (const param of effect.params) {
      out.push(param.index, PARAM_MARKER, ...encFloat(param.value));
    }
  }

  if (!options.omitTail) {
    for (const value of preset.tail ?? []) out.push(...encFloat(value));
  }
  out.push(presetChecksum(out));
  return out;
}

export interface ValidationResult {
  /** Block encoding or produce meaningless bytes. */
  errors: string[];
  /** Odd, but the amp might accept them. */
  warnings: string[];
}

/**
 * Checks a preset is safe to serialize before sending it. Needed because **an ACK is not
 * a verification**: the amp ACKs every chunk even when the payload is malformed, then
 * silently ignores it. A non-numeric value, for instance, becomes a NaN float that
 * encodes without complaint.
 *
 * `knownModels`, if given, is the list of models the amp has. An effect outside it is an
 * **error**, because asking the amp for a model it lacks is the one known way to freeze
 * it (recoverable only by power-off). The module stays pure: the caller passes the list.
 */
export function validatePreset(preset: unknown, knownModels?: Iterable<string>): ValidationResult {
  const known = knownModels ? new Set(knownModels) : null;
  const errors: string[] = [];
  const warnings: string[] = [];
  const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

  if (!preset || typeof preset !== 'object') {
    return { errors: ['Not a preset'], warnings };
  }
  const p = preset as Partial<Preset> & Record<string, unknown>;

  if (typeof p.uuid !== 'string' || !p.uuid) errors.push('Missing UUID');
  else if (p.uuid.length !== 36) warnings.push(`UUID of ${p.uuid.length} characters instead of 36`);

  for (const field of ['name', 'version', 'description', 'icon']) {
    if (typeof p[field] !== 'string') errors.push(`Field ${field} is not text`);
  }
  if (!isNumber(p.bpm)) errors.push('BPM is not a number');

  if (!Array.isArray(p.effects)) {
    errors.push('Missing effect chain');
    return { errors, warnings };
  }
  // A fixarray holds at most 15: beyond that, ARRAY_BASE + n spills into another type.
  if (p.effects.length > 15) errors.push(`${p.effects.length} effects: over the 15 of a fixarray`);
  if (p.effects.length !== 7) warnings.push(`${p.effects.length} effects instead of the usual 7`);

  p.effects.forEach((effect: unknown, i: number) => {
    const where = `Effect ${i + 1}`;
    if (!effect || typeof effect !== 'object') {
      errors.push(`${where}: not an effect`);
      return;
    }
    const e = effect as Partial<PresetEffect>;
    if (typeof e.name !== 'string' || !e.name) errors.push(`${where}: missing name`);
    else if (known && !known.has(e.name)) errors.push(`${where}: model "${e.name}" is not one the amp knows`);
    if (!Array.isArray(e.params)) {
      errors.push(`${where}: missing params`);
      return;
    }
    if (e.params.length > 15) errors.push(`${where}: ${e.params.length} params, over the 15 of a fixarray`);
    e.params.forEach((param: unknown, j: number) => {
      const label = `${e.name || where}, param ${j + 1}`;
      if (!param || typeof param !== 'object') {
        errors.push(`${label}: not a param`);
        return;
      }
      const pr = param as Partial<PresetParam>;
      if (!isNumber(pr.value)) errors.push(`${label}: value is not a number (${String(pr.value)})`);
      else if (pr.value < 0 || pr.value > 1) warnings.push(`${label}: value ${pr.value} outside 0..1`);
      if (!Number.isInteger(pr.index) || (pr.index as number) < 0 || (pr.index as number) > 127) {
        errors.push(`${label}: invalid index ${String(pr.index)}`);
      }
    });
  });

  for (const value of p.tail ?? []) {
    if (!isNumber(value)) errors.push('Tail contains a non-numeric value');
  }
  return { errors, warnings };
}

/**
 * Payload bytes per chunk when sending a preset. paulhamsh uses 128, meant for an ESP32
 * with a large MTU; that gives 154-byte messages and the Spark 2 disconnects. 25 is the
 * size the amp itself uses when sending a preset, giving 39-byte messages identical to
 * its own. SOURCED: SparklingTones; works on the Spark LIVE (VERIFIED-HW, via SparklingTones).
 */
export const PRESET_CHUNK_SIZE = 25;

/**
 * Splits a preset payload into the chunks of a 0x0101 message. Each carries the
 * sub-header [total chunks, index, useful bytes], the same one the amp uses. Rounds up
 * (paulhamsh's `len/size + 1` is wrong when the length is an exact multiple).
 */
export function splitPresetIntoChunks(payload: readonly number[], chunkSize = PRESET_CHUNK_SIZE): number[][] {
  const total = Math.max(1, Math.ceil(payload.length / chunkSize));
  const chunks: number[][] = [];
  for (let i = 0; i < total; i++) {
    const slice = payload.slice(i * chunkSize, (i + 1) * chunkSize);
    chunks.push([total, i, slice.length, ...slice]);
  }
  return chunks;
}
