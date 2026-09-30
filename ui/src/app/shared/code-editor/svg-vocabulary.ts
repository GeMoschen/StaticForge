import type { AttrSpec, ElementSpec } from '@codemirror/lang-xml';

/**
 * SVG element and attribute names for XML completion in SVG files and channels (M33 follow-up). Completion offers
 * these alongside closing tags; nothing here restricts what may be written.
 */

const PRESENTATION = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'opacity',
  'transform',
  'clip-path',
  'clip-rule',
  'mask',
  'filter',
  'color',
  'display',
  'visibility',
  'font-family',
  'font-size',
  'font-weight',
  'text-anchor',
  'dominant-baseline',
  'vector-effect',
  'pointer-events',
];

const GEOMETRY: Record<string, string[]> = {
  svg: ['xmlns', 'xmlns:xlink', 'viewBox', 'width', 'height', 'x', 'y', 'preserveAspectRatio', 'version'],
  g: [],
  defs: [],
  symbol: ['viewBox', 'preserveAspectRatio', 'width', 'height', 'x', 'y'],
  use: ['href', 'xlink:href', 'x', 'y', 'width', 'height'],
  title: [],
  desc: [],
  path: ['d', 'pathLength'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
  circle: ['cx', 'cy', 'r'],
  ellipse: ['cx', 'cy', 'rx', 'ry'],
  line: ['x1', 'y1', 'x2', 'y2'],
  polyline: ['points'],
  polygon: ['points'],
  text: ['x', 'y', 'dx', 'dy', 'rotate', 'textLength', 'lengthAdjust'],
  tspan: ['x', 'y', 'dx', 'dy', 'rotate'],
  textPath: ['href', 'startOffset', 'method', 'spacing'],
  image: ['href', 'xlink:href', 'x', 'y', 'width', 'height', 'preserveAspectRatio'],
  a: ['href', 'target'],
  linearGradient: ['x1', 'y1', 'x2', 'y2', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'href'],
  radialGradient: ['cx', 'cy', 'r', 'fx', 'fy', 'fr', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'href'],
  stop: ['offset', 'stop-color', 'stop-opacity'],
  pattern: ['x', 'y', 'width', 'height', 'patternUnits', 'patternContentUnits', 'patternTransform', 'viewBox'],
  clipPath: ['clipPathUnits'],
  mask: ['x', 'y', 'width', 'height', 'maskUnits', 'maskContentUnits'],
  marker: ['viewBox', 'refX', 'refY', 'markerWidth', 'markerHeight', 'markerUnits', 'orient'],
  filter: ['x', 'y', 'width', 'height', 'filterUnits', 'primitiveUnits'],
  feGaussianBlur: ['in', 'stdDeviation', 'result'],
  feOffset: ['in', 'dx', 'dy', 'result'],
  feBlend: ['in', 'in2', 'mode', 'result'],
  feColorMatrix: ['in', 'type', 'values', 'result'],
  feComposite: ['in', 'in2', 'operator', 'k1', 'k2', 'k3', 'k4', 'result'],
  feFlood: ['flood-color', 'flood-opacity', 'result'],
  feMerge: ['result'],
  feMergeNode: ['in'],
  feDropShadow: ['dx', 'dy', 'stdDeviation', 'flood-color', 'flood-opacity'],
  foreignObject: ['x', 'y', 'width', 'height'],
  switch: [],
  style: ['type', 'media'],
  animate: ['attributeName', 'from', 'to', 'values', 'dur', 'begin', 'end', 'repeatCount', 'fill'],
  animateTransform: ['attributeName', 'type', 'from', 'to', 'values', 'dur', 'begin', 'repeatCount'],
  animateMotion: ['path', 'dur', 'begin', 'repeatCount', 'rotate'],
  set: ['attributeName', 'to', 'begin', 'dur'],
  view: ['viewBox', 'preserveAspectRatio'],
  metadata: [],
};

export const SVG_ELEMENTS: ElementSpec[] = Object.entries(GEOMETRY).map(([name, attributes]) => ({
  name,
  top: name === 'svg',
  attributes,
}));

/** Attributes every SVG element accepts: identity, styling and presentation attributes. */
export const SVG_ATTRIBUTES: AttrSpec[] = ['id', 'class', 'style', 'lang', 'tabindex', 'role', 'aria-label', 'aria-hidden', ...PRESENTATION].map(
  (name) => ({ name, global: true }),
);
