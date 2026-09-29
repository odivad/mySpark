/**
 * The browser's built-in language model (Chrome's Prompt API, Gemini Nano on-device; Edge offers
 * the same API with its own model). Runs locally: no API key, nothing leaves the machine.
 *
 * API shape per Chrome's built-in AI documentation (`LanguageModel.availability/create`,
 * `session.prompt(text, { responseConstraint })`). Not yet exercised on the owner's PC; it needs a
 * desktop Chrome/Edge with the model available, and is not available on Chrome for Android as far
 * as we know. Feature-detected: the app works without it.
 */

export type AiAvailability = 'unsupported' | 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface LanguageModelSession {
  prompt(input: string, options?: { responseConstraint?: object; signal?: AbortSignal }): Promise<string>;
  clone?(options?: { signal?: AbortSignal }): Promise<LanguageModelSession>;
  destroy(): void;
}

interface DownloadMonitor {
  addEventListener(type: 'downloadprogress', listener: (e: { loaded: number }) => void): void;
}

interface LanguageModelStatic {
  availability(options?: object): Promise<Exclude<AiAvailability, 'unsupported'>>;
  create(options?: {
    initialPrompts?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    expectedInputs?: Array<{ type: 'text'; languages?: string[] }>;
    expectedOutputs?: Array<{ type: 'text'; languages?: string[] }>;
    monitor?: (m: DownloadMonitor) => void;
    signal?: AbortSignal;
  }): Promise<LanguageModelSession>;
}

const LANGUAGE_OPTIONS = {
  expectedInputs: [{ type: 'text' as const, languages: ['en'] }],
  expectedOutputs: [{ type: 'text' as const, languages: ['en'] }],
};

function api(): LanguageModelStatic | null {
  const lm = (globalThis as { LanguageModel?: LanguageModelStatic }).LanguageModel;
  return lm && typeof lm.create === 'function' ? lm : null;
}

export async function aiAvailability(): Promise<AiAvailability> {
  const lm = api();
  if (!lm) return 'unsupported';
  try {
    return await lm.availability(LANGUAGE_OPTIONS);
  } catch {
    return 'unavailable';
  }
}

/**
 * A session primed with the system prompt, kept and cloned per request, so the fixed instructions
 * are processed once instead of on every request. `clone()` is part of the Prompt API; where it is
 * missing, each request gets a fresh session as before.
 */
let primed: { system: string; session: Promise<LanguageModelSession> } | null = null;

function primedSession(lm: LanguageModelStatic, system: string, onDownload?: (fraction: number) => void): Promise<LanguageModelSession> {
  if (primed?.system !== system) {
    const session = lm.create({
      ...LANGUAGE_OPTIONS,
      initialPrompts: [{ role: 'system', content: system }],
      monitor: (m) => m.addEventListener('downloadprogress', (e) => onDownload?.(e.loaded)),
    });
    primed = { system, session };
    session.catch(() => {
      if (primed?.session === session) primed = null;
    });
  }
  return primed.session;
}

/** Starts loading the model and processing the system prompt ahead of the first request. */
export function warmUp(system: string): void {
  const lm = api();
  if (lm) void primedSession(lm, system).catch(() => undefined);
}

/**
 * One prompt, answer constrained to `schema`. The first call may start the model download
 * (Chrome requires a user gesture for that — call it from a click).
 */
export async function generate(
  system: string,
  user: string,
  schema: object,
  onDownload?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  const lm = api();
  if (!lm) throw new Error('This browser has no built-in AI (Prompt API).');
  const base = await primedSession(lm, system, onDownload);
  const session = typeof base.clone === 'function' ? await base.clone({ signal }) : base;
  try {
    return await session.prompt(user, { responseConstraint: schema, signal });
  } finally {
    // A clone is thrown away; without clone() the base can't be reused cleanly either.
    session.destroy();
    if (session === base) primed = null;
  }
}
