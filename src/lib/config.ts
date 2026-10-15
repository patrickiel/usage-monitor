import { load } from '@tauri-apps/plugin-store';
import { emit, listen } from '@tauri-apps/api/event';
import type { Theme } from './theme';

export type Anchor =
  | 'top-left' | 'top-center' | 'top-right'
  | 'middle-left' | 'middle-center' | 'middle-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right';

/** When a bar shows its percentage: always, once the limit is critical (90%+), or never. */
export type BarPercent = 'always' | 'high' | 'never';

export interface Config {
  /** Monitor name; empty means the primary monitor. */
  monitor: string;
  anchor: Anchor;
  /** Logical px, pushed inwards from the anchored edge. */
  offsetX: number;
  offsetY: number;
  /** Width of a single bar in logical px. */
  barWidth: number;
  /** Rows per column; a provider with more bars continues in another column. */
  maxRows: number;
  scale: number;
  /** Background opacity, 0–1. */
  opacity: number;
  refreshSeconds: number;
  /** Tick on each bar marking how much of the window has elapsed. */
  showPace: boolean;
  /** Bars, or just the percentage in their place. Providers can override it in `bars`. */
  showBars: boolean;
  /** Rows without bars always show the percentage; this is only for the ones with. */
  barPercent: BarPercent;
  /** Reset countdown column (and extra usage $ amounts). */
  showTimes: boolean;
  /** Row labels as their first letter: "S" for Session, "W" for Week. */
  shortLabels: boolean;
  theme: Theme;
  /** Provider ids in display order (drag to reorder in settings). */
  order: string[];
  /** Provider id → enabled. Missing ids use the provider's default. */
  providers: Record<string, boolean>;
  /** Provider id → show bars, overriding `showBars`. Missing ids follow it. */
  bars: Record<string, boolean>;
  /** Provider id → API key, for providers that need one. */
  keys: Record<string, string>;
}

export const defaults: Config = {
  monitor: '',
  anchor: 'bottom-left',
  offsetX: 0,
  offsetY: 0,
  barWidth: 48,
  maxRows: 3,
  scale: 1,
  opacity: 0,
  refreshSeconds: 120,
  showPace: false,
  showBars: true,
  barPercent: 'high',
  showTimes: true,
  shortLabels: false,
  theme: 'auto',
  order: [],
  providers: {},
  bars: {},
  keys: {},
};

const CHANGED = 'config-changed';
const store = load('config.json', { defaults: {}, autoSave: false });

export async function loadConfig(): Promise<Config> {
  const saved = (await (await store).get<Partial<Config> & { showPercent?: boolean }>('config')) ?? {};
  // Up to 0.5 percentages were on/off; off keeps the bars bare.
  if (saved.showPercent === false) saved.barPercent ??= 'never';
  // Only known keys, so settings removed in later versions drop out.
  const known = Object.entries(saved).filter(([k]) => k in defaults);
  return { ...defaults, ...Object.fromEntries(known) };
}

export async function saveConfig(config: Config): Promise<void> {
  const s = await store;
  await s.set('config', config);
  await s.save();
  await emit(CHANGED, config);
}

/** Whether `providerId` draws its bars: its own override, else the global setting. */
export const barsShown = (config: Config, providerId: string) => config.bars[providerId] ?? config.showBars;

export const onConfigChanged = (fn: (config: Config) => void) =>
  listen<Config>(CHANGED, (e) => fn(e.payload));
