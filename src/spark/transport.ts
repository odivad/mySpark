/**
 * BLE connection to a Spark amp and message exchange: connect, send queue, reassembly,
 * waiting for replies. Knows how to move messages, not what most of them mean.
 *
 * Ported from SparklingTones `src/spark-transport.js` (MIT, Copyright (c) 2026 Massimo Togni),
 * commit f25379d. See THIRD_PARTY_NOTICES.md. Changes from the original:
 * - Preset writes (loadPreset, storePreset) and setBpm read the result back from the amp and
 *   compare it (knowledge/approved-patterns.md §1). SparklingTones stops at the ACK.
 * - Write commands (cmd 0x01) are checked per amp (writeAllowed): the Spark LIVE takes them all;
 *   the Spark GO only the preset switch, the one write seen verified from its official app.
 * - A failed BLE write rejects the caller's promise instead of only being logged.
 * - Slot counts are passed in by the caller rather than assumed.
 *
 * Hardware facts from SparklingTones (SOURCED: SparklingTones, Spark 2):
 * - 0xFFC1 supports writeWithoutResponse only, so no GATT error is raised if the amp drops a
 *   message, and there is no flow control: sends are serialized and spaced out.
 * - A single write per message works up to at least 44 bytes; the amp notifies 39-byte packets.
 * - Writes get an ACK 0x04nn with the same sub-command and seq. The ACK confirms receipt, NOT
 *   execution.
 */
import {
  CMD_ACK,
  CMD_ACTION,
  CMD_NOTIFY,
  MessageAssembler,
  Reader,
  SOFTWARE_PRESET,
  SOFTWARE_TARGET,
  type ChannelPreset,
  type Preset,
  type PresetTarget,
  type SparkCommand,
  type SparkMessage,
  assemblePresetPayload,
  bpmFromSettings,
  commands,
  encode,
  parseChannelPresets,
  parsePreset,
  serializePreset,
  settingsWithBpm,
  slotTarget,
  splitPresetIntoChunks,
  validatePreset,
} from './protocol.js';
import { presetDifferences } from './verify.js';

/* ======================================================================
   The slice of the Web Bluetooth API this module uses. Declared here because the project
   compiles without DOM types; the browser's navigator.bluetooth satisfies it, and tests pass
   a fake with the same shape.
   ====================================================================== */

export interface SparkGattCharacteristic {
  readonly value?: DataView | null;
  writeValueWithoutResponse(value: Uint8Array): Promise<void>;
  startNotifications(): Promise<unknown>;
  addEventListener(type: 'characteristicvaluechanged', listener: () => void): void;
}

export interface SparkGattService {
  getCharacteristic(uuid: number): Promise<SparkGattCharacteristic>;
}

export interface SparkGattServer {
  getPrimaryService(uuid: number): Promise<SparkGattService>;
}

export interface SparkBluetoothDevice {
  readonly name?: string;
  readonly gatt?: {
    readonly connected: boolean;
    connect(): Promise<SparkGattServer>;
    disconnect(): void;
  };
  addEventListener(type: 'gattserverdisconnected', listener: () => void): void;
}

export interface SparkBluetooth {
  requestDevice(options: {
    filters: Array<{ services: number[] }>;
    optionalServices?: number[];
  }): Promise<SparkBluetoothDevice>;
}

/* ======================================================================
   Constants
   ====================================================================== */

/** VERIFIED-HW: Spark LIVE advertises it (SparklingTones' only scan filter). SOURCED for Spark GO: soundshed. */
export const SERVICE_UUID = 0xffc0;
/** Write, app → amp. VERIFIED-HW: Spark LIVE (via SparklingTones). SOURCED for Spark GO: soundshed. */
export const CHAR_WRITE_UUID = 0xffc1;
/** Notify, amp → app. VERIFIED-HW: Spark LIVE (via SparklingTones). SOURCED for Spark GO: soundshed. */
export const CHAR_NOTIFY_UUID = 0xffc2;

/** BLE name of the owner's Spark LIVE. VERIFIED-HW: Spark LIVE (owner screenshot, 2026-09-28). */
export const SPARK_LIVE_NAME = 'Spark LIVE BLE';

/** Preset upload chunk size for the Spark GO. VERIFIED-HW: official app on the owner's GO (128-byte 0x0101 chunks). */
export const GO_PRESET_CHUNK_SIZE = 128;

/** BLE write size for the GO's larger messages (a 128-byte chunk is ~173 bytes with the header). UNVERIFIED choice. */
export const GO_BLE_WRITE_SIZE = 20;

/** BLE name of the owner's Spark GO. VERIFIED-HW: Spark GO (mySpark log, 2026-09-28). */
export const SPARK_GO_NAME = 'Spark GO BLE';

/**
 * Which writes each amp may receive. The LIVE: all (Spark 2 conventions, verified). The GO: only
 * the preset switch 0x0138 [0x00, slot] — the official app sends exactly that and the GO ACKs it
 * (owner's GO, HCI snoop log 2026-09-28); owner approved enabling it. Everything else stays refused
 * until captured. Anything else: no writes.
 */
