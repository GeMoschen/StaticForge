import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { ReactiveFormsModule, FormArray, FormControl, FormGroup } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfBadgeComponent } from '../../../shared/components/display/sf-badge.component';
import { SfFindingComponent, SfFindingLevel } from '../../../shared/components/forms/sf-finding.component';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { sfUniqueId } from '../../../shared/components/forms/sf-field-context';
import { SfEditorBase } from '../editor-base';
import { SfEditorOutlet } from '../editor-outlet.component';
import { EditorDefinition } from '../form.model';

/** How many member values the closed group's summary line shows. */
const SUMMARY_VALUES = 2;

const LEVEL_RANK: Readonly<Record<SfFindingLevel, number>> = { error: 0, warning: 1, info: 2, hint: 3 };

/**
 * The GROUP editor (M35.17): related fields in a bordered panel under a collapsible header — a disclosure button
 * (`aria-expanded`) with the group's name and, while it is closed, a **summary line** of the first filled values inside, so a
 * closed group still tells what is in it. Opens expanded. The members render through the outlet (their own `visibleWhen`,
 * languages and editors); the findings of any member show under the header, because members render no chrome of their own.
 */
@Component({
  selector: 'sf-group-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, SfEditorOutlet, SfIconComponent, SfBadgeComponent, SfFindingComponent, TranslocoPipe],
  templateUrl: './group-editor.component.html',
  styleUrl: './group-editor.component.scss',
})
export class SfGroupEditor extends SfEditorBase<FormGroup> {
  protected readonly bodyId = sfUniqueId('sf-group-body');
  readonly expanded = signal(true);

  /** The findings of the group's members, most severe first. */
  protected readonly findings = computed(() => [...this.fieldFindings()].sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]));

  /** What the closed group shows after its name: the first filled values of its members, joined. */
  readonly summary = computed(() => {
    this.changes();
    const values: string[] = [];
    for (const item of this.definition().items ?? []) {
      const text = this.textOf(this.control().get(item.name)?.value);
      if (text) {
        values.push(text);
      }
      if (values.length === SUMMARY_VALUES) {
        break;
      }
    }
    return values.join(' · ');
  });

  controlFor(item: EditorDefinition): FormControl | FormGroup | FormArray {
    return this.control().get(item.name) as FormControl | FormGroup | FormArray;
  }

  protected toggle(): void {
    this.expanded.update((open) => !open);
  }

  private textOf(value: unknown): string {
    if (typeof value === 'number') {
      return String(value);
    }
    if (typeof value !== 'string') {
      return '';
    }
    return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
}
