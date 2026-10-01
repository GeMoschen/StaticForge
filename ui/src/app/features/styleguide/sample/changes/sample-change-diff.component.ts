import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfStatusComponent } from '../../../../shared/components/display/sf-status.component';
import { SfSegmentedComponent, SfSegmentedOption } from '../../../../shared/components/forms/sf-segmented.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import {
  CHANGE_LANG_NAMES,
  CHANGE_STATUS_ICONS,
  CHANGE_STATUS_TONES,
  CHANGE_TYPE_ICONS,
  ChangeDiffField,
  SampleChange,
} from './changes-data';
import { injectSampleNotice, injectSampleText } from './sample-area.util';

/** A run of words of a value; `changed` runs are highlighted (removed on the left, added on the right). */
export interface DiffSegment {
  readonly text: string;
  readonly changed: boolean;
}

export interface FieldDiff {
  readonly label: string;
  readonly before: readonly DiffSegment[] | null;
  readonly after: readonly DiffSegment[] | null;
  readonly unchanged: boolean;
}

/**
 * A word-level diff of two values: the common words at the start and end stay plain, the middle is marked. Enough for
 * the prototype's short fields (the real diff, M35.23, compares structured field values).
 */
export function diffField(field: ChangeDiffField): FieldDiff {
  const { label, before, after } = field;
  if (before === null || after === null) {
    return {
      label,
      before: before === null ? null : [{ text: before, changed: true }],
      after: after === null ? null : [{ text: after, changed: true }],
      unchanged: false,
    };
  }
  if (before === after) {
    return { label, before: [{ text: before, changed: false }], after: [{ text: after, changed: false }], unchanged: true };
  }
  const a = before.split(/(\s+)/);
  const b = after.split(/(\s+)/);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    start++;
  }
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) {
    end++;
  }
  const segments = (words: string[]): DiffSegment[] =>
    [
      { text: words.slice(0, start).join(''), changed: false },
      { text: words.slice(start, words.length - end).join(''), changed: true },
      { text: words.slice(words.length - end).join(''), changed: false },
    ].filter((s) => s.text !== '');
  return { label, before: segments(a), after: segments(b), unchanged: false };
}

/**
 * The diff pane of the sample's Changes area (M35.9 decision 26): the change's name (h2 of the pane), type, language
 * and status, then its fields released (left) against the draft (right), side by side or inline. Removed text is on
 * `--sf-danger-subtle`, added on `--sf-success-subtle`, and every line carries a − / + marker (and a screen-reader
 * word), so colour is never the only cue.
 */
@Component({
  selector: 'sf-sample-change-diff',
  standalone: true,
  imports: [NgTemplateOutlet, SfButtonComponent, SfIconComponent, SfSegmentedComponent, SfStatusComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-change-diff.component.html',
  styleUrl: './sample-change-diff.component.scss',
  host: { role: 'region', 'aria-labelledby': 'sample-diff-title' },
})
export class SampleChangeDiffComponent {
  readonly change = input.required<SampleChange>();
  readonly closed = output<void>();

  protected readonly t = injectSampleText('styleguide.sample.changes');
  private readonly notice = injectSampleNotice();
  protected readonly tones = CHANGE_STATUS_TONES;
  protected readonly statusIcons = CHANGE_STATUS_ICONS;
  protected readonly typeIcons = CHANGE_TYPE_ICONS;

  protected readonly layout = signal<'split' | 'inline'>('split');
  protected readonly layoutOptions = computed<SfSegmentedOption<'split' | 'inline'>[]>(() => [
    { value: 'split', label: this.t('diff.split'), icon: 'vertical_split', iconOnly: true },
    { value: 'inline', label: this.t('diff.inline'), icon: 'view_agenda', iconOnly: true },
  ]);

  protected readonly fields = computed(() => this.change().fields.map(diffField));
  protected readonly meta = computed(() => {
    const change = this.change();
    return [this.t(`types.${change.type}`), `${CHANGE_LANG_NAMES[change.lang]} (${change.lang.toUpperCase()})`].join(' · ');
  });

  protected open(): void {
    this.notice(this.t('diff.openNotice', { name: this.change().name }));
  }
}
