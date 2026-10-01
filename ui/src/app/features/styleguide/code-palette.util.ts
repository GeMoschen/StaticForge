/**
 * The code highlighting palettes to compare at the M35.9 sign-off (decision 18): `current` (the M35.5 `--sf-code-*`
 * colours) and `refined` (`design/_semantic.scss`, applied by `data-code-palette="refined"` on `<html>`). There is no
 * app setting yet: the style guide and the sample switch the attribute for their preview only.
 */
export type CodePalette = 'current' | 'refined';

export const CODE_PALETTES: readonly CodePalette[] = ['current', 'refined'];

/** The `?palette=` query value if it names a palette. */
export function codePaletteParam(value: string | null | undefined): CodePalette | null {
  return CODE_PALETTES.includes(value as CodePalette) ? (value as CodePalette) : null;
}

/** Shows a palette: `refined` sets the attribute, `current` (the default) removes it. */
export function applyCodePalette(root: HTMLElement, palette: CodePalette): void {
  if (palette === 'refined') {
    root.dataset['codePalette'] = 'refined';
  } else {
    delete root.dataset['codePalette'];
  }
}

/** The syntax colour tokens (without `--sf-`), as `design/tokens.contrast.spec.ts` checks them. */
export const SYNTAX_TOKENS: readonly string[] = [
  'keyword', 'type', 'attr', 'atom', 'string', 'number', 'comment', 'function', 'special', 'operator', 'tag',
  'fmt-tag', 'fmt-attr', 'fmt-string', 'fmt-keyword', 'fmt-number', 'fmt-comment', 'fmt-punct',
].map((name) => `code-${name}`);
