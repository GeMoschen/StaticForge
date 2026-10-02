import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { PageEditorSectionsService } from './page-editor-sections.service';
import { FIELDS_SELECTION, bodySelection, revealCard } from './page-editor-targets';
import { PageEditorStore } from './page-editor.store';
import { locateField } from './page-issues.util';

/** The level an outline entry shows: the most serious finding in it. */
type OutlineLevel = 'error' | 'warning' | 'info' | 'hint';

const LEVEL_OF: Readonly<Record<string, OutlineLevel>> = { ERROR: 'error', WARNING: 'warning', INFO: 'info', HINT: 'hint' };
const LEVEL_ICON: Readonly<Record<OutlineLevel, string>> = { error: 'error', warning: 'warning', info: 'info', hint: 'lightbulb' };
const LEVEL_RANK: Readonly<Record<OutlineLevel, number>> = { error: 0, warning: 1, info: 2, hint: 3 };

/** One entry of the outline: the page fields, a body, or a section of a body. */
interface OutlineRow {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  /** A section: indented, and the one Alt+↑/↓ moves. */
  readonly section: { readonly body: string; readonly index: number; readonly count: number } | null;
  readonly level: OutlineLevel | null;
}

/**
 * The page editor's outline (M35.18): the page fields, each body and its sections as one list beside the form. Choosing an
 * entry selects it and scrolls the form to its card; an entry with findings carries the level of the most serious one (in
 * words for screen readers); a section is moved with **Alt+↑ / Alt+↓** (announced). It is a listbox with a roving focus:
 * ↑ ↓ move the focus, Home / End jump, Enter or a click chooses.
 */
@Component({
  selector: 'sf-page-editor-outline',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfIconComponent, TranslocoPipe],
  styleUrl: './page-editor-outline.component.scss',
  template: `
    <nav class="outline" [attr.aria-label]="'pages.editor.outline.heading' | transloco">
      <p class="outline__heading" id="page-editor-outline-heading">{{ 'pages.editor.outline.heading' | transloco }}</p>
      <ul class="outline__list" role="listbox" aria-labelledby="page-editor-outline-heading">
        @for (row of rows(); track row.id; let i = $index) {
          <li
            role="option"
            class="outline__row"
            [class.is-section]="!!row.section"
            [class.is-selected]="editor.selected() === row.id"
            [id]="'page-editor-outline-' + row.id"
            [attr.data-sf-outline]="row.id"
            [attr.aria-selected]="editor.selected() === row.id"
            [attr.aria-keyshortcuts]="row.section && !editor.readOnly() ? 'Alt+ArrowUp Alt+ArrowDown' : null"
            [attr.tabindex]="tabStop() === row.id ? 0 : -1"
            (click)="select(row)"
            (focus)="tabbable.set(row.id)"
            (keydown)="onKeydown($event, row, i)"
          >
            <sf-icon class="outline__icon" [name]="row.icon" />
            <span class="outline__label">{{ row.label }}</span>
            @if (row.level; as level) {
              <sf-icon class="outline__issue is-{{ level }}" [name]="icons[level]" />
              <span class="sf-sr-only">{{ 'pages.issues.levels.' + level | transloco }}</span>
            }
          </li>
        }
      </ul>
      @if (!editor.readOnly()) {
        <p class="outline__hint">{{ 'pages.editor.outline.hint' | transloco }}</p>
      }
      <span class="sf-sr-only" aria-live="polite">{{ announcement() }}</span>
    </nav>
  `,
})
export class PageEditorOutlineComponent {
  protected readonly editor = inject(PageEditorStore);
  private readonly sections = inject(PageEditorSectionsService);
  private readonly transloco = inject(TranslocoService);

  protected readonly icons = LEVEL_ICON;
  protected readonly announcement = signal('');
  /** The row that holds the tab stop (the roving focus). */
  protected readonly tabbable = signal<string>(FIELDS_SELECTION);

