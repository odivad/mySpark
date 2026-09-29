/**
 * mySpark app: connect, preset list, verified preset switch, live chain view with tone editing,
 * backup. Plain DOM (ADR-0005). The amp is the source of truth: what's shown is a projection of
 * what the amp reported, and every change is confirmed by reading the amp back.
 */
import { BANK, CHAIN_CH2, CMD_NOTIFY, NOTE_NAMES, Reader, SOFTWARE_PRESET, VOLUME, type VolumeName, parseTunerReading, tunerCents, type Preset, type SparkMessage, slotLabel, validatePreset } from '../spark/protocol.js';
import { SparkTransport, type SlotRead } from '../spark/transport.js';
import {
  AMP_BLOCK,
  LIVE_SLOT_COUNT,
  backupFileName,
  blockName,
  buildBackup,
  formatValue,
  isEditableParam,
  paramName,
} from './model.js';
import { aiAvailability, generate, warmUp } from './browser-ai.js';
import { startDevReload } from './dev-reload.js';
import { type CloudOrder, type CloudSummary, fetchPreset, searchPresets, sortResults } from './tonecloud.js';
import { type CheckedSuggestion, type Instrument, type ModelPalette, buildPalette, buildPrompt, checkSuggestion, mergePalettes, paletteModels, parseAnswer, suggestionSchema } from './tone-ai.js';
import { MODEL_INFO, SPARK2_MODELS, describeModel, knobName, modelName } from '../spark/catalog.js';
import { type SavedTone, addKnownBlocks, deleteTone, getKnownBlocks, getSeenModels, listTones, saveTone } from './tone-db.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

