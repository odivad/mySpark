/**
 * Effect and amp catalogue: what the amp's internal model ids are, per chain position.
 *
 * Ported from SparklingTones `src/spark-effetti.js` (MIT, Copyright (c) 2026 Massimo Togni), commit
 * f25379d, whose names and knob lists come from Soundshed `sparkFxCatalog.ts` (MIT, Copyright (c)
 * Soundshed contributors). See THIRD_PARTY_NOTICES.md.
 *
 * Verification status:
 * - SPARK2_MODELS: SOURCED — SparklingTones checked every position against the official app's list
 *   on a real Spark 2 (2026-08-26) and removed models Soundshed had but the Spark 2 lacks.
 *   On the Spark LIVE: every model the owner tried from this list worked (2026-09-28), and the owner
 *   then chose to allow the whole list in the model picker without a warning. Asking an amp for a
 *   model it lacks can freeze it until power-off (SparklingTones, Spark 2); the AI still only
 *   sends models confirmed on the connected amp.
 * - Knob names are in **param index order**, which is not the on-screen order (amps: Gain, Treble,
 *   Middle, Bass, Master). SOURCED; amp knobs 0–3 VERIFIED-HW on the Spark LIVE (capture 3).
 * - `real`: the gear a model is inspired by. Amps and the Jimi Hendrix pack: Positive Grid's official
 *   "Amp & Effect List" (help.positivegrid.com article 8140276955917, updated 2026-09-27, read via
 *   its public Zendesk API) — SOURCED (official). Other effects: that page gives names only; the six
 *   marked `realSource: 'secondary'` come from Positive Grid's "Spark Effect List Rev20220827" PDF
 *   as quoted by web search results (the PDF itself couldn't be opened) — SOURCED (secondary).
 *   Every other effect has no `real`: no source seen, none invented.
 */

export interface ModelInfo {
  /** Name shown in Positive Grid's app. */
  name: string;
  /** Real amp or pedal it is modelled on, when known. */
  real?: string;
  /** Positive Grid's amp family (Clean, Glassy, Crunch, High Gain, Metal, Acoustic, Bass, …). */
  group?: string;
  /** 'secondary' when `real` comes from a quoted source rather than Positive Grid's page itself. */
  realSource?: 'secondary';
  /** Knob names by param index. */
  knobs: string[];
  /** Params that pick between positions instead of sliding: index → position names. */
  choices?: Record<number, string[]>;
  /** Stored value of each position in `choices`, when not 0, 0.1, 0.2 … (e.g. an on/off switch: [0, 1]). */
  choiceValues?: Record<number, number[]>;
  /** Adjusted with sliders in the official app (graphic EQs). */
  sliders?: boolean;
  /**
   * Params the official app stores as true/false in its default presets (Spark app 4.6.2 APK,
   * assets/ModulePresets/…/data.json): on/off switches, sent to and read from the amp as 0 / 1.
   * Which label goes with which value is not known yet, so they aren't editable.
   */
  switches?: number[];
}

// Index order; the official app labels the fifth knob VOLUME (owner screenshot, Spark LIVE, 2026-09-28).
const AMP_KNOBS = ['Gain', 'Treble', 'Middle', 'Bass', 'Volume'];
const amp = (name: string, real: string, group: string): ModelInfo => ({ name, real, group, knobs: AMP_KNOBS });

/**
 * The delays' BPM switch (tempo sync): an on/off toggle in the official app (owner screenshots,
 * Vintage Delay "BPM ON/OFF", Digital Delay "BPM"). Stored as 0 or 1 in every ToneCloud preset
 * sampled (2026-09-28). 1 = on is the natural reading; not yet confirmed by ear.
 */
const bpmSwitch = (index: number): Pick<ModelInfo, 'choices' | 'choiceValues'> => ({
  choices: { [index]: ['BPM sync off', 'BPM sync on'] },
  choiceValues: { [index]: [0, 1] },
});

