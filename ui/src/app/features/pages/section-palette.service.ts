import { Injectable, computed, inject, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ToastService } from '../../core/ui/toast.service';
import type { BodyDefinition } from '../forms';
import { PageEditorStore } from './page-editor.store';

type TemplateSummary = components['schemas']['TemplateSummary'];

/** Where the section palette inserts: see {@link SectionPaletteService.open}. */
export interface PaletteTarget {
  readonly body: BodyDefinition;
  readonly position: number;
  readonly after: string | null;
}

/**
 * The section palette's state and actions: which body it is open for, which section templates that body allows,
 * and adding the chosen one. Kept apart from the rest of the section handling so the palette can change alone.
 * Provided per page editor.
 */
@Injectable()
export class SectionPaletteService {
  private readonly api = inject(ApiClient);
  private readonly project = inject(ProjectContextStore);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  private readonly editor = inject(PageEditorStore);

  /** Where the palette is open: the body, the position the section goes to and the section it follows; `null` while closed. */
  readonly target = signal<PaletteTarget | null>(null);

  /** The body the palette is open for; `null` while it is closed. */
  readonly body = computed(() => this.target()?.body ?? null);

  close(): void {
    this.target.set(null);
  }

  /** The section templates `body` allows (`allow` empty or `*` means all). */
  allowedTemplates(body: BodyDefinition): TemplateSummary[] {
    const allow = body.allow ?? [];
    const templates = this.project.sectionTemplates();
    if (allow.length === 0 || allow.includes('*')) {
      return templates;
    }
    return templates.filter((t) => t.uid != null && allow.includes(t.uid));
  }

  /**
   * Opens the palette for `body`. `position` is where the new section goes (its index in the body; the end by default) and
   * `after` the name of the section it follows, for the dialog's "Insert after: …".
   */
  open(body: BodyDefinition, position: number | null = null, after: string | null = null): void {
    if (this.editor.readOnly()) {
      return;
    }
    this.target.set({ body, position: position ?? this.editor.bodyCount(body.name), after });
    // Refresh section templates every time the palette opens — a template created or
    // uid-renamed on the Templates screen only reaches `sectionTemplates()` via that
    // screen's own force-reload, so a page editor that was already open before that happened
    // (the common case: create the template, then come back here to use it) would otherwise
    // keep showing its stale pre-creation snapshot.
    const key = this.editor.projectKey();
    if (key) {
      this.project.loadFor(key, true).subscribe();
    }
  }

  add(body: BodyDefinition, templateUuid: string): void {
    if (this.editor.readOnly()) {
      return;
    }
    const position = this.target()?.position ?? this.editor.bodyCount(body.name);
    this.api
      .addSection(
        this.editor.projectKey(),
        this.editor.uuid(),
        body.name,
        { templateUuid, position },
        this.editor.autosave.revision() ?? undefined,
      )
      .subscribe({
        next: (page) => {
          this.target.set(null);
          this.editor.applyServerPage(page);
          this.toast.show(this.transloco.translate('pages.palette.added'), 'success');
        },
        error: () => this.toast.show(this.transloco.translate('pages.palette.addFailed'), 'error'),
      });
  }
}