/** Fills a range slider's track up to its value (CSS reads --val). */
function paintRange(input: HTMLInputElement): void {
  const min = Number(input.min || 0);
  const max = Number(input.max || 1);
  input.style.setProperty('--val', `${((Number(input.value) - min) / (max - min || 1)) * 100}%`);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

/** Settle time after the last slider move before reading the amp back. */
const VERIFY_DELAY_MS = 250;

/* ---------------------------------------------------------------- state */

let slots: SlotRead[] = [];
let live: Preset | null = null;
/** Actions that must not overlap with user input (connect read, switch, on/off). */
let blocking = 0;
let refreshQueued = false;
/** Name of what's in the temporary buffer, when the amp is playing it. */
let bufferName: string | null = null;
/** Which card is playing in the temporary buffer: "ai:<n>", "cloud:<id>" or "tone:<id>". */
let playingKey: string | null = null;
let suggestions: CheckedSuggestion[] = [];
let lastRequest = '';
let tones: SavedTone[] = [];
let seenModels = new Set<string>();
/** Blocks confirmed on this amp in earlier sessions (tone-db). */
let knownBlocks: ModelPalette = [];
let aiReady = false;
let aiRunning = false;
/** Which channel the Presets and Playing now panels show. CH2 is read-only for now. */
let channel: 1 | 2 = 1;
let ch2Slots: SlotRead[] = [];
let ch2Live: Preset | null = null;
let cloudResults: CloudSummary[] = [];
let cloudBusy = false;
let cloudPage = 1;
let cloudQuery = '';
let cloudOrder: CloudOrder = 'likes';
let cloudMore = false;
const CLOUD_PAGE_SIZE = 24;

interface ParamView {
  block: number;
  index: number;
  input: HTMLInputElement | null;
  value: HTMLElement;
  fill: HTMLElement | null;
  status: HTMLElement;
  /** For params that pick between positions (e.g. reverb type): a dropdown instead of a slider. */
  choice?: HTMLSelectElement;
}
interface BlockView {
  root: HTMLElement;
  toggle: HTMLButtonElement;
  label: HTMLElement;
}
const paramViews = new Map<string, ParamView>();
let blockViews: BlockView[] = [];

/** One slider being edited: values are streamed, then verified once the user lets go. */
interface Edit {
  effect: string;
  index: number;
  latest: number;
  dirty: boolean;
  sending: boolean;
  dragging: boolean;
  verifyTimer: number | undefined;
}
const edits = new Map<string, Edit>();
const keyOf = (block: number, index: number): string => `${block}-${index}`;

function log(line: string): void {
  const out = $('log');
  out.append(el('div', {}, `${new Date().toISOString().slice(11, 23)}  ${line}`));
  out.scrollTop = out.scrollHeight;
}

/* Messages appear as toasts at the bottom right, so a confirmation is visible wherever you are.
   Progress ("Reading A2…") reuses one info toast instead of stacking up. */
const TOAST_MS = { info: 3500, ok: 4500, warn: 9000 } as const;
let progressToast: HTMLElement | null = null;

function toast(content: Array<Node | string>, kind: 'info' | 'ok' | 'warn', sticky = false): HTMLElement {
  const box = $('toasts');
  const close = el('button', { class: 'toast-close', 'aria-label': 'Dismiss' }, '×');
  const t = el('div', { class: 'toast', 'data-kind': kind, role: kind === 'warn' ? 'alert' : 'status' }, el('div', { class: 'toast-text' }, ...content), close);
  let timer: number | undefined;
  const remove = () => {
    window.clearTimeout(timer);
    t.remove();
    if (progressToast === t) progressToast = null;
  };
  const arm = () => {
    window.clearTimeout(timer);
    if (!sticky) timer = window.setTimeout(remove, TOAST_MS[kind]);
  };
  close.addEventListener('click', remove);
  (t as HTMLElement & { rearm?: () => void }).rearm = arm;
  arm();
  box.append(t);
  while (box.children.length > 4) box.firstElementChild?.remove();
  return t;
}

function setMessage(text: string, kind: 'info' | 'ok' | 'warn' = 'info'): void {
  if (kind === 'info' && progressToast?.isConnected) {
    progressToast.querySelector('.toast-text')!.textContent = text;
    (progressToast as HTMLElement & { rearm?: () => void }).rearm?.();
    return;
  }
  if (kind !== 'info' && progressToast?.isConnected) progressToast.remove();
  const t = toast([text], kind);
  progressToast = kind === 'info' ? t : null;
}

const transport = new SparkTransport({
  onStatus: (status, detail) => {
    document.body.dataset.connection = status;
    if (status === 'disconnected' && tunerOpen) {
      tunerOpen = false;
      $('tuner').hidden = true;
    }
    $('status').textContent = status === 'disconnected' ? 'Not connected' : detail;
    renderControls();
  },
  onLog: log,
  onMessage: handleAmpMessage,
});

/* ---------------------------------------------------------------- amp access
   Every read-and-compare goes through one lock so conversations with the amp don't interleave.
   Knob values streamed while dragging bypass it: they're fire-and-forget, serialized by the
   transport's own send queue. */

let lock: Promise<unknown> = Promise.resolve();

function withAmp<T>(task: () => Promise<T>): Promise<T> {
  const run = lock.then(task);
  lock = run.catch(() => undefined);
  return run;
}

/** A user action that blocks other input while it runs. Ignored if one is already running. */
async function userAction(task: () => Promise<void>): Promise<void> {
  if (blocking > 0) return;
  blocking++;
  renderControls();
  try {
    await withAmp(task);
  } catch (err) {
    setMessage((err as Error).message, 'warn');
    log(`error: ${(err as Error).message}`);
  } finally {
    blocking--;
    renderControls();
  }
}

/* ---------------------------------------------------------------- amp events */

function handleAmpMessage(m: SparkMessage): void {
  if (m.cmd !== CMD_NOTIFY) return;
  if (m.sub === 0x38) {
    // Preset switched on the amp. Bank 0x00 = CH1 slot; 0x03 = the back CH2 knob (capture 4).
    if (m.data[0] === BANK.ch2Slot) {
      if (channel === 2) {
        renderSlots();
        void refreshCh2Live();
      }
      return;
    }
    if (m.data[0] !== 0x00) {
      log(`preset switch on the amp: bank 0x${m.data[0]?.toString(16)} number ${m.data[1]}`);
      return;
    }
    bufferName = null;
    playingKey = null;
    renderCardLists();
    renderSlots();
    void refreshLive();
  } else if (m.sub === 0x64) {
    showTunerReading(m.data);
  } else if (m.sub === 0x37) {
    applyAmpKnob(m.data);
  } else if (m.sub === 0x33 && m.data.length === 6) {
    // A level changed on the amp, e.g. the MASTER VOL knob. The transport already recorded it.
    updateLevel(m.data[0]);
  }
}

/** 0x0337 from the amp: [prefixed model name, param index, float]. VERIFIED-HW: Spark LIVE. */
function applyAmpKnob(data: readonly number[]): void {
  if (!live) return;
  try {
    const r = new Reader(data);
    const model = r.prefixedString();
    const index = r.int();
    const value = r.float();
    const block = live.effects.findIndex((e) => e.name === model);
    const param = block >= 0 ? live.effects[block].params.find((p) => p.index === index) : undefined;
    if (!param) return;
    param.value = value; // projection only; the next read from the amp replaces it
    updateParamView(block, index, true);
  } catch (err) {
    log(`knob message not decoded: ${(err as Error).message}`);
  }
}

async function refreshLive(): Promise<void> {
  if (refreshQueued) return;
  refreshQueued = true;
  try {
    const fresh = await withAmp(() => {
      refreshQueued = false;
      return transport.readLiveState();
    });
    applyLive(fresh);
  } catch (err) {
    refreshQueued = false;
    log(`live refresh failed: ${(err as Error).message}`);
  }
}

/* ---------------------------------------------------------------- actions */

async function connect(): Promise<void> {
  try {
    await transport.connect();
  } catch (err) {
    const e = err as Error;
    // Closing the picker is not an error worth shouting about.
    setMessage(e.name === 'NotFoundError' ? 'No amp chosen.' : `Could not connect: ${e.message}`, 'warn');
    return;
  }
  await userAction(async () => {
    setMessage('Reading the amp…');
    await transport.identify();
    renderInfo();
    for (const target of Object.values(VOLUME)) await transport.readVolume(target);
    await transport.readChannelPresets();
    renderLevels();
    slots = await transport.readLibrary(LIVE_SLOT_COUNT, (i) => setMessage(`Reading ${slotLabel(i).label}…`));
    renderSlots();
    live = await transport.readLiveState();
    await rememberModels();
    renderLive();
    const ok = slots.filter((s) => s.preset).length;
    const good = ok === LIVE_SLOT_COUNT && live !== null;
    setMessage(good ? 'Ready.' : `Read ${ok} of ${LIVE_SLOT_COUNT} presets${live ? '' : ', live sound unreadable'}.`, good ? 'ok' : 'warn');
  });
}

async function switchTo(slot: number): Promise<void> {
  await userAction(async () => {
    setMessage(`Switching to ${slotLabel(slot).label}…`);
    const r = await transport.switchPreset(slot, LIVE_SLOT_COUNT);
    bufferName = null;
    playingKey = null;
    renderCardLists();
    if (r.slotPreset) slots = slots.map((s) => (s.slot === slot ? { slot, preset: r.slotPreset } : s));
    live = r.live;
    renderSlots();
    renderLive();
    if (r.verified) setMessage(`${slotLabel(slot).label} playing — confirmed by the amp.`, 'ok');
    else setMessage(`Switch to ${slotLabel(slot).label} not confirmed: ${r.differences.slice(0, 3).join('; ')}`, 'warn');
  });
}

async function toggleBlock(block: number): Promise<void> {
  const effect = live?.effects[block];
  if (!effect) return;
  const on = !effect.enabled;
  await userAction(async () => {
    const check = await transport.setEffectEnabled(effect.name, on);
    applyLive(check.live);
    if (check.verified) setMessage(`${blockName(block)} ${on ? 'on' : 'off'} — confirmed by the amp.`, 'ok');
    else setMessage(`${blockName(block)} ${on ? 'on' : 'off'} not confirmed: the amp reports ${check.actual === null ? 'nothing' : check.actual ? 'on' : 'off'}.`, 'warn');
  });
}

/* Slider editing: stream the latest value, then verify after release. */

function onSliderInput(block: number, index: number, value: number): void {
  if (!live) return;
  const key = keyOf(block, index);
  let edit = edits.get(key);
  if (!edit) {
    edit = { effect: live.effects[block].name, index, latest: value, dirty: false, sending: false, dragging: true, verifyTimer: undefined };
    edits.set(key, edit);
  }
  window.clearTimeout(edit.verifyTimer);
  edit.latest = value;
  edit.dirty = true;
  edit.dragging = true;
  const param = live.effects[block].params.find((p) => p.index === index);
  if (param) param.value = value;
  updateParamView(block, index, false, 'pending');
  void pump(key, edit);
}

function onSliderRelease(block: number, index: number): void {
  const key = keyOf(block, index);
  const edit = edits.get(key);
  if (!edit) return;
  edit.dragging = false;
  if (!edit.sending) scheduleVerify(key, block, edit);
}

async function pump(key: string, edit: Edit): Promise<void> {
  if (edit.sending) return;
  edit.sending = true;
  try {
    while (edit.dirty) {
      edit.dirty = false;
      await transport.changeParam(edit.effect, edit.index, edit.latest);
    }
  } catch (err) {
    setMessage(`Knob not sent: ${(err as Error).message}`, 'warn');
  } finally {
    edit.sending = false;
  }
  const view = paramViews.get(key);
  if (!edit.dragging && view) scheduleVerify(key, view.block, edit);
}

function scheduleVerify(key: string, block: number, edit: Edit): void {
  window.clearTimeout(edit.verifyTimer);
  edit.verifyTimer = window.setTimeout(() => void verify(key, block, edit), VERIFY_DELAY_MS);
}

async function verify(key: string, block: number, edit: Edit): Promise<void> {
  if (edit.dragging || edit.sending || edit.dirty) return; // a newer value is on its way
  const value = edit.latest;
  try {
    const check = await withAmp(() => transport.verifyParam(edit.effect, edit.index, value));
    if (edits.get(key) !== edit || edit.dragging || edit.latest !== value) return; // moved again meanwhile
    edits.delete(key);
    applyLive(check.live);
    updateParamView(block, edit.index, false, check.verified ? 'ok' : 'bad');
    if (!check.verified) {
      setMessage(
        `${paramName(block, edit.index, edit.effect)} not confirmed: sent ${formatValue(value)}, amp has ${check.actual === null ? 'nothing' : formatValue(check.actual)}.`,
        'warn',
      );
    }
  } catch (err) {
    updateParamView(block, edit.index, false, 'bad');
    setMessage(`${paramName(block, edit.index, edit.effect)} not confirmed: ${(err as Error).message}`, 'warn');
  }
}

function backup(): void {
  const b = buildBackup(slots, { device: transport.deviceName, serial: transport.state.serial });
  const blob = new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: backupFileName(b) });
  a.click();
  URL.revokeObjectURL(a.href);
  const n = b.slots.filter((s) => s.preset).length;
  setMessage(`Backed up ${n} of ${b.slots.length} presets to ${backupFileName(b)}.`, n === b.slots.length ? 'ok' : 'warn');
}

