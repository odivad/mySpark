export type BankLetter = 'A' | 'B';
export type SlotIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface SparkParameter {
  key: string;
  index: number;
  value: number;
  normalized: boolean;
}

export interface SparkEffect {
  id: string;
  name: string;
  enabled: boolean;
  parameters: SparkParameter[];
}

export interface SparkPreset {
  id: string;
  uuid: string;
  name: string;
  bank: BankLetter;
  slot: SlotIndex;
  version: number;
  description: string;
  icon: string;
  bpm: number;
  effects: SparkEffect[];
}

export interface SparkDeviceState {
  livePreset: SparkPreset;
  savedPresets: Record<string, SparkPreset>;
  lastSequence: number;
}
