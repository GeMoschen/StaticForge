import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { ToastService } from '../../core/ui/toast.service';
import {
  CODE_FORMATS,
  CODE_FORMAT_LABELS,
  CodeFormat,
  normalizeExtension,
  normalizeMimeType,
} from '../../shared/code-editor/code-format';
import { SfButtonComponent } from '../../shared/components/sf-button.component';

type CodeHighlightingView = components['schemas']['CodeHighlightingView'];
type ProjectDetail = components['schemas']['ProjectDetail'];

/** One override as edited: a file extension or a MIME type, and the format it's highlighted as. */
interface OverrideRow {
  id: number;
  kind: 'EXTENSION' | 'MIME';
  key: string;
  format: CodeFormat;
}

const EXTENSION = /^[a-z0-9]{1,10}$/;
const MIME_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/;

let nextRowId = 0;

function rowsOf(view: CodeHighlightingView | null | undefined): OverrideRow[] {
  const rows: OverrideRow[] = [];
  for (const [key, format] of Object.entries(view?.extensions ?? {})) {
    rows.push({ id: nextRowId++, kind: 'EXTENSION', key, format: format as CodeFormat });
  }
  for (const [key, format] of Object.entries(view?.mimeTypes ?? {})) {
    rows.push({ id: nextRowId++, kind: 'MIME', key, format: format as CodeFormat });
  }
  return rows;
}

/** What a row's key is wrong about, or `null`. */
function problemOf(row: OverrideRow, rows: readonly OverrideRow[]): string | null {
  const key = row.kind === 'EXTENSION' ? normalizeExtension(row.key) : normalizeMimeType(row.key);
  if (!key) {
    return row.kind === 'EXTENSION' ? 'Enter an extension.' : 'Enter a MIME type.';
  }
  if (row.kind === 'EXTENSION' ? !EXTENSION.test(key) : !MIME_TYPE.test(key)) {
    return row.kind === 'EXTENSION' ? 'Use 1–10 lower-case letters or digits.' : 'Use type/subtype, e.g. text/x-template.';
  }
  const normalize = (r: OverrideRow) => (r.kind === 'EXTENSION' ? normalizeExtension(r.key) : normalizeMimeType(r.key));
  if (rows.some((other) => other.id !== row.id && other.kind === row.kind && normalize(other) === key && other.id < row.id)) {
    return 'Listed twice.';
  }
  return null;
}

/**
 * The project's code highlighting overrides (M33 follow-up), on the General tab: which format the code editors
 * highlight a file extension or MIME type as. They apply to processed text media and to templates of channels whose
 * "Highlight as" is Auto, before the built-in detection; an extension entry wins over a MIME entry.
 */
@Component({
  selector: 'sf-project-settings-code-highlighting',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfButtonComponent],
  templateUrl: './project-settings-code-highlighting.component.html',
  styleUrl: './project-settings-code-highlighting.component.scss',
})
export class ProjectSettingsCodeHighlightingComponent {
  readonly projectKey = input.required<string>();
  /** The overrides the server holds. */
  readonly overrides = input<CodeHighlightingView | null | undefined>(null);
  /** The project after a save, for the host to refresh its context. */
  readonly saved = output<ProjectDetail>();

  private readonly api = inject(ApiClient);
  private readonly toast = inject(ToastService);
  protected readonly readOnly = inject(ProjectAccessStore).readOnly;

  protected readonly formats = CODE_FORMATS.map((format) => ({ value: format, label: CODE_FORMAT_LABELS[format] }));
  protected readonly rows = signal<OverrideRow[]>([]);
  protected readonly saving = signal(false);
  protected readonly serverErrors = signal<string[]>([]);
  private readonly stored = signal<CodeHighlightingView>({ extensions: {}, mimeTypes: {} });

  protected readonly problems = computed(() => {
    const rows = this.rows();
    return new Map(rows.map((row) => [row.id, problemOf(row, rows)]));
  });
  protected readonly valid = computed(() => [...this.problems().values()].every((problem) => problem === null));
  protected readonly changed = computed(() => JSON.stringify(this.body()) !== JSON.stringify(this.stored()));

  constructor() {
    effect(() => {
      const view = this.overrides();
      untracked(() => this.reset(view));
    });
  }

  protected add(kind: OverrideRow['kind']): void {
    this.rows.update((rows) => [...rows, { id: nextRowId++, kind, key: '', format: 'HTML' }]);
  }

  protected remove(id: number): void {
    this.rows.update((rows) => rows.filter((row) => row.id !== id));
  }

  protected setKey(id: number, event: Event): void {
    const key = (event.target as HTMLInputElement).value;
    this.rows.update((rows) => rows.map((row) => (row.id === id ? { ...row, key } : row)));
  }

  protected setFormat(id: number, event: Event): void {
    const format = (event.target as HTMLSelectElement).value as CodeFormat;
    this.rows.update((rows) => rows.map((row) => (row.id === id ? { ...row, format } : row)));
  }

  protected save(): void {
    if (!this.valid() || !this.changed() || this.saving() || this.readOnly()) {
      return;
    }
    this.saving.set(true);
    this.serverErrors.set([]);
    this.api.updateCodeHighlighting(this.projectKey(), this.body()).subscribe({
      next: (project) => {
        this.saving.set(false);
        this.reset(project.codeHighlighting);
        this.toast.show('Code highlighting saved', 'success');
        this.saved.emit(project);
      },
      error: (error: unknown) => {
        this.saving.set(false);
        const errors = error instanceof HttpErrorResponse ? (error.error?.errors as string[] | undefined) : undefined;
        if (errors?.length) {
          this.serverErrors.set(errors);
        } else {
          this.toast.show('Could not save the code highlighting — try again in a moment.', 'error');
        }
      },
    });
  }

  private reset(view: CodeHighlightingView | null | undefined): void {
    const rows = rowsOf(view);
    this.rows.set(rows);
    this.stored.set(this.bodyOf(rows));
    this.serverErrors.set([]);
  }

  private body(): CodeHighlightingView {
    return this.bodyOf(this.rows());
  }

  private bodyOf(rows: readonly OverrideRow[]): CodeHighlightingView {
    const extensions: Record<string, string> = {};
    const mimeTypes: Record<string, string> = {};
    for (const row of rows) {
      if (row.kind === 'EXTENSION') {
        extensions[normalizeExtension(row.key) ?? ''] = row.format;
      } else {
        mimeTypes[normalizeMimeType(row.key) ?? ''] = row.format;
      }
    }
    return { extensions, mimeTypes };
  }
}
