import {
  ChangeDetectionStrategy,
  Component,
  effect,
  forwardRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormArray, FormControl, FormGroup } from '@angular/forms';
import { ContentDefinition, EditorDefinition } from './form.model';
import { SfEditorOutlet } from './editor-outlet.component';
import { SF_FORM_CONTEXT, SfFormContext } from './form.context';

/**
 * Host component of the CDL-driven dynamic form engine. Renders the top-level
 * editors (flattening GROUPs by delegating their items to {@link SfGroupEditor},
 * and expanding LIST rows inside {@link SfListEditor}) via {@link SfEditorOutlet}.
 *
 * Provides the shared {@link SF_FORM_CONTEXT} so nested editors can reactively
 * evaluate their own `visibleWhen` expressions and resolve the project key.
 */
@Component({
  selector: 'sf-content-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfEditorOutlet],
  providers: [
    {
      provide: SF_FORM_CONTEXT,
      useFactory: () => {
        const host = inject(forwardRef(() => SfContentFormComponent));
        return {
          formValue: host.formValue,
          projectKey: host.projectKey,
        } satisfies SfFormContext;
      },
    },
  ],
  templateUrl: './sf-content-form.component.html',
  styleUrl: './sf-content-form.component.scss',
})
export class SfContentFormComponent {
  readonly definition = input.required<ContentDefinition>();
  readonly formGroup = input.required<FormGroup>();
  readonly projectKey = input<string>();
  /**
   * Server validation findings (`ContentIssue`s) to show under the editor they belong to. Paths are
   * rooted at `issuePrefix` (`content.name`, `content.links[0].target`); a finding inside a list row
   * or a group member is shown under its top-level editor.
   */
  readonly issues = input<ReadonlyArray<{ path?: string; message?: string }>>([]);
  readonly issuePrefix = input<string>('content');

  readonly formValue = signal<Record<string, unknown>>({});

  constructor() {
    effect(
      (onCleanup) => {
        const form = this.formGroup();
        const update = () => this.formValue.set(form.getRawValue() as Record<string, unknown>);
        update();
        const subscription = form.valueChanges.subscribe(update);
        onCleanup(() => subscription.unsubscribe());
      },
      { allowSignalWrites: true },
    );
  }

  /** The messages of every issue under `editor` (or, for a group, under any of its members). */
  issuesFor(editor: EditorDefinition): string[] {
    const names = new Set<string>();
    const collect = (e: EditorDefinition) => {
      names.add(e.name);
      if (e.type === 'GROUP') {
        (e.items ?? []).forEach(collect);
      }
    };
    collect(editor);
    const prefix = this.issuePrefix() ? `${this.issuePrefix()}.` : '';
    return this.issues()
      .filter((issue) => {
        const path = issue.path ?? '';
        if (!path.startsWith(prefix)) {
          return false;
        }
        const head = path.slice(prefix.length).split(/[.[]/)[0];
        return names.has(head);
      })
      .map((issue) => issue.message ?? '');
  }

  controlFor(editor: EditorDefinition): FormControl | FormGroup | FormArray {
    return this.formGroup().get(editor.name) as FormControl | FormGroup | FormArray;
  }
}
