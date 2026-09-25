<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { listen } from '@tauri-apps/api/event';
  import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
  import ClockCounterClockwiseIcon from 'phosphor-svelte/lib/ClockCounterClockwiseIcon';
  import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircleIcon';
  import { providers } from '../providers';
  import type { Provider, UsageSnapshot } from '../providers/types';
  import { loadConfig, onConfigChanged, type Config } from '../lib/config';
  import { place } from '../lib/placement';
  import { loadCached, saveCached } from '../lib/cache';
  import { ago, barColors, countdown, current, pace, severity } from '../lib/format';

  /** Data older than this gets an age badge even without an error. */
  const STALE_MS = 10 * 60 * 1000;

  let config = $state<Config | null>(null);
  let snapshots = $state<Record<string, UsageSnapshot>>({});
  let now = $state(Date.now());
  let size = $state({ width: 0, height: 0 });

  const active = $derived(config ? providers.filter((p) => config!.providers[p.id] !== false) : []);

  async function refreshOne(p: Provider) {
    let next: UsageSnapshot;
    try {
      next = await p.fetch();
    } catch (e) {
      next = { bars: [], error: String(e), fetchedAt: new Date() };
    }
    // On failure (e.g. rate limited) keep showing the last known bars and their age.
    const prev = snapshots[p.id];
    if (next.error && !next.bars.length && prev?.bars.length) {
      snapshots[p.id] = { ...prev, error: next.error };
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
  const activeKey = $derived(active.map((p) => p.id).join());

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
    class="w-max font-mono text-[10px] leading-none text-white/85 select-none"
    style:zoom={config.scale}
  >
    <div
      class="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5"
      style:background-color="rgba(16, 16, 18, {config.opacity})"
    >
      {#each active as p, i (p.id)}
        {@const s = snapshots[p.id]}
        {#if i}<div class="h-7 w-px bg-white/10"></div>{/if}

        <div class="flex items-center gap-2">
          <!-- Provider: icon, then only what needs attention (stale/error, resets left). -->
          <div class="flex flex-col items-center gap-1">
            <p.icon size="1.7em" weight="bold" color={p.accent ?? '#fff'} />
            {#if !s}
              <CircleNotchIcon size="1.1em" class="animate-spin text-white/40" />
            {:else if s.error || now - s.fetchedAt.getTime() > STALE_MS}
              <!-- amber: showing last known data; red: nothing to show -->
              <span class={['flex items-center gap-0.5', s.bars.length ? 'text-amber-400' : 'text-red-400']}>
                <WarningCircleIcon size="1.1em" weight="bold" />{ago(s.fetchedAt, now)}
              </span>
            {/if}
            {#if s?.resetsAvailable != null}
              <span class="flex items-center gap-0.5 text-sky-300">
                <ClockCounterClockwiseIcon size="1.1em" weight="bold" />{s.resetsAvailable}
              </span>
            {/if}
          </div>

          {#if s?.bars.length}
            <!-- One row per limit: label · bar (optional pace tick) · percent · reset -->
            <div
              class="grid items-center gap-x-1.5 gap-y-[3px]"
              style:grid-template-columns="auto {config.barWidth}px auto auto"
            >
              {#each s.bars.map((b) => current(b, now)) as bar (bar.label)}
                {@const sev = severity(bar.percent)}
                {@const color = barColors[sev]}
                {@const tick = config.showPace ? pace(bar, now) : null}
                <span class="text-white/45">{bar.label}</span>
                <div class="relative bg-white/10" style:height="{config.barHeight}px">
                  <div
                    class={['h-full', bar.percent > 0 && 'min-w-[3px]']}
                    style:width="{Math.min(100, bar.percent)}%"
                    style:background-color={color}
                    style:box-shadow={sev === 'ok' ? undefined : `0 0 6px ${color}`}
                  ></div>
                  {#if tick != null}
                    <div class="absolute -inset-y-0.5 w-px bg-white/70" style:left="{tick}%"></div>
                  {/if}
                </div>
                <span class="text-right" style:color={sev === 'ok' ? undefined : color}>
                  {Math.round(bar.percent)}%
                </span>
                <span class="text-right text-white/40">
                  {bar.detail ?? (bar.resetsAt ? countdown(bar.resetsAt, now) : '')}
                </span>
              {/each}
            </div>
          {:else if s}
            <span class="text-white/50">{s.error ?? 'no limits'}</span>
          {/if}
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  :global(html, body) {
    background: transparent;
  }
</style>
