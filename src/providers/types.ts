import type { Component } from 'svelte';
import type { IconComponentProps } from 'phosphor-svelte';

/** One usage window, rendered as a progress bar. */
export interface LimitBar {
  label: string;
  /** 0–100 */
  percent: number;
  resetsAt?: Date;
  /** Window length; with `resetsAt` it draws a pace marker (time elapsed in the window). */
  windowSeconds?: number;
  /** Shown instead of the reset countdown, e.g. "$12 / $50". */
  detail?: string;
}

export interface UsageSnapshot {
  bars: LimitBar[];
  /** Limit resets the user can still redeem, if the provider offers them. */
  resetsAvailable?: number;
  /** Short and human readable; the overlay is click-through, so keep it tiny. */
  error?: string;
  fetchedAt: Date;
}

/**
 * A usage source. To add one: implement this in `providers/<id>.ts`
 * and append it to the list in `providers/index.ts`.
 */
export interface Provider {
  id: string;
  name: string;
  /** Shown in the overlay instead of the name (a Phosphor icon or compatible component). */
  icon: Component<IconComponentProps>;
  /** Icon color; defaults to the text color, which follows the theme. */
  accent?: string;
  /** Shown until toggled in settings; off for providers most people don't use. Default true. */
  defaultEnabled?: boolean;
  /** Set when the provider needs an API key; settings shows an input with this label. */
  keyLabel?: string;
  fetch(ctx: { key?: string }): Promise<UsageSnapshot>;
}