/* ---------------------------------------------------------------- tones: assistant and library */

/** Models confirmed on this amp: stored from earlier sessions plus what was just read. */
function palette(): ModelPalette {
  return mergePalettes(knownBlocks, buildPalette([...slots.map((s) => s.preset), live]));
}

/** Records every model read from this amp, so saved tones can be checked against them later. */
async function rememberModels(): Promise<void> {
  const device = transport.deviceName;
  if (!device) return;
  try {
    knownBlocks = mergePalettes(await getKnownBlocks(device));
    knownBlocks = mergePalettes(await addKnownBlocks(device, palette()));
    seenModels = paletteModels(knownBlocks);
  } catch (err) {
    log(`could not record models: ${(err as Error).message}`);
  }
}

/** Plays a preset from the temporary buffer (verified). No saved slot changes. */
async function playInBuffer(preset: Preset, label: string, key: string | null = null): Promise<void> {
  await userAction(async () => {
    setMessage(`Loading "${label}" into the temporary buffer…`);
    const r = await transport.loadPreset(preset, (i, n) => setMessage(`Loading "${label}" — ${i + 1}/${n}…`));
    bufferName = label;
    playingKey = r.sent ? key : playingKey;
    if (r.readBack) applyLive(r.readBack);
    renderSlots();
    renderCardLists();
    $('live-name').textContent = liveLabel();
    if (r.verified) setMessage(`"${label}" playing (temporary) — confirmed by the amp. Press PRESET on the amp to go back.`, 'ok');
    else setMessage(`"${label}" not confirmed: ${r.differences.slice(0, 3).join('; ') || r.error || 'no read-back'}`, 'warn');
  });
}

async function checkAi(): Promise<void> {
  const a = await aiAvailability();
  aiReady = a === 'available' || a === 'downloadable' || a === 'downloading';
  $('ai-status').textContent = {
    unsupported: 'not available in this browser',
    unavailable: 'not available on this device',
    downloadable: 'model downloads on first use',
    downloading: 'model downloading…',
    available: 'ready',
  }[a];
  // Load the model and the fixed instructions now, so the first Suggest is quicker.
  if (a === 'available') warmUp(buildPrompt('', palette()).system);
  renderControls();
}

async function suggest(): Promise<void> {
  if (!live || aiRunning) return;
  const request = $<HTMLInputElement>('ai-request').value;
  const playback = live;
  const pal = palette();
  const count = Number($<HTMLSelectElement>('ai-count').value) || 3;
  const instrument = ($<HTMLSelectElement>('ai-instrument').value || 'electric') as Instrument;
  const { system, user } = buildPrompt(request, pal, count, instrument);
  aiRunning = true;
  renderControls();
  const started = Date.now();
  const tick = () => ($('ai-status').textContent = `thinking… ${Math.round((Date.now() - started) / 1000)} s`);
  tick();
  const timer = window.setInterval(tick, 1000);
  try {
    const text = await generate(system, user, suggestionSchema(pal, count), (f) => {
      $('ai-status').textContent = `downloading model ${Math.round(f * 100)}%`;
    });
    log(`AI answer: ${text.slice(0, 400)}${text.length > 400 ? '…' : ''}`);
    suggestions = parseAnswer(text).suggestions.map((raw) => checkSuggestion(raw, playback, pal));
    if (playingKey?.startsWith('ai:')) playingKey = null;
    lastRequest = request;
    renderSuggestions();
    const good = suggestions.filter((s) => s.preset).length;
    const secs = Math.round((Date.now() - started) / 1000);
    setMessage(`${good} of ${suggestions.length} suggestions usable (${secs} s).`, good ? 'ok' : 'warn');
    log(`AI took ${secs} s`);
    $('ai-status').textContent = 'ready';
  } catch (err) {
    setMessage(`Tone assistant: ${(err as Error).message}`, 'warn');
    $('ai-status').textContent = 'error';
  } finally {
    window.clearInterval(timer);
    aiRunning = false;
    renderControls();
  }
}

async function storeTone(tone: Omit<SavedTone, 'id' | 'createdAt'>): Promise<void> {
  try {
    await saveTone({ ...tone, id: crypto.randomUUID(), createdAt: new Date().toISOString() });
    await refreshTones();
    setMessage(`Saved "${tone.name}" to My tones.`, 'ok');
  } catch (err) {
    setMessage(`Could not save: ${(err as Error).message}`, 'warn');
  }
}

async function refreshTones(): Promise<void> {
  try {
    tones = await listTones();
  } catch (err) {
    log(`tone library unavailable: ${(err as Error).message}`);
    tones = [];
  }
  renderTones();
}

/** A saved tone may only use models this amp is known to have. */
async function applySaved(tone: SavedTone): Promise<void> {
  const device = transport.deviceName;
  const known = new Set([...paletteModels(palette()), ...(device ? await getSeenModels(device) : seenModels)]);
  const { errors } = validatePreset(tone.preset, known);
  if (errors.length) {
    setMessage(`Not applied — "${tone.name}": ${errors.slice(0, 2).join('; ')}`, 'warn');
    return;
  }
  await playInBuffer(tone.preset, tone.name, `tone:${tone.id}`);
}

function exportTones(): void {
  const data = { format: 'myspark-tones', version: 1, exportedAt: new Date().toISOString(), tones };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `myspark-tones-${data.exportedAt.slice(0, 10)}.json` });
  a.click();
  URL.revokeObjectURL(a.href);
}

/** True when this card's tone is what the amp is playing from the temporary buffer. */
function isPlaying(key: string): boolean {
  return playingKey === key && transport.state.currentPreset === SOFTWARE_PRESET;
}

/** Re-draws the three card lists so the "Playing" highlight follows what the amp plays. */
function renderCardLists(): void {
  renderSuggestions();
  renderTones();
  if (cloudResults.length) renderCloud();
}

function card(title: string, desc: string, meta: string, extra: Node[], actions: HTMLButtonElement[], cls = ''): HTMLElement {
  const playing = cls.split(' ').includes('playing');
  return el(
    'div',
    { class: `card ${cls}`.trim(), ...(playing ? { 'aria-current': 'true' } : {}) },
    ...(playing ? [el('span', { class: 'badge' }, '▶ Playing')] : []),
    el('h3', {}, title),
    ...(desc ? [el('div', { class: 'desc' }, desc)] : []),
    ...(meta ? [el('div', { class: 'meta' }, meta)] : []),
    ...extra,
    el('div', { class: 'actions' }, ...actions),
  );
}

function button(label: string, onClick: () => void, needsAmp = false): HTMLButtonElement {
  const b = el('button', needsAmp ? { 'data-needs-amp': '' } : {}, label);
  b.addEventListener('click', onClick);
  return b;
}

