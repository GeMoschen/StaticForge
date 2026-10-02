import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input } from '@angular/core';
import { useFrameItem } from '../../core/frame/use-frame-item';
import { ReleaseBarComponent } from '../release/release-bar.component';
import { PageAutosaveService } from './autosave.service';
import { PageEditorConflictComponent } from './page-editor-conflict.component';
import { PageEditorFieldsService } from './page-editor-fields.service';
import { PageEditorHeaderComponent } from './page-editor-header.component';
import { PageEditorIssuesComponent } from './page-editor-issues.component';
import { PageEditorPreviewComponent } from './page-editor-preview.component';
import { PageEditorScopeComponent } from './page-editor-scope.component';
import { PageEditorSectionsService } from './page-editor-sections.service';
import { PageEditorStore } from './page-editor.store';
import { SectionPaletteComponent } from './section-palette.component';
import { SectionPaletteService } from './section-palette.service';
import { ActiveEditorService } from '../../core/editor/active-editor.service';
import { autosaveEditorState } from '../../core/editor/autosave-editor-state';

/**
 * Split-view page editor: page fields and bodies/sections in the centre, the preview beside it. It composes the
 * header, the scope router, the section palette, the Issues panel, the preview split and the conflict drawer, which
 * share their state through {@link PageEditorStore}; it owns the routed inputs, autosave and the effects that load
 * and sync the page.
 */
@Component({
  selector: 'sf-page-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PageEditorHeaderComponent,
    PageEditorScopeComponent,
    PageEditorIssuesComponent,
    PageEditorPreviewComponent,
    PageEditorConflictComponent,
    SectionPaletteComponent,
    ReleaseBarComponent,
  ],
  providers: [PageAutosaveService, PageEditorStore, PageEditorFieldsService, SectionPaletteService, PageEditorSectionsService],
  templateUrl: './page-editor.component.html',
  styleUrl: './page-editor.component.scss',
})
export class PageEditorComponent {
  protected readonly editor = inject(PageEditorStore);

  readonly projectKey = input.required<string>();
  readonly uuid = input.required<string>();
  /** Bound from `?body=`/`?section=` query params (see `PageNavNodeComponent`). */
  readonly focusBody = input<string | undefined>(undefined, { alias: 'body' });
  readonly focusSection = input<string | undefined>(undefined, { alias: 'section' });

  constructor() {
    this.editor.attach({
      projectKey: this.projectKey,
      uuid: this.uuid,
      focusBody: this.focusBody,
      focusSection: this.focusSection,
    });

    effect(() => this.editor.loadProject());

    effect(() => this.editor.loadRouted(), { allowSignalWrites: true });

    // Kept separate from the load effect above so that changing `?body=`/`?section=` (e.g.
    // clicking a different section) only updates the nav-tree's active-row highlight, not a
    // full reload of the page.
    effect(() => this.editor.syncActivePage(), { allowSignalWrites: true });

    effect(() => this.editor.syncExternalMutation(), { allowSignalWrites: true });

    effect(() => this.editor.syncEditingLocale(), { allowSignalWrites: true });

    // The open page is an editor for the frame (M35.13): Ctrl+S saves it, leaving it with an edit that could not be
    // written asks first, and closing the tab prompts. The editor is reused when another page is opened, so it stays
    // registered for the component's life.
    const unregister = inject(ActiveEditorService).register(
      autosaveEditorState({
        name: () => this.editor.page()?.displayName || this.editor.page()?.uid || '',
        autosave: this.editor.autosave as never,
        reload: () => this.editor.loadRouted(),
      }),
    );
    inject(DestroyRef).onDestroy(unregister);

    // The breadcrumb ends with the open page and the document title starts with it (M35.10).
    useFrameItem(() => {
      const page = this.editor.page();
      const label = page?.displayName || page?.uid;
      return label ? { label, ...(page?.uuid ? { asset: { uuid: page.uuid } } : {}) } : null;
    });
  }
}
