import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  Injector,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { ToastService } from '../../core/ui/toast.service';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import {
  firstSectionWithErrors,
  isSaveShortcut,
  sectionsEqual,
  sectionsOf,
  type CdlSection,
  type CdlSections,
} from '../../shared/code-editor/cdl-sections';
import { SfCdlSectionsEditorComponent } from '../../shared/components/sf-cdl-sections-editor.component';
import { SfUidRenameComponent } from '../../shared/components/sf-uid-rename.component';
import type { EditorDefinition } from '../forms/form.model';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { sortDiagnostics } from '../templates/inheritance.util';
import { DatasetRecordTemplatesComponent } from './dataset-record-templates.component';
import { DatasetTemplatesStore } from './dataset-templates.store';
import { ContentService, etagFor, type DatasetDetailView, type Diagnostic } from './content.service';
import { firstPositioned, recordTemplateErrorsOf, recordTemplatesForSave } from './record-template.util';

type BrokenRecordSet = components['schemas']['BrokenRecordSet'];

/** A dataset's CDL tabs: records have no bodies. */
const DATASET_SECTIONS: readonly CdlSection[] = ['content', 'rules'];

/**
 * A dataset in the Templates store (M19.4.1, M25.5.2): the CDL declaring every record's fields — a Content and a
 * Rules tab (M34) — with live validation (`kind=DATASET`, the restrictions the save enforces), the optional title
 * editor naming records, a description, the dataset's record count with a link to its records — and one
 * **record template** tab per channel beside it: the OCTL one record renders with wherever a record set is rendered
 * (`$CMS_VALUE(recordset:…)$`, a reference editor pointing at a set).
 *
 * <p>Schema and record templates save together, as one revision, so a renamed field and the template reading it
 * change at once. A rejected template keeps the edited source and shows its diagnostics in its tab; a save that
 * leaves set queries invalid lists those sets. Deleting is disabled while records exist — the server refuses it
 * too. Datasets are a developer's artifact: everyone else, and everyone in time travel, sees them read-only.
 */
