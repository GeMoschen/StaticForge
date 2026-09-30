import '@angular/compiler';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { render } from '@testing-library/angular';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { EditingLocaleStore } from '../../core/project/editing-locale.store';
import { LocalesStore } from '../../core/project/locales.store';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { ReleaseEventsStore } from '../release/release-events.store';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { ProjectShellComponent } from './project-shell.component';

describe('ProjectShellComponent', () => {
  it('ends time travel when the user leaves the project', async () => {
    TestBed.overrideComponent(ProjectShellComponent, { set: { imports: [], schemas: [NO_ERRORS_SCHEMA] } });
    const { fixture } = await render(ProjectShellComponent, {
      providers: [
        provideRouter([]),
        {
          provide: ProjectContextStore,
          useValue: {
            activeProjectKey: signal('proj'),
            revisions: signal([]),
            currentRevision: signal(null),
            refreshFolderTrees: vi.fn(),
            refreshRevision: vi.fn(),
          },
        },
        {
          provide: LocalesStore,
          useValue: { clear: vi.fn(), load: () => of(null), isLocalized: signal(false), locales: signal([]) },
        },
        { provide: EditingLocaleStore, useValue: { restore: vi.fn(), locale: signal(null) } },
        { provide: ReleaseEventsStore, useValue: { version: signal(0) } },
      ],
    });
    const timeTravel = TestBed.inject(TimeTravelStore);
    timeTravel.enter(3);

    fixture.destroy();

    expect(timeTravel.isTimeTravel()).toBe(false);
  });
});
