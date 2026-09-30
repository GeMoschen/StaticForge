import { TranslocoPipe } from '@jsverse/transloco';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { components } from '../../core/api/generated/schema.d.ts';

type FieldChange = components['schemas']['FieldChange'];
type BlockChange = components['schemas']['BlockChange'];

export type BlockKind = 'ADD' | 'REMOVE' | 'UPDATE';

export function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

/**
 * Turns a diff path into something an editor can read. A language-dependent value changes at
 * `content.headline.values.en` (M24.2.1); showing that raw is noise, so it reads as
 * `content.headline (English)` — the field, then the language that changed.
 *
 * <p>`labels` maps a language tag to its project label; an unknown tag keeps its own spelling.
 */
export function formatDiffPath(path: string | undefined, labels: Record<string, string> = {}): string {
  if (!path) {
    return '';
  }
  // The Changes diff (M27.1.3) addresses the stored version: `payload.content.title` reads as `content.title`.
  path = path.replace(/^payload\./, '');
  const match = /^(.*)\.values\.([^.[\]]+)(.*)$/.exec(path);
  if (!match) {
    return path;
  }
  const [, field, locale, rest] = match;
  return `${field}${rest} (${labels[locale] ?? locale})`;
}

export function blockKind(block: BlockChange): BlockKind {
  if (block.kind === 'ADD' || block.kind === 'REMOVE') {
    return block.kind;
  }
  if (block.before !== undefined && block.after !== undefined) {
    return 'UPDATE';
  }
  return block.after !== undefined ? 'ADD' : 'REMOVE';
}

@Component({
  selector: 'sf-diff',
  standalone: true,
  imports: [TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sf-diff.component.html',
  styleUrl: './sf-diff.component.scss',
})
export class SfDiffComponent {
  readonly changes = input<FieldChange[]>([]);
  /** Language tag to label, so a language-dependent change reads "(English)" not "(en)". */
  readonly localeLabels = input<Record<string, string>>({});

  protected formatValue = formatValue;

  protected pathOf(change: FieldChange): string {
    return formatDiffPath(change.path, this.localeLabels());
  }

  protected trackChange(index: number, _change: FieldChange): string {
    return `${index}:${_change.path ?? ''}`;
  }

  protected kindOfBlock(block: BlockChange): BlockKind {
    return blockKind(block);
  }
}