  /** The most serious finding level per outline entry. */
  private readonly levels = computed(() => {
    const levels = new Map<string, OutlineLevel>();
    const note = (id: string, severity: string | null | undefined) => {
      const level = LEVEL_OF[severity ?? ''] ?? 'warning';
      const known = levels.get(id);
      if (!known || LEVEL_RANK[level] < LEVEL_RANK[known]) {
        levels.set(id, level);
      }
    };
    for (const issue of this.editor.shownIssues()) {
      const at = locateField(issue.path);
      if (at?.scope === 'page') {
        note(FIELDS_SELECTION, issue.severity);
      } else if (at?.scope === 'section') {
        const instanceId = this.editor.sectionsFor(at.body)[at.index]?.instanceId;
        if (instanceId) {
          note(instanceId, issue.severity);
        }
      }
    }
    return levels;
  });

  /** The row that is in the tab order: the one last focused or chosen, else the first. */
  protected readonly tabStop = computed(() => {
    const rows = this.rows();
    return rows.some((row) => row.id === this.tabbable()) ? this.tabbable() : (rows[0]?.id ?? null);
  });

  protected readonly rows = computed<OutlineRow[]>(() => {
    const levels = this.levels();
    const rows: OutlineRow[] = [];
    if ((this.editor.contentDefinition()?.editors.length ?? 0) > 0) {
      rows.push({
        id: FIELDS_SELECTION,
        label: this.transloco.translate('pages.editor.outline.fields'),
        icon: 'description',
        section: null,
        level: levels.get(FIELDS_SELECTION) ?? null,
      });
    }
    for (const body of this.editor.bodies()) {
      rows.push({ id: bodySelection(body.name), label: body.label ?? body.name, icon: 'view_agenda', section: null, level: null });
      const list = this.editor.sectionsFor(body.name);
      list.forEach((section, index) =>
        rows.push({
          id: section.instanceId,
          label: this.sections.title(section.templateRef),
          icon: 'widgets',
          section: { body: body.name, index, count: list.length },
          level: levels.get(section.instanceId) ?? null,
        }),
      );
    }
    return rows;
  });

  protected select(row: OutlineRow): void {
    this.editor.selected.set(row.id);
    this.tabbable.set(row.id);
    revealCard(row.id);
  }

  protected onKeydown(event: KeyboardEvent, row: OutlineRow, index: number): void {
    const rows = this.rows();
    if (event.altKey && row.section && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      this.moveSection(row, event.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.focusRow(rows[Math.min(rows.length - 1, index + 1)]);
        return;
      case 'ArrowUp':
        event.preventDefault();
        this.focusRow(rows[Math.max(0, index - 1)]);
        return;
      case 'Home':
        event.preventDefault();
        this.focusRow(rows[0]);
        return;
      case 'End':
        event.preventDefault();
        this.focusRow(rows[rows.length - 1]);
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.select(row);
        return;
    }
  }

  private focusRow(row: OutlineRow | undefined): void {
    if (!row) {
      return;
    }
    this.tabbable.set(row.id);
    // The row gets its tab stop with the next render; focus it then.
    queueMicrotask(() => document.getElementById(`page-editor-outline-${row.id}`)?.focus());
  }

  /** Moves the section one place and says where it went; the row keeps the focus. */
  private moveSection(row: OutlineRow, delta: -1 | 1): void {
    const at = row.section;
    if (!at || this.editor.readOnly()) {
      return;
    }
    const to = at.index + delta;
    if (to < 0 || to >= at.count) {
      return;
    }
    this.sections.moveBy(at.body, at.index, delta);
    this.announcement.set(this.transloco.translate('pages.editor.outline.moved', { name: row.label, position: to + 1, count: at.count }));
    this.editor.selected.set(row.id);
    queueMicrotask(() => document.getElementById(`page-editor-outline-${row.id}`)?.focus());
  }
}
