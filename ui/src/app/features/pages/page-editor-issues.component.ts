import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { Router } from '@angular/router';
import { PageEditorStore } from './page-editor.store';
import { PageIssuesPanelComponent } from './page-issues-panel.component';
import {
  issueDestination,
  issueFocusTarget,
  type ContentIssue,
  type DraftCheckView,
  type IssueTarget,
} from './page-issues.util';

/** The Issues panel of every scope (M30.3.2): an issue opens the field or section it is about. */
@Component({
  selector: 'sf-page-editor-issues',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageIssuesPanelComponent],
  template: `
    <div class="page-editor__issues">
      <sf-page-issues-panel
        [projectKey]="editor.projectKey()"
        [pageUuid]="editor.uuid()"
        [revision]="editor.timeTravelRevision()"
        [refreshKey]="editor.autosave.revision()"
        [completeness]="editor.shownIssues()"
        [previewView]="editor.previewView()"
        (issueSelect)="onIssueSelect($event)"
        (checked)="onChecked($event)"
      />
    </div>
  `,
  styles: [
    `
      :host {
        display: contents;
      }
      .page-editor__issues {
        padding-top: var(--sf-3);
        border-top: 1px solid var(--sf-line);
        min-width: 0;
      }
    `,
  ],
})
export class PageEditorIssuesComponent {
  protected readonly editor = inject(PageEditorStore);
  private readonly router = inject(Router);

  /** The element a field or section card is looked up in. */
  readonly focusRoot = input.required<HTMLElement>();
  /** Outline this section — or an element of it — in the preview. */
  readonly previewFocus = output<{ instanceId: string | null; selector: string | null }>();

  /** A draft check returns the completeness of the version it checked: the freshest there is. */
  protected onChecked(result: DraftCheckView): void {
    this.editor.issues.set((result.completeness ?? []) as ContentIssue[]);
  }

  /**
   * Goes where an issue points: a page field opens the page's fields and focuses it; a section field or a section opens
   * that section (`?section=`) and focuses the field or the section; the section — or else the element — is outlined in
   * the preview while it shows the draft (the checks' view).
   */
  protected onIssueSelect(target: IssueTarget): void {
    const destination = issueDestination(target, (body, index) => this.editor.sectionsFor(body)[index]?.instanceId ?? null);
    if (destination.form?.scope === 'page') {
      const editor = destination.form.editor;
      void this.router.navigate([], { queryParams: {} }).then(() => this.focusField(null, editor));
    } else if (destination.form?.scope === 'section') {
      const { instanceId, editor } = destination.form;
      void this.router.navigate([], { queryParams: { section: instanceId } }).then(() => this.focusField(instanceId, editor));
    }
    // The preview shows the checked view only in Draft: outlining an element of the published page would mislead.
    if (destination.preview && this.editor.previewView() === 'draft') {
      this.previewFocus.emit(destination.preview);
    }
  }

  /**
   * Scrolls to a field of the page's own form (`section` null) or of a section card, or to the card itself when no
   * field is named (or the card is collapsed), and focuses it. Waits for the scope switch to render.
   */
  private focusField(section: string | null, editor: string | null, attempt = 0): void {
    const found = issueFocusTarget(this.focusRoot(), section, editor);
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
