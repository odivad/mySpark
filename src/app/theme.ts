/**
 * App theme settings: Light, Dark or System (follows the device), and the colour scheme (Material 3
 * schemes generated from a seed colour; Purple is M3's baseline). Stored on this device only
 * (localStorage; a per-viewer preference, not amp state). index.html applies it before the first
 * paint; this module changes it and keeps the browser/status bar colour in step.
 */
export type Theme = 'light' | 'dark' | 'system';

const KEY = 'myspark.theme';

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  try {
    if (theme === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // Storage blocked: the choice lasts until the page closes.
  }
  syncThemeColor();
}

/** The top bar's colour (M3 surface-container) for the browser UI / Android status bar. */
export function syncThemeColor(): void {
  const color = getComputedStyle(document.body).getPropertyValue('--md-surface-container').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color || '#f3edf7');
}

/** Wires the Settings theme buttons. */
export function initThemeSetting(group: HTMLElement): void {
  const buttons = [...group.querySelectorAll<HTMLButtonElement>('button[data-theme]')];
  const show = () => buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.theme === getTheme())));
  for (const b of buttons) {
    b.addEventListener('click', () => {
      applyTheme(b.dataset.theme as Theme);
      show();
    });
  }
  // System mode: follow the device when it switches between light and dark.
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncThemeColor);
  show();
  syncThemeColor();
}

/** Colour schemes defined in app.css (`:root[data-color=…]`); purple is the default, no attribute. */
export const COLORS = ['purple', 'red', 'orange', 'green', 'blue', 'teal'] as const;
export type ColorName = (typeof COLORS)[number];
const COLOR_KEY = 'myspark.color';

export function getColor(): ColorName {
  try {
    const c = localStorage.getItem(COLOR_KEY) as ColorName | null;
    return c && COLORS.includes(c) ? c : 'purple';
  } catch {
    return 'purple';
  }
}

export function applyColor(color: ColorName): void {
  const root = document.documentElement;
  if (color === 'purple') delete root.dataset.color;
  else root.dataset.color = color;
  try {
    if (color === 'purple') localStorage.removeItem(COLOR_KEY);
    else localStorage.setItem(COLOR_KEY, color);
  } catch {
    // Storage blocked: the choice lasts until the page closes.
  }
  syncThemeColor();
}

/** Wires the Settings colour swatches. */
export function initColorSetting(group: HTMLElement): void {
  const buttons = [...group.querySelectorAll<HTMLButtonElement>('button[data-color]')];
  const show = () => buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.color === getColor())));
  for (const b of buttons) {
    b.addEventListener('click', () => {
      applyColor(b.dataset.color as ColorName);
      show();
    });
  }
  show();
}
