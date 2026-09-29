import { describe, expect, it } from 'vitest';
import { type CloudSummary, cloudToPreset, sortResults, toSummary } from '../src/app/tonecloud.js';
import { SPARK2_MODELS } from '../src/spark/catalog.js';
import { serializePreset, validatePreset, SOFTWARE_TARGET } from '../src/spark/protocol.js';
import { TONECLOUD_PRESET } from './fixtures/tonecloud.js';

describe('ToneCloud', () => {
  it('summarises a search item, including its models', () => {
    const s = toSummary(TONECLOUD_PRESET)!;
    expect(s).toMatchObject({ id: '6abaa161e9519e95946c709b', name: 'Blues Legend', chain: 'in1' });
    expect(s.models).toEqual(['bias.noisegate', 'Compressor', 'Booster', 'Bassman', 'Phaser', 'DelayRe201', 'bias.reverb']);
  });

  it('converts preset_data into a 7-block preset that validates against the Spark 2 models and serializes', () => {
    const p = cloudToPreset(TONECLOUD_PRESET.preset_data);
    expect(p.name).toBe('Blues Legend');
    expect(p.effects.map((e) => e.name)).toEqual(toSummary(TONECLOUD_PRESET)!.models);
    expect(p.effects[2]).toMatchObject({ name: 'Booster', enabled: true });
    expect(p.effects[1].enabled).toBe(false);
    expect(validatePreset(p, SPARK2_MODELS.flat()).errors).toEqual([]);
    expect(serializePreset(p, SOFTWARE_TARGET).length).toBeGreaterThan(100);
  });

  it('reads switches stored as true/false (the official app format) as 1 / 0', () => {
    const p = cloudToPreset({ sigpath: [{ dspId: 'Cloner', active: true, params: [{ index: 0, value: 0.35 }, { index: 1, value: false }] }] });
    expect(p.effects[0].params).toEqual([{ index: 0, value: 0.35 }, { index: 1, value: 0 }]);
  });

  it('rejects malformed preset data with a reason', () => {
    expect(() => cloudToPreset('not json')).toThrow(/valid JSON/);
    expect(() => cloudToPreset({ meta: {} })).toThrow(/no sigpath/);
    expect(() => cloudToPreset({ sigpath: [{ dspId: 'Twin', params: [{ index: 'x', value: 1 }] }] })).toThrow(/malformed/);
  });

  it('flags a model the Spark 2 list lacks', () => {
    const p = cloudToPreset(TONECLOUD_PRESET.preset_data);
    p.effects[2].name = 'TrebleBooster';
    expect(validatePreset(p, SPARK2_MODELS.flat()).errors[0]).toMatch(/TrebleBooster/);
  });
});

describe('ToneCloud sorting', () => {
  const r = (name: string, likes: number, downloads: number): CloudSummary => ({
    id: name, name, description: '', category: '', likes, downloads, rating: 0, models: [], chain: 'in1', updated: '',
  });
  const list = [r('beta', 5, 900), r('  alpha', 50, 10), r('Gamma', 20, 300)];

  it('sorts by likes, downloads and title (ignoring stray spaces and case)', () => {
    expect(sortResults(list, 'likes').map((x) => x.name)).toEqual(['  alpha', 'Gamma', 'beta']);
    expect(sortResults(list, 'downloads').map((x) => x.name)).toEqual(['beta', 'Gamma', '  alpha']);
    expect(sortResults(list, 'title').map((x) => x.name)).toEqual(['  alpha', 'beta', 'Gamma']);
  });

  it('keeps the server order for newest', () => {
    expect(sortResults(list, 'latest')).toEqual(list);
  });
});
