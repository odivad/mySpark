import { describe, expect, it } from 'vitest';
import {
  POSITION_KEYS,
  alignToAmp,
  buildPalette,
  buildPrompt,
  checkSuggestion,
  mergePalettes,
  parseAnswer,
  suggestionSchema,
  toAscii,
} from '../src/app/tone-ai.js';
import { MessageAssembler, type Preset, type SparkMessage, assemblePresetPayload, parsePreset } from '../src/spark/protocol.js';
import { PRESET0_CHUNKS } from './fixtures/sparklingtones.js';
import { MODEL_INFO, SPARK2_MODELS, describeModel } from '../src/spark/catalog.js';

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function preset0(): Preset {
  const messages: SparkMessage[] = [];
  const asm = new MessageAssembler((m) => messages.push(m));
  PRESET0_CHUNKS.forEach((c) => asm.feed(c));
  return parsePreset(assemblePresetPayload(messages).payload);
}

/** Preset 0 plus a second preset with a different amp model, so the palette offers a choice. */
function fixtures() {
  const base = preset0();
  const other = copy(base);
  other.effects[3] = { ...other.effects[3], name: 'Plexi', params: other.effects[3].params.map((p) => ({ ...p, value: 0.2 })) };
  return { base, palette: buildPalette([base, other, null]) };
}

const answer = (base: Preset, over: Record<string, unknown> = {}) => ({
  name: 'Warm blues',
  description: 'Less gain, more middle.',
  amp: { gain: 3.5, treble: 5, middle: 7, bass: 5 },
  on: { noiseGate: true, compWah: false, drive: true, modulation: false, delay: false, reverb: true },
  models: Object.fromEntries(POSITION_KEYS.map((k, i) => [k, base.effects[i].name])),
  ...over,
});

describe('palette', () => {
  it('collects distinct models per position from the amp’s presets', () => {
    const { base, palette } = fixtures();
    expect(palette[3].map((e) => e.name)).toEqual([base.effects[3].name, 'Plexi']);
    expect(palette[0]).toHaveLength(1);
  });
});

describe('format', () => {
  it('limits models to the palette in the schema', () => {
    const { palette } = fixtures();
    const schema = suggestionSchema(palette, 3) as any;
    const item = schema.properties.suggestions.items;
    expect(schema.properties.suggestions.maxItems).toBe(3);
    expect(item.properties.models.properties.amp.enum).toEqual(palette[3].map((e) => e.name));
    expect(item.properties.amp.required).toEqual(['gain', 'treble', 'middle', 'bass']);
    expect(item.properties.on.required).not.toContain('amp');
  });

  it('builds a standalone prompt: models and request, no current tone, master excluded', () => {
    const { base, palette } = fixtures();
    const { system, user } = buildPrompt('warm blues', palette);
    expect(user).toContain('Request: warm blues');
    expect(user).toContain('Plexi');
    expect(user).not.toContain('Current tone');
    expect(user).not.toContain(base.name);
    expect(system).toMatch(/complete tone built from scratch/);
    expect(system).toMatch(/ONLY the model ids listed/);
    expect(system).toMatch(/Do not set the master volume/);
    expect(system).toMatch(/similar loudness across them/);
  });

  it('describes every model with its real name, and lists unconfirmed ones as not to choose', () => {
    const { palette } = fixtures();
    const { user } = buildPrompt('', palette);
    expect(user).toContain('Plexi = Plexiglas — Marshall Super Lead 100 (Crunch)');
    expect(user).toMatch(/not yet confirmed on this amp, do NOT choose: .*Match DC — Matchless DC30 \(Clean\)/);
    expect(user).toContain('J.H. Super 100');
  });

  it('tells the AI which instrument, in the user message only', () => {
    const { palette } = fixtures();
    const bass = buildPrompt('punchy', palette, 3, 'bass');
    expect(bass.user.split('\n')[0]).toMatch(/^Instrument: bass guitar/);
    expect(bass.system).toBe(buildPrompt('punchy', palette, 3, 'acoustic').system);
    expect(buildPrompt('x', palette).user).toMatch(/^Instrument: electric guitar\./);
  });

  it('parses JSON, tolerating a code fence, and rejects anything else', () => {
    expect(parseAnswer('```json\n{"suggestions":[1]}\n```').suggestions).toEqual([1]);
    expect(() => parseAnswer('Sure! Here are some tones')).toThrow(/valid JSON/);
    expect(() => parseAnswer('{"tones":[]}')).toThrow(/suggestions/);
  });
});