function renderSuggestions(): void {
  const out = $('ai-results');
  out.replaceChildren(
    ...suggestions.map((s, i) => {
      if (!s.preset) {
        const errs = el('ul', { class: 'errors' }, ...s.errors.slice(0, 4).map((e) => el('li', {}, e)));
        return card(s.name, s.description, 'Rejected — not safe to send', [errs], [], 'rejected');
      }
      const preset = s.preset;
      const key = `ai:${i}`;
      return card(
        s.name,
        s.description,
        s.summary.join(' · '),
        [],
        [
          button('Try', () => void playInBuffer(preset, s.name, key), true),
          button('Save', () => void storeTone({ name: s.name, description: s.description, source: 'ai', request: lastRequest, preset })),
        ],
        isPlaying(key) ? 'playing' : '',
      );
    }),
  );
  renderControls();
}

function renderTones(): void {
  const out = $('tones');
  if (!tones.length) {
    out.replaceChildren(el('p', { class: 'empty-note' }, 'No saved tones yet. Save the tone playing now, or an AI suggestion.'));
  } else {
    out.replaceChildren(
      ...tones.map((t) =>
        card(
          t.name,
          t.description,
          `${t.source === 'ai' ? `AI${t.request ? `: "${t.request}"` : ''}` : t.source === 'tonecloud' ? 'ToneCloud' : 'from the amp'} · ${new Date(t.createdAt).toLocaleString()}`,
          [],
          [
            button('Apply', () => void applySaved(t), true),
            button('Delete', () => {
              if (!confirm(`Delete "${t.name}" from My tones?`)) return;
              void deleteTone(t.id).then(refreshTones);
            }),
          ],
          isPlaying(`tone:${t.id}`) ? 'playing' : '',
        ),
      ),
    );
  }
  renderControls();
}

/* ---------------------------------------------------------------- ToneCloud
   Search is user-initiated only. A preset may be tried or saved only if every model is on the
   Spark 2 list or confirmed on this amp; anything else (e.g. Spark 40-only models) is flagged. */

function knownForCloud(): Set<string> {
  return new Set([...SPARK2_MODELS.flat(), ...paletteModels(palette()), ...seenModels]);
}

/** New search (more = false) or the next page of the current one (more = true). */
async function cloudSearch(more = false): Promise<void> {
  if (cloudBusy) return;
  if (!more) {
    cloudQuery = $<HTMLInputElement>('tc-query').value;
    cloudOrder = $<HTMLSelectElement>('tc-order').value as CloudOrder;
    cloudPage = 1;
  }
  cloudBusy = true;
  renderControls();
  $('tc-status').textContent = 'searching…';
  try {
    const page = await searchPresets(cloudQuery, more ? cloudPage + 1 : 1, CLOUD_PAGE_SIZE, cloudOrder);
    if (more) cloudPage++;
    const seen = new Set(more ? cloudResults.map((r) => r.id) : []);
    const merged = [...(more ? cloudResults : []), ...page.filter((r) => !seen.has(r.id))];
    cloudResults = sortResults(merged, cloudOrder);
    cloudMore = page.length === CLOUD_PAGE_SIZE;
    renderCloud();
  } catch (err) {
    $('tc-status').textContent = 'error';
    setMessage(`ToneCloud: ${(err as Error).message}`, 'warn');
  } finally {
    cloudBusy = false;
    renderControls();
  }
}

/** Presets that failed the check when loaded; left out of the list from then on. */
const cloudHidden = new Set<string>();

/**
 * Supported = nothing in the search result rules it out: every listed model is known for this amp,
 * guitar input (in1), 7 blocks. Older presets have no model list in the results; they're checked
 * when loaded (Try/Save) and hidden if they fail. Owner decision 2026-09-28: don't show the rest.
 */
function cloudSupported(s: CloudSummary, known: Set<string>): boolean {
  if (cloudHidden.has(s.id)) return false;
  if (s.chain && s.chain !== 'in1') return false;
  if (s.models.length && s.models.length !== 7) return false;
  return s.models.every((m) => known.has(m));
}

async function cloudPreset(s: CloudSummary): Promise<Preset | null> {
  try {
    const { preset } = await fetchPreset(s.id);
    const errors = [...validatePreset(preset, knownForCloud()).errors];
    if (preset.effects.length !== 7) errors.unshift(`${preset.effects.length} blocks, not the guitar channel's 7`);
    if (errors.length) throw new Error(errors[0]);
    // Older presets have no model list in the search results: fill it in now for the card.
    if (s.models.length === 0) {
      s.models = preset.effects.map((e) => e.name);
      renderCloud();
    }
    return preset;
  } catch (err) {
    cloudHidden.add(s.id);
    renderCloud();
    setMessage(`"${s.name}" isn't supported on your amp (${(err as Error).message}) — removed from the list. Nothing was sent.`, 'warn');
    log(`ToneCloud ${s.id} hidden: ${(err as Error).message}`);
    return null;
  }
}

function renderCloud(): void {
  const known = knownForCloud();
  const shown = cloudResults.filter((s) => cloudSupported(s, known));
  const hidden = cloudResults.length - shown.length;
  if (cloudResults.length || hidden) {
    $('tc-status').textContent = `${shown.length} result${shown.length === 1 ? '' : 's'}${hidden ? ` · ${hidden} unsupported hidden` : ''}`;
  }
  const out = $('tc-results');
  if (!shown.length) {
    out.replaceChildren(el('p', { class: 'empty-note' }, cloudResults.length ? 'No supported presets in these results — try More results or another search.' : 'No presets found.'));
    renderControls();
    return;
  }
  out.replaceChildren(
    ...shown.map((s) => {
      const meta = [s.category, `${s.likes.toLocaleString()} likes`, `${s.downloads.toLocaleString()} downloads`].filter(Boolean).join(' · ');
      const chain = s.models.length ? s.models.map((m) => modelName(m)).join(' → ') : 'chain shown after first Try or Save';
      const tryBtn = button('Try', async () => {
        const preset = await cloudPreset(s);
        if (preset) await playInBuffer(preset, s.name, `cloud:${s.id}`);
      }, true);
      tryBtn.setAttribute('data-ch1-only', '');
      const save = button('Save', async () => {
        const preset = await cloudPreset(s);
        if (preset) await storeTone({ name: s.name, description: s.description, source: 'tonecloud', preset });
      });
      return card(s.name, s.description, meta, [el('div', { class: 'meta chain-line' }, chain)], [tryBtn, save], isPlaying(`cloud:${s.id}`) ? 'playing' : '');
    }),
  );
  renderControls();
}

/* ---------------------------------------------------------------- tuner
   The amp's built-in tuner: 0x0165 on/off (confirmed by reading 0x0265 back), readings 0x0364. */

let tunerOpen = false;
let tunerSmooth: number | null = null;
let tunerSilence: number | undefined;

async function openTuner(): Promise<void> {
  if (tunerOpen) return;
  await userAction(async () => {
    const ok = await transport.setTuner(true);
    if (!ok) {
      setMessage('The amp did not confirm the tuner is on.', 'warn');
      return;
    }
    tunerOpen = true;
    tunerSmooth = null;
    $('tuner').hidden = false;
    $('tuner').dataset.state = '';
    $('tuner-note').textContent = '–';
    $('tuner-cents').textContent = 'Play a string';
    $<HTMLButtonElement>('tuner-close').focus();
  });
}

