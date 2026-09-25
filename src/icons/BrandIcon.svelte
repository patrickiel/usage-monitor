<!-- A single-path brand mark (e.g. from simple-icons), with the same props as a Phosphor icon. -->
<script lang="ts">
  import type { IconComponentProps } from 'phosphor-svelte';

  let {
    path,
    size = '1em',
    color = 'currentColor',
    weight: _,
    mirrored: __,
    ...rest
  }: IconComponentProps & { path: string } = $props();
</script>

<svg viewBox="0 0 24 24" width={size} height={size} fill={color} {...rest}>
  <path d={path} />
</svg>
