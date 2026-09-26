import { SparkCommand, SparkFrame, SparkFrameCodec } from './protocol.js';
import {
  SparkDeviceState,
  SparkEffect,
  SparkParameter,
  SparkPreset,
  SlotIndex,
} from './types.js';

export interface SparkTransport {
  write(data: Uint8Array): Promise<void>;
  onFrame(handler: (frame: SparkFrame) => void): void;
}

const defaultPreset = (): SparkPreset => ({
  id: 'active',
  uuid: '00000000-0000-0000-0000-000000000000',
  name: 'Default',
  bank: 'A',
  slot: 0,
  version: 1,
  description: 'Active preset',
  icon: 'default',
  bpm: 120,
  effects: [
    {
      id: 'amp',
      name: 'Amp',
      enabled: true,
      parameters: [{ key: 'gain', index: 0, value: 0.5, normalized: true }],
    },
  ],
});

export class SparkBtClient {
  private readonly transport: SparkTransport;
  private state: SparkDeviceState;
  private nextSequence = 1;

  constructor(transport: SparkTransport) {
    this.transport = transport;
    this.state = {
      livePreset: defaultPreset(),
      savedPresets: {},
      lastSequence: 0,
    };

    this.transport.onFrame((frame) => {
      this.handleFrame(frame);
    });
  }

  get currentState(): SparkDeviceState {
    return this.state;
  }

  async requestState(): Promise<void> {
    const frame = SparkFrameCodec.buildFrame(SparkCommand.ReadState, 0x00, [], this.nextSequence++);
    await this.transport.write(frame);
  }

  async loadPreset(slot: SlotIndex): Promise<void> {
    const payload = SparkFrameCodec.appendTrailingZeroIfNeeded([slot]);
    const frame = SparkFrameCodec.buildFrame(SparkCommand.LoadPreset, 0x00, payload, this.nextSequence++);
    await this.transport.write(frame);
  }

  async savePreset(slot: SlotIndex): Promise<void> {
    const payload = SparkFrameCodec.appendTrailingZeroIfNeeded([slot]);
    const frame = SparkFrameCodec.buildFrame(SparkCommand.SavePreset, 0x00, payload, this.nextSequence++);
    await this.transport.write(frame);
  }

  async setParameter(effectId: string, parameterKey: string, value: number): Promise<void> {
    const effect = this.state.livePreset.effects.find((item) => item.id === effectId);
    if (!effect) {
      throw new Error(`Unknown effect: ${effectId}`);
    }

    const parameter = effect.parameters.find((item) => item.key === parameterKey);
    if (!parameter) {
      throw new Error(`Unknown parameter: ${parameterKey}`);
    }

    parameter.value = Math.max(0, Math.min(1, value));
    const payload = SparkFrameCodec.appendTrailingZeroIfNeeded([
      effect.parameters.findIndex((item) => item.key === parameterKey),
      Math.round(parameter.value * 100),
    ]);

    const frame = SparkFrameCodec.buildFrame(SparkCommand.SetParameter, 0x00, payload, this.nextSequence++);
    await this.transport.write(frame);
  }

  async setEffectState(effectId: string, enabled: boolean): Promise<void> {
    const effect = this.state.livePreset.effects.find((item) => item.id === effectId);
    if (!effect) {
      throw new Error(`Unknown effect: ${effectId}`);
    }

    effect.enabled = enabled;
    const payload = SparkFrameCodec.appendTrailingZeroIfNeeded([
      this.state.livePreset.effects.findIndex((item) => item.id === effectId),
      enabled ? 1 : 0,
    ]);

    const frame = SparkFrameCodec.buildFrame(SparkCommand.SetEffectState, 0x00, payload, this.nextSequence++);
    await this.transport.write(frame);
  }

  private handleFrame(frame: SparkFrame): void {
    this.state.lastSequence = frame.sequence;

    if (frame.command === SparkCommand.ReadState) {
      this.state.livePreset = this.normalizeLivePreset(frame.payload);
    }

    if (frame.command === SparkCommand.ReadPreset) {
      const preset = this.normalizePreset(frame.payload);
      this.state.savedPresets[preset.id] = preset;
    }
  }

  private normalizeLivePreset(payload: number[]): SparkPreset {
    const preset = defaultPreset();
    const byteCount = payload.length > 0 ? payload[0] : 0;
    preset.name = `Live ${byteCount}`;
    return preset;
  }

  private normalizePreset(payload: number[]): SparkPreset {
    const preset = defaultPreset();

    preset.id = `preset-${payload.length}`;
    preset.uuid = 'generated-from-frame';
    preset.name = 'Normalized preset';
    preset.bank = 'A';
    preset.slot = 0;
    preset.version = 1;
    preset.description = 'Decoded from Spark frame payload';
    preset.icon = 'spark';
    preset.bpm = 120;
    preset.effects = [
      {
        id: 'amp',
        name: 'Amp',
        enabled: true,
        parameters: [
          { key: 'gain', index: 0, value: payload[0] / 255, normalized: true },
        ],
      },
    ];

    return preset;
  }
}

export function createDemoTransport(): SparkTransport {
  return {
    async write(data: Uint8Array): Promise<void> {
      console.log('Spark write:', Array.from(data));
    },
    onFrame(handler: (frame: SparkFrame) => void): void {
      // This hook is intentionally left for a real BLE implementation.
      // A real adapter would push parsed frames into the handler as notifications arrive.
      void handler;
    },
  };
}

export type { SparkEffect, SparkParameter, SparkPreset, SlotIndex };
