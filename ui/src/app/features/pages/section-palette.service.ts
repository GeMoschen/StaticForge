import { Injectable, inject, signal } from '@angular/core';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ToastService } from '../../core/ui/toast.service';
import type { BodyDefinition } from '../forms';
import { PageEditorStore } from './page-editor.store';

type TemplateSummary = components['schemas']['TemplateSummary'];

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
  private readonly editor = inject(PageEditorStore);

  /** The body the palette is open for; `null` while it is closed. */
  readonly body = signal<BodyDefinition | null>(null);

  close(): void {
    this.body.set(null);
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

  open(body: BodyDefinition): void {
    if (this.editor.readOnly()) {
      return;
    }
    this.body.set(body);
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
    const position = this.editor.bodyCount(body.name);
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
          this.body.set(null);
          this.editor.applyServerPage(page);
          this.toast.show('Section added', 'success');
        },
        error: () => this.toast.show('Could not add section — someone may have edited this page, try reloading it.', 'error'),
      });
  }
}
