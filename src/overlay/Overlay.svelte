<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { fade } from 'svelte/transition';
  import { listen } from '@tauri-apps/api/event';
  import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
  import ClockCounterClockwiseIcon from 'phosphor-svelte/lib/ClockCounterClockwiseIcon';
  import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircleIcon';
  import { ordered, providerEnabled } from '../providers';
  import type { Provider, UsageSnapshot } from '../providers/types';
  import { loadConfig, onConfigChanged, type Config } from '../lib/config';
  import { place } from '../lib/placement';
  import { setTheme } from '../lib/theme';
  import { loadCached, saveCached } from '../lib/cache';
  import { ago, barColors, columns, countdown, current, pace, paceColor, problem, severity } from '../lib/format';

  /** Data older than this gets an age badge even without an error. */
  const STALE_MS = 10 * 60 * 1000;

  let config = $state<Config | null>(null);
  let snapshots = $state<Record<string, UsageSnapshot>>({});
  let now = $state(Date.now());
  let size = $state({ width: 0, height: 0 });

  const active = $derived(config ? ordered(config.order).filter((p) => providerEnabled(config!, p)) : []);

  /** Providers with a fetch in flight; a second refresh joins it instead of fetching again. */
  const inflight: Record<string, Promise<void>> = {};
  let loading = $state<Record<string, boolean>>({});
  /** Keeps the loading ring up long enough to register, even for instant (cached/local) fetches. */
  const MIN_LOADING_MS = 500;

  function refreshOne(p: Provider) {
    return (inflight[p.id] ??= (async () => {
      loading[p.id] = true;
      const started = Date.now();
      try {
        await fetchOne(p);
      } finally {
        await new Promise((r) => setTimeout(r, MIN_LOADING_MS - (Date.now() - started)));
        loading[p.id] = false;
        delete inflight[p.id];
      }
    })());
  }

  async function fetchOne(p: Provider) {
    let next: UsageSnapshot;
    try {
      next = await p.fetch({ key: config?.keys[p.id] || undefined });
    } catch (e) {
      next = { bars: [], error: String(e), fetchedAt: new Date() };
    }
    // On failure (e.g. rate limited) keep showing the last known bars and their age.
    const prev = snapshots[p.id];
    // A failed or empty result never replaces newer good data (e.g. an old log fallback).
    const worse = next.error || !next.bars.length;
    if (worse && prev?.bars.length && (!next.bars.length || prev.fetchedAt >= next.fetchedAt)) {
      snapshots[p.id] = { ...prev, error: next.error ?? 'no data' };
      return;
    }
    snapshots[p.id] = next;
    if (!next.error && next.bars.length) saveCached(p.id, next);
  }

  const refresh = () => Promise.all(active.map(refreshOne));

  onMount(() => {
    // Cache first, so polling (which waits for config) starts from the last known data.
    Promise.all([loadConfig(), loadCached()]).then(([c, cached]) => {
      snapshots = { ...cached, ...snapshots };
      config = c;
    });
    const unlisten = [onConfigChanged((c) => (config = c)), listen('refresh', refresh)];
    const clock = setInterval(() => (now = Date.now()), 1000);
    return () => {
      clearInterval(clock);
      unlisten.forEach((u) => u.then((f) => f()));
    };
  });

  // Primitive keys so unrelated config edits (e.g. dragging the scale slider) don't refetch.
  const intervalMs = $derived(config ? Math.max(30, config.refreshSeconds) * 1000 : 0);
  const activeKey = $derived(active.map((p) => `${p.id}:${config?.keys[p.id] ?? ''}`).join());

  $effect(() => {
    if (!intervalMs) return;
    void activeKey;
    untrack(refresh);
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  });

  /** Attachment: tracks the rendered content size (zoom included). */
  function measure(el: HTMLElement) {
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      size = { width: r.width, height: r.height };
    });
    ro.observe(el);
    return () => ro.disconnect();
  }

  $effect(() => {
    if (config) setTheme(config.theme);
  });

  // Re-dock on any config/size change, and once a minute to follow monitor changes.
  $effect(() => {
    if (!config || !size.width) return;
    const snapshot = $state.snapshot(config);
    const { width, height } = size;
    place(snapshot, width, height);
    const id = setInterval(() => place(snapshot, width, height), 60000);
    return () => clearInterval(id);
  });
</script>

