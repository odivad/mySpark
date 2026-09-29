/**
 * Tone assistant: the standard prompt, the expected result format, and the checks that turn an
 * AI answer into a preset that is safe to send. DOM-free. Spec: docs/ai-tone-assistant.md.
 *
 * Each suggestion is a **standalone tone built from the request** — not a variation of the tone
 * playing now (owner, 2026-09-28). The AI chooses every position's model and on/off, and the amp's
 * Gain/Treble/Middle/Bass. From the amp's current state only playback settings are kept: master
 * volume (so suggestions play at the owner's listening level) and BPM (so delays keep time).
 *
 * Safety rules (the AI is never trusted):
 * - Models only from those read from this amp (its slots and live sound): asking an amp for a
 *   model it lacks can freeze it (SparklingTones). A model brings the params it had on the amp.
 * - Master volume is not the AI's to set. The amp block is always on.
 * - Everything is re-checked here; anything out of line is rejected with a reason.
 */
import { type Preset, type PresetEffect, validatePreset } from '../spark/protocol.js';
import { AMP_BLOCK, formatValue } from './model.js';
import { SPARK2_MODELS, describeModel } from '../spark/catalog.js';

/** JSON keys for the seven chain positions, in chain order. */
export const POSITION_KEYS = ['noiseGate', 'compWah', 'drive', 'amp', 'modulation', 'delay', 'reverb'] as const;
export type PositionKey = (typeof POSITION_KEYS)[number];

/** The amp knobs the AI sets, with their param index (VERIFIED-HW on the Spark LIVE). */
export const AI_AMP_KNOBS = { gain: 0, treble: 1, middle: 2, bass: 3 } as const;
export type AiAmpKnob = keyof typeof AI_AMP_KNOBS;

/** Master volume's param index on the amp block (SOURCED: SparklingTones/soundshed). Kept from the amp. */
export const AMP_MASTER_PARAM = 4;

/** Positions whose on/off the AI sets. The amp is always on. */
export const SWITCHABLE: readonly PositionKey[] = POSITION_KEYS.filter((k) => k !== 'amp');

export const NAME_MAX = 24;
export const DESCRIPTION_MAX = 140;
export const DEFAULT_SUGGESTIONS = 4;

export type Instrument = 'electric' | 'bass' | 'acoustic';

/** One line per instrument, added to the user message (the system prompt stays fixed). */
export const INSTRUMENT_BRIEF: Record<Instrument, string> = {
  electric: 'Instrument: electric guitar.',
  bass:
    'Instrument: bass guitar. Build bass tones: prefer the Bass amp family and bass effects (Bass Comp, Bass Muff, Bassmaster, Bass EQ) where they are available, and keep the low end solid.',
  acoustic:
    'Instrument: acoustic guitar with a pickup. Build acoustic tones: prefer the Acoustic amp family, light compression, EQ, chorus and reverb, and avoid heavy drive.',
};

/** Per chain position, the distinct models (with their params) seen on this amp. */
export type ModelPalette = PresetEffect[][];

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function buildPalette(presets: ReadonlyArray<Preset | null | undefined>): ModelPalette {
  const palette: ModelPalette = POSITION_KEYS.map(() => []);
  for (const preset of presets) {
    if (!preset || preset.effects.length !== POSITION_KEYS.length) continue;
    preset.effects.forEach((effect, i) => {
      if (!palette[i].some((e) => e.name === effect.name)) palette[i].push(clone(effect));
    });
  }
  return palette;
}

/** Merges palettes position by position; later ones win for a model seen in both. */
export function mergePalettes(...palettes: ReadonlyArray<readonly (readonly PresetEffect[])[]>): ModelPalette {
  const out: ModelPalette = POSITION_KEYS.map(() => []);
  for (const p of palettes) {
    p.forEach((list, i) => {
      if (!out[i]) return;
      for (const e of list) {
        const at = out[i].findIndex((x) => x.name === e.name);
        if (at >= 0) out[i][at] = clone(e);
        else out[i].push(clone(e));
      }
    });
  }
  return out;
}

export function paletteModels(palette: ModelPalette): Set<string> {
  return new Set(palette.flat().map((e) => e.name));
}

