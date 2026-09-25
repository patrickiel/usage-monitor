import type { LimitBar, Provider, UsageSnapshot } from './types';

/** Sample data for screenshots: `VITE_DEMO=1 pnpm tauri dev`. */

const H = 3600;
const D = 24 * H;

const bar = (label: string, percent: number, resetsIn: number, windowSeconds: number): LimitBar => ({
  label,
  percent,
  resetsAt: new Date(Date.now() + resetsIn * 1000),
  windowSeconds,
});

const samples: Record<string, () => Omit<UsageSnapshot, 'fetchedAt'>> = {
  claude: () => ({
    bars: [bar('5h', 62, 2 * H + 14 * 60, 5 * H), bar('7d', 38, 3 * D + 4 * H, 7 * D), bar('Sonnet', 21, 3 * D + 4 * H, 7 * D)],
  }),
  codex: () => ({
    bars: [bar('5h', 84, 1 * H + 2 * 60, 5 * H), bar('7d', 47, 4 * D + 9 * H, 7 * D)],
    resetsAvailable: 2,
  }),
};

export const withDemoData = (providers: Provider[]): Provider[] =>
  providers.map((p) => ({
    ...p,
    fetch: async () => ({ ...(samples[p.id]?.() ?? { bars: [] }), fetchedAt: new Date() }),
  }));