describe('checkSuggestion', () => {
  it('builds the tone from the answer: models from the palette, knobs 0–10 → 0–1, on/off', () => {
    const { base, palette } = fixtures();
    const r = checkSuggestion(answer(base, { models: { ...answer(base).models, amp: 'Plexi' } }), base, palette);
    expect(r.errors).toEqual([]);
    const amp = r.preset!.effects[3];
    expect(amp.name).toBe('Plexi');
    expect(amp.params.find((p) => p.index === 0)?.value).toBe(0.35);
    expect(amp.params.find((p) => p.index === 2)?.value).toBe(0.7);
    expect(r.preset!.effects.map((e) => e.enabled)).toEqual([true, false, true, true, false, false, true]);
    expect(r.preset!.name).toBe('Warm blues');
    expect(r.summary[0]).toMatch(/^amp Plexi \(gain 3\.5, treble 5\.0, middle 7\.0, bass 5\.0\)$/);
  });

  it('takes nothing from the tone playing now except master, bpm and container fields', () => {
    const { base, palette } = fixtures();
    const playing = copy(base);
    playing.effects.forEach((e) => (e.enabled = !e.enabled)); // on/off must come from the answer
    playing.effects[3].params.find((p) => p.index === 0)!.value = 0.99; // gain must come from the answer
    playing.bpm = 97;
    const r = checkSuggestion(answer(base), playing, palette);
    expect(r.preset!.effects.map((e) => e.enabled)).toEqual([true, false, true, true, false, false, true]);
    expect(r.preset!.effects[3].params.find((p) => p.index === 0)?.value).toBe(0.35);
    expect(r.preset!.bpm).toBe(97);
    expect(r.preset!.uuid).toBe(playing.uuid);
  });

  it('keeps the current master volume, whatever the chosen amp had stored', () => {
    const { base, palette } = fixtures();
    const playing = copy(base);
    playing.effects[3].params.find((p) => p.index === 4)!.value = 0.33;
    const r = checkSuggestion(answer(base, { models: { ...answer(base).models, amp: 'Plexi' }, amp: { gain: 5, treble: 5, middle: 5, bass: 5, master: 10 } }), playing, palette);
    expect(r.preset!.effects[3].params.find((p) => p.index === 4)?.value).toBe(0.33);
  });

  it('always has the amp on, even if the tone playing now has it off', () => {
    const { base, palette } = fixtures();
    const off = copy(base);
    off.effects[3].enabled = false;
    const pal = buildPalette([off]);
    expect(checkSuggestion(answer(off), off, pal).preset!.effects[3].enabled).toBe(true);
  });

  it('rejects a model not read from this amp (the freeze risk), or a missing one', () => {
    const { base, palette } = fixtures();
    const r = checkSuggestion(answer(base, { models: { ...answer(base).models, drive: 'TrebleBooster' } }), base, palette);
    expect(r.preset).toBeNull();
    expect(r.errors[0]).toMatch(/drive: model "TrebleBooster" is not one read from this amp/);
    const { reverb, ...noReverb } = answer(base).models as Record<string, string>;
    expect(checkSuggestion(answer(base, { models: noReverb }), base, palette).errors).toContain('reverb: no model chosen');
  });

  it('clamps knob values and rejects missing or wrong-typed fields', () => {
    const { base, palette } = fixtures();
    const clamped = checkSuggestion(answer(base, { amp: { gain: 42, treble: -3, middle: 5, bass: 5 } }), base, palette);
    expect(clamped.preset!.effects[3].params.find((p) => p.index === 0)?.value).toBe(1);
    expect(clamped.preset!.effects[3].params.find((p) => p.index === 1)?.value).toBe(0);
    const bad = checkSuggestion(answer(base, { amp: { gain: 'loud' }, on: { reverb: 'yes' } }), base, palette);
    expect(bad.preset).toBeNull();
    expect(bad.errors).toEqual(
      expect.arrayContaining(['amp gain: not a number', 'amp treble: missing', 'reverb: on/off is not true or false', 'drive: on/off missing']),
    );
  });

  it('keeps names to plain ASCII within 24 characters', () => {
    const { base, palette } = fixtures();
    const r = checkSuggestion(answer(base, { name: 'Crème brûlée 🔥 super long tone name here' }), base, palette);
    expect(r.name).toBe(toAscii('Creme brulee  super long tone name here', 24));
    expect(r.name.length).toBeLessThanOrEqual(24);
    expect(r.preset!.name).toBe(r.name);
  });

  it('does not modify the tone playing now or the palette', () => {
    const { base, palette } = fixtures();
    const before = copy(base);
    const palBefore = copy(palette);
    checkSuggestion(answer(base), base, palette);
    expect(base).toEqual(before);
    expect(palette).toEqual(palBefore);
  });
});