async function closeTuner(): Promise<void> {
  if (!tunerOpen) return;
  tunerOpen = false;
  $('tuner').hidden = true;
  window.clearTimeout(tunerSilence);
  if (!transport.connected) return;
  try {
    const ok = await withAmp(() => transport.setTuner(false));
    if (!ok) setMessage('The amp did not confirm the tuner is off — it may still be muted. Try Tuner → Close again.', 'warn');
  } catch (err) {
    setMessage(`Tuner off failed: ${(err as Error).message}`, 'warn');
  }
}

function showTunerReading(data: readonly number[]): void {
  if (!tunerOpen) return;
  const reading = parseTunerReading(data);
  window.clearTimeout(tunerSilence);
  if (!reading) {
    // No signal: fade back after a moment instead of flickering between notes.
    tunerSilence = window.setTimeout(() => {
      tunerSmooth = null;
      $('tuner').dataset.state = '';
      $('tuner-cents').textContent = 'Play a string';
      $('tuner-needle').style.left = '50%';
    }, 600);
    return;
  }
  // Light smoothing: the amp reports every ~60 ms and the value jitters while a note rings.
  tunerSmooth = tunerSmooth === null ? reading.value : tunerSmooth * 0.6 + reading.value * 0.4;
  const cents = tunerCents(tunerSmooth);
  const abs = Math.abs(cents);
  $('tuner').dataset.state = abs <= 3 ? 'in' : abs <= 15 ? 'near' : 'off';
  $('tuner-note').textContent = NOTE_NAMES[reading.note] ?? '?';
  $('tuner-cents').textContent = abs <= 3 ? 'In tune' : `${cents > 0 ? '+' : '−'}${abs} cents ${cents > 0 ? 'sharp' : 'flat'}`;
  $('tuner-needle').style.left = `${Math.min(98, Math.max(2, tunerSmooth * 100))}%`;
}

/* ---------------------------------------------------------------- channels
   CH2 (mic / acoustic / bass) is read-only: reading it is known from the official app's traffic,
   switching and editing it aren't yet. */

async function selectChannel(ch: 1 | 2): Promise<void> {
  if (channel === ch) return;
  channel = ch;
  document
    .querySelectorAll<HTMLButtonElement>('#channel button')
    .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ch === String(ch))));
  renderSlots();
  renderLive();
  if (ch === 2 && transport.connected && ch2Slots.length === 0) await readCh2();
}

async function readCh2(): Promise<void> {
  await userAction(async () => {
    await transport.readChannelPresets();
    const out: SlotRead[] = [];
    for (let n = 0; n < LIVE_SLOT_COUNT; n++) {
      setMessage(`Reading CH2 ${slotLabel(n).label}…`);
      out.push({ slot: n, preset: await transport.readPresetAt(BANK.ch2Slot, n) });
    }
    ch2Slots = out;
    ch2Live = await transport.readPresetAt(BANK.ch2Live, 0);
    renderSlots();
    renderLive();
    const ok = ch2Slots.filter((s) => s.preset).length;
    setMessage(
      `CH2: read ${ok} of ${LIVE_SLOT_COUNT} presets${ch2Live ? '' : ', live sound unreadable'}. CH2 is view-only for now.`,
      ok ? 'ok' : 'warn',
    );
  });
}

async function refreshCh2Live(): Promise<void> {
  try {
    ch2Live = await withAmp(() => transport.readPresetAt(BANK.ch2Live, 0));
    if (channel === 2) renderLive();
  } catch (err) {
    log(`CH2 refresh failed: ${(err as Error).message}`);
  }
}

function renderCh2Live(out: HTMLElement, ampBox: HTMLElement): void {
  $('live-name').textContent = ch2Live ? `${ch2Live.name} · CH2, view only` : '';
  if (!ch2Live) {
    out.append(el('p', { class: 'empty' }, transport.connected ? 'Reading CH2…' : 'Connect to see CH2.'));
    return;
  }
  // CH2's chain: comp/drive → preamp → EQ/mod → reverb. The preamp plays the amp's role: shown above.
  const pedalPos = [1, -1, 4, 6];
  const pedals: HTMLElement[] = [];
  ch2Live.effects.forEach((effect, block) => {
    const params = el('div', { class: 'params' });
    for (const p of effect.params) {
      params.append(
        el(
          'div',
          { class: 'param' },
          el('span', { class: 'param-name' }, knobName(effect.name, p.index) ?? `P${p.index}`),
          el('span', { class: 'bar' }, el('span', { class: 'fill', style: `width:${Math.round(p.value * 100)}%` })),
          el('span', { class: 'param-value' }, formatValue(p.value)),
          el('span', { class: 'param-status' }),
        ),
      );
    }
    const sw = el(
      'span',
      { class: 'switch static', 'aria-pressed': String(effect.enabled) },
      el('span', { class: 'led' }),
      el('span', {}, effect.enabled ? 'on' : 'off'),
    );
    const isPreamp = block === 1;
    const root = el(
      'section',
      { class: isPreamp ? `amp-panel${effect.enabled ? '' : ' off'}` : `block pedal pos-${pedalPos[block] ?? 0}${effect.enabled ? '' : ' off'}` },
      el(
        'header',
        {},
        el('span', { class: 'block-name' }, CHAIN_CH2[block] ?? `Block ${block + 1}`),
        ...(isPreamp ? [el('div', { class: 'model', title: effect.name }, describeModel(effect.name)), sw] : []),
      ),
      ...(isPreamp ? [params] : [el('div', { class: 'model', title: effect.name }, describeModel(effect.name)), params, el('div', { class: 'footswitch' }, sw)]),
    );
    if (isPreamp) ampBox.append(root);
    else pedals.push(root);
  });
  pedals.forEach((pedal, i) => {
    if (i > 0) out.append(el('span', { class: 'cable', 'aria-hidden': 'true' }));
    if (i === 1) out.append(el('span', { class: 'amp-tap', title: 'The preamp (above) sits here in the chain' }, 'PRE', '↑'), el('span', { class: 'cable', 'aria-hidden': 'true' }));
    out.append(pedal);
  });
}

/* ---------------------------------------------------------------- levels (guitar, music, master)
   0x0133 / 0x0233 / 0x0333, found in the official app's Bluetooth log on the owner's LIVE.
   Values stream while dragging; after release the level is read back and marked ✓ or ✗. */

const LEVEL_LABELS: Record<VolumeName, string> = { guitar: 'Guitar', music: 'Music', master: 'Master' };
interface LevelView {
  input: HTMLInputElement;
  value: HTMLElement;
  status: HTMLElement;
  latest: number;
  dirty: boolean;
  sending: boolean;
  dragging: boolean;
  timer: number | undefined;
}
const levelViews = new Map<number, LevelView>();
const percent = (v: number): string => `${Math.round(v * 100)}%`;