/** Jimi Hendrix Pack: paid content on the Spark 2; silent until the official app unlocks it. */
export const HENDRIX_PREFIX = 'JH.';
export const isHendrix = (id: string): boolean => id.startsWith(HENDRIX_PREFIX);

export const MODEL_INFO: Record<string, ModelInfo> = {
  /* Noise gate. A third param, when present, is the block's on/off (SparklingTones, Spark 2). */
  'bias.noisegate': { name: 'Noise Gate', knobs: ['Threshold', 'Decay'] },

  /* Comp / wah */
  LA2AComp: { name: 'LA Comp', knobs: ['Limit/Compress', 'Gain', 'Peak Reduction'] },
  BlueComp: { name: 'Sustain Comp', real: 'Boss CS-3', realSource: 'secondary', knobs: ['Level', 'Tone', 'Attack', 'Sustain'] },
  Compressor: { name: 'Red Comp', real: 'MXR Dyna Comp', realSource: 'secondary', knobs: ['Output', 'Sensitivity'] },
  BassComp: { name: 'Bass Comp', knobs: ['Comp', 'Gain'] },
  BBEOpticalComp: { name: 'Optical Comp', knobs: ['Volume', 'Comp', 'Pad'] },
  /* Auto Wah (added by Positive Grid 2026-09-02, free) and the Hendrix pack's J.H. Legendary Wah are
     two entries in the official app but ONE model id: presets with either come back as `JH.Vox846`
     (SOURCED: SparklingTones, two dedicated captures on a Spark 2). The difference is in the params,
     not yet decoded — UNVERIFIED on the LIVE. */
  'JH.Vox846': { name: 'J.H. Legendary Wah / Auto Wah', real: 'Vox 846 wah-wah pedal', knobs: ['P1', 'Mode', 'P3', 'P4', 'P5'] },

  /* Drive */
  Booster: { name: 'Booster', knobs: ['Gain'] },
  KlonCentaurSilver: { name: 'Clone Drive', real: 'Klon Centaur', realSource: 'secondary', knobs: ['Output', 'Treble', 'Gain'] },
  DistortionTS9: { name: 'Tube Drive', real: 'Ibanez Tube Screamer', realSource: 'secondary', knobs: ['Overdrive', 'Tone', 'Level'] },
  Overdrive: { name: 'Over Drive', knobs: ['Level', 'Tone', 'Drive'] },
  'JH.AxisFuzz': { name: 'J.H. Axle Fuzz', real: 'Roger Mayer Axis Fuzz', knobs: ['Volume', 'Drive'] },
  'JH.SupaFuzz': { name: 'J.H. Super Fuzz', real: 'Marshall Supa Fuzz', knobs: ['Volume', 'Filter'] },
  'JH.Octavia': { name: 'J.H. Octave Fuzz', real: 'Roger Mayer Octavia', knobs: ['Level', 'Fuzz'] },
  'JH.FuzzTone': { name: 'J.H. Fuzz Zone', real: 'Maestro FZ-1 Fuzz-Tone', knobs: ['Volume', 'Attack'] },
  Fuzz: { name: 'Fuzz Face', knobs: ['Volume', 'Fuzz'] },
  ProCoRat: { name: 'Black Op', real: 'Pro Co RAT', realSource: 'secondary', knobs: ['Distortion', 'Filter', 'Volume'] },
  BassBigMuff: { name: 'Bass Muff', knobs: ['Volume', 'Tone', 'Sustain'] },
  GuitarMuff: { name: 'Guitar Muff', knobs: ['Volume', 'Tone', 'Sustain'] },
  MaestroBassmaster: { name: 'Bassmaster', knobs: ['Brass Vol', 'Sensitivity', 'Bass Vol'] },
  SABdriver: { name: 'SAB Driver', knobs: ['Volume', 'Tone', 'Drive', 'HP/LP'], switches: [3] },

  /* Amps */
  RolandJC120: amp('Silver 120', 'Roland JC120', 'Clean'),
  Twin: amp('Black Duo', 'Fender Twin Reverb', 'Clean'),
  ADClean: amp('AD Clean', 'Orange AD 30', 'Clean'),
  '94MatchDCV2': amp('Match DC', 'Matchless DC30', 'Clean'),
  ODS50CN: amp('ODS 50', 'Dumble ODS 50 HRM', 'Clean'),
  Bassman: amp('Tweed Bass', 'Fender Bassman', 'Glassy'),
  'AC Boost': amp('AC Boost', 'Vox AC30', 'Glassy'),
  Checkmate: amp('Checkmate', 'Teisco Checkmate 20', 'Glassy'),
  TwoStoneSP50: amp('Two Stone SP50', 'Two Rock Studio Pro 50', 'Glassy'),
  Deluxe65: amp('American Deluxe', "Fender '57 Custom Deluxe", 'Crunch'),
  Plexi: amp('Plexiglas', 'Marshall Super Lead 100', 'Crunch'),
  OverDrivenJM45: amp('JM45', 'Marshall JTM45', 'Crunch'),
  OverDrivenLuxVerb: amp('Lux Verb', 'Fender Deluxe Reverb', 'Crunch'),
  BluesJrTweed: amp('Blues Boy', 'Fender Blues Junior', 'Crunch'),
  Bogner: amp('RB 101', 'Bogner Ecstasy 101', 'High Gain'),
  OrangeAD30: amp('British 30', 'Orange AD30', 'High Gain'),
  AmericanHighGain: amp('American High Gain', 'Mesa Boogie JP-2C', 'High Gain'),
  SLO100: amp('SLO 100', 'Soldano SLO-100', 'High Gain'),
  YJM100: amp('YJM100', 'Marshall YJM100 Signature', 'High Gain'),
  Rectifier: amp('Treadplate', 'Mesa Boogie Triple Rectifier', 'Metal'),
  EVH: amp('Insane', 'EVH 5150 III', 'Metal'),
  SwitchAxeLead: amp('SwitchAxe', 'H&K Switch Blade', 'Metal'),
  Invader: amp('Rocker V', 'Orange Rockerverb 50', 'Metal'),
  BE101: amp('BE 101', 'Friedman BE100', 'Metal'),
  '6505Plus': amp('Insane 6508', 'Peavey 6505', 'Metal'),
  Acoustic: amp('Pure Acoustic', 'PG Original', 'Acoustic'),
  AcousticAmpV2: amp('Fishboy', 'Fishman Acoustic Amp', 'Acoustic'),
  FatAcousticV2: amp('Jumbo', 'PG Original', 'Acoustic'),
  FlatAcoustic: amp('Flat Acoustic', 'PG Original', 'Acoustic'),
  GK800: amp('RB-800', 'Gallien-Krueger 800RB', 'Bass'),
  Sunny3000: amp('Sunny 3000', 'Sunn 300T', 'Bass'),
  W600: amp('W600', 'Eden WTP600', 'Bass'),
  Hammer500: amp('Hammer 500', 'Aguilar Tone Hammer 500', 'Bass'),
  'JH.JTM45': amp('J.H. 45/100', 'Marshall JTM45/100', 'Jimi Hendrix Pack'),
  'JH.SuperLead100': amp('J.H. Super 100', 'Marshall Super Lead 100', 'Jimi Hendrix Pack'),
  'JH.DualShowman': amp('J.H. D-Show Master', 'Fender Dual Showman', 'Jimi Hendrix Pack'),
  'JH.Sunn100': amp('J.H. Sun 100S', 'Sunn 100S', 'Jimi Hendrix Pack'),
  'JH.Bassman50Silver': amp('J.H. Bass Master', 'Fender 1968 Bassman 50', 'Jimi Hendrix Pack'),
  'JH.SoundCity100': amp('J.H. Tone City 100', 'Sound City One Hundred', 'Jimi Hendrix Pack'),

  /* Modulation / EQ */
  Tremolo: { name: 'Tremolo', knobs: ['Speed', 'Depth', 'Level'] },
  ChorusAnalog: { name: 'Chorus', knobs: ['E.Level', 'Rate', 'Depth', 'Tone'] },
  Flanger: { name: 'Flanger', knobs: ['Rate', 'Mix', 'Depth'] },
  Phaser: { name: 'Phaser', knobs: ['Speed', 'Intensity'] },
  Vibrato01: { name: 'Vibrato', knobs: ['Speed', 'Depth'] },
  UniVibe: { name: 'UniVibe', knobs: ['Speed', 'Chorus / Vibrato', 'Intensity'], switches: [1] },
  'JH.VoodooVibeJr': { name: 'J.H. Legendary Vibe', real: 'Roger Mayer Voodoo Vibe Junior', knobs: ['Speed', 'Sweep', 'Intensity', 'Chorus/Vibrato'] },
  Cloner: { name: 'Cloner Chorus', knobs: ['Rate', 'Depth'], switches: [1] },
  MiniVibe: { name: 'Classic Vibe', knobs: ['Speed', 'Intensity'] },
  Tremolator: { name: 'Tremolator', real: 'Demeter Tremulator', realSource: 'secondary', knobs: ['Depth', 'Speed', 'BPM'] },
  TremoloSquare: { name: 'Tremolo Square', knobs: ['Speed', 'Depth', 'Level'] },
  GuitarEQ6: { name: 'Guitar EQ', sliders: true, knobs: ['Level', '100', '200', '400', '800', '1.6K', '3.2K'] },
  BassEQ6: { name: 'Bass EQ', sliders: true, knobs: ['Level', '50', '120', '400', '800', '4.5K', '10K'] },

  /* Delay */
  DelayMono: { name: 'Digital Delay', knobs: ['E.Level', 'F.Back', 'D.Time', 'Mode', 'BPM'], ...bpmSwitch(4) },
  DelayEchoFilt: { name: 'Echo Filt', knobs: ['Delay', 'Feedback', 'Level', 'Tone', 'BPM'], ...bpmSwitch(4) },
  VintageDelay: { name: 'Vintage Delay', knobs: ['Repeat Rate', 'Intensity', 'Echo', 'BPM'], ...bpmSwitch(3) },
  DelayReverse: { name: 'Reverse Delay', knobs: ['Mix', 'Decay', 'Filter', 'Time', 'BPM'], ...bpmSwitch(4) },
  DelayMultiHead: { name: 'Multi Head', knobs: ['Repeat Rate', 'Intensity', 'Echo Vol', 'Mode Selector', 'BPM'], ...bpmSwitch(4) },
  DelayRe201: { name: 'Echo Tape', knobs: ['Sustain', 'Volume', 'Tone', 'Short -> Long', 'BPM'], ...bpmSwitch(4) },

  /* Reverb: one model; param 6 is the reverb type. Names in the official app's order (01–09, owner
     screenshots), each with the value the official app itself stores for it: its default preset per
     type in the Spark app 4.6.2 APK (assets/ModulePresets/Reverb/<type>/data.json). The value order
     is NOT the display order — SparklingTones' assumption (0, 0.1 … in display order) was wrong. */
  'bias.reverb': {
    name: 'Reverb',
    knobs: ['Level', 'Damping', 'Low Cut', 'High Cut', 'Dwell', 'Time', 'Type'],
    choices: {
      6: ['Room Studio A', 'Chamber', 'Hall Natural', 'Plate Short', 'Hall Ambient', 'Plate Rich', 'Hall Medium', 'Plate Long', 'Room Studio B'],
    },
    choiceValues: { 6: [0, 0.2, 0.3, 0.6, 0.5, 0.7, 0.4, 0.8, 0.1] },
  },
};

