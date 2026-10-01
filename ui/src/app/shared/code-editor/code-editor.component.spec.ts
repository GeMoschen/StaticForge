import '@angular/compiler';
import { Component, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ensureSyntaxTree } from '@codemirror/language';
import { forEachDiagnostic } from '@codemirror/lint';
import { beforeEach, describe, expect, it } from 'vitest';
import { CodeDiagnostic, CodeFormat, CodeLanguage, SfCodeEditorComponent } from './code-editor.component';
import { loadFormat } from './formats';

@Component({
  standalone: true,
  imports: [SfCodeEditorComponent],
  template: `<sf-code-editor
    [value]="value()"
    [language]="language()"
    label="CDL source"
    [diagnostics]="diagnostics()"
    [readOnly]="readOnly()"
    [format]="format()"
    (valueChange)="changes.push($event); value.set($event)"
    (cursorChange)="cursors.push($event)"
  />`,
})
class HostComponent {
  readonly value = signal('content {\n  editor text title { }\n}');
  readonly language = signal<CodeLanguage>('cdl');
  readonly diagnostics = signal<CodeDiagnostic[]>([]);
  readonly readOnly = signal(false);
  readonly format = signal<CodeFormat>('PLAIN');
  readonly changes: string[] = [];
  readonly cursors: { line: number; column: number }[] = [];
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

  it('cancels a click in the text so an enclosing label cannot forward it to another control', () => {
    const root = fixture.nativeElement as HTMLElement;
    const click = (target: Element) => {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(click(root.querySelector('.cm-content')!)).toBe(true);
    // A real control inside the editor (the search panel's buttons and checkboxes) keeps its behavior.
    const control = document.createElement('input');
    root.querySelector('.cm-editor')!.append(control);
    expect(click(control)).toBe(false);
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

  it('reports where the caret moves, once per position', () => {
    host.editor().goTo(2, 3);
    host.editor().goTo(2, 3);
    view().dispatch({ selection: { anchor: 0 } });
    expect(host.cursors).toEqual([
      { line: 2, column: 3 },
      { line: 1, column: 1 },
    ]);
    // Typing moves it too.
    view().dispatch({ changes: { from: 0, insert: 'ab' }, selection: { anchor: 2 } });
    expect(host.cursors.at(-1)).toEqual({ line: 1, column: 3 });
  });

  it('opens the search panel', () => {
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.cm-search')).toBeNull();
    host.editor().openSearch();
    expect(root.querySelector('.cm-search')).not.toBeNull();
  });

  it('highlights an OCTL template as its format once the grammar has loaded', async () => {
    // The language is fixed when the editor is created: a fresh host for OCTL.
    fixture.destroy();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    host.language.set('octl');
    host.value.set('<p class="x">$CMS_VALUE(title)$</p>');
    fixture.detectChanges();
    // The node at `class`: an HTML attribute name once HTML parses the text between the instructions.
    const nodeAtClass = () => ensureSyntaxTree(view().state, view().state.doc.length, 5000)!.resolveInner(4, 1).name;
    expect(nodeAtClass()).not.toBe('AttributeName');

    host.format.set('HTML');
    fixture.detectChanges();
    await loadFormat('HTML');
    await Promise.resolve();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-format="HTML"]')).not.toBeNull();
    expect(nodeAtClass()).toBe('AttributeName');

    // The markup has a palette of its own: the tag name and the instruction don't share a highlight class.
    fixture.detectChanges();
    const classOf = (text: string) =>
      Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.cm-line span')).find(
        (span) => span.textContent === text,
      )?.className;
    expect(classOf('p')).toBeTruthy();
    expect(classOf('$CMS_VALUE')).toBeTruthy();
    expect(classOf('p')).not.toBe(classOf('$CMS_VALUE'));

    host.format.set('PLAIN');
    fixture.detectChanges();
    expect(nodeAtClass()).not.toBe('AttributeName');
  });
});