function renderLevels(): void {
  const box = $('levels');
  box.replaceChildren();
  levelViews.clear();
  for (const [name, target] of Object.entries(VOLUME) as Array<[VolumeName, number]>) {
    const v = transport.state.volumes[target];
    const input = el('input', { type: 'range', min: '0', max: '1', step: '0.01', 'aria-label': `${LEVEL_LABELS[name]} volume`, 'data-needs-amp': '' });
    input.value = String(v ?? 0);
    paintRange(input);
    const value = el('span', { class: 'param-value' }, v === undefined ? '—' : percent(v));
    const status = el('span', { class: 'param-status', 'aria-live': 'polite' });
    const view: LevelView = { input, value, status, latest: v ?? 0, dirty: false, sending: false, dragging: false, timer: undefined };
    levelViews.set(target, view);
    input.addEventListener('input', () => {
      window.clearTimeout(view.timer);
      view.latest = Number(input.value);
      view.dirty = true;
      view.dragging = true;
      value.textContent = percent(view.latest);
      setLevelStatus(view, 'pending');
      void pumpLevel(target, view);
    });
    input.addEventListener('change', () => {
      view.dragging = false;
      if (!view.sending) scheduleLevelVerify(target, view);
    });
    box.append(el('div', { class: 'param editable level' }, el('span', { class: 'param-name' }, LEVEL_LABELS[name]), input, value, status));
  }
  renderControls();
}

function setLevelStatus(view: LevelView, state: 'pending' | 'ok' | 'bad'): void {
  view.status.dataset.state = state;
  view.status.textContent = state === 'ok' ? '✓' : state === 'bad' ? '✗' : '…';
}

async function pumpLevel(target: number, view: LevelView): Promise<void> {
  if (view.sending) return;
  view.sending = true;
  try {
    while (view.dirty) {
      view.dirty = false;
      await transport.changeVolume(target, view.latest);
    }
  } catch (err) {
    setMessage(`Level not sent: ${(err as Error).message}`, 'warn');
  } finally {
    view.sending = false;
  }
  if (!view.dragging) scheduleLevelVerify(target, view);
}

function scheduleLevelVerify(target: number, view: LevelView): void {
  window.clearTimeout(view.timer);
  view.timer = window.setTimeout(async () => {
    if (view.dragging || view.sending || view.dirty) return;
    const value = view.latest;
    try {
      const check = await withAmp(() => transport.verifyVolume(target, value));
      if (view.dragging || view.latest !== value) return;
      setLevelStatus(view, check.verified ? 'ok' : 'bad');
      if (!check.verified) {
        setMessage(`Level not confirmed: sent ${percent(value)}, amp has ${check.actual === null ? 'nothing' : percent(check.actual)}.`, 'warn');
        updateLevel(target);
      }
    } catch (err) {
      setLevelStatus(view, 'bad');
      setMessage(`Level not confirmed: ${(err as Error).message}`, 'warn');
    }
  }, VERIFY_DELAY_MS);
}

/** Shows what the amp reports for a level (after a read or a 0x0333 from the panel). */
function updateLevel(target: number): void {
  const view = levelViews.get(target);
  const v = transport.state.volumes[target];
  if (!view || v === undefined || view.dragging) return;
  view.latest = v;
  view.input.value = String(v);
  paintRange(view.input);
  view.value.textContent = percent(v);
}

/* ---------------------------------------------------------------- model picker */

/**
 * Model picker for one chain position: models confirmed on this amp, then the rest of the Spark 2
 * list ("not yet tried"). A model that verifies joins the confirmed list.
 */
function modelControl(block: number, current: string): HTMLElement {
  const confirmed = (palette()[block] ?? []).map((e) => e.name);
  const untried = (SPARK2_MODELS[block] ?? []).filter((id) => !confirmed.includes(id));
  if (confirmed.length + untried.length <= 1) {
    return el('div', { class: 'model', title: current }, describeModel(current));
  }
  const option = (id: string) => {
    const o = el('option', { value: id }, describeModel(id));
    if (id === current) o.selected = true;
    return o;
  };
  const select = el(
    'select',
    { class: 'model-select', 'aria-label': `${blockName(block)} model`, 'data-needs-amp': '' },
    el('optgroup', { label: 'Confirmed on your amp' }, ...(confirmed.includes(current) ? confirmed : [current, ...confirmed]).map(option)),
    ...(untried.length ? [el('optgroup', { label: 'Not yet tried on your LIVE' }, ...untried.map(option))] : []),
  );
  select.addEventListener('change', () => void changeModel(block, current, select.value, !confirmed.includes(select.value)));
  return select;
}

/**
 * Switches a block's model and confirms by reading back. No warning for models not yet tried on
 * this amp: owner decision 2026-09-28, after every untried Spark 2 amp, pedal and Hendrix model they
 * tried worked on the LIVE. The AI still only uses confirmed models.
 */
async function changeModel(block: number, from: string, to: string, untried: boolean): Promise<void> {
  await userAction(async () => {
    setMessage(`${blockName(block)}: switching to ${modelName(to)}…`);
    const check = await transport.setEffectModel(block, from, to);
    applyLive(check.live);
    if (!check.verified) {
      renderLive();
      setMessage(`${blockName(block)}: ${modelName(to)} not confirmed — the amp reports ${check.actual ?? 'nothing'}.`, 'warn');
      return;
    }
    const device = transport.deviceName;
    const block0 = check.live?.effects[block];
    if (device && block0) {
      const one: ModelPalette = [];
      one[block] = [block0];
      knownBlocks = mergePalettes(await addKnownBlocks(device, one));
      seenModels = paletteModels(knownBlocks);
    }
    renderLive();
    setMessage(`${blockName(block)}: ${modelName(to)} — confirmed by the amp${untried ? ', and added to your confirmed models' : ''}.`, 'ok');
  });
}

/* ---------------------------------------------------------------- rendering */

function renderControls(): void {
  const on = transport.connected;
  const idle = blocking === 0;
  $<HTMLButtonElement>('connect').hidden = on;
  $<HTMLButtonElement>('disconnect').hidden = !on;
  $<HTMLButtonElement>('connect').disabled = document.body.dataset.connection === 'connecting';
  $<HTMLButtonElement>('backup').disabled = !on || !idle || slots.every((s) => !s.preset);
  document.querySelectorAll<HTMLButtonElement>('#slots button').forEach((b) => (b.disabled = !on || !idle || channel === 2));
  for (const v of blockViews) v.toggle.disabled = !on || !idle;
  for (const v of paramViews.values()) if (v.input) v.input.disabled = !on || !idle;
  $<HTMLButtonElement>('save-current').disabled = !live || channel === 2;
  $<HTMLButtonElement>('ai-generate').disabled = !aiReady || aiRunning || !live || channel === 2;
  $<HTMLButtonElement>('export-tones').disabled = tones.length === 0;
  document.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('[data-needs-amp]').forEach((b) => (b.disabled = !on || !idle));
  document.querySelectorAll<HTMLButtonElement>('[data-ch1-only]').forEach((b) => (b.disabled = b.disabled || channel === 2));
  $<HTMLButtonElement>('tc-search').disabled = cloudBusy;
  $<HTMLButtonElement>('tc-more').hidden = !cloudMore;
  $<HTMLButtonElement>('tc-more').disabled = cloudBusy;
}

function renderInfo(): void {
  const s = transport.state;
  $('info').textContent = [s.name, s.serial && `serial ${s.serial}`].filter(Boolean).join(' · ');
}

