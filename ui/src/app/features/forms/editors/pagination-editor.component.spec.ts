import '@angular/compiler';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl } from '@angular/forms';
import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { ApiClient } from '../../../core/api/api.client';
import { ProjectContextStore } from '../../../core/project/project-context.store';
import { ContentService } from '../../content/content.service';
import type { EditorDefinition } from '../form.model';
import { SfPaginationEditor } from './pagination-editor.component';

const definition: EditorDefinition = {
  name: 'posts',
  type: 'PAGINATION',
  label: 'Posts',
  pagination: { sources: ['nav', 'dataset'], pageSize: 10, maxPageSize: 20, sort: ['navigation', 'date', 'title'] },
};

function render(control: FormControl) {
  TestBed.configureTestingModule({
    imports: [SfPaginationEditor],
    providers: [
      { provide: ProjectContextStore, useValue: { navigationFolderTree: signal([]) } },
      {
        provide: ApiClient,
        useValue: {
          listFolders: () => of([{ uuid: 'nav-1', displayName: 'Blog', children: [] }]),
          paginationCount: () => of({ itemCount: 7, skipped: 0 }),
        },
      },
      { provide: ContentService, useValue: { listDatasets: () => of([{ uuid: 'ds-1', displayName: 'Team' }]) } },
    ],
  });
  const fixture = TestBed.createComponent(SfPaginationEditor);
  fixture.componentRef.setInput('definition', definition);
  fixture.componentRef.setInput('control', control);
  fixture.componentRef.setInput('projectKey', 'p1');
  // Twice: the first pass creates the view and only then flushes the constructor effects that read
  // the control (value, disabled state) into the component's signals; the second renders those.
  fixture.detectChanges();
  fixture.detectChanges();
  return fixture;
}

describe('SfPaginationEditor', () => {
  it('shows the chosen source, the items → pages hint, and clears to null', () => {
    const control = new FormControl<unknown>({
      type: 'PAGINATION',
      source: { kind: 'NAV', uuid: 'nav-1' },
      pageSize: 2,
      sort: { key: 'date', direction: 'DESC' },
    });
    const fixture = render(control);
    const root: HTMLElement = fixture.nativeElement;

    expect(root.querySelector('.sf-pagination__name')?.textContent).toContain('Blog');
    expect(root.querySelector('.sf-pagination__hint')?.textContent).toContain('7 items → 4 pages');

    const clear = Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.includes('Clear'));
    clear?.click();
    expect(control.value).toBeNull();
  });

  it('shows a summary instead of controls when disabled', () => {
    const control = new FormControl<unknown>({
      type: 'PAGINATION',
      source: { kind: 'NAV', uuid: 'nav-1' },
      pageSize: 10,
      sort: { key: 'date', direction: 'DESC' },
    });
    control.disable();
    const fixture = render(control);
    const root: HTMLElement = fixture.nativeElement;

    expect(root.querySelector('select')).toBeNull();
    expect(root.querySelector('.sf-pagination__summary')?.textContent).toContain('Source: Blog · 10 per page · Date ↓');
  });
});
