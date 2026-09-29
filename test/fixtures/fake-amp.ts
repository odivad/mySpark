/**
 * A fake Spark amp behind a fake navigator.bluetooth, for SparkTransport tests.
 *
 * Status: behaves the way SparklingTones describes the Spark 2 (SOURCED) — ACK 0x04 per preset
 * chunk and 0x05 on the last, replies sharing the request seq, 0x0138 switching the playing sound.
 * It proves the transport matches that description, not that it matches the amp.
 */
import {
  CMD_ACK,
  CMD_ACTION,
  CMD_NOTIFY,
  CMD_QUERY,
  LIVE_TARGET,
  MessageAssembler,
  Reader,
  SOFTWARE_PRESET,
  type Preset,
  type SparkMessage,
  assemblePresetPayload,
  buildChunk,
  encFloat,
  parsePreset,
  serializePreset,
  splitPresetIntoChunks,
} from '../../src/spark/protocol.js';
import type {
  SparkBluetooth,
  SparkBluetoothDevice,
  SparkGattCharacteristic,
} from '../../src/spark/transport.js';

export interface FakeAmpOptions {
  name?: string;
  /** Preset payloads by slot, as the amp would send them (with bank/number bytes). */
  slots?: Map<number, number[]>;
  looperSettings?: number[];
}

export class FakeAmp {
  readonly name: string;
  readonly slots: Map<number, number[]>;
  softwareBuffer: number[] | null = null;
  /** What 0x0201 [0x01, 0x00] returns. */
  live: number[] | null = null;
  looperSettings: number[];
  /** Presets in other banks (e.g. CH2 `3:n`, `4:0`), by "bank:number". */
  readonly banks = new Map<string, number[]>();
  /** Levels by 0x0133 target. */
  volumes: Record<number, number> = { 0x00: 0.25, 0x05: 0, 0x09: 0.53 };

  /** ACK every chunk but don't store anything, like the Spark 2 does with a malformed preset. */
  ignoreWrites = false;
  /** Don't answer reads. */
  silent = false;
  /** Make the next BLE write throw. */
  failNextWrite = false;

  /** Every message the app sent, decoded. */
  readonly received: SparkMessage[] = [];
  connected = false;

  private uploads = new Map<number, SparkMessage[]>();
  private notifyListener: (() => void) | null = null;
  private disconnectListener: (() => void) | null = null;
  private readonly assembler = new MessageAssembler((m) => this.handle(m));
  private readonly notifyChar: SparkGattCharacteristic & { value: DataView | null };
  private readonly writeChar: SparkGattCharacteristic;
  readonly requestedFilters: unknown[] = [];

  constructor(options: FakeAmpOptions = {}) {
    this.name = options.name ?? 'Spark LIVE BLE';
    this.slots = options.slots ?? new Map();
    // bpm 120 first (SOURCED layout); the remaining bytes are arbitrary filler, not a capture.
    this.looperSettings = options.looperSettings ?? [0x78, 0x04, 0x04, 0xc2, 0xc3, 0xc2, 0x3c];

    const amp = this;
    this.notifyChar = {
      value: null,
      writeValueWithoutResponse: () => Promise.reject(new Error('not writable')),
      startNotifications: () => Promise.resolve(),
      addEventListener: (_type, listener) => {
        amp.notifyListener = listener;
      },
    };
    this.writeChar = {
      writeValueWithoutResponse: async (value) => {
        if (amp.failNextWrite) {
          amp.failNextWrite = false;
          throw new Error('GATT write failed');
        }
        amp.assembler.feed(Array.from(value));
      },
      startNotifications: () => Promise.reject(new Error('no notify')),
      addEventListener: () => {},
    };
  }

  get bluetooth(): SparkBluetooth {
    const amp = this;
    const device: SparkBluetoothDevice = {
      name: this.name,
      gatt: {
        get connected() {
          return amp.connected;
        },
        connect: async () => {
          amp.connected = true;
          return {
            getPrimaryService: async (uuid) => {
              if (uuid !== 0xffc0) throw new Error(`no service ${uuid.toString(16)}`);
              return {
                getCharacteristic: async (c) => {
                  if (c === 0xffc1) return amp.writeChar;
                  if (c === 0xffc2) return amp.notifyChar;
                  throw new Error(`no characteristic ${c.toString(16)}`);
                },
              };
            },
          };
        },
        disconnect: () => amp.dropConnection(),
      },
      addEventListener: (_type, listener) => {
        amp.disconnectListener = listener;
      },
    };
    return {
      requestDevice: async (options) => {
        this.requestedFilters.push(options.filters);
        return device;
      },
    };
  }

