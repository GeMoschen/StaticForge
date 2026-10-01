import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { fireEvent, screen, waitFor } from '@testing-library/angular';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SYNTAX_TOKENS } from '../code-palette.util';
import { CODE_DEMO } from '../styleguide.code-demo';
import { SgCodeComponent } from './sg-code.component';

@Component({ standalone: true, template: '' })
class ElsewhereComponent {}

describe('SgCodeComponent', () => {
  const html = document.documentElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'code', component: SgCodeComponent },
          { path: 'elsewhere', component: ElsewhereComponent },
        ]),
      ],
    });
  });

  afterEach(() => {
    delete html.dataset['codePalette'];
  });

  async function open(url = '/code') {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url, SgCodeComponent);
    harness.detectChanges();
    return harness;
  }

  it('shows the code panels, the compact field and the syntax colour table', async () => {
    const harness = await open();
    const root = harness.routeNativeElement!;
    expect(screen.getByRole('heading', { level: 2, name: 'Code editor' })).toBeInTheDocument();
    const files = Array.from(root.querySelectorAll('.sf-code-panel__file')).map((e) => e.textContent?.trim());
    expect(files).toEqual([
      CODE_DEMO.cdl.fileName,
      CODE_DEMO.octl.fileName,
      CODE_DEMO.json.fileName,
      CODE_DEMO.readOnly.fileName,
    ]);
    // The deliberate error and warning are listed.
    expect(root.querySelectorAll('.sf-code-panel__problem')).toHaveLength(3);
    expect(root.querySelector('.sf-code-editor--compact')).not.toBeNull();
    expect(root.querySelectorAll('.sg-code-swatches tbody tr')).toHaveLength(SYNTAX_TOKENS.length);
  });

  it('switches the palette on <html> and removes it on leaving the page', async () => {
    const harness = await open();
    expect(html.dataset['codePalette']).toBeUndefined();

    fireEvent.click(screen.getByRole('radio', { name: 'Refined' }));
    harness.detectChanges();
    await waitFor(() => expect(html.dataset['codePalette']).toBe('refined'));

    fireEvent.click(screen.getByRole('radio', { name: 'Current' }));
    harness.detectChanges();
    await waitFor(() => expect(html.dataset['codePalette']).toBeUndefined());

    fireEvent.click(screen.getByRole('radio', { name: 'Refined' }));
    harness.detectChanges();
    await waitFor(() => expect(html.dataset['codePalette']).toBe('refined'));
    await harness.navigateByUrl('/elsewhere');
    expect(html.dataset['codePalette']).toBeUndefined();
  });

  it('honours ?palette= on load', async () => {
    await open('/code?palette=refined');
    expect(html.dataset['codePalette']).toBe('refined');
    expect(screen.getByRole('radio', { name: 'Refined' })).toBeChecked();
  });

  it('ignores an unknown ?palette=', async () => {
    await open('/code?palette=neon');
    expect(html.dataset['codePalette']).toBeUndefined();
    expect(screen.getByRole('radio', { name: 'Current' })).toBeChecked();
  });
});
