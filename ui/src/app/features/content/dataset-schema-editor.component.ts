import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthStore } from '../../core/auth/auth.store';
import { roleRank } from '../../core/auth/auth.guard';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { SfUidRenameComponent } from '../../shared/components/sf-uid-rename.component';
import type { ContentDefinition, EditorDefinition } from '../forms/form.model';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { ContentService, etagFor, type DatasetDetailView, type Diagnostic } from './content.service';

/**
 * A dataset schema in the Templates store (M19.4.1): the CDL declaring every record's fields, with
 * live validation (`kind=DATASET`, so a `body` is flagged exactly as the save would reject it), the
 * optional title editor naming records, a description, and the dataset's record count with a link
 * to its records. Deleting is disabled while records exist — the server refuses it too.
 *
 * <p>Schemas are a developer's artifact: everyone else, and everyone in time travel, sees it read-only.
 */
@Component({
  selector: 'sf-dataset-schema-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, SfButtonComponent, SfFieldComponent, SfUidRenameComponent],
  templateUrl: './dataset-schema-editor.component.html',
  styleUrl: './dataset-schema-editor.component.scss',
})
export class DatasetSchemaEditorComponent {
  readonly projectKey = input.required<string>();
  readonly uuid = input.required<string>();

  /** Saved, renamed or deleted: the templates tree should reload. */
  readonly changed = output<void>();
  readonly deleted = output<void>();

  private readonly content = inject(ContentService);
  private readonly toasts = inject(ToastService);
  private readonly auth = inject(AuthStore);
  private readonly timeTravel = inject(TimeTravelStore);

  protected readonly detail = signal<DatasetDetailView | null>(null);
  protected readonly displayName = signal('');
  protected readonly description = signal('');
  protected readonly contentDefinition = signal('');
  protected readonly titleEditor = signal('');
  protected readonly diagnostics = signal<Diagnostic[]>([]);
  protected readonly saving = signal(false);
  protected readonly validating = signal(false);
  private validateTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly hasErrors = computed(() => this.diagnostics().some((d) => d.severity === 'ERROR'));

  protected readonly canEdit = computed(
    () => !this.timeTravel.isTimeTravel() && roleRank(this.auth.roleFor(this.projectKey())) >= roleRank('DEVELOPER'),
  );

  /** The title editor options: the stored schema's text editors (groups flattened). */
  protected readonly textEditors = computed<EditorDefinition[]>(() => {
    const definition = this.detail()?.compiledDefinition as unknown as ContentDefinition | undefined;
    const out: EditorDefinition[] = [];
    const walk = (editors: EditorDefinition[] | undefined) => {
      for (const editor of editors ?? []) {
        if (editor.type === 'GROUP') {
          walk(editor.items);
        } else if (editor.type === 'TEXT') {
          out.push(editor);
        }
      }
    };
    walk(definition?.editors);
    return out;
  });

  protected readonly loopSnippet = computed(() => {
    const uid = this.detail()?.uid ?? 'dataset';
    const first = this.textEditors()[0]?.name ?? 'field';
    return `$CMS_FOR(item : dataset:${uid}, sort="${first}")$ $CMS_VALUE(item.${first})$ $CMS_END_FOR$`;
  });

  constructor() {
    effect(() => {
      const key = this.projectKey();
      const uuid = this.uuid();
      const revision = this.timeTravel.activeRevision();
      untracked(() => this.load(key, uuid, revision));
    });
  }

  protected onNameInput(event: Event): void {
    this.displayName.set((event.target as HTMLInputElement).value);
  }

  protected onDescriptionInput(event: Event): void {
    this.description.set((event.target as HTMLTextAreaElement).value);
  }

  protected onTitleEditorChange(event: Event): void {
    this.titleEditor.set((event.target as HTMLSelectElement).value);
  }

  /** Live validation while typing, debounced; the same restrictions the save enforces. */
  protected onCdlInput(event: Event): void {
    this.contentDefinition.set((event.target as HTMLTextAreaElement).value);
    if (this.validateTimer) {
      clearTimeout(this.validateTimer);
    }
    this.validateTimer = setTimeout(() => this.validate(), 400);
  }

  protected validate(): void {
    this.validating.set(true);
    this.content.validateCdl(this.projectKey(), this.contentDefinition()).subscribe({
      next: (res) => {
        this.validating.set(false);
        this.diagnostics.set(res.diagnostics ?? []);
      },
      error: () => this.validating.set(false),
    });
  }

  protected save(): void {
    const current = this.detail();
    if (!current?.uuid || !this.canEdit()) {
      return;
    }
    this.saving.set(true);
    this.content
      .updateDataset(
        this.projectKey(),
        current.uuid,
        {
          displayName: this.displayName(),
          contentDefinition: this.contentDefinition(),
          titleEditor: this.titleEditor() || undefined,
          description: this.description(),
        },
        etagFor(current.revision ?? 0),
      )
      .subscribe({
        next: (saved) => {
          this.saving.set(false);
          this.apply(saved);
          this.toasts.show('Dataset saved', 'success');
          this.changed.emit();
        },
        error: (err: unknown) => {
          this.saving.set(false);
          if (err instanceof HttpErrorResponse) {
            const body = (err.error ?? {}) as { diagnostics?: Diagnostic[]; detail?: string };
            if (Array.isArray(body.diagnostics) && body.diagnostics.length > 0) {
              this.diagnostics.set(body.diagnostics);
              this.toasts.show('The schema has errors — see the diagnostics below.', 'error');
              return;
            }
            if (err.status === 409) {
              this.toasts.show('Someone else saved this dataset — reloading the current version.', 'error');
              this.load(this.projectKey(), current.uuid!, null);
              return;
            }
            if (body.detail) {
              this.toasts.show(body.detail, 'error');
              return;
            }
          }
          this.toasts.show('Could not save the dataset — try again in a moment.', 'error');
        },
      });
  }

  protected remove(): void {
    const current = this.detail();
    if (!current?.uuid || !this.canEdit() || (current.recordCount ?? 0) > 0) {
      return;
    }
    if (!window.confirm(`Delete the dataset "${current.displayName ?? current.uid}"?`)) {
      return;
    }
    this.content.deleteDataset(this.projectKey(), current.uuid).subscribe({
      next: () => {
        this.toasts.show('Dataset deleted', 'success');
        this.deleted.emit();
      },
      error: (err: unknown) => {
        const body = err instanceof HttpErrorResponse ? ((err.error ?? {}) as { recordCount?: number }) : {};
        this.toasts.show(
          body.recordCount
            ? `The dataset still has ${body.recordCount} records — delete them first.`
            : 'Could not delete the dataset — a template may still loop it.',
          'error',
        );
      },
    });
  }

  protected onUidChanged(): void {
    this.load(this.projectKey(), this.uuid(), this.timeTravel.activeRevision());
    this.changed.emit();
  }

  private load(projectKey: string, uuid: string, revision: number | null): void {
    if (!projectKey || !uuid) {
      return;
    }
    this.content.getDataset(projectKey, uuid, revision).subscribe({
      next: (detail) => this.apply(detail),
      error: () => this.toasts.show('Could not load the dataset — try again in a moment.', 'error'),
    });
  }

  private apply(detail: DatasetDetailView): void {
    this.detail.set(detail);
    this.displayName.set(detail.displayName ?? '');
    this.description.set(detail.description ?? '');
    this.contentDefinition.set(detail.contentDefinition ?? '');
    this.titleEditor.set(detail.titleEditor ?? '');
    this.diagnostics.set([]);
  }
}