export function writeAllowed(deviceName: string | null, command: SparkCommand): boolean {
  if (command.cmd !== CMD_ACTION) return true;
  if (deviceName === SPARK_LIVE_NAME) return true;
  if (deviceName === SPARK_GO_NAME) {
    // Preset switch: seen ACKed from the official app. Tuner on/off: the GO answers the tuner-state
    // query 0x0265 in the official app's log (so it has one); 0x0165 itself is the LIVE's form,
    // UNVERIFIED on the GO — the transport confirms it by reading 0x0265 back. Owner asked for it
    // on the GO (2026-09-29).
    // Preset upload 0x0101 and switch 0x0138, to the temporary buffer 0x7f (ToneCloud play) or a
    // slot 0–3 (save): both seen from the official app on the owner's GO (snoop log 2026-09-29).
    const target = (n: number): boolean => n === 0x7f || (n >= 0 && n <= 3);
    if (command.sub === 0x38) return command.data.length === 2 && command.data[0] === 0x00 && target(command.data[1]);
    if (command.sub === 0x01) {
      // Chunk sub-header [total, index, size]; the first chunk starts with the target [bank, number].
      const [, index] = command.data;
      return index !== 0 || (command.data[3] === 0x00 && target(command.data[4]));
    }
    if (command.sub === 0x65) return command.data.length === 1 && (command.data[0] === 0xc2 || command.data[0] === 0xc3);
    return false;
  }
  return false;
}

/** ACK for the last chunk of a 0x0101 preset upload (intermediate chunks get 0x04). SOURCED: SparklingTones. */
export const CMD_ACK_FINAL = 0x05;

/**
 * Above this the Spark 2 disconnects instead of answering. 44 bytes is the largest verified
 * working write; the amp itself never sends more than 39. SOURCED: SparklingTones
 * (captures/2026-08-10-sweep-lunghezza.txt). UNVERIFIED on the Spark LIVE.
 */
export const SAFE_WRITE_BYTES = 60;

/** App → amp sequence numbers stay in 0x01..0x3e; above is the amp's own range. SOURCED: SparkIO.ino:1116. */
const SEQ_FIRST = 0x01;
const SEQ_LIMIT = 0x3f;

/** Delays and timeouts in ms. All SOURCED: SparklingTones (Spark 2) unless noted. */
export interface SparkTiming {
  /** Pause between consecutive sends: writeWithoutResponse has no flow control. */
  sendGap: number;
  defaultTimeout: number;
  /** Per-chunk ACK wait on preset upload. The firmware unblocks itself after 500 ms (SparkIO.ino:139). */
  presetAckTimeout: number;
  /** Waiting for every chunk of a 0x0301 preset reply. */
  presetReadTimeout: number;
  /** Pause between slots when reading the whole library. */
  libraryReadGap: number;
  /** Pauses around the switch-away-and-back after a slot write. */
  storeSwitchDelay: number;
  /** Wait after switching to the software buffer before reading live state (SparklingTones index.html, Tweak). */
  loadSettleDelay: number;
  /** Extra attempts when a preset reply stops partway (Spark GO; VERIFIED-HW). */
  presetReadRetries: number;
}

export const DEFAULT_TIMING: SparkTiming = {
  sendGap: 30,
  defaultTimeout: 2500,
  presetAckTimeout: 700,
  presetReadTimeout: 4000,
  libraryReadGap: 150,
  storeSwitchDelay: 300,
  loadSettleDelay: 400,
  presetReadRetries: 2,
};

/* ======================================================================
   Types
   ====================================================================== */

export type SparkConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export interface SparkTransportOptions {
  /** Defaults to navigator.bluetooth. */
  bluetooth?: SparkBluetooth;
  timing?: Partial<SparkTiming>;
  onStatus?: (status: SparkConnectionStatus, detail: string) => void;
  /** Every complete message from the amp, after waiters have seen it. */
  onMessage?: (message: SparkMessage) => void;
  onLog?: (line: string) => void;
}

export interface SendOptions {
  /** Use this seq instead of the next one (all chunks of one preset upload share a seq). */
  seq?: number;
  /** Prefix the 16-byte block header. UNVERIFIED as needed on any of the owner's amps. */
  blockHeader?: boolean;
  /**
   * Split the BLE write into pieces of this many bytes. The message stays one message; the amp
   * reassembles by F0 … F7. SparklingTones needed it for a 109-byte message the Spark 2 ignored
   * as a single write; the official app writes 20-byte pieces. SOURCED: SparklingTones.
   */
  writeSize?: number;
}

/** What the amp has told us about itself. A cache: the amp remains the source of truth. */
export interface SparkAmpState {
  name: string | null;
  serial: string | null;
  /** Current CH1 slot (bank 0x00). */
  currentPreset: number | null;
  /** Raw [bank, number] of the last 0x0338 switch the amp announced, any bank (e.g. CH2 = 0x03). */
  lastPresetSwitch: { bank: number; number: number } | null;
  /** Current CH2 slot (bank 0x03), from 0x0338 or 0x031a. */
  ch2Preset: number | null;
  /** Last 0x0376 payload. BPM writes are built from these, never from scratch. */
  looperSettings: number[] | null;
  bpm: number | null;
  /** Amp-wide levels by 0x0133 target (see VOLUME), from reads and 0x0333 notifications. */
  volumes: Record<number, number>;
}

export interface SlotRead {
  slot: number;
  preset: Preset | null;
}

export interface PresetUploadOptions {
  /** Increment seq per chunk (Spark 40 behavior) instead of one seq for all (Spark 2). */
  incrementSeq?: boolean;
  /** Send the tail floats. Off by default: create_preset doesn't (SparkIO.ino:1019). */
  includeTail?: boolean;
  blockHeader?: boolean;
  chunkSize?: number;
  ackTimeout?: number;
}