/** Keeps a string to printable ASCII: the preset encoder writes one byte per character. */
export function toAscii(s: string, max: number): string {
  return s
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/* ------------------------------------------------------------------ format */

/** JSON Schema of the expected answer, also given to the browser model as a response constraint. */
export function suggestionSchema(palette: ModelPalette, count = DEFAULT_SUGGESTIONS): object {
  const knob = { type: 'number', minimum: 0, maximum: 10 };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['suggestions'],
    properties: {
      suggestions: {
        type: 'array',
        minItems: 1,
        maxItems: count,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'description', 'amp', 'on', 'models'],
          properties: {
            name: { type: 'string', maxLength: NAME_MAX },
            description: { type: 'string', maxLength: DESCRIPTION_MAX },
            amp: {
              type: 'object',
              additionalProperties: false,
              required: Object.keys(AI_AMP_KNOBS),
              properties: Object.fromEntries(Object.keys(AI_AMP_KNOBS).map((k) => [k, knob])),
            },
            on: {
              type: 'object',
              additionalProperties: false,
              required: [...SWITCHABLE],
              properties: Object.fromEntries(SWITCHABLE.map((k) => [k, { type: 'boolean' }])),
            },
            models: {
              type: 'object',
              additionalProperties: false,
              required: [...POSITION_KEYS],
              properties: Object.fromEntries(
                POSITION_KEYS.map((k, i) => [k, { type: 'string', enum: palette[i].map((e) => e.name) }]),
              ),
            },
          },
        },
      },
    },
  };
}

export interface TonePrompt {
  system: string;
  user: string;
}

/** The standard prompt. Kept in sync with docs/ai-tone-assistant.md. */
export function buildPrompt(
  request: string,
  palette: ModelPalette,
  count = DEFAULT_SUGGESTIONS,
  instrument: Instrument = 'electric',
): TonePrompt {
  const models = POSITION_KEYS.map((k, i) => {
    const usable = palette[i].map((e) => e.name);
    const others = (SPARK2_MODELS[i] ?? []).filter((id) => !usable.includes(id));
    let line = `- ${k}: ${usable.map((id) => `${id} = ${describeModel(id)}`).join('; ') || '(none)'}`;
    if (others.length) {
      line += `\n  (also in the Spark range but not yet confirmed on this amp, do NOT choose: ${others.map(describeModel).join('; ')})`;
    }
    return line;
  }).join('\n');
  const system = [
    'You are a guitar tone assistant for a Positive Grid Spark LIVE amplifier.',
    'A tone is a fixed chain of seven positions, in this order: noiseGate, compWah, drive, amp, modulation, delay, reverb.',
    'Each suggestion is a complete tone built from scratch for the request. For each one you choose:',
    '- the model for every position, using ONLY the model ids listed for that position. Never invent a model id;',
    '- which of noiseGate, compWah, drive, modulation, delay and reverb are on (the amp is always on);',
    '- the amp knobs gain, treble, middle and bass, each from 0 to 10 like the knobs on the amp panel.',
    'Use what you know about the Spark LIVE and the amps and effects it models to choose; the ids are the amp\'s internal names for them.',
    'Do not set the master volume; it is not part of the answer.',
    'All suggestions play at the same master volume, so aim for similar loudness across them: balance gain against drive and amp choice (for example use less amp gain with a drive on or a hot amp model, more with a clean one).',
    'Give each suggestion a short name (at most 24 characters, plain ASCII) and a one-sentence description of how it should sound and why.',
    'Make the suggestions meaningfully different takes on the request.',
    'Answer with JSON only, matching the given schema. No other text.',
  ].join('\n');
  const user = [
    INSTRUMENT_BRIEF[instrument],
    '',
    'Models you may choose, per position, as "id = name (inspired by, family)":',
    models,
    '',
    `Request: ${request.trim() || 'Suggest a few useful, different guitar tones.'}`,
    '',
    `Give ${count} suggestions.`,
  ].join('\n');
  return { system, user };
}

/* ------------------------------------------------------------------ checking */

export interface CheckedSuggestion {
  name: string;
  description: string;
  /** Null when the suggestion was rejected; see `errors`. */
  preset: Preset | null;
  errors: string[];
  /** Short human-readable description of the tone: amp, knobs, which blocks are on. */
  summary: string[];
}

