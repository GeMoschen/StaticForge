/** The non-colour scales of `design/_scales.scss` as the style guide lists them (M35.9). Names without `--sf-`. */

export const TYPE_SIZES = [12, 13, 14, 16, 18, 20, 24, 30] as const;
export const FONT_WEIGHTS = ['regular', 'medium', 'semibold'] as const;
export const FONT_FAMILIES = ['font-ui', 'font-mono'] as const;
export const SPACING_STEPS = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16] as const;
export const RADII = ['sm', 'md', 'lg', 'pill'] as const;
export const ELEVATIONS = [0, 1, 2, 3] as const;
export const Z_LAYERS = ['base', 'sticky', 'dropdown', 'drawer', 'modal', 'popover', 'toast', 'tooltip'] as const;
export const DURATIONS = ['fast', 'base', 'slow'] as const;
export const EASINGS = ['standard', 'enter', 'exit'] as const;
export const LAYOUT_TOKENS = [
  'topbar-height',
  'rail-width-collapsed',
  'rail-width-expanded',
  'tree-width',
  'bp-sm',
  'bp-md',
  'bp-lg',
] as const;

/** Density tokens: heights are drawn as bars of that height, paddings and gaps as bars of that width. */
export const DENSITY_TOKENS: readonly { readonly name: string; readonly axis: 'height' | 'width' }[] = [
  { name: 'control-height-sm', axis: 'height' },
  { name: 'control-height', axis: 'height' },
  { name: 'row-height', axis: 'height' },
  { name: 'table-row-height', axis: 'height' },
  { name: 'pad-control-x', axis: 'width' },
  { name: 'pad-cell-x', axis: 'width' },
  { name: 'pad-cell-y', axis: 'width' },
  { name: 'pad-panel', axis: 'width' },
  { name: 'gap', axis: 'width' },
];

/** Every scale token the style guide reads from the computed styles. */
export const SCALE_TOKEN_NAMES: readonly string[] = [
  ...TYPE_SIZES.flatMap((size) => [`fs-${size}`, `lh-${size}`]),
  ...FONT_WEIGHTS.map((w) => `weight-${w}`),
  ...FONT_FAMILIES,
  ...SPACING_STEPS.map((n) => `space-${n}`),
  ...RADII.map((r) => `radius-${r}`),
  ...ELEVATIONS.map((n) => `elevation-${n}`),
  ...Z_LAYERS.map((z) => `z-${z}`),
  ...DURATIONS.map((d) => `duration-${d}`),
  ...EASINGS.map((e) => `ease-${e}`),
  ...LAYOUT_TOKENS,
  ...DENSITY_TOKENS.map((t) => t.name),
];
