import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ActiveEditorService } from '../../core/editor/active-editor.service';
import { autosaveEditorState } from '../../core/editor/autosave-editor-state';
import type { Crumb } from '../../core/frame/breadcrumb.util';
import { useFrameItem } from '../../core/frame/use-frame-item';
import { SfSplitterComponent } from '../../shared/components/splitter/sf-splitter.component';
import { PageAutosaveService } from './autosave.service';
import { FolderTrailService } from './folder-trail.service';
import { PageEditorConflictComponent } from './page-editor-conflict.component';
import { PageEditorFieldsService } from './page-editor-fields.service';
import { PageEditorFocusService } from './page-editor-focus.service';
import { PageEditorFormComponent } from './page-editor-form.component';
import { PageEditorHeaderComponent } from './page-editor-header.component';
import { PageEditorIssuesComponent } from './page-editor-issues.component';
import { PageEditorOutlineComponent } from './page-editor-outline.component';
import { PageEditorPreviewComponent } from './page-editor-preview.component';
import { PageEditorSectionsService } from './page-editor-sections.service';
import { PageEditorStore } from './page-editor.store';
import { PageSettingsComponent } from './page-settings.component';
import { SectionPaletteComponent } from './section-palette.component';
import { SectionPaletteService } from './section-palette.service';

/**
 * The page editor (M35.18): the header (name, status, Issues, settings, Preview, release actions, ⋮), the outline of the page
 * (page fields, bodies, sections), one scrolling form and — when shown — the preview beside it in a resizable splitter.
 * Page settings and the Issues list are non-modal drawers; adding a section opens the palette dialog. The parts share
 * their state through {@link PageEditorStore}; this component owns the routed inputs, autosave and the effects that load
 * and sync the page.
 */
@Component({
  selector: 'sf-page-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PageEditorHeaderComponent,
    PageEditorOutlineComponent,
    PageEditorFormComponent,
    PageEditorIssuesComponent,
    PageEditorPreviewComponent,
    PageEditorConflictComponent,
    PageSettingsComponent,
    SectionPaletteComponent,
    SfSplitterComponent,
    TranslocoPipe,
  ],
  providers: [
    PageAutosaveService,
    PageEditorStore,
    PageEditorFieldsService,
    SectionPaletteService,
    PageEditorSectionsService,
    PageEditorFocusService,
  ],
  templateUrl: './page-editor.component.html',
  styleUrl: './page-editor.component.scss',
})
export class PageEditorComponent {
  protected readonly editor = inject(PageEditorStore);
  private readonly trails = inject(FolderTrailService);

  readonly projectKey = input.required<string>();
  readonly uuid = input.required<string>();
  /** Bound from `?body=`/`?section=` query params: the form scrolls to and selects that body or section. */
  readonly focusBody = input<string | undefined>(undefined, { alias: 'body' });
  readonly focusSection = input<string | undefined>(undefined, { alias: 'section' });

  protected readonly preview = viewChild(PageEditorPreviewComponent);
  /** The folders above the open page, for the breadcrumb. */
  private readonly trail = signal<Crumb[]>([]);

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
    // a link to a different section) only updates the nav-tree's active-row highlight, not a
    // full reload of the page.
    effect(() => this.editor.syncActivePage(), { allowSignalWrites: true });

    effect(() => this.editor.syncExternalMutation(), { allowSignalWrites: true });

    effect(() => this.editor.syncEditingLocale(), { allowSignalWrites: true });

    // The folders above the page are matched against the Pages tree whenever the page's folder changes.
    effect(
      (onCleanup) => {
        const key = this.projectKey();
        const folderPath = this.editor.page()?.folderPath;
        untracked(() => {
          if (!key || !folderPath) {
            this.trail.set([]);
            return;
          }
          const sub = this.trails.trailFor(key, folderPath).subscribe((crumbs) => this.trail.set(crumbs));
          onCleanup(() => sub.unsubscribe());
        });
      },
      { allowSignalWrites: true },
    );

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
      return label
        ? { label, trail: this.trail(), ...(page?.uuid ? { asset: { uuid: page.uuid } } : {}) }
        : null;
    });
  }
}
