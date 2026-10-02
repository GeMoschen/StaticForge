import { ChangeDetectionStrategy, Component, computed, effect, inject, untracked } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { SfSectionComponent } from '../../shared/components/layout/sf-section.component';
import { SfSpinnerComponent } from '../../shared/components/sf-spinner.component';
import { SfContentFormComponent } from '../forms';
import { SfAssetUrlsComponent } from '../settings/asset-urls.component';
import { PageEditorSectionsService } from './page-editor-sections.service';
import { FIELDS_SELECTION, bodySelection, cardDomId, revealCard } from './page-editor-targets';
import { PageEditorStore } from './page-editor.store';
import { SectionEditorComponent } from './section-editor.component';
import { SectionPaletteService } from './section-palette.service';
import type { SectionInstance } from './types';

/**
 * The page editor's form (M35.18): one scrolling form with the page's own fields first, then every body with its
 * sections (a card each, with a **+** between two of them and **Add section** in the body's heading), then where the page lives. The outline beside it selects and scrolls to a card; `?section=` / `?body=` still work as
 * focus inputs (a link from elsewhere selects and scrolls to that section or body).
 */
@Component({
  selector: 'sf-page-editor-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SectionEditorComponent,
    SfAssetUrlsComponent,
    SfButtonComponent,
    SfContentFormComponent,
    SfEmptyStateComponent,
    SfIconComponent,
    SfSectionComponent,
    SfSpinnerComponent,
    TranslocoPipe,
  ],
  templateUrl: './page-editor-form.component.html',
  styleUrl: './page-editor-form.component.scss',
})
export class PageEditorFormComponent {
  protected readonly editor = inject(PageEditorStore);
  protected readonly sections = inject(PageEditorSectionsService);
  protected readonly palette = inject(SectionPaletteService);

  protected readonly fieldsId = cardDomId(FIELDS_SELECTION);
  protected readonly fieldsSelection = FIELDS_SELECTION;

  /** What `?section=` / `?body=` point at, as an outline entry; a string, so a save of the page never re-fires the scroll. */
  private readonly focusTarget = computed(() => {
    const section = this.editor.focusedSection();
    if (section) {
      return section.section.instanceId;
    }
    const body = this.editor.focusedBody();
    return body ? bodySelection(body.name) : null;
  });

  /** Whether the page is there: a save replaces the page object, which must not re-run the scroll below. */
  private readonly loaded = computed(() => !!this.editor.page());

  constructor() {
    effect(() => {
      const target = this.focusTarget();
      if (target && this.loaded()) {
        untracked(() => {
          this.editor.selected.set(target);
          revealCard(target);
        });
      }
    });
  }

  protected cardId(selection: string): string {
    return cardDomId(selection);
  }

  protected bodySelection(name: string): string {
    return bodySelection(name);
  }

  protected sectionKey(section: SectionInstance): string {
    return `${section.instanceId}|${section.templateRef}`;
  }

  /**
   * Whether the body takes no more sections (`max`). A body without a limit comes from the server as no `max` — `null`
   * (JSON) as often as `undefined` — and must never count as full.
   */
  protected full(bodyName: string, max: number | null | undefined): boolean {
    return max != null && max > 0 && this.editor.bodyCount(bodyName) >= max;
  }
}