@Component({
  selector: 'sf-dataset-schema-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    SfButtonComponent,
    SfCdlSectionsEditorComponent,
    SfFieldComponent,
    DatasetRecordTemplatesComponent,
    SfUidRenameComponent,
  ],
  providers: [DatasetTemplatesStore],
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
  private readonly timeTravel = inject(TimeTravelStore);
  private readonly injector = inject(Injector);

  private readonly store = inject(DatasetTemplatesStore);
  private readonly recordTemplatesPane = viewChild(DatasetRecordTemplatesComponent);

  protected readonly detail = this.store.detail;
  protected readonly displayName = signal('');
  protected readonly description = signal('');
  /** The CDL as edited (M34): content and rules; a dataset has no bodies. */
  protected readonly sections = this.store.sections;
  protected readonly savedSections = computed<CdlSections | null>(() => {
    const detail = this.detail();
    return detail ? sectionsOf(detail) : null;
  });
  protected readonly cdlTabs = DATASET_SECTIONS;
  protected readonly cdlTab = signal<CdlSection>('content');
  protected readonly cdlHints: Partial<Record<CdlSection, string>> = {
    content: 'Editors only — records have no bodies. Rename a field with renamedFrom and every record follows in one revision.',
    rules: 'Checks, required/read-only states and fills on the record fields: rule, state and fill entries.',
  };
  protected readonly titleEditor = signal('');
  protected readonly diagnostics = signal<Diagnostic[]>([]);
  protected readonly saving = signal(false);
  protected readonly validating = signal(false);
  /** The dataset's fields, for record template completion (M33). */
  protected readonly fieldNames = this.store.fieldNames;
  private validateTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly clearValidateTimer = inject(DestroyRef).onDestroy(() => {
    if (this.validateTimer) {
      clearTimeout(this.validateTimer);
    }
  });

  /** Sets whose stored query the last save left invalid (`brokenRecordSets`); dismissible. */
  protected readonly brokenRecordSets = signal<BrokenRecordSet[]>([]);

  protected readonly hasErrors = computed(() => this.diagnostics().some((d) => d.severity === 'ERROR'));

  protected readonly canEdit = inject(ProjectPermissionsStore).canEditTemplates;

  /** Whether the schema tab's fields differ from the stored dataset. */
  protected readonly schemaDirty = computed(() => {
    const d = this.detail();
    return (
      !!d &&
      (this.displayName() !== (d.displayName ?? '') ||
        this.description() !== (d.description ?? '') ||
        !sectionsEqual(this.sections(), sectionsOf(d)) ||
        this.titleEditor() !== (d.titleEditor ?? ''))
    );
  });

  /** Anything to save: schema fields or any record template. */
  protected readonly dirty = computed(() => this.schemaDirty() || this.store.dirtyChannels().size > 0);

  /** The title editor options: the stored schema's text editors (groups flattened). */
  protected readonly textEditors = computed<EditorDefinition[]>(() => {
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
    walk(this.store.savedEditors());
    return out;
  });

  protected readonly loopSnippet = computed(() => {
    const uid = this.detail()?.uid ?? 'dataset';
    const first = this.textEditors()[0]?.name ?? 'field';
    return `$CMS_FOR(item : dataset:${uid}, sort="${first}")$ $CMS_VALUE(item.${first})$ $CMS_END_FOR$`;
  });

  constructor() {
    this.store.bind(this.projectKey);

    effect(() => {
      const key = this.projectKey();
      const uuid = this.uuid();
      const revision = this.timeTravel.activeRevision();
      untracked(() => {
        this.store.selectedChannel.set(null);
        this.cdlTab.set('content');
        this.brokenRecordSets.set([]);
        this.load(key, uuid, revision);
      });
    });

    effect(() => {
      const key = this.projectKey();
      untracked(() => this.store.loadChannels(key));
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
  protected onSectionInput(change: { section: CdlSection; value: string }): void {
    this.sections.update((sections) => ({ ...sections, [change.section]: change.value }));
    if (this.validateTimer) {
      clearTimeout(this.validateTimer);
    }
    this.validateTimer = setTimeout(() => this.validate(), 400);
  }

  /** Ctrl+S / ⌘S saves the dataset (M34). */
  protected onKeydown(event: KeyboardEvent): void {
    if (isSaveShortcut(event)) {
      event.preventDefault();
      this.save();
    }
  }

  protected validate(): void {
    this.validating.set(true);
    this.content.validateCdl(this.projectKey(), this.sections()).subscribe({
      next: (res) => {
        this.validating.set(false);
        this.diagnostics.set(sortDiagnostics(res.diagnostics ?? []) as Diagnostic[]);
      },
      error: () => this.validating.set(false),
    });
  }

  protected dismissBrokenRecordSets(): void {
    this.brokenRecordSets.set([]);
  }

  /** Saves schema and record templates together: one request, one revision. */
  save(): void {
    const current = this.detail();
    if (!current?.uuid || !this.canEdit() || !this.dirty() || this.saving()) {
      return;
    }
    this.saving.set(true);
    this.brokenRecordSets.set([]);
    this.store.dropPendingCheck();
    this.content
      .updateDataset(
        this.projectKey(),
        current.uuid,
        {
          displayName: this.displayName(),
          contentCdl: this.sections().content,
          rulesCdl: this.sections().rules,
          titleEditor: this.titleEditor() || undefined,
          description: this.description(),
          channelTemplates: recordTemplatesForSave(this.store.recordTemplates()),
        },
        etagFor(current.revision ?? 0),
      )
      .subscribe({
        next: (saved) => {
          this.saving.set(false);
          this.apply(saved);
          this.store.recordTemplateDiagnostics.set(saved.recordTemplateDiagnostics ?? {});
          this.brokenRecordSets.set(saved.brokenRecordSets ?? []);
          const broken = saved.brokenRecordSets?.length ?? 0;
          this.toasts.show(
            broken > 0
              ? `Dataset saved — ${broken} record ${broken === 1 ? 'set needs' : 'sets need'} a query fix.`
              : 'Dataset saved',
            broken > 0 ? 'info' : 'success',
          );
          this.changed.emit();
        },
        error: (err: unknown) => {
          this.saving.set(false);
          this.showSaveError(err, current.uuid!);
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

  /**
   * A rejected save keeps every edit. Record template errors (`422` with `channel`) open the first failing
   * channel and put the caret on the error; schema errors show on their CDL tab, which opens.
   */
  private showSaveError(err: unknown, uuid: string): void {
    if (!(err instanceof HttpErrorResponse)) {
      this.toasts.show('Could not save the dataset — try again in a moment.', 'error');
      return;
    }
    const templateErrors = recordTemplateErrorsOf(err);
    if (templateErrors) {
      this.diagnostics.set([]);
      this.store.recordTemplateDiagnostics.update((all) => ({ ...all, ...templateErrors.byChannel }));
      this.store.selectedChannel.set(templateErrors.channel);
      this.revealFirstDiagnostic(templateErrors.byChannel[templateErrors.channel] ?? []);
      this.toasts.show(`The ${templateErrors.channel} record template has errors — nothing was saved.`, 'error');
      return;
    }
    const body = (err.error ?? {}) as { diagnostics?: Diagnostic[]; detail?: string };
    if (Array.isArray(body.diagnostics) && body.diagnostics.length > 0) {
      this.diagnostics.set(sortDiagnostics(body.diagnostics) as Diagnostic[]);
      const section = firstSectionWithErrors(body.diagnostics, DATASET_SECTIONS);
      if (section) {
        this.cdlTab.set(section);
      }
      this.toasts.show(`The schema has errors — see the ${section ?? 'content'} tab.`, 'error');
      return;
    }
    if (err.status === 409) {
      this.toasts.show('Someone else saved this dataset — reloading the current version.', 'error');
      this.load(this.projectKey(), uuid, null);
      return;
    }
    this.toasts.show(body.detail || 'Could not save the dataset — try again in a moment.', 'error');
  }

  /** After the tab switch renders, moves the caret to the first positioned diagnostic. */
  private revealFirstDiagnostic(diagnostics: readonly Diagnostic[]): void {
    const target = firstPositioned(diagnostics);
    if (!target?.line) {
      return;
    }
    afterNextRender(() => this.recordTemplatesPane()?.goTo(target), { injector: this.injector });
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
    this.sections.set(sectionsOf(detail));
    this.titleEditor.set(detail.titleEditor ?? '');
    this.store.resetTemplates(detail);
    this.diagnostics.set([]);
  }
}