export interface PresetUploadResult {
  /** All chunks were written over BLE. Says nothing about whether the amp applied them. */
  sent: boolean;
  chunksSent: number;
  chunksTotal: number;
  acks: number;
  error?: string;
}

export interface VerifiedWriteResult extends PresetUploadResult {
  /** True only when the amp's read-back matches what was written. */
  verified: boolean;
  /** Differences between what was written and what the amp reports; empty when verified. */
  differences: string[];
  readBack: Preset | null;
}

export interface SwitchResult {
  /** True only when the live state read back matches the slot's content. */
  verified: boolean;
  differences: string[];
  slotPreset: Preset | null;
  live: Preset | null;
}

export interface ParamCheck {
  verified: boolean;
  /** The value the amp should hold, as float32. */
  expected: number;
  /** What the amp reports, or null if the read failed or the param wasn't found. */
  actual: number | null;
  live: Preset | null;
}

export interface ModelCheck {
  verified: boolean;
  expected: string;
  actual: string | null;
  live: Preset | null;
}

export interface EnabledCheck {
  verified: boolean;
  expected: boolean;
  actual: boolean | null;
  live: Preset | null;
}

export interface BpmWriteResult {
  verified: boolean;
  requested: number;
  /** BPM the amp reports after the write, or null if it did not answer. */
  readBack: number | null;
}

export interface FailedPayload {
  label: string;
  payload: number[];
  error: string;
  at: string;
}

interface Waiter {
  match: (message: SparkMessage) => boolean;
  resolve: (message: SparkMessage | null) => void;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const hex = (b: number): string => b.toString(16).padStart(2, '0');
const isNotify = (sub: number) => (m: SparkMessage) => m.cmd === CMD_NOTIFY && m.sub === sub;

/* ======================================================================
   Transport
   ====================================================================== */

export class SparkTransport {
  readonly state: SparkAmpState = {
    name: null,
    serial: null,
    currentPreset: null,
    lastPresetSwitch: null,
    ch2Preset: null,
    looperSettings: null,
    bpm: null,
    volumes: {},
  };

  /**
   * Last preset reply that failed to parse, kept on purpose: it is exactly the material needed
   * to work out what the amp sent.
   */
  lastFailedPayload: FailedPayload | null = null;

  /**
   * Messages received in total. Answers the one question that matters when a read gets no reply:
   * is the amp silent, or have we stopped hearing it?
   */
  rxTotal = 0;

  private readonly timing: SparkTiming;
  private readonly bluetoothOverride?: SparkBluetooth;
  private readonly onStatus: NonNullable<SparkTransportOptions['onStatus']>;
  private readonly onMessage: NonNullable<SparkTransportOptions['onMessage']>;
  private readonly onLog: NonNullable<SparkTransportOptions['onLog']>;
  private readonly assembler = new MessageAssembler((m) => this.handleMessage(m));

  private device: SparkBluetoothDevice | null = null;
  private writeChar: SparkGattCharacteristic | null = null;
  private seq = SEQ_FIRST;
  private waiters: Waiter[] = [];
  private sendChain: Promise<void> = Promise.resolve();

  constructor(options: SparkTransportOptions = {}) {
    this.timing = { ...DEFAULT_TIMING, ...options.timing };
    this.bluetoothOverride = options.bluetooth;
    this.onStatus = options.onStatus ?? (() => {});
    this.onMessage = options.onMessage ?? (() => {});
    this.onLog = options.onLog ?? (() => {});
  }

  get connected(): boolean {
    return !!this.device?.gatt?.connected && this.writeChar !== null;
  }

  /** BLE name of the connected amp, e.g. "Spark LIVE BLE". */
  get deviceName(): string | null {
    return this.device?.name ?? null;
  }

  /* ---------------------------------------------------------------- */