function renderSlots(): void {
  const list = $('slots');
  list.replaceChildren();
  if (channel === 2) {
    for (let slot = 0; slot < LIVE_SLOT_COUNT; slot++) {
      const { bank, label } = slotLabel(slot);
      const preset = ch2Slots.find((s) => s.slot === slot)?.preset;
      list.append(
        el(
          'button',
          {
            class: `slot bank-${bank} view-only`,
            'aria-pressed': String(transport.state.ch2Preset === slot),
            title: 'Switching CH2 presets from the app is not known yet: use the back PRESET knob',
          },
          el('span', { class: 'led', 'aria-hidden': 'true' }),
          el('span', { class: 'slot-label' }, label),
          el('span', { class: 'slot-name', title: preset?.name ?? '' }, preset ? preset.name : ch2Slots.length ? 'unreadable' : '—'),
        ),
      );
    }
    renderControls();
    return;
  }
  for (let slot = 0; slot < LIVE_SLOT_COUNT; slot++) {
    const { bank, label } = slotLabel(slot);
    const preset = slots.find((s) => s.slot === slot)?.preset;
    const button = el(
      'button',
      { class: `slot bank-${bank}`, 'aria-pressed': String(transport.state.currentPreset === slot) },
      el('span', { class: 'led', 'aria-hidden': 'true' }),
      el('span', { class: 'slot-label' }, label),
      el('span', { class: 'slot-name', title: preset?.name ?? '' }, preset ? preset.name : slots.length ? 'unreadable' : '—'),
    );
    button.addEventListener('click', () => void switchTo(slot));
    list.append(button);
  }
  renderControls();
}

function liveLabel(): string {
  if (!live) return '';
  const where = transport.state.currentPreset === SOFTWARE_PRESET ? ' · temporary buffer' : '';
  return `${live.name} · ${live.bpm.toFixed(0)} bpm${where}`;
}

/** Same chain (models and params) as what's on screen, so values can be updated in place? */
function sameShape(a: Preset | null, b: Preset | null): boolean {
  if (!a || !b || a.effects.length !== b.effects.length) return false;
  return a.effects.every(
    (e, i) =>
      e.name === b.effects[i].name &&
      e.params.length === b.effects[i].params.length &&
      e.params.every((p, j) => p.index === b.effects[i].params[j].index),
  );
}

/** Takes a fresh read from the amp as the truth and shows it. */
function applyLive(fresh: Preset | null): void {
  if (!fresh) return;
  const inPlace = sameShape(live, fresh) && blockViews.length === fresh.effects.length;
  live = fresh;
  if (inPlace) {
    // A slider still being edited keeps the user's value; its own read-back settles it.
    for (const [key, e] of edits) {
      const view = paramViews.get(key);
      const param = view && fresh.effects[view.block]?.params.find((p) => p.index === e.index);
      if (param) param.value = e.latest;
    }
  }
  if (!inPlace) {
    renderLive();
    return;
  }
  $('live-name').textContent = liveLabel();
  fresh.effects.forEach((e, block) => {
    updateBlockView(block);
    for (const p of e.params) updateParamView(block, p.index, false);
  });
}

function updateBlockView(block: number): void {
  const view = blockViews[block];
  const effect = live?.effects[block];
  if (!view || !effect) return;
  view.root.classList.toggle('off', !effect.enabled);
  view.label.textContent = effect.enabled ? 'on' : 'off';
  view.toggle.setAttribute('aria-pressed', String(effect.enabled));
}

function updateParamView(block: number, index: number, fromAmp: boolean, status?: 'pending' | 'ok' | 'bad'): void {
  const view = paramViews.get(keyOf(block, index));
  const param = live?.effects[block]?.params.find((p) => p.index === index);
  if (!view || !param) return;
  const edit = edits.get(keyOf(block, index));
  if (view.input && !edit?.dragging) {
    view.input.value = String(param.value);
    paintRange(view.input);
  }
  if (view.choice && !edit?.dragging) {
    const vals = MODEL_INFO[live?.effects[block]?.name ?? '']?.choiceValues?.[index];
    const i = vals ? vals.findIndex((v) => Math.abs(v - param.value) <= 0.02) : Math.round(param.value * 10);
    if (i >= 0) view.choice.value = String(i);
  }
  view.value.textContent = formatValue(param.value);
  if (view.fill) view.fill.style.width = `${Math.round(param.value * 100)}%`;
  if (status) {
    view.status.dataset.state = status;
    view.status.textContent = status === 'ok' ? '✓' : status === 'bad' ? '✗' : '…';
    view.status.title = status === 'ok' ? 'Confirmed by the amp' : status === 'bad' ? 'Not confirmed by the amp' : 'Sending…';
  } else if (fromAmp) {
    view.status.dataset.state = 'amp';
    view.status.textContent = '';
  }
}

