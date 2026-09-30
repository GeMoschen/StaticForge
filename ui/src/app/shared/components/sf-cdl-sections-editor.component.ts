import { ChangeDetectionStrategy, Component, computed, inject, input, output, viewChildren } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { components } from '../../core/api/generated/schema.d.ts';
import {
  diagnosticsIn,
  errorCount,
  SECTION_LABEL_KEYS,
  type CdlSection,
  type CdlSections,
} from '../code-editor/cdl-sections';
import { SfCodeEditorComponent } from '../code-editor/code-editor.component';
import { panelIdOf, SfTabsComponent, tabIdOf, type SfTab } from './sf-tabs.component';

type Diagnostic = components['schemas']['Diagnostic'];

let nextId = 0;

/**
 * A content holder's CDL, one tab per section (M34): Content, Bodies (page templates only) and Rules. Each tab has
 * its own code editor — kept alive while another tab shows, so its undo history and caret survive — an error count
 * and an unsaved dot, and lists its own diagnostics below the editor; a diagnostic's `line:column` jumps there.
 *
 * <p>Like `sf-octl-editor` it holds no state: the host owns the sections (`sections` in, `sectionChange` out), the
 * saved sections the dots compare against, the diagnostics (each naming its section in `field`) and the selected
 * tab. Content projected with `sfCdlContent`, `sfCdlBodies` or `sfCdlRules` shows above that tab's editor.
 */
@Component({
  selector: 'sf-cdl-sections-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfCodeEditorComponent, SfTabsComponent, TranslocoPipe],
  template: `
    <sf-tabs
      [tabs]="tabs()"
      [selected]="selected()"
      [label]="label() ?? ('shared.codeEditor.cdlLabel' | transloco)"
      [idPrefix]="idPrefix"
      (selectTab)="selectedChange.emit($any($event))"
    />
    @for (section of sections(); track section) {
      <div
        class="cdl-sections__panel"
        role="tabpanel"
        [id]="panelId(section)"
        [attr.aria-labelledby]="tabId(section)"
        [hidden]="section !== selected()"
      >
        @switch (section) {
          @case ('content') {
            <ng-content select="[sfCdlContent]" />
          }
          @case ('bodies') {
            <ng-content select="[sfCdlBodies]" />
          }
          @case ('rules') {
            <ng-content select="[sfCdlRules]" />
          }
        }
        @if (hints()[section]; as hint) {
          <p class="cdl-sections__hint">{{ hint }}</p>
        }
        <sf-code-editor
          class="cdl-sections__source"
          language="cdl"
          [attr.data-section]="section"
          [label]="editorLabel(section)"
          [value]="value()[section]"
          [diagnostics]="byField()[section]"
          [readOnly]="readOnly()"
          [names]="names()"
          [invalid]="errorCounts()[section] > 0"
          [placeholder]="placeholders()[section] ?? ''"
          (valueChange)="sectionChange.emit({ section, value: $event })"
        />
        <div class="cdl-sections__diagnostics" aria-live="polite">
          @for (diag of byField()[section]; track $index) {
            <div class="diagnostic" [class.diagnostic--error]="diag.severity === 'ERROR'" [class.diagnostic--warning]="diag.severity !== 'ERROR'">
              <span>{{ diag.severity }} {{ diag.code }}</span>
              @if (diag.line) {
                <button
                  type="button"
                  class="diagnostic__position"
                  [attr.aria-label]="'shared.codeEditor.goToPosition' | transloco: { line: diag.line, column: diag.column ?? 0 }"
                  (click)="goTo(section, diag)"
                >
                  ({{ diag.line }}:{{ diag.column ?? 0 }})
                </button>
              }
              <span>— {{ diag.message }}</span>
            </div>
          }
        </div>
      </div>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--sf-2);
      min-width: 0;
    }
    .cdl-sections__panel {
      display: flex;
      flex-direction: column;
      gap: var(--sf-2);
      min-width: 0;
    }
    .cdl-sections__panel[hidden] {
      display: none;
    }
    .cdl-sections__hint {
      margin: 0;
      color: var(--sf-slate);
      font-size: var(--sf-text-xs);
    }
    .cdl-sections__source {
      --sf-code-min-height: var(--sf-cdl-min-height, 9rem);
      --sf-code-max-height: var(--sf-cdl-max-height, 36rem);
    }
    .diagnostic {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--sf-1) var(--sf-2);
      padding: var(--sf-1) var(--sf-2);
      margin-bottom: var(--sf-1);
      border-radius: var(--sf-radius-sm);
      font-size: var(--sf-text-xs);
    }
    .diagnostic--error {
      background: color-mix(in srgb, var(--sf-rust) 12%, transparent);
      color: var(--sf-rust);
    }
    .diagnostic--warning {
      background: color-mix(in srgb, var(--sf-amber, #9c7a2e) 14%, transparent);
      color: var(--sf-ink);
    }
    .diagnostic__position {
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      text-decoration: underline;
      text-underline-offset: 2px;
      cursor: pointer;
    }
    .diagnostic__position:focus-visible {
      outline: 2px solid var(--sf-signal);
      outline-offset: 2px;
    }
  `,
})
export class SfCdlSectionsEditorComponent {
  /** The sections as edited. */
  readonly value = input.required<CdlSections>();
  /** The sections as saved; a section that differs shows the unsaved dot. `null`: nothing to compare against. */
  readonly saved = input<CdlSections | null>(null);
  /** Which sections have a tab, in order. */
  readonly sections = input<readonly CdlSection[]>(['content', 'rules']);
  readonly selected = input.required<CdlSection>();
  /** Every CDL diagnostic; each is shown on the tab its `field` names (Content when it names none). */
  readonly diagnostics = input<readonly Diagnostic[]>([]);
  readonly readOnly = input(false);
  /** Editor names completion offers besides the ones the Content tab declares (inherited editors). */
  readonly names = input<readonly string[]>([]);
  /** The accessible name of the tab list, and the prefix of each editor's name. */
  readonly label = input<string | null>(null);
  /** A short help line per section, shown above its editor. */
  readonly hints = input<Partial<Record<CdlSection, string>>>({});
  readonly placeholders = input<Partial<Record<CdlSection, string>>>({});

