import '@angular/compiler';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ToastService } from '../../core/ui/toast.service';
import { PageEditorStore } from './page-editor.store';
import { SectionPaletteService } from './section-palette.service';

const BODY = { name: 'main', label: 'Main' };

describe('SectionPaletteService', () => {
  let service: SectionPaletteService;
  let api: { addSection: ReturnType<typeof vi.fn> };
  let editor: { readOnly: ReturnType<typeof signal<boolean>>; applyServerPage: ReturnType<typeof vi.fn> } & Record<string, unknown>;
  let toasts: ToastService;

  beforeEach(() => {
    api = { addSection: vi.fn().mockReturnValue(of({ uuid: 'page-1' })) };
    editor = {
      readOnly: signal(false),
      projectKey: () => 'proj',
      uuid: () => 'page-1',
      bodyCount: () => 4,
      autosave: { revision: () => 9 },
      applyServerPage: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        SectionPaletteService,
        { provide: ApiClient, useValue: api },
        { provide: PageEditorStore, useValue: editor },
        {
          provide: ProjectContextStore,
          useValue: {
            loadFor: () => of(undefined),
            sectionTemplates: signal([
              { uuid: 'a', uid: 'hero' },
              { uuid: 'b', uid: 'text' },
            ]),
          },
        },
      ],
    });
    service = TestBed.inject(SectionPaletteService);
    toasts = TestBed.inject(ToastService);
  });

  it('opens at the end of the body by default, and after a section when told where', () => {
    service.open(BODY);
    expect(service.target()).toEqual({ body: BODY, position: 4, after: null });
    expect(service.body()).toBe(BODY);

    service.open(BODY, 2, 'Hero');
    expect(service.target()).toEqual({ body: BODY, position: 2, after: 'Hero' });
  });

  it('does not open while read-only', () => {
    editor.readOnly.set(true);

    service.open(BODY);

    expect(service.target()).toBeNull();
  });

  it('adds the section at the position the palette was opened for, then closes', () => {
    service.open(BODY, 2, 'Hero');

    service.add(BODY, 'b');

    expect(api.addSection).toHaveBeenCalledWith('proj', 'page-1', 'main', { templateUuid: 'b', position: 2 }, 9);
    expect(editor.applyServerPage).toHaveBeenCalledWith({ uuid: 'page-1' });
    expect(service.target()).toBeNull();
    expect(toasts.toasts().at(-1)?.message).toBe('Section added');
  });

  it('adds at the end when it was not opened for a position', () => {
    service.add(BODY, 'a');

    expect(api.addSection.mock.calls[0][3]).toEqual({ templateUuid: 'a', position: 4 });
  });

  it('only offers the templates a body allows', () => {
    expect(service.allowedTemplates({ name: 'main', allow: ['text'] }).map((t) => t.uid)).toEqual(['text']);
    expect(service.allowedTemplates({ name: 'main', allow: ['*'] })).toHaveLength(2);
    expect(service.allowedTemplates({ name: 'main' })).toHaveLength(2);
  });
});
