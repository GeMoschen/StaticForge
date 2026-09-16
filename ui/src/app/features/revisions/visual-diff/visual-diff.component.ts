import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  forwardRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { forkJoin } from 'rxjs';
import { ApiClient } from '../../../core/api/api.client';
import { SF_FORM_CONTEXT } from '../../forms/form.context';
import { ContentDefinition } from '../../forms/form.model';
import {
  READONLY_EDITOR_TYPES,
  resolveEditor,
  resolveObjectEditorPrefix,
  valueAtPath,
} from './resolve-editor';
import { toRenderedChange, RenderedChange } from './field-diff.model';
import { SfFieldDiffComponent } from './field-diff.component';
import { SfBodyDiffComponent } from './body-diff.component';
import type { components } from '../../../core/api/generated/schema.d.ts';

type AssetDiff = components['schemas']['AssetDiff'];
type FieldChange = components['schemas']['FieldChange'];

/**
 * Renders one asset's revision diff using the form editors for saved content
 * values: each resolvable `content.*` field is shown side-by-side as a
 * read-only editor (before | after). Page-body changes (`bodies.*`) are
 * delegated to {@link SfBodyDiffComponent}. Object-typed editors (reference,
 * link, media, catalog) are rendered whole — the server differ recurses into
 * their value and emits sub-paths, so we re-read the full field from the
 * before/after payloads. Fields that can't be mapped to an editor fall back to
 * a structured JSON view.
 */
@Component({
  selector: 'sf-visual-diff',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfFieldDiffComponent, SfBodyDiffComponent],
  providers: [
    {
      provide: SF_FORM_CONTEXT,
      useFactory: () => {
        const host = inject(forwardRef(() => SfVisualDiffComponent));
        return {
          formValue: () => ({}),
          projectKey: host.projectKey,
        };
      },
    },
  ],
  templateUrl: './visual-diff.component.html',
  styleUrl: './visual-diff.component.scss',
})
export class SfVisualDiffComponent {
  private readonly api = inject(ApiClient);

  readonly asset = input.required<AssetDiff>();
  readonly projectKey = input.required<string>();
  readonly revisionId = input.required<number>();

  protected readonly definition = signal<ContentDefinition | null>(null);
  protected readonly changes = signal<RenderedChange[]>([]);
  protected readonly bodyChanges = signal<FieldChange[]>([]);
  protected readonly loading = signal(false);
  protected readonly empty = computed(
    () => this.changes().length === 0 && this.bodyChanges().length === 0,
  );

  constructor() {
    effect(
      () => {
        const key = this.projectKey();
        const asset = this.asset();
        const revision = this.revisionId();
        if (!key || !asset || !revision) {
          return;
        }
        this.resolve(key, asset, revision);
      },
      { allowSignalWrites: true },
    );
  }

  private resolve(key: string, asset: AssetDiff, revision: number): void {
    this.loading.set(true);
    this.definition.set(null);
    this.changes.set([]);
    this.bodyChanges.set([]);

    // Only pages carry persisted content values mapped to a content definition.
    if (asset.type !== 'PAGE') {
      this.render(asset.changes ?? [], null, null, null);
      this.loading.set(false);
      return;
    }

    const after$ = this.api.assetVersion(key, asset.uuid ?? '', revision);
    const before$ = this.api.assetVersion(key, asset.uuid ?? '', revision - 1);

    forkJoin({ after: after$, before: before$ }).subscribe({
      next: ({ after, before }) => {
        const afterPayload = (after.payload ?? {}) as Record<string, unknown>;
        const beforePayload = (before.payload ?? {}) as Record<string, unknown>;
        const templateRef = afterPayload['templateRef'];
        if (typeof templateRef !== 'string' || !templateRef) {
          this.render(asset.changes ?? [], null, beforePayload, afterPayload);
          this.loading.set(false);
          return;
        }
        this.api.templateDetail(key, templateRef).subscribe({
          next: (td) => {
            const def = (td.effectiveDefinition ?? td.compiledDefinition ?? null) as ContentDefinition | null;
            this.render(asset.changes ?? [], def, beforePayload, afterPayload);
            this.loading.set(false);
          },
          error: () => {
            this.render(asset.changes ?? [], null, beforePayload, afterPayload);
            this.loading.set(false);
          },
        });
      },
      error: () => {
        this.render(asset.changes ?? [], null, null, null);
        this.loading.set(false);
      },
    });
  }

  private render(
    changes: FieldChange[],
    definition: ContentDefinition | null,
    beforePayload: Record<string, unknown> | null,
    afterPayload: Record<string, unknown> | null,
  ): void {
    this.definition.set(definition);
    const bodyChanges: FieldChange[] = [];
    const fieldChanges: RenderedChange[] = [];
    const objectGroups = new Map<
      string,
      {
        editor: NonNullable<RenderedChange['editor']>;
        segments: string[];
        before?: unknown;
        after?: unknown;
      }
    >();

    for (const change of changes) {
      const path = change.path ?? '';
      if (path.startsWith('bodies.')) {
        bodyChanges.push(change);
        continue;
      }
      const editor = definition ? resolveEditor(definition, path) : null;
      const usable = editor && READONLY_EDITOR_TYPES.has(editor.type);
      if (usable) {
        fieldChanges.push(toRenderedChange(change, editor));
        continue;
      }
      // Object-typed editor whose value the server recursed into (sub-path change).
      const prefix = definition
        ? resolveObjectEditorPrefix(definition, path)
        : null;
      if (prefix) {
        const groupKey = prefix.segments.join('.');
        if (!objectGroups.has(groupKey)) {
          objectGroups.set(groupKey, {
            editor: prefix.editor,
            segments: prefix.segments,
            before: beforePayload
              ? valueAtPath(beforePayload, prefix.segments)
              : undefined,
            after: afterPayload
              ? valueAtPath(afterPayload, prefix.segments)
              : undefined,
          });
        }
        continue;
      }
      fieldChanges.push(toRenderedChange(change, null));
    }

    for (const { editor, segments, before, after } of objectGroups.values()) {
      const change: FieldChange = {
        path: 'content.' + segments.join('.'),
        before: before as never,
        after: after as never,
        add: before == null,
        remove: after == null,
      };
      fieldChanges.push(toRenderedChange(change, editor));
    }

    this.changes.set(fieldChanges);
    this.bodyChanges.set(bodyChanges);
  }
}