/**
 * CH2 (mic / acoustic / bass) models seen on the owner's Spark LIVE (official app log, 2026-09-28).
 * Spark names from Positive Grid's list, matched to ids by the obvious correspondence; the id →
 * name match for ParaAcousticPreAmp ("Acoustic Preamp") and SansAmpBassDriver ("Bass DI") is
 * UNVERIFIED. Knob names unknown: shown as numbers.
 */
export const CH2_MODEL_INFO: Record<string, ModelInfo> = {
  MicComp: { name: 'Mic Comp', knobs: [] },
  Comp76: { name: 'Comp 76', knobs: [] },
  VocalDrive: { name: 'Vocal Drive', knobs: [] },
  Preamp73: { name: 'MIC Preamp 73', group: 'Vocal preamp', knobs: [] },
  ParaAcousticPreAmp: { name: 'Acoustic Preamp', group: 'Acoustic preamp', knobs: [] },
  SansAmpBassDriver: { name: 'Bass DI', group: 'Bass preamp', knobs: [] },
  VocalChorus: { name: 'Vocal Chorus', knobs: [] },
  VocalMellowReverb: { name: 'Vocal Mellow Reverb', knobs: [] },
  VocalBrilliantReverb: { name: 'Vocal Brilliant Reverb', knobs: [] },
};
Object.assign(MODEL_INFO, CH2_MODEL_INFO);