{#if config}
  <div
    {@attach measure}
    class="w-max font-mono text-[10px] leading-none text-neutral-800 select-none dark:text-white/85"
    style:zoom={config.scale}
  >
    <div
      class="flex items-center gap-2.5 rounded-lg bg-neutral-50/(--alpha) px-2.5 py-1.5 dark:bg-[#101012]/(--alpha)"
      style:--alpha="{config.opacity * 100}%"
    >
      {#each active as p, i (p.id)}
        {@const s = snapshots[p.id]}
        {#if i}<div class="h-7 w-px bg-black/10 dark:bg-white/10"></div>{/if}

        <div class="flex items-center gap-2">
          <!-- Provider: icon, then only what needs attention (stale/error, resets left). -->
          <div class="flex flex-col items-center gap-1">
            <!-- Refreshing: the icon dims under a thin ring, positioned outside the flow so nothing shifts. -->
            <span class="relative grid place-items-center">
              <span class={['grid transition-opacity duration-300', s && loading[p.id] && 'opacity-35']}>
                <p.icon size="1.7em" weight="bold" color={p.accent ?? 'currentColor'} />
              </span>
              {#if s && loading[p.id]}
                <svg
                  class="pointer-events-none absolute top-1/2 left-1/2 size-[2.3em] -translate-1/2"
                  viewBox="0 0 24 24"
                  transition:fade={{ duration: 150 }}
                >
                  <circle cx="12" cy="12" r="11" fill="none" stroke-width="1.25" class="stroke-black/10 dark:stroke-white/10" />
                  <circle
                    cx="12"
                    cy="12"
                    r="11"
                    fill="none"
                    stroke-width="1.25"
                    stroke-linecap="round"
                    stroke-dasharray="17 52"
                    class="origin-center animate-spin stroke-neutral-500 dark:stroke-white/60"
                  />
                </svg>
              {/if}
            </span>
            {#if !s}
              <CircleNotchIcon size="1.1em" class="animate-spin text-neutral-400 dark:text-white/40" />
            {:else if s.error && !s.bars.length}
              <!-- Nothing to show: the error itself takes the place of the bars. -->
              <WarningCircleIcon size="1.1em" weight="bold" class="text-red-600 dark:text-red-400" />
            {:else if s.error}
              <!-- Last update failed; the bars are older data. -->
              <span class="flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
                <WarningCircleIcon size="1.1em" weight="bold" />{problem(s.error)}
              </span>
            {:else if now - s.fetchedAt.getTime() > STALE_MS}
              <span class="text-neutral-500 dark:text-white/45">{ago(s.fetchedAt, now)} ago</span>
            {/if}
            {#if s?.resetsAvailable != null}
              <span class="flex items-center gap-0.5 text-sky-600 dark:text-sky-300">
                <ClockCounterClockwiseIcon size="1.1em" weight="bold" />{s.resetsAvailable}
              </span>
            {/if}
          </div>

          {#if s?.bars.length}
            <!-- One row per limit: label · bar (optional pace tick) · percent · reset.
                 Past `maxRows`, limits continue in another column. -->
            <div class="flex items-center gap-3">
              {#each columns(s.bars.map((b) => current(b, now)), config.maxRows) as column, c (c)}
                <div
                  class="grid items-center gap-x-1.5 gap-y-[3px]"
                  style:grid-template-columns="auto {config.barWidth}px{config.showPercent ? ' auto' : ''}{config.showTimes ? ' auto' : ''}"
                >
                  {#each column as bar (bar.label)}
                    {@const sev = severity(bar.percent)}
                    {@const color = barColors[sev]}
                    {@const tick = config.showPace ? pace(bar, now) : null}
                    <span class="text-neutral-500 dark:text-white/45">{bar.label}</span>
                    <div class="relative bg-black/10 dark:bg-white/10" style:height="{config.barHeight}px">
                      <div
                        class={['h-full', bar.percent > 0 && 'min-w-[3px]']}
                        style:width="{Math.min(100, bar.percent)}%"
                        style:background-color={color}
                        style:box-shadow={sev === 'ok' ? undefined : `0 0 6px ${color}`}
                      ></div>
                      {#if tick != null}
                        <div
                          class="absolute -inset-y-0.5 w-0.5 -translate-x-1/2"
                          style:left="{tick}%"
                          style:background-color={paceColor(bar.percent, tick)}
                          style:box-shadow="0 0 0 1px var(--pace-outline)"
                        ></div>
                      {/if}
                    </div>
                    {#if config.showPercent}
                      <span class="text-right" style:color={sev === 'ok' ? undefined : color}>
                        {Math.round(bar.percent)}%
                      </span>
                    {/if}
                    {#if config.showTimes}
                      <span class="text-right text-neutral-500 dark:text-white/40">
                        {bar.detail ?? (bar.resetsAt ? countdown(bar.resetsAt, now) : '')}
                      </span>
                    {/if}
                  {/each}
                </div>
              {/each}
            </div>
          {:else if s}
            <span class="text-neutral-500 dark:text-white/50">{s.error ?? 'no limits'}</span>
          {/if}
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  :global(html, body) {
    background: transparent;
    overflow: hidden;
  }
</style>
