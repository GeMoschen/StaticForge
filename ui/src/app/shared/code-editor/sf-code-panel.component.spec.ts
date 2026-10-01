import { Component, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { fireEvent, waitFor } from '@testing-library/angular';
import { beforeEach, describe, expect, it } from 'vitest';
import { SfCodeEditorComponent } from './code-editor.component';
import type { CodeDiagnostic, CodeLanguage } from './code-editor.types';
import { SfCodePanelComponent } from './sf-code-panel.component';

@Component({
  standalone: true,
  imports: [SfCodePanelComponent],
  template: `<div style="height: 30rem; display: flex; flex-direction: column">
    <sf-code-panel
      [fileName]="fileName()"
      [languageLabel]="languageLabel()"
      [value]="value()"
      [language]="language()"
      label="Source"
      [diagnostics]="diagnostics()"
      [readOnly]="readOnly()"
      [formattable]="formattable()"
      (valueChange)="changes.push($event); value.set($event)"
    />
  </div>`,
})
class HostComponent {
  readonly fileName = signal('article.cdl');
  readonly languageLabel = signal('CDL');
  readonly value = signal('content {\neditor text title { }\n}');
  readonly language = signal<CodeLanguage>('cdl');
  readonly diagnostics = signal<CodeDiagnostic[]>([]);
  readonly readOnly = signal(false);
  readonly formattable = signal(true);
  readonly changes: string[] = [];
  readonly panel = viewChild.required(SfCodePanelComponent);
}

describe('SfCodePanelComponent', () => {
  let host: HostComponent;
  let root: HTMLElement;
  let detect: () => void;
  let editor: SfCodeEditorComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    root = fixture.nativeElement as HTMLElement;
    detect = () => fixture.detectChanges();
    detect();
    editor = fixture.debugElement.query(By.directive(SfCodeEditorComponent)).componentInstance;
  });

  const view = () => editor.editorView!;
  const text = (selector: string) => root.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();
  const button = (name: string) =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('.sf-code-panel__header button')).find((b) =>
      b.textContent?.includes(name),
    );

  it('shows the file name and the language in the header', () => {
    expect(text('.sf-code-panel__file')).toBe('article.cdl');
    expect(text('.sf-code-panel__language')).toBe('CDL');
    expect(text('.sf-code-panel__status-language')).toBe('CDL');
  });

  it('formats the text and reports it', async () => {
    fireEvent.click(button('Format')!);
    detect();
    await waitFor(() => expect(host.changes).toEqual(['content {\n  editor text title { }\n}']));
    expect(view().state.doc.toString()).toBe('content {\n  editor text title { }\n}');
  });

  it('says so when the text cannot be formatted, until the next edit', async () => {
    host.language.set('json');
    host.value.set('{"a":');
    detect();
    expect(text('.sf-code-panel__notice')).toBe('');
    fireEvent.click(button('Format')!);
    detect();
    expect(root.querySelector('.sf-code-panel__notice')!.getAttribute('role')).toBe('status');
    expect(text('.sf-code-panel__notice')).toBe('Can’t format: the text doesn’t parse');
    expect(host.changes).toEqual([]);
    view().dispatch({ changes: { from: view().state.doc.length, insert: '1}' } });
    detect();
    await waitFor(() => expect(text('.sf-code-panel__notice')).toBe(''));
  });

  it('offers Format only for a formattable, editable language with a formatter', () => {
    expect(button('Format')).toBeDefined();
    host.readOnly.set(true);
    detect();
    expect(button('Format')).toBeUndefined();
    expect(text('.sf-code-panel__readonly')).toContain('Read-only');
    host.readOnly.set(false);
    host.formattable.set(false);
    detect();
    expect(button('Format')).toBeUndefined();
    host.formattable.set(true);
    host.language.set('where');
    detect();
    expect(button('Format')).toBeUndefined();
  });

  it('opens the search panel from Find', () => {
    expect(root.querySelector('.cm-search')).toBeNull();
    fireEvent.click(button('Find')!);
    expect(root.querySelector('.cm-search')).not.toBeNull();
  });

  it('lists the diagnostics, errors first, and jumps to one', async () => {
    expect(root.querySelector('.sf-code-panel__problems')).toBeNull();
    host.diagnostics.set([
      { severity: 'WARNING', message: 'Unused rule', line: 1, column: 1 },
      { severity: 'ERROR', code: 'SF-CDL-0101', message: 'Unknown editor type', line: 2, column: 8 },
      { severity: 'INFO', message: 'Hint', line: 3, column: 1 },
    ]);
    detect();
    const rows = () => Array.from(root.querySelectorAll<HTMLButtonElement>('.sf-code-panel__problem'));
    const part = (row: Element, selector: string) => row.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();
    expect(
      rows().map((r) => [
        part(r, '.sf-status__label'),
        part(r, '.sf-code-panel__message'),
        part(r, '.sf-code-panel__where'),
      ]),
    ).toEqual([
      ['Error', 'SF-CDL-0101 Unknown editor type', 'Ln 2, Col 8'],
      ['Warning', 'Unused rule', 'Ln 1, Col 1'],
      ['Info', 'Hint', 'Ln 3, Col 1'],
    ]);
    expect(text('.sf-code-panel__count')).toBe('3');
    expect(text('.sf-code-panel__status')).toContain('1 error');
    expect(text('.sf-code-panel__status')).toContain('1 warning');

    fireEvent.click(rows()[0]);
    detect();
    expect(view().state.selection.main.head).toBe(view().state.doc.line(2).from + 7);
    expect(view().hasFocus || document.activeElement === view().contentDOM).toBe(true);
    await waitFor(() => expect(text('.sf-code-panel__position')).toBe('Ln 2, Col 8'));

    // Collapsible.
    fireEvent.click(root.querySelector('.sf-code-panel__problems-toggle')!);
    detect();
    expect(rows()).toHaveLength(0);
    expect(root.querySelector('.sf-code-panel__problems-toggle')!.getAttribute('aria-expanded')).toBe('false');
  });

  it('follows the caret in the status line', async () => {
    expect(text('.sf-code-panel__position')).toBe('Ln 1, Col 1');
    view().dispatch({ selection: { anchor: view().state.doc.line(3).from + 1 } });
    detect();
    await waitFor(() => expect(text('.sf-code-panel__position')).toBe('Ln 3, Col 2'));
    expect(host.panel().cursor()).toEqual({ line: 3, column: 2 });
  });
});
