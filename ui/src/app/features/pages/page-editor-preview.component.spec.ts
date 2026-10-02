import '@angular/compiler';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoPipe } from '@jsverse/transloco';
import { fireEvent, render, screen } from '@testing-library/angular';
import { describe, expect, it, vi } from 'vitest';
import { SfEmptyStateComponent } from '../../shared/components/sf-empty-state.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';
import { PageEditorFocusService } from './page-editor-focus.service';
import { PageEditorPreviewComponent } from './page-editor-preview.component';
import { PageEditorStore } from './page-editor.store';
import type { ContentIssue, IssueTarget } from './page-issues.util';

const LABELS: Record<string, string> = {
  'content.title': 'Page fields › Title',
  'content.image': 'Page fields › Hero image',
  'bodies.main[0].content.headline': 'Hero › Headline',
};

async function renderPreview(issues: ContentIssue[]) {
  const goTo = vi.fn();
  // The frame loads the page over HTTP: out of scope here, a stand-in marks where it would be.
  TestBed.overrideComponent(PageEditorPreviewComponent, {
    set: { imports: [SfEmptyStateComponent, SfIconComponent, TranslocoPipe], schemas: [NO_ERRORS_SCHEMA] },
  });
  const result = await render(PageEditorPreviewComponent, {
    providers: [
      {
        provide: PageEditorStore,
        useValue: {
          shownIssues: signal(issues),
          projectKey: signal('proj'),
          uuid: signal('page-1'),
          timeTravelRevision: signal(null),
          autosave: { revision: signal(1) },
          previewView: signal('draft'),
        },
      },
      { provide: PageEditorFocusService, useValue: { describe: (target: IssueTarget) => LABELS[target.editorPath ?? ''] ?? null, goTo } },
    ],
  });
  return { ...result, goTo };
}

const required = (path: string): ContentIssue => ({ path, code: 'required', severity: 'ERROR', kind: 'COMPLETENESS', message: `${path} is required.` });

describe('PageEditorPreviewComponent', () => {
  it('shows the preview frame for a complete page', async () => {
    await renderPreview([{ path: 'content.title', code: 'long', severity: 'WARNING', kind: 'COMPLETENESS', message: 'Long title.' }]);

    expect(document.querySelector('sf-preview-frame')).not.toBeNull();
    expect(document.querySelector('[data-sf-preview-incomplete]')).toBeNull();
  });

  it("says the page can't be previewed yet, lists what is missing and goes to the first field", async () => {
    const { goTo } = await renderPreview([required('content.title'), required('content.image'), required('content.title')]);

    expect(document.querySelector('sf-preview-frame')).toBeNull();
    expect(screen.getByText("This page can't be previewed yet")).toBeTruthy();
    const missing = screen.getByRole('list', { name: 'Missing before the preview works' });
    expect(Array.from(missing.querySelectorAll('li')).map((item) => item.textContent?.replace(/^[a-z_]+/, '').trim())).toEqual([
      'Page fields › Title',
      'Page fields › Hero image',
    ]);

    fireEvent.click(screen.getByRole('button', { name: /Go to Page fields › Title/ }));

    expect(goTo).toHaveBeenCalledWith({ editorPath: 'content.title', sectionInstanceId: null, selector: null });
  });

  it('falls back to the finding message for a path it cannot name', async () => {
    await renderPreview([required('template')]);

    expect(screen.getByRole('list', { name: 'Missing before the preview works' }).textContent).toContain('template is required.');
  });
});
