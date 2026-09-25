<!-- Claude brand mark (simple-icons), with the same props as a Phosphor icon. -->
<script lang="ts">
  import { siClaude } from 'simple-icons';
  import type { IconComponentProps } from 'phosphor-svelte';

  let { size = '1em', color = 'currentColor', weight: _, mirrored: __, ...rest }: IconComponentProps = $props();
</script>

<svg viewBox="0 0 24 24" width={size} height={size} fill={color} {...rest}>
  <path d={siClaude.path} />
</svg>