  /** Opens the browser's device picker and connects. Must be called from a user gesture. */
  async connect(): Promise<string> {
    const bluetooth = this.bluetoothOverride ?? (globalThis as { navigator?: { bluetooth?: SparkBluetooth } }).navigator?.bluetooth;
    if (!bluetooth) throw new Error('Web Bluetooth is not available in this browser');

    this.onStatus('connecting', 'Looking for the amp…');
    const device = await bluetooth.requestDevice({
      filters: [{ services: [SERVICE_UUID] }],
      optionalServices: [SERVICE_UUID],
    });
    if (!device.gatt) throw new Error('The selected device has no GATT server');
    this.device = device;
    device.addEventListener('gattserverdisconnected', () => {
      this.writeChar = null;
      this.assembler.reset();
      this.failAllWaiters('connection lost');
      this.onStatus('disconnected', 'Disconnected');
    });

    this.onStatus('connecting', 'Connecting GATT…');
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    const writeChar = await service.getCharacteristic(CHAR_WRITE_UUID);
    const notifyChar = await service.getCharacteristic(CHAR_NOTIFY_UUID);

    await notifyChar.startNotifications();
    notifyChar.addEventListener('characteristicvaluechanged', () => {
      const v = notifyChar.value;
      if (v) this.assembler.feed(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
    });
    this.writeChar = writeChar;

    const name = device.name ?? 'Spark';
    this.onStatus('connected', name);
    this.onLog(`connected to ${name}`);
    return name;
  }

  disconnect(): void {
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
  }

  /* ---------------------------------------------------------------- */

  private nextSeq(): number {
    const s = this.seq;
    this.seq = this.seq + 1 >= SEQ_LIMIT ? SEQ_FIRST : this.seq + 1;
    return s;
  }

  /**
   * Sends a command. Sends are serialized and spaced: writeWithoutResponse has no flow control.
   * Write commands (0x01) are refused unless the amp is a Spark LIVE — see the file header.
   * @returns the seq used, to correlate the reply
   */
  async send(command: SparkCommand, options: SendOptions = {}): Promise<number> {
    const writeChar = this.writeChar;
    if (!writeChar) throw new Error('Not connected');
    if (!writeAllowed(this.deviceName, command)) {
      throw new Error(
        `Write 0x${hex(command.cmd)}${hex(command.sub)} refused for ${this.deviceName ?? 'unknown amp'}: ` +
          'not verified on this amp (only the Spark LIVE takes all writes; the Spark GO only preset switches)',
      );
    }
    const seq = options.seq ?? this.nextSeq();
    // The Spark GO gets the 16-byte block header on every message, exactly as the official app
    // sends it (owner's GO, HCI snoop log 2026-09-29: `01 fe 00 00 53 fe <len> 00…` before each
    // F0 frame). Without it the GO answers reads but ignored a preset switch. The LIVE doesn't need it.
    const withHeader = options.blockHeader ?? this.deviceName === SPARK_GO_NAME;
    const bytes = new Uint8Array(encode(command, seq, withHeader));
    const step = options.writeSize ? Math.max(1, options.writeSize) : bytes.length;

    if (step > SAFE_WRITE_BYTES) {
      this.onLog(`warning: ${bytes.length}-byte write, over the ${SAFE_WRITE_BYTES} verified — the amp may disconnect`);
    }

    const run = this.sendChain.then(async () => {
      for (let i = 0; i < bytes.length; i += step) {
        await writeChar.writeValueWithoutResponse(bytes.subarray(i, i + step));
      }
      const pieces = Math.ceil(bytes.length / step);
      this.onLog(
        `TX 0x${hex(command.cmd)}${hex(command.sub)} seq=0x${hex(seq)} ${bytes.length}B` +
          (pieces > 1 ? ` in ${pieces} writes of ${step}` : ''),
      );
      await sleep(this.timing.sendGap);
    });
    // Keep the queue alive after a failure; the caller still sees the error.
    this.sendChain = run.catch(() => {});
    try {
      await run;
    } catch (err) {
      this.onLog(`send error: ${(err as Error).message}`);
      throw err;
    }
    return seq;
  }

  /**
   * Sends and waits for a reply matching the predicate.
   * @returns the reply, or null on timeout
   */
  async request(
    command: SparkCommand,
    match: (message: SparkMessage) => boolean,
    timeoutMs = this.timing.defaultTimeout,
  ): Promise<SparkMessage | null> {
    const pending = this.wait(match, timeoutMs);
    await this.send(command);
    return pending;
  }

  /** Sends a write and waits for its ACK. An ACK means received, not executed. */
  sendAndAwaitAck(command: SparkCommand, timeoutMs = this.timing.defaultTimeout): Promise<SparkMessage | null> {
    return this.request(command, (m) => m.cmd === CMD_ACK && m.sub === command.sub, timeoutMs);
  }

  private wait(match: Waiter['match'], timeoutMs: number): Promise<SparkMessage | null> {
    return new Promise((resolve) => {
      const waiter: Waiter = { match, resolve };
      this.waiters.push(waiter);
      setTimeout(() => {
        if (this.removeWaiter(waiter)) resolve(null);
      }, timeoutMs);
    });
  }

  private removeWaiter(waiter: Waiter): boolean {
    const i = this.waiters.indexOf(waiter);
    if (i === -1) return false;
    this.waiters.splice(i, 1);
    return true;
  }

  private failAllWaiters(reason: string): void {
    const pending = this.waiters.splice(0);
    pending.forEach((w) => w.resolve(null));
    if (pending.length) this.onLog(`${pending.length} pending waits cancelled: ${reason}`);
  }

  private handleMessage(message: SparkMessage): void {
    this.rxTotal++;
    this.trackState(message);
    // A copy: a waiter can remove itself while we iterate.
    for (const waiter of this.waiters.slice()) {
      if (waiter.match(message)) {
        this.removeWaiter(waiter);
        waiter.resolve(message);
      }
    }
    try {
      this.onMessage(message);
    } catch (err) {
      this.onLog(`onMessage handler error: ${(err as Error).message}`);
    }
  }

  /** Notification decoding. All SOURCED: SparklingTones (Spark 2). */
  private trackState(m: SparkMessage): void {
    if (m.cmd !== CMD_NOTIFY) return;
    try {
      if (m.sub === 0x38) {
        // The amp announcing a preset switch: [bank, number]. VERIFIED-HW: Spark LIVE — the front
        // (CH1) PRESET knob sends bank 0x00 with the slot; the back (CH2) PRESET knob sends bank
        // 0x03 (capture 4, 2026-09-28). Only bank 0x00 is a CH1 slot; anything else must not
        // overwrite currentPreset. Meaning of bank 0x03 beyond "CH2" is UNVERIFIED.
        const [bank, number] = m.data;
        this.state.lastPresetSwitch = { bank, number };
        if (m.data.length === 2 && bank === 0x00) this.state.currentPreset = number;
        if (m.data.length === 2 && bank === 0x03) this.state.ch2Preset = number;
      } else if (m.sub === 0x1a) {
        for (const c of parseChannelPresets(m.data)) {
          if (c.channel === 0 && this.state.currentPreset !== SOFTWARE_PRESET) this.state.currentPreset = c.preset;
          if (c.channel === 1) this.state.ch2Preset = c.preset;
        }
      } else if (m.sub === 0x10) {
        // Reply to 0x0210. SOURCED: SparklingTones (last byte); its layout on the LIVE is UNVERIFIED.
        this.state.currentPreset = m.data[m.data.length - 1];
      } else if (m.sub === 0x11) {
        this.state.name = new Reader(m.data).prefixedString();
      } else if (m.sub === 0x23) {
        this.state.serial = new Reader(m.data).prefixedString();
      } else if (m.sub === 0x76) {
        this.state.looperSettings = Array.from(m.data);
        this.state.bpm = bpmFromSettings(m.data);
      } else if (m.sub === 0x33 && m.data.length === 6) {
        // A level changed on the amp (e.g. the MASTER VOL knob): [target, float]. VERIFIED-HW: Spark LIVE.
        const r = new Reader(m.data);
        const target = r.int();
        this.state.volumes[target] = r.float();
      } else if (m.sub === 0x63) {
        // BPM alone, as the amp's TAP sends it: a float.
        const v = new Reader(m.data).float();
        if (Number.isFinite(v)) this.state.bpm = Math.round(v);
      }
    } catch {
      // An unexpected message: state stays as it was. Not fatal.
    }
  }

  /* ----------------------------------------------------------------
     Reading presets
     The reply to 0x0201 arrives as several 0x0301 messages sharing the request's seq, collected
     until the count in the sub-header is complete. VERIFIED-HW: Spark LIVE (via SparklingTones).
     ---------------------------------------------------------------- */

  readPreset(slot: number, timeoutMs?: number): Promise<Preset | null> {
    return this.readPresetVia(commands.getPreset(slot), `preset ${slot}`, timeoutMs);
  }

  /** Reads the sound currently playing, which is not one of the saved slots. */
  /**
   * Reads a preset by bank (see BANK), in the official app's padded form. For CH2:
   * readPresetAt(BANK.ch2Slot, n) and readPresetAt(BANK.ch2Live, 0). Read-only.
   */
  readPresetAt(bank: number, n: number, timeoutMs?: number): Promise<Preset | null> {
    return this.readPresetVia(commands.getPresetAt(bank, n), `bank ${bank} preset ${n}`, timeoutMs);
  }

  /** Which preset each channel is on (0x021a → 0x031a). Updates state; null if no reply. */
  async readChannelPresets(timeoutMs?: number): Promise<ChannelPreset[] | null> {
    const msg = await this.request(commands.getChannelPresets(), isNotify(0x1a), timeoutMs);
    return msg ? parseChannelPresets(msg.data) : null;
  }

  readLiveState(timeoutMs?: number): Promise<Preset | null> {
    return this.readPresetVia(commands.getLiveState(), 'live state', timeoutMs);
  }

  /**
   * Reads slots 0..slotCount-1. The caller supplies the count: 8 for the Spark LIVE
   * (VERIFIED-HW), 4 for the Spark GO (SOURCED: soundshed).
   */
  async readLibrary(slotCount: number, onProgress?: (slot: number, total: number) => void): Promise<SlotRead[]> {
    const out: SlotRead[] = [];
    for (let slot = 0; slot < slotCount; slot++) {
      onProgress?.(slot, slotCount);
      const preset = await this.readPreset(slot);
      if (!preset) this.onLog(`slot ${slot}: empty or not answering`);
      out.push({ slot, preset });
      await sleep(this.timing.libraryReadGap);
    }
    return out;
  }

  /**
   * One preset read, retried when the reply stops partway. The Spark GO sometimes stops a 0x0301
   * reply after 13 of its 14–16 chunks, with the official app too; the official app simply asks
   * again ~3 s later and gets it whole (owner's GO, HCI snoop log 2026-09-28). VERIFIED-HW: Spark GO.
   */
  private async readPresetVia(command: SparkCommand, label: string, timeoutMs?: number): Promise<Preset | null> {
    for (let attempt = 0; attempt <= this.timing.presetReadRetries; attempt++) {
      const result = await this.readPresetOnce(command, label, timeoutMs);
      if (result.preset || !result.partial) return result.preset;
      if (attempt < this.timing.presetReadRetries) this.onLog(`${label}: reply stopped partway — asking again`);
    }
    return null;
  }

  private async readPresetOnce(
    command: SparkCommand,
    label: string,
    timeoutMs?: number,
  ): Promise<{ preset: Preset | null; partial: boolean }> {
    const chunks: SparkMessage[] = [];
    const rxBefore = this.rxTotal;
    // Chosen before sending so no early reply chunk slips past the seq filter.
    const seq = this.nextSeq();

    const done = this.wait((m) => {
      if (m.cmd !== CMD_NOTIFY || m.sub !== 0x01 || m.seq !== seq) return false;
      chunks.push(m);
      return assemblePresetPayload(chunks).complete; // keep listening until complete
    }, timeoutMs ?? this.timing.presetReadTimeout);

    await this.send(command, { seq });
    if (!(await done)) {
      // The second number is the one that matters: 0 means the amp said nothing (or we no
      // longer hear it); above 0 means it is talking and we are discarding what it sends.
      this.onLog(
        `${label}: no complete reply (${chunks.length} good chunks, ${this.rxTotal - rxBefore} messages received in total)`,
      );
      // Several chunks then silence = a reply cut short (worth retrying). One chunk = the GO's
      // answer for a slot it doesn't have; none = no answer at all.
      return { preset: null, partial: chunks.length > 1 };
    }

    const payload = assemblePresetPayload(chunks).payload;
    try {
      return { preset: parsePreset(payload), partial: false };
    } catch (err) {
      const error = (err as Error).message;
      this.lastFailedPayload = { label, payload, error, at: new Date().toISOString() };
      this.onLog(`${label}: parse error — ${error} (${payload.length}-byte payload kept)`);
      return { preset: null, partial: false };
    }
  }

  /** Asks the amp for its name, serial and current preset. SOURCED: SparklingTones. */
  async identify(): Promise<SparkAmpState> {
    await this.request(commands.getName(), isNotify(0x11));
    await this.request(commands.getSerial(), isNotify(0x23));
    await this.request(commands.getCurrentPreset(), isNotify(0x10));
    return this.state;
  }

  /* ----------------------------------------------------------------
     Tempo (bpm)
     Lives inside the looper settings; the amp keeps timed effects coupled to it.
     SOURCED: SparklingTones (Spark 2). UNVERIFIED on the Spark LIVE.
     ---------------------------------------------------------------- */

  /** @returns the 0x0376 payload, or null if the amp doesn't answer. */
  async readLooperSettings(timeoutMs?: number): Promise<number[] | null> {
    const msg = await this.request(commands.getLooperSettings(), isNotify(0x76), timeoutMs);
    return msg ? Array.from(msg.data) : null;
  }

  async readBpm(timeoutMs?: number): Promise<number | null> {
    const settings = await this.readLooperSettings(timeoutMs);
    return settings ? bpmFromSettings(settings) : null;
  }

  /**
   * Writes the bpm, then reads it back. The other looper fields are never invented: they come
   * from a fresh read, with only the bpm replaced (their shape changes between sessions).
   * **No trailing 0x00** — with it the amp reads shifted fields and the delay repeats forever.
   *
   * Changes live amp state: needs owner approval and a hardware test before use.
   */
  async setBpm(bpm: number, timeoutMs?: number): Promise<BpmWriteResult> {
    const requested = Math.round(bpm);
    const previous = await this.readLooperSettings(timeoutMs);
    if (!previous) throw new Error('The amp did not send its looper settings: tempo not written');
    await this.send(commands.setLooperSettings(settingsWithBpm(previous, bpm)));
    const readBack = await this.readBpm(timeoutMs);
    return { verified: readBack === requested, requested, readBack };
  }

  /* ----------------------------------------------------------------
     Writing a whole preset (0x0101)
     ---------------------------------------------------------------- */

  /**
   * Plays a preset without overwriting any saved slot: 0x0101 to the software buffer 0x7f, then
   * 0x0138 to switch to it (without the switch the amp ACKs every chunk and keeps playing the old
   * sound), then reads live state back and compares. VERIFIED-HW: Spark LIVE — mySpark
   * tools/write-test, read-back verified, 2026-09-28. The PRESET LED blinks while 0x7f plays.
   *
   * Changes live amp state: needs owner approval and a hardware test before use.
   */
  async loadPreset(
    preset: Preset,
    onProgress?: (chunk: number, total: number) => void,
    options?: PresetUploadOptions,
  ): Promise<VerifiedWriteResult> {
    const upload = await this.writePreset(preset, SOFTWARE_TARGET, onProgress, options);
    if (!upload.sent) return { ...upload, verified: false, differences: [], readBack: null };
    await this.send(commands.changePreset(SOFTWARE_PRESET));
    this.state.currentPreset = SOFTWARE_PRESET; // playing the buffer, not a saved slot
    await sleep(this.timing.loadSettleDelay);
    return this.verify(upload, preset, await this.readLiveState(), 'live state');
  }

  /**
   * Switches the amp to a saved CH1 slot (0x0138 [0x00, slot]), then reads the slot and the live
   * state back and checks the amp is playing that slot's content.
   * 0x0138 is VERIFIED-HW on the Spark LIVE (SparklingTones; mySpark loadPreset uses it for 0x7f);
   * this verified switch to a saved slot is not yet hardware-tested.
   *
   * Changes live amp state: needs owner approval and a hardware test before use.
   *
   * @param slotCount slots on the connected amp (8 for the Spark LIVE)
   */
  async switchPreset(slot: number, slotCount: number): Promise<SwitchResult> {
    if (!Number.isInteger(slot) || slot < 0 || slot >= slotCount) {
      throw new Error(`Slot ${slot} outside 0–${slotCount - 1}`);
    }
    await this.send(commands.changePreset(slot));
    await sleep(this.timing.loadSettleDelay);
    const slotPreset = await this.readPreset(slot);
    const live = await this.readLiveState();
    if (!slotPreset || !live) {
      const differences = [`no read-back of ${!slotPreset ? `slot ${slot}` : 'live state'} from the amp`];
      this.onLog(`switch to slot ${slot}: ${differences[0]} — NOT verified`);
      return { verified: false, differences, slotPreset, live };
    }
    const differences = presetDifferences(slotPreset, live);
    const verified = differences.length === 0;
    if (verified) this.state.currentPreset = slot;
    this.onLog(`switch to slot ${slot}: ${verified ? 'verified' : `NOT verified — ${differences.join('; ')}`}`);
    return { verified, differences, slotPreset, live };
  }

  /**
   * Knob change (0x0104), **not verified** — for streaming values while a slider moves. Follow it
   * with verifyParam once the value settles. The amp sends no ACK for 0x0104 (SOURCED: soundshed),
   * so only a read-back proves anything. VERIFIED-HW: Spark LIVE (via SparklingTones, amp block).
   *
   * Changes live amp state: needs owner approval and a hardware test before use.
   */
  async changeParam(effectName: string, index: number, value: number): Promise<void> {
    if (!Number.isFinite(value)) throw new Error(`Knob value is not a number: ${value}`);
    if (!Number.isInteger(index) || index < 0 || index > 0x7f) throw new Error(`Invalid param index ${index}`);
    await this.send(commands.changeParam(effectName, index, value));
  }

  /** Reads live state and checks one param holds `value` (float32, clamped 0–1 like changeParam). */
  async verifyParam(effectName: string, index: number, value: number): Promise<ParamCheck> {
    const live = await this.readLiveState();
    const actual = live?.effects.find((e) => e.name === effectName)?.params.find((p) => p.index === index)?.value ?? null;
    const expected = Math.fround(Math.max(0, Math.min(1, value)));
    const verified = actual === expected;
    this.onLog(`${effectName} param ${index}: ${verified ? 'verified' : `NOT verified (amp has ${actual})`}`);
    return { verified, expected, actual, live };
  }

  /**
   * Turns a block on or off (0x0115), then reads live state back and checks.
   * VERIFIED-HW: Spark LIVE (via SparklingTones). Changes live amp state: needs owner approval
   * and a hardware test before use.
   */
  async setEffectEnabled(effectName: string, on: boolean): Promise<EnabledCheck> {
    await this.send(commands.effectOnOff(effectName, on));
    const live = await this.readLiveState();
    const actual = live?.effects.find((e) => e.name === effectName)?.enabled ?? null;
    const verified = actual === on;
    this.onLog(`${effectName} ${on ? 'on' : 'off'}: ${verified ? 'verified' : `NOT verified (amp has ${actual})`}`);
    return { verified, expected: on, actual, live };
  }

  /**
   * Changes the model of one chain position (0x0106 [old name, new name, 0x00]), then reads live
   * state back and checks the position now holds `newName`. VERIFIED-HW: Spark LIVE for the models
   * the owner tried via SparklingTones. **A model the amp lacks can freeze it until power-off**
   * (SparklingTones, Spark 2): the caller must only send models known on this amp, or get the
   * owner's explicit go-ahead for an untried one.
   *
   * Changes live amp state: needs owner approval and a hardware test before use.
   */
  async setEffectModel(position: number, oldName: string, newName: string): Promise<ModelCheck> {
    await this.send(commands.changeEffectModel(oldName, newName));
    await sleep(this.timing.loadSettleDelay);
    const live = await this.readLiveState();
    const actual = live?.effects[position]?.name ?? null;
    const verified = actual === newName;
    this.onLog(`position ${position} ${oldName} → ${newName}: ${verified ? 'verified' : `NOT verified (amp has ${actual})`}`);
    return { verified, expected: newName, actual, live };
  }

  /**
   * Turns the amp's built-in tuner on or off, then reads its state back (0x0265 → 0x0365).
   * While on, the amp streams 0x0364 readings (see parseTunerReading) and usually mutes its output.
   * @returns whether the amp confirms the requested state
   */
  async setTuner(on: boolean): Promise<boolean> {
    await this.send(commands.setTuner(on));
    const reply = await this.request(commands.getTunerState(), isNotify(0x65));
    let state: boolean | null = null;
    try {
      state = reply ? new Reader(reply.data).bool() : null;
    } catch {
      state = null;
    }
    this.onLog(`tuner ${on ? 'on' : 'off'}: amp reports ${state === null ? 'nothing' : state ? 'on' : 'off'}`);
    return state === on;
  }

  /**
   * Reads one amp-wide level (0x0233 [target] → 0x0333 [float], matched by seq). Observed on the
   * owner's Spark LIVE from the official app; mySpark's use not yet hardware-tested.
   * @returns 0..1, or null if the amp doesn't answer
   */
  async readVolume(target: number, timeoutMs?: number): Promise<number | null> {
    const seq = this.nextSeq();
    const pending = this.wait(
      (m) => m.cmd === CMD_NOTIFY && m.sub === 0x33 && m.seq === seq && m.data.length === 5,
      timeoutMs ?? this.timing.defaultTimeout,
    );
    await this.send(commands.getVolume(target), { seq });
    const reply = await pending;
    if (!reply) return null;
    const value = new Reader(reply.data).float();
    this.state.volumes[target] = value;
    return value;
  }

  /**
   * Sets one amp-wide level (0x0133), **not verified** — for streaming while a slider moves.
   * Follow it with verifyVolume. Changes live amp state: needs owner approval and a hardware test.
   */
  async changeVolume(target: number, value: number): Promise<void> {
    if (!Number.isFinite(value)) throw new Error(`Volume is not a number: ${value}`);
    await this.send(commands.setVolume(target, value));
  }

  /** Reads a level back and checks it holds `value` (float32, clamped 0–1). */
  async verifyVolume(target: number, value: number): Promise<{ verified: boolean; expected: number; actual: number | null }> {
    const actual = await this.readVolume(target);
    const expected = Math.fround(Math.max(0, Math.min(1, value)));
    const verified = actual === expected;
    this.onLog(`volume 0x${hex(target)}: ${verified ? 'verified' : `NOT verified (amp has ${actual})`}`);
    return { verified, expected, actual };
  }

  /**
   * Saves a preset to a slot, overwriting it, then reads the slot back and compares.
   *
   * Addresses the slot directly with 0x0101 — **not** via 0x7f + 0x0127, which ACKs and does not
   * save on the Spark 2. Then switches to another slot and back: without that round trip the slot
   * keeps reporting its old content. Note the round trip changes the sound the amp is playing.
   * SOURCED: SparklingTones; VERIFIED-HW: Spark LIVE (slot change seen on re-read, 2026-09-28).
   *
   * Writes a saved slot: needs owner approval and a hardware test before use.
   *
   * @param slotCount slots on the connected amp (8 for the Spark LIVE)
   */
  async storePreset(
    preset: Preset,
    slot: number,
    slotCount: number,
    onProgress?: (chunk: number, total: number) => void,
    options?: PresetUploadOptions,
  ): Promise<VerifiedWriteResult> {
    if (!Number.isInteger(slot) || slot < 0 || slot >= slotCount) {
      throw new Error(`Slot ${slot} outside 0–${slotCount - 1}`);
    }
    const upload = await this.writePreset(preset, slotTarget(slot), onProgress, options);
    if (!upload.sent) return { ...upload, verified: false, differences: [], readBack: null };

    await sleep(this.timing.storeSwitchDelay);
    await this.send(commands.changePreset(slot === 0 ? 1 : 0));
    await sleep(this.timing.storeSwitchDelay);
    await this.send(commands.changePreset(slot));
    this.onLog(`written to slot ${slot}, with a preset switch away and back; reading back`);
    return this.verify(upload, preset, await this.readPreset(slot), `slot ${slot}`);
  }

  private verify(upload: PresetUploadResult, expected: Preset, readBack: Preset | null, label: string): VerifiedWriteResult {
    if (!readBack) {
      this.onLog(`${label}: read-back failed — write NOT verified`);
      return { ...upload, verified: false, differences: ['no read-back from the amp'], readBack: null };
    }
    const differences = presetDifferences(expected, readBack);
    this.onLog(
      differences.length === 0
        ? `${label}: read-back matches — write verified`
        : `${label}: read-back differs — write NOT verified: ${differences.join('; ')}`,
    );
    return { ...upload, verified: differences.length === 0, differences, readBack };
  }

  /**
   * Uploads a preset one chunk at a time, waiting for each ACK: the firmware blocks further
   * sends until it has acked the previous one (ok_to_send, SparkIO.ino:1251). ACK is 0x0401 on
   * intermediate chunks, 0x0501 on the last. All chunks share **one seq** — how the amp sends its
   * own presets. SOURCED: SparklingTones; VERIFIED-HW: Spark LIVE.
   *
   * Private: an upload alone proves nothing. Use loadPreset or storePreset, which verify.
   */
  private async writePreset(
    preset: Preset,
    target: PresetTarget,
    onProgress?: (chunk: number, total: number) => void,
    options: PresetUploadOptions = {},
  ): Promise<PresetUploadResult> {
    if (!this.writeChar) throw new Error('Not connected');
    const { errors } = validatePreset(preset);
    if (errors.length) throw new Error(`Preset not sent: ${errors.join('; ')}`);

    // The two tail floats are not sent: create_preset doesn't write them (SparkIO.ino:1019).
    const payload = serializePreset(preset, target, { omitTail: !options.includeTail });
    // The Spark GO takes 128-byte chunks (official app on the owner's GO, 2026-09-29); the LIVE 25.
    // Over BLE the GO's larger messages are split into 20-byte writes; the amp reassembles F0…F7.
    const go = this.deviceName === SPARK_GO_NAME;
    const chunks = splitPresetIntoChunks(payload, options.chunkSize ?? (go ? GO_PRESET_CHUNK_SIZE : undefined));
    const seq = this.nextSeq();
    this.onLog(
      `sending "${preset.name}" → bank ${payload[0]} number ${payload[1]}: ${payload.length} bytes in ${chunks.length} chunks, ` +
        (options.incrementSeq ? 'incrementing seq' : `seq 0x${hex(seq)} for all`) +
        (options.includeTail ? ', with tail' : ''),
    );

    let acks = 0;
    for (let i = 0; i < chunks.length; i++) {
      onProgress?.(i, chunks.length);
      const pending = this.wait(
        (m) => (m.cmd === CMD_ACK || m.cmd === CMD_ACK_FINAL) && m.sub === 0x01,
        options.ackTimeout ?? this.timing.presetAckTimeout,
      );
      try {
        await this.send(
          { cmd: CMD_ACTION, sub: 0x01, data: chunks[i] },
          { seq: options.incrementSeq ? undefined : seq, blockHeader: options.blockHeader, writeSize: go ? GO_BLE_WRITE_SIZE : undefined },
        );
      } catch (err) {
        const error = `BLE error on chunk ${i + 1} of ${chunks.length}: ${(err as Error).message}`;
        this.onLog(error);
        return { sent: false, chunksSent: i, chunksTotal: chunks.length, acks, error };
      }
      // A missing ACK is no reason to stop: the firmware unblocks itself after 500 ms too.
      if (await pending) acks++;
    }
    if (acks < chunks.length) this.onLog(`all chunks sent, but only ${acks} of ${chunks.length} acked`);
    return { sent: true, chunksSent: chunks.length, chunksTotal: chunks.length, acks };
  }
}