  readonly sectionChange = output<{ section: CdlSection; value: string }>();
  readonly selectedChange = output<CdlSection>();

  private readonly transloco = inject(TranslocoService);

  private readonly editors = viewChildren(SfCodeEditorComponent);
  protected readonly idPrefix = `sf-cdl-sections-${nextId++}`;

  protected readonly byField = computed<Record<CdlSection, Diagnostic[]>>(() => {
    const all = this.diagnostics();
    return { content: diagnosticsIn(all, 'content'), bodies: diagnosticsIn(all, 'bodies'), rules: diagnosticsIn(all, 'rules') };
  });

  protected readonly errorCounts = computed<Record<CdlSection, number>>(() => {
    const by = this.byField();
    return { content: errorCount(by.content), bodies: errorCount(by.bodies), rules: errorCount(by.rules) };
  });

  protected readonly tabs = computed<SfTab[]>(() => {
    const value = this.value();
    const saved = this.saved();
    return this.sections().map((section) => ({
      id: section,
      label: this.transloco.translate(SECTION_LABEL_KEYS[section]),
      errors: this.errorCounts()[section],
      dirty: saved !== null && value[section] !== saved[section],
    }));
  });

  /** The accessible name of a section's editor: the list's name and the section's. */
  protected editorLabel(section: CdlSection): string {
    const name = this.label() ?? this.transloco.translate('shared.codeEditor.cdlLabel');
    return `${name} — ${this.transloco.translate(SECTION_LABEL_KEYS[section])}`;
  }

  protected tabId(section: CdlSection): string {
    return tabIdOf(this.idPrefix, section);
  }

  protected panelId(section: CdlSection): string {
    return panelIdOf(this.idPrefix, section);
  }

  /** Opens a section's tab and moves its caret to a diagnostic's position. */
  goTo(section: CdlSection, diagnostic: Diagnostic): void {
    if (section !== this.selected()) {
      this.selectedChange.emit(section);
    }
    const index = this.sections().indexOf(section);
    const editor = this.editors()[index];
    if (editor && diagnostic.line) {
      editor.goTo(diagnostic.line, diagnostic.column ?? 1);
    }
  }
}