  dropConnection(): void {
    this.connected = false;
    this.disconnectListener?.();
  }

  /** Sends raw bytes to the app as one notification, asynchronously like a real radio. */
  notify(bytes: readonly number[]): void {
    setTimeout(() => {
      this.notifyChar.value = new DataView(Uint8Array.from(bytes).buffer);
      this.notifyListener?.();
    }, 0);
  }

  private reply(cmd: number, sub: number, data: number[], seq: number): void {
    this.notify(buildChunk(cmd, sub, data, seq));
  }

  private sendPreset(payload: number[], seq: number): void {
    for (const chunk of splitPresetIntoChunks(payload)) this.reply(CMD_NOTIFY, 0x01, chunk, seq);
  }

  private handle(m: SparkMessage): void {
    this.received.push(m);
    if (m.cmd === CMD_QUERY && m.sub === 0x01) {
      if (this.silent) return;
      const [bank, number] = m.data;
      const payload =
        this.banks.get(`${bank}:${number}`) ?? (bank === 0x01 ? this.live : bank === 0x00 ? this.slots.get(number) : undefined);
      if (payload) this.sendPreset(payload, m.seq);
    } else if (m.cmd === CMD_QUERY && m.sub === 0x76) {
      if (!this.silent) this.reply(CMD_NOTIFY, 0x76, this.looperSettings, m.seq);
    } else if (m.cmd === CMD_ACTION && m.sub === 0x01) {
      this.receiveUploadChunk(m);
    } else if (m.cmd === CMD_ACTION && m.sub === 0x38) {
      const target = m.data[1];
      const payload = target === SOFTWARE_PRESET ? this.softwareBuffer : this.slots.get(target);
      if (payload && !this.ignoreWrites) this.live = [0x01, 0x00, ...payload.slice(2)];
      this.reply(CMD_ACK, 0x38, [], m.seq);
    } else if (m.cmd === CMD_ACTION && m.sub === 0x04) {
      // Knob change: no ACK (SOURCED: soundshed). [prefixed name, param, float, 0x00]
      const r = new Reader(m.data);
      const name = r.prefixedString();
      const index = r.int();
      const value = r.float();
      this.editLive((p) => {
        const param = p.effects.find((e) => e.name === name)?.params.find((q) => q.index === index);
        if (param) param.value = value;
      });
    } else if (m.cmd === CMD_ACTION && m.sub === 0x15) {
      const r = new Reader(m.data);
      const name = r.prefixedString();
      const on = r.bool();
      this.editLive((p) => {
        const effect = p.effects.find((e) => e.name === name);
        if (effect) effect.enabled = on;
      });
      this.reply(CMD_ACK, 0x15, [], m.seq);
    } else if (m.cmd === CMD_ACTION && m.sub === 0x06) {
      const r = new Reader(m.data);
      const from = r.prefixedString();
      const to = r.prefixedString();
      this.editLive((p) => {
        const effect = p.effects.find((e) => e.name === from);
        if (effect) effect.name = to;
      });
      this.reply(CMD_ACK, 0x06, [], m.seq);
    } else if (m.cmd === CMD_QUERY && m.sub === 0x33) {
      if (!this.silent) this.reply(CMD_NOTIFY, 0x33, encFloat(this.volumes[m.data[0]] ?? 0), m.seq);
    } else if (m.cmd === CMD_ACTION && m.sub === 0x33) {
      // No ACK, like the LIVE in the official app's log.
      const r = new Reader(m.data);
      const target = r.int();
      const value = r.float();
      if (!this.ignoreWrites) this.volumes[target] = value;
    } else if (m.cmd === CMD_ACTION && m.sub === 0x76) {
      if (!this.ignoreWrites) this.looperSettings = m.data;
      this.reply(CMD_ACK, 0x76, [], m.seq);
    }
  }

  private editLive(change: (preset: Preset) => void): void {
    if (this.ignoreWrites || !this.live) return;
    const preset = parsePreset(this.live);
    change(preset);
    this.live = serializePreset(preset, LIVE_TARGET);
  }

  private receiveUploadChunk(m: SparkMessage): void {
    const list = this.uploads.get(m.seq) ?? [];
    list.push(m);
    this.uploads.set(m.seq, list);
    const asm = assemblePresetPayload(list);
    this.reply(asm.complete ? 0x05 : CMD_ACK, 0x01, [], m.seq);
    if (!asm.complete) return;
    this.uploads.delete(m.seq);
    if (this.ignoreWrites) return;
    const [, number] = asm.payload;
    if (number === SOFTWARE_PRESET) this.softwareBuffer = asm.payload;
    else this.slots.set(number, asm.payload);
  }
}