/**
 * Models per chain position on the Spark 2 (SOURCED: SparklingTones, checked against the official
 * app). Positions 0 and 6 have one model each. UNVERIFIED on the Spark LIVE — see file header.
 */
export const SPARK2_MODELS: readonly (readonly string[])[] = [
  ['bias.noisegate'],
  ['LA2AComp', 'BlueComp', 'Compressor', 'BassComp', 'BBEOpticalComp', 'JH.Vox846'],
  [
    'Booster', 'KlonCentaurSilver', 'DistortionTS9', 'Overdrive', 'JH.AxisFuzz', 'JH.SupaFuzz', 'JH.Octavia',
    'JH.FuzzTone', 'Fuzz', 'ProCoRat', 'BassBigMuff', 'GuitarMuff', 'MaestroBassmaster', 'SABdriver',
  ],
  [
    'RolandJC120', 'Twin', 'ADClean', '94MatchDCV2', 'Bassman', 'AC Boost', 'Checkmate', 'TwoStoneSP50', 'Deluxe65',
    'Plexi', 'OverDrivenJM45', 'OverDrivenLuxVerb', 'Bogner', 'OrangeAD30', 'AmericanHighGain', 'SLO100', 'YJM100',
    'Rectifier', 'EVH', 'SwitchAxeLead', 'Invader', 'BE101', 'Acoustic', 'AcousticAmpV2', 'FatAcousticV2',
    'FlatAcoustic', 'GK800', 'Sunny3000', 'W600', 'Hammer500', '6505Plus', 'ODS50CN', 'BluesJrTweed', 'JH.JTM45',
    'JH.SuperLead100', 'JH.DualShowman', 'JH.Sunn100', 'JH.Bassman50Silver', 'JH.SoundCity100',
  ],
  [
    'Tremolo', 'ChorusAnalog', 'Flanger', 'Phaser', 'Vibrato01', 'UniVibe', 'JH.VoodooVibeJr', 'Cloner', 'MiniVibe',
    'Tremolator', 'TremoloSquare', 'GuitarEQ6', 'BassEQ6',
  ],
  ['DelayMono', 'DelayEchoFilt', 'VintageDelay', 'DelayReverse', 'DelayMultiHead', 'DelayRe201'],
  ['bias.reverb'],
];

/** Display name for a model id; the id itself when unknown. */
export function modelName(id: string): string {
  return MODEL_INFO[id]?.name ?? id;
}

/** Knob name for a model's param index, or null when unknown. */
export function knobName(id: string, index: number): string | null {
  return MODEL_INFO[id]?.knobs[index] ?? null;
}

/**
 * Both names for people and prompts: "Match DC — Matchless DC30 (Clean)". Just the Spark name when
 * no source says what a model is based on.
 */
export function describeModel(id: string): string {
  const info = MODEL_INFO[id];
  if (!info) return id;
  const based = info.real ? ` — ${info.real}` : '';
  const family = info.group ? ` (${info.group})` : '';
  return `${info.name}${based}${family}`;
}