/** Parses the model's text. Tolerates a ```json fence around it; nothing else. */
export function parseAnswer(text: string): { suggestions: unknown[] } {
  const body = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error('The AI did not answer with valid JSON');
  }
  const list = (data as { suggestions?: unknown })?.suggestions;
  if (!Array.isArray(list)) throw new Error('The AI answer has no "suggestions" list');
  return { suggestions: list };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Builds a standalone preset from one raw suggestion, or rejects it. Never trusts the input: every
 * field is type-checked, knob values clamped to 0–10, models checked against the palette, and the
 * result passed through validatePreset with the palette as the known-model list.
 *
 * @param playback the preset playing now — used ONLY for master volume, BPM and the preset
 *                 container fields (uuid, version, description, icon), never for the tone
 */
export function checkSuggestion(raw: unknown, playback: Preset, palette: ModelPalette): CheckedSuggestion {
  const errors: string[] = [];
  const s = isObject(raw) ? raw : {};
  const name = toAscii(typeof s.name === 'string' ? s.name : '', NAME_MAX) || 'AI tone';
  const description = toAscii(typeof s.description === 'string' ? s.description : '', DESCRIPTION_MAX);
  const reject = (): CheckedSuggestion => ({ name, description, preset: null, errors, summary: [] });

  if (!isObject(raw)) {
    errors.push('not an object');
    return reject();
  }

  // Every position's model, from the palette.
  const models = isObject(s.models) ? s.models : {};
  const effects: PresetEffect[] = [];
  POSITION_KEYS.forEach((key, i) => {
    const wanted = models[key];
    const found = typeof wanted === 'string' ? palette[i].find((e) => e.name === wanted) : undefined;
    if (!found) {
      errors.push(
        wanted === undefined ? `${key}: no model chosen` : `${key}: model ${JSON.stringify(wanted)} is not one read from this amp`,
      );
      return;
    }
    effects[i] = clone(found);
  });
  if (errors.length) return reject();

  // On/off for every position; the amp is always on.
  const on = isObject(s.on) ? s.on : {};
  for (const key of SWITCHABLE) {
    const v = on[key];
    if (typeof v !== 'boolean') {
      errors.push(`${key}: on/off ${v === undefined ? 'missing' : 'is not true or false'}`);
      continue;
    }
    effects[POSITION_KEYS.indexOf(key)].enabled = v;
  }
  effects[AMP_BLOCK].enabled = true;

  // Amp knobs, 0–10 → 0–1 in 0.1 steps.
  const amp = isObject(s.amp) ? s.amp : {};
  const ampParams = effects[AMP_BLOCK].params;
  for (const [knob, index] of Object.entries(AI_AMP_KNOBS)) {
    const v = amp[knob];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      errors.push(`amp ${knob}: ${v === undefined ? 'missing' : 'not a number'}`);
      continue;
    }
    const param = ampParams.find((p) => p.index === index);
    if (!param) {
      errors.push(`amp ${knob}: the amp model has no param ${index}`);
      continue;
    }
    param.value = Math.round(Math.min(10, Math.max(0, v)) * 10) / 100;
  }

  // Master volume stays at the owner's current level, whatever the chosen amp model had stored.
  const currentMaster = playback.effects[AMP_BLOCK]?.params.find((p) => p.index === AMP_MASTER_PARAM)?.value;
  const master = ampParams.find((p) => p.index === AMP_MASTER_PARAM);
  if (master && currentMaster !== undefined) master.value = currentMaster;

  if (errors.length) return reject();

  const preset: Preset = {
    ...clone(playback),
    name,
    effects,
    tail: [],
    checksum: null,
  };
  const validation = validatePreset(preset, paletteModels(palette));
  errors.push(...validation.errors);
  if (errors.length) return reject();

  const knobs = Object.entries(AI_AMP_KNOBS)
    .map(([k, i]) => `${k} ${formatValue(ampParams.find((p) => p.index === i)?.value ?? 0)}`)
    .join(', ');
  const active = SWITCHABLE.filter((k) => effects[POSITION_KEYS.indexOf(k)].enabled);
  const summary = [
    `amp ${effects[AMP_BLOCK].name} (${knobs})`,
    active.length ? `on: ${active.map((k) => `${k} ${effects[POSITION_KEYS.indexOf(k)].name}`).join(', ')}` : 'no effects on',
  ];
  return { name, description, preset, errors, summary };
}
