import {
  ChangeDetectionStrategy,
  Component,
  effect,
  forwardRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { ApiClient } from '../../../core/api/api.client';
import { SF_FORM_CONTEXT } from '../../forms/form.context';
import {
  ContentDefinition,
  EditorDefinition,
} from '../../forms/form.model';
import {
  READONLY_EDITOR_TYPES,
  resolveEditor,
  resolveObjectEditorPrefix,
  valueAtPath,
} from './resolve-editor';
import { matchSections, SectionDiff, SectionStatus } from './body-diff.util';
import { toRenderedChange, RenderedChange } from './field-diff.model';
import { SfFieldDiffComponent } from './field-diff.component';
import type { components } from '../../../core/api/generated/schema.d.ts';

type FieldChange = components['schemas']['FieldChange'];

interface RenderedSection extends SectionDiff {
  templateRef: string;
  def: ContentDefinition | null;
  fieldChanges: RenderedChange[];
}

const STATUS_LABEL: Record<SectionStatus, string> = {
  added: 'Section added',
  removed: 'Section removed',
  moved: 'Moved',
  unchanged: 'Changed',
};

/**
 * Renders the diff of a page body's section array (`bodies.<name>`), which the
 * server reports as a single whole-array change. Sections are aligned by
 * `instanceId` (added / removed / moved), and sections present on both sides
 * have their `content` field-diffed with the section template's editors.
 */
@Component({
  selector: 'sf-body-diff',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfFieldDiffComponent],
  providers: [
    {
      provide: SF_FORM_CONTEXT,
      useFactory: () => {
        const host = inject(forwardRef(() => SfBodyDiffComponent));
        return {
          formValue: () => ({}),
          projectKey: host.projectKey,
        };
      },
    },
  ],
  templateUrl: './body-diff.component.html',
  styleUrl: './body-diff.component.scss',
})
export class SfBodyDiffComponent {
  private readonly api = inject(ApiClient);

  readonly change = input.required<FieldChange>();
  readonly projectKey = input.required<string>();

  protected readonly sections = signal<RenderedSection[]>([]);
  protected readonly loading = signal(false);

  protected readonly STATUS_LABEL = STATUS_LABEL;

  private definitions = new Map<string, ContentDefinition | null>();

  constructor() {
    effect(
      () => {
        const key = this.projectKey();
        const change = this.change();
        if (!key || !change) {
          return;
        }
        this.resolve(key, change);
      },
      { allowSignalWrites: true },
    );
  }

  private resolve(key: string, change: FieldChange): void {
    this.loading.set(true);
    this.sections.set([]);
    this.definitions.clear();

    const raw = matchSections(change.before, change.after);
    const refs = new Set(raw.map((s) => s.templateRef).filter((r) => r.length > 0));

    const missing = [...refs].filter((ref) => !this.definitions.has(ref));
    if (missing.length === 0) {
      this.sections.set(this.buildSections(raw));
      this.loading.set(false);
      return;
    }

    let pending = missing.length;
    for (const ref of missing) {
      this.api.sectionTemplateDetail(key, ref).subscribe({
        next: (td) => {
          this.definitions.set(ref, (td.compiledDefinition ?? null) as ContentDefinition | null);
          if (--pending === 0) {
            this.sections.set(this.buildSections(raw));
            this.loading.set(false);
          }
        },
        error: () => {
          this.definitions.set(ref, null);
          if (--pending === 0) {
            this.sections.set(this.buildSections(raw));
            this.loading.set(false);
          }
        },
      });
    }
  }

  /** Renders sections and hides those with no content changes (unchanged position, empty field diff). */
  private buildSections(raw: SectionDiff[]): RenderedSection[] {
    return raw
      .map((s) => this.renderSection(s))
      .filter((s) => s.status !== 'unchanged' || s.fieldChanges.length > 0);
  }

  private renderSection(section: SectionDiff): RenderedSection {
    const def = this.definitions.get(section.templateRef) ?? null;
    const fieldChanges: RenderedChange[] = [];
    const objectGroups = new Map<
      string,
      { editor: EditorDefinition; segments: string[]; before?: unknown; after?: unknown }
    >();

    for (const c of section.changes) {
      const editor = def ? resolveEditor(def, c.path) : null;
      const usable = editor && READONLY_EDITOR_TYPES.has(editor.type);
      if (usable) {
        const change: FieldChange = {
          path: c.path,
          before: c.before as never,
          after: c.after as never,
          add: c.add,
          remove: c.remove,
        };
        fieldChanges.push(toRenderedChange(change, editor));
        continue;
      }
      const prefix = def ? resolveObjectEditorPrefix(def, c.path) : null;
      if (prefix) {
        const groupKey = prefix.segments.join('.');
        if (!objectGroups.has(groupKey)) {
          objectGroups.set(groupKey, {
            editor: prefix.editor,
            segments: prefix.segments,
            before: valueAtPath(section.beforeContent, prefix.segments),
            after: valueAtPath(section.afterContent, prefix.segments),
          });
        }
        continue;
      }
      const change: FieldChange = {
        path: c.path,
        before: c.before as never,
        after: c.after as never,
        add: c.add,
        remove: c.remove,
      };
      fieldChanges.push(toRenderedChange(change, null));
    }

    for (const { editor, segments, before, after } of objectGroups.values()) {
      const change: FieldChange = {
        path: segments.join('.'),
        before: before as never,
        after: after as never,
        add: before == null,
        remove: after == null,
      };
      fieldChanges.push(toRenderedChange(change, editor));
    }

    return { ...section, templateRef: section.templateRef, def, fieldChanges };
  }
}