function renderLive(): void {
  const out = $('live');
  const ampBox = $('amp');
  out.replaceChildren();
  ampBox.replaceChildren();
  paramViews.clear();
  blockViews = [];
  edits.forEach((e) => window.clearTimeout(e.verifyTimer));
  edits.clear();
  if (channel === 2) {
    renderCh2Live(out, ampBox);
    renderControls();
    return;
  }
  $('live-name').textContent = liveLabel();
  if (!live) {
    out.append(el('p', { class: 'empty' }, transport.connected ? 'Live sound not readable.' : 'Connect to see what the amp is playing.'));
    return;
  }
  live.effects.forEach((effect, block) => {
    const params = el('div', { class: 'params' });
    // Selector params (reverb type) go at the top of the pedal, where the model dropdown sits.
    const top = el('div', { class: 'params pedal-top' });
    const known = MODEL_INFO[effect.name]?.knobs.length ?? 0;
    for (const p of effect.params) {
      // Params past the named knobs aren't shown: on Noise Gate and Reverb that extra param is the
      // block's on/off (the footswitch), and the official app doesn't show it either (owner, 2026-09-28).
      if (known && p.index >= known && block !== AMP_BLOCK) continue;
      const editable = isEditableParam(block, p.index, effect.name);
      const value = el('span', { class: 'param-value' }, formatValue(p.value));
      const status = el('span', { class: 'param-status', 'aria-live': 'polite' });
      let input: HTMLInputElement | null = null;
      let fill: HTMLElement | null = null;
      let choice: HTMLSelectElement | undefined;
      let control: HTMLElement;
      const positions = MODEL_INFO[effect.name]?.choices?.[p.index];
      const values = MODEL_INFO[effect.name]?.choiceValues?.[p.index] ?? positions?.map((_, i) => i / 10);
      if (positions && values) {
        // Reverb type: positions stored as 0, 0.1 … 0.8 (SparklingTones); order confirmed against the
        // official app (owner screenshots 2026-09-28). BPM switches: 0 / 1.
        const nearest = values.reduce((best, v, i) => (Math.abs(v - p.value) < Math.abs(values[best] - p.value) ? i : best), 0);
        const current = Math.abs(values[nearest] - p.value) <= 0.02 ? nearest : -1;
        choice = el(
          'select',
          { class: 'choice-select', 'aria-label': `${blockName(block)} ${paramName(block, p.index, effect.name)}`, 'data-needs-amp': '' },
          ...positions.map((name, i) => {
            const o = el('option', { value: String(i) }, name);
            if (i === current) o.selected = true;
            return o;
          }),
        );
        if (current < 0) choice.prepend(el('option', { value: '', selected: '' }, `(value ${formatValue(p.value)})`));
        const sel = choice;
        sel.addEventListener('change', () => {
          if (sel.value === '') return;
          onSliderInput(block, p.index, values[Number(sel.value)]);
          onSliderRelease(block, p.index);
        });
        control = sel;
      } else if (editable) {
        const slider = el('input', {
          type: 'range',
          min: '0',
          max: '1',
          step: '0.01',
          'aria-label': `${blockName(block)} ${paramName(block, p.index, effect.name)}`,
        });
        slider.value = String(p.value);
        paintRange(slider);
        slider.addEventListener('input', () => onSliderInput(block, p.index, Number(slider.value)));
        slider.addEventListener('change', () => onSliderRelease(block, p.index));
        input = slider;
        control = slider;
      } else {
        fill = el('span', { class: 'fill', style: `width:${Math.round(p.value * 100)}%` });
        control = el('span', { class: 'bar' }, fill);
      }
      paramViews.set(keyOf(block, p.index), { block, index: p.index, input, value, fill, status, choice });
      if (choice) value.textContent = '';
      (choice ? top : params).append(
        el(
          'div',
          { class: `param${editable ? ' editable' : ''}${choice ? ' choice' : ''}` },
          el('span', { class: 'param-name' }, paramName(block, p.index, effect.name)),
          control,
          value,
          status,
        ),
      );
    }
    const label = el('span', {}, effect.enabled ? 'on' : 'off');
    const toggle = el(
      'button',
      { class: 'switch', 'aria-pressed': String(effect.enabled), title: `Turn ${blockName(block)} on or off` },
      el('span', { class: 'led', 'aria-hidden': 'true' }),
      label,
    );
    toggle.addEventListener('click', () => void toggleBlock(block));
    const isAmp = block === AMP_BLOCK;
    const root = el(
      'section',
      { class: isAmp ? `block amp-panel${effect.enabled ? '' : ' off'}` : `block pedal pos-${block}${effect.enabled ? '' : ' off'}` },
      // Amp: name, model and switch in the header. Pedals: name on top, footswitch at the bottom.
      el('header', {}, el('span', { class: 'block-name' }, blockName(block)), ...(isAmp ? [modelControl(block, effect.name), toggle] : [])),
      ...(isAmp
        ? [params]
        : [
            // A single-model block with a selector (Reverb) shows the selector instead of the model line.
            ...(top.childElementCount && (SPARK2_MODELS[block]?.length ?? 0) <= 1 ? [] : [modelControl(block, effect.name)]),
            ...(top.childElementCount ? [top] : []),
            params,
            el('div', { class: 'footswitch' }, toggle),
          ]),
    );
    blockViews.push({ root, toggle, label });
    if (isAmp) {
      ampBox.append(root);
      return;
    }
    // Pedals in signal order, joined by cables; a tap marks where the amp (shown above) sits.
    if (out.childElementCount) out.append(el('span', { class: 'cable', 'aria-hidden': 'true' }));
    if (block === AMP_BLOCK + 1) {
      out.append(el('span', { class: 'amp-tap', title: 'The amp (above) sits here in the chain' }, 'AMP', '↑'));
      out.append(el('span', { class: 'cable', 'aria-hidden': 'true' }));
    }
    out.append(root);
  });
  renderControls();
}

/* ---------------------------------------------------------------- tabs */

const TABS = ['tone', 'ai', 'cloud', 'tones', 'log'] as const;
type Tab = (typeof TABS)[number];

function showTab(tab: Tab): void {
  for (const t of TABS) {
    $(`tab-${t}`).hidden = t !== tab;
    document.querySelector(`.tabs [data-tab="${t}"]`)?.setAttribute('aria-selected', String(t === tab));
  }
  try {
    localStorage.setItem('myspark.tab', tab);
  } catch {
    // storage unavailable: the tab just isn't remembered
  }
}

/* ---------------------------------------------------------------- start */

document.addEventListener('input', (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type === 'range') paintRange(e.target);
});

document.querySelectorAll<HTMLButtonElement>('.tabs [data-tab]').forEach((b) =>
  b.addEventListener('click', () => showTab(b.dataset.tab as Tab)),
);
try {
  const saved = localStorage.getItem('myspark.tab') as Tab | null;
  if (saved && (TABS as readonly string[]).includes(saved)) showTab(saved);
} catch {
  // no storage: start on Tone
}
$('connect').addEventListener('click', () => void connect());
$('tuner-btn').addEventListener('click', () => void openTuner());
$('tuner-close').addEventListener('click', () => void closeTuner());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && tunerOpen) void closeTuner();
});
$('disconnect').addEventListener('click', () => transport.disconnect());
$('backup').addEventListener('click', backup);
$('save-current').addEventListener('click', () => {
  if (!live) return;
  const name = prompt('Name for this tone:', bufferName ?? live.name);
  if (name === null) return;
  const preset = structuredClone(live);
  preset.name = name.trim() || live.name;
  void storeTone({ name: preset.name, description: '', source: 'amp', preset });
});
$('ai-form').addEventListener('submit', (e) => {
  e.preventDefault();
  void suggest();
});
$('export-tones').addEventListener('click', exportTones);
$('tc-form').addEventListener('submit', (e) => {
  e.preventDefault();
  void cloudSearch();
});
$('tc-more').addEventListener('click', () => void cloudSearch(true));
$('tc-order').addEventListener('change', () => {
  if (cloudResults.length) void cloudSearch();
});
document
  .querySelectorAll<HTMLButtonElement>('#channel button')
  .forEach((b) => b.addEventListener('click', () => void selectChannel(b.dataset.ch === '2' ? 2 : 1)));

if (!('bluetooth' in navigator)) {
  setMessage('This browser has no Web Bluetooth. Use Chrome or Edge on the PC, or Chrome on Android.', 'warn');
  $<HTMLButtonElement>('connect').disabled = true;
}

renderSlots();
renderLive();
renderLevels();
void refreshTones();
void checkAi();

/* Dev-only preview: on localhost with ?demo, show a backup file (web/demo-backup.json, gitignored)
   as if read from the amp, so the layout can be checked without an amp. Nothing is sent anywhere. */
if (['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).has('demo')) {
  void fetch('./demo-backup.json')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((b: { slots: SlotRead[] }) => {
      slots = b.slots;
      live = b.slots.find((s) => s.preset)?.preset ?? null;
      transport.state.currentPreset = b.slots.find((s) => s.preset)?.slot ?? null;
      renderSlots();
      renderLive();
      setMessage('Demo preview: showing demo-backup.json — not connected to an amp.', 'info');
      if (new URLSearchParams(location.search).get('demo') === 'tuner') {
        // A real reading from the owner's LIVE (E string, 0.444), to check the tuner display.
        tunerOpen = true;
        $('tuner').hidden = false;
        showTunerReading([0x04, 0xca, 0x3e, 0xe3, 0x82, 0x80]);
      }
    })
    .catch((err: Error) => log(`demo preview unavailable: ${err.message}`));
}

startDevReload(
  () => transport.connected,
  () => {
    toast(['Update ready (dev) — reloading disconnects the amp. ', button('Reload', () => location.reload())], 'info', true);
  },
);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch((err: Error) => log(`service worker not registered: ${err.message}`));
}
