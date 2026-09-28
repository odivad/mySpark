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
  MessageAssembler,
  SOFTWARE_PRESET,
  type SparkMessage,
  assemblePresetPayload,
  buildChunk,
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
      const payload = bank === 0x01 ? this.live : this.slots.get(number);
      if (payload) this.sendPreset(payload, m.seq);
    } else if (m.cmd === CMD_QUERY && m.sub === 0x76) {
      if (!this.silent) this.reply(CMD_NOTIFY, 0x76, this.looperSettings, m.seq);
    } else if (m.cmd === CMD_ACTION && m.sub === 0x01) {
      this.receiveUploadChunk(m);
    } else if (m.cmd === CMD_ACTION && m.sub === 0x38) {
      const target = m.data[1];
      const payload = target === SOFTWARE_PRESET ? this.softwareBuffer : this.slots.get(target);
      if (payload) this.live = [0x01, 0x00, ...payload.slice(2)];
      this.reply(CMD_ACK, 0x38, [], m.seq);
    } else if (m.cmd === CMD_ACTION && m.sub === 0x76) {
      if (!this.ignoreWrites) this.looperSettings = m.data;
      this.reply(CMD_ACK, 0x76, [], m.seq);
    }
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
