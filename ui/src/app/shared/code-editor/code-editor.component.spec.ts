import '@angular/compiler';
import { Component, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { forEachDiagnostic } from '@codemirror/lint';
import { beforeEach, describe, expect, it } from 'vitest';
import { CodeDiagnostic, CodeLanguage, SfCodeEditorComponent } from './code-editor.component';

@Component({
  standalone: true,
  imports: [SfCodeEditorComponent],
  template: `<sf-code-editor
    [value]="value()"
    [language]="language()"
    label="CDL source"
    [diagnostics]="diagnostics()"
    [readOnly]="readOnly()"
    (valueChange)="changes.push($event); value.set($event)"
  />`,
})
class HostComponent {
  readonly value = signal('content {\n  editor text title { }\n}');
  readonly language = signal<CodeLanguage>('cdl');
  readonly diagnostics = signal<CodeDiagnostic[]>([]);
  readonly readOnly = signal(false);
  readonly changes: string[] = [];
  readonly editor = viewChild.required(SfCodeEditorComponent);
}

describe('SfCodeEditorComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  function view() {
    return host.editor().editorView!;
  }

  it('shows the value with an accessible name and highlighted tokens', () => {
    expect(view().state.doc.toString()).toBe(host.value());
    const content = (fixture.nativeElement as HTMLElement).querySelector('.cm-content')!;
    expect(content.getAttribute('aria-label')).toBe('CDL source');
    expect((fixture.nativeElement as HTMLElement).querySelector('.cm-lineNumbers')).not.toBeNull();
  });

  it('reports edits, and an echoed value changes nothing', () => {
    view().dispatch({ changes: { from: 0, insert: '// top\n' } });
    fixture.detectChanges();
    expect(host.changes).toEqual(['// top\ncontent {\n  editor text title { }\n}']);
    expect(view().state.doc.toString()).toBe(host.value());

    host.value.set('content { }');
    fixture.detectChanges();
    expect(view().state.doc.toString()).toBe('content { }');
    // The host's own text isn't reported back as an edit.
    expect(host.changes).toHaveLength(1);
  });

  it('underlines the diagnostics at their position', () => {
    host.diagnostics.set([{ severity: 'ERROR', code: 'SF-CDL-0101', message: 'Unknown editor type', line: 2, column: 10 }]);
    fixture.detectChanges();
    const found: { from: number; to: number; severity: string; message: string }[] = [];
    forEachDiagnostic(view().state, (d, from, to) => found.push({ from, to, severity: d.severity, message: d.message }));
    expect(found).toEqual([{ from: 19, to: 23, severity: 'error', message: 'SF-CDL-0101: Unknown editor type' }]);
  });

  it('goes to a position, inserts at the caret and honors read-only', () => {
    host.editor().goTo(2, 3);
    expect(view().state.selection.main.head).toBe(12);
    host.editor().insert('X');
    expect(view().state.doc.line(2).text).toBe('  Xeditor text title { }');

    host.readOnly.set(true);
    fixture.detectChanges();
    host.editor().insert('Y');
    expect(view().state.doc.line(2).text).toBe('  Xeditor text title { }');
    expect(view().state.readOnly).toBe(true);
  });
});