describe('mergePalettes', () => {
  it('unions models per position; later palettes win', () => {
    const { base, palette } = fixtures();
    const stored = copy(palette);
    stored[2] = [{ ...base.effects[2], name: 'SABdriver' }];
    const fresh = buildPalette([base]);
    fresh[0][0].params[0].value = 0.123;
    const merged = mergePalettes(stored, fresh);
    expect(merged[2].map((e) => e.name)).toEqual(['SABdriver', base.effects[2].name]);
    expect(merged[0][0].params[0].value).toBe(0.123);
  });
});

describe('catalogue names', () => {
  it('shows both names where a source gives the real gear, and only the Spark name otherwise', () => {
    expect(describeModel('94MatchDCV2')).toBe('Match DC — Matchless DC30 (Clean)');
    expect(describeModel('JH.Octavia')).toBe('J.H. Octave Fuzz — Roger Mayer Octavia');
    expect(describeModel('DistortionTS9')).toBe('Tube Drive — Ibanez Tube Screamer');
    expect(describeModel('GuitarMuff')).toBe('Guitar Muff');
    expect(describeModel('unknownId')).toBe('unknownId');
  });

  it('has a Spark name and knob list for every model on the Spark 2 list', () => {
    for (const id of SPARK2_MODELS.flat()) {
      expect(MODEL_INFO[id]?.name, id).toBeTruthy();
      expect(MODEL_INFO[id]?.knobs.length, id).toBeGreaterThan(0);
    }
  });
});

describe('alignToAmp', () => {
  it('drops params the amp did not report for that model ("Crunchy Chorus": JH.Vox846 #5)', () => {
    const base = preset0();
    const amp = copy(base);
    amp.effects[1] = { name: 'JH.Vox846', enabled: true, params: [0, 1, 2, 3, 4].map((index) => ({ index, value: 0.5 })) };
    const tone = copy(amp);
    tone.effects[1].params.push({ index: 5, value: 0 });
    const r = alignToAmp(tone, buildPalette([amp]));
    expect(r.preset.effects[1].params.map((p) => p.index)).toEqual([0, 1, 2, 3, 4]);
    expect(r.dropped).toEqual(['block 2 (JH.Vox846) param 5']);
    expect(tone.effects[1].params).toHaveLength(6); // input untouched
  });

  it('leaves out-of-palette models, and params the tone leaves out, as they are', () => {
    const base = preset0();
    const tone = copy(base);
    tone.effects[4].params = tone.effects[4].params.slice(0, 1);
    const r = alignToAmp(tone, buildPalette([base]));
    expect(r.dropped).toEqual([]);
    expect(r.preset).toBe(tone);
    expect(alignToAmp(base, buildPalette([])).preset).toBe(base);
  });
});
