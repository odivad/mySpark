export interface SparkFrame {
  sequence: number;
  checksum: number;
  command: number;
  subcommand: number;
  payload: number[];
  raw: Uint8Array;
}

export enum SparkCommand {
  ReadState = 0x01,
  ReadPreset = 0x02,
  WritePreset = 0x03,
  SetParameter = 0x10,
  SetEffectState = 0x11,
  SavePreset = 0x20,
  LoadPreset = 0x21,
  SetBpm = 0x30,
}

export class SparkFrameCodec {
  static readonly START = 0xf0;
  static readonly END = 0xf7;
  static readonly HEADER = 0x01;

  static parseFrame(frame: Uint8Array): SparkFrame {
    if (frame.length < 7) {
      throw new Error(`Frame too short: ${frame.length} bytes`);
    }

    if (frame[0] !== SparkFrameCodec.START || frame[frame.length - 1] !== SparkFrameCodec.END) {
      throw new Error('Frame delimiter mismatch');
    }

    if (frame[1] !== SparkFrameCodec.HEADER) {
      throw new Error(`Unexpected protocol marker: 0x${frame[1].toString(16).padStart(2, '0')}`);
    }

    const sequence = frame[2];
    const checksum = frame[3];
    const command = frame[4];
    const subcommand = frame[5];
    const payload = Array.from(frame.slice(6, -1));
    const actualChecksum = payload.reduce((acc, byte) => acc ^ byte, 0);

    if (checksum !== actualChecksum) {
      throw new Error(`Checksum mismatch: expected 0x${actualChecksum.toString(16)}, got 0x${checksum.toString(16)}`);
    }

    return {
      sequence,
      checksum,
      command,
      subcommand,
      payload,
      raw: frame,
    };
  }

  static buildFrame(command: number, subcommand: number, payload: number[], sequence = 0): Uint8Array {
    const body = [...payload];
    const checksum = body.reduce((acc, byte) => acc ^ byte, 0);
    const frame = new Uint8Array(7 + body.length);

    frame[0] = SparkFrameCodec.START;
    frame[1] = SparkFrameCodec.HEADER;
    frame[2] = sequence & 0xff;
    frame[3] = checksum & 0xff;
    frame[4] = command & 0xff;
    frame[5] = subcommand & 0xff;

    frame.set(body, 6);
    frame[frame.length - 1] = SparkFrameCodec.END;

    return frame;
  }

  static appendTrailingZeroIfNeeded(payload: number[]): number[] {
    if (payload.length === 0 || payload[payload.length - 1] !== 0) {
      return [...payload, 0];
    }

    return payload;
  }
}
