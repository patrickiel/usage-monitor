import type { Component } from 'svelte';
import type { IconComponentProps } from 'phosphor-svelte';
import BrandIcon from './BrandIcon.svelte';

/** An icon component (Phosphor-compatible props) for one 24×24 SVG path. */
export const brandIcon =
  (path: string): Component<IconComponentProps> =>
  (internals, props) =>
    BrandIcon(internals, { ...props, path });
