import { Injectable, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { FIELDS_SELECTION } from './page-editor-targets';
import { PageEditorSectionsService } from './page-editor-sections.service';
import { PageEditorStore } from './page-editor.store';
import { issueDestination, issueFocusTarget, locateField, type IssueDestination, type IssueTarget } from './page-issues.util';
import type { SectionInstance } from './types';

/**
 * Where the page editor's findings point (M35.18): *what* a finding is about in words ("Hero › Image") and *taking the
 * editor there* — select the entry in the outline, scroll the form to the field or section and focus it. Shared by the Issues
 * drawer and the preview's "can't be previewed yet" state. Provided per page editor.
 */
@Injectable()
export class PageEditorFocusService {
  private readonly editor = inject(PageEditorStore);
  private readonly sections = inject(PageEditorSectionsService);
  private readonly transloco = inject(TranslocoService);

  /** "Hero › Image", "Page fields › Meta description", "Hero": where a finding points, in words; `null` for the whole page. */
  describe(target: IssueTarget): string | null {
    const at = locateField(target.editorPath);
    if (at?.scope === 'page') {
      const label = this.editor.contentDefinition()?.editors.find((e) => e.name === at.editor)?.label ?? at.editor;
      return `${this.transloco.translate('pages.issues.where.page')} › ${label}`;
    }
    const section = at?.scope === 'section' ? this.editor.sectionsFor(at.body)[at.index] : this.findSection(target.sectionInstanceId);
    if (!section) {
      return null;
    }
    const title = this.sections.title(section.templateRef);
    const editorName = at?.scope === 'section' ? at.editor : null;
    if (!editorName) {
      return title;
    }
    const label = this.sections.defFor(section.templateRef).editors.find((e) => e.name === editorName)?.label ?? editorName;
    return `${title} › ${label}`;
  }

  /**
   * Goes where a finding points: a page field or a section field is scrolled to and focused, a section is scrolled to and
   * focused (its card); the outline selects it. Returns what the preview should outline (`null` for nothing), so the caller
   * can decide whether the preview shows the checked view.
   */
  goTo(target: IssueTarget): IssueDestination['preview'] {
    const destination = issueDestination(target, (body, index) => this.editor.sectionsFor(body)[index]?.instanceId ?? null);
    if (destination.form?.scope === 'page') {
      this.editor.selected.set(FIELDS_SELECTION);
      this.focusField(null, destination.form.editor);
    } else if (destination.form?.scope === 'section') {
      this.editor.selected.set(destination.form.instanceId);
      this.focusField(destination.form.instanceId, destination.form.editor);
    }
    return destination.preview;
  }

  private findSection(instanceId: string | null): SectionInstance | null {
    if (!instanceId) {
      return null;
    }
    for (const body of this.editor.bodies()) {
      const found = this.editor.sectionsFor(body.name).find((section) => section.instanceId === instanceId);
      if (found) {
        return found;
      }
    }
    return null;
  }

  /**
   * Scrolls to a field of the page's own form (`section` null) or of a section card, or to the card itself when no field is
   * named (or the card is collapsed), and focuses it. Waits for the form to render.
   */
  private focusField(section: string | null, editor: string | null, attempt = 0): void {
    const found = issueFocusTarget(document, section, editor);
    if (!found) {
      if (attempt < 20) {
        setTimeout(() => this.focusField(section, editor, attempt + 1), 50);
      }
      return;
    }
    found.scrollIntoView?.({ block: 'center' });
    const field = found.hasAttribute('data-sf-editor');
    const focusable = field
      ? found.querySelector<HTMLElement>('input:not([type="hidden"]), textarea, select, [contenteditable="true"], button')
      : found.querySelector<HTMLElement>('.section-card__header');
    focusable?.focus({ preventScroll: true });
    found.classList.add('sf-issue-target');
    setTimeout(() => found.classList.remove('sf-issue-target'), 2000);
  }
}
