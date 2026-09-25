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
  antigravity: () => ({
    bars: [bar('Pro', 40, 3 * H, 5 * H), bar('Flash', 12, 3 * H, 5 * H), bar('Claude', 75, 1 * H, 5 * H)],
  }),
  cursor: () => ({ bars: [bar('Month', 54, 12 * D, 30 * D)] }),
  copilot: () => ({ bars: [bar('Month', 31, 18 * D, 30 * D)] }),
  zai: () => ({ bars: [bar('5h', 22, 4 * H, 5 * H), bar('7d', 35, 5 * D, 7 * D)] }),
  kimi: () => ({ bars: [bar('5h', 15, 2 * H, 5 * H), bar('7d', 28, 6 * D, 7 * D)] }),
};

export const withDemoData = (providers: Provider[]): Provider[] =>
  providers.map((p) => ({
    ...p,
    fetch: async () => ({ ...(samples[p.id]?.() ?? { bars: [] }), fetchedAt: new Date() }),
  }));
