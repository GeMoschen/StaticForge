import '@angular/compiler';
import { fireEvent, render, screen } from '@testing-library/angular';
import { forEachDiagnostic } from '@codemirror/lint';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import { SfCodeEditorComponent } from '../code-editor/code-editor.component';
import { SfOctlEditorComponent } from './sf-octl-editor.component';

const SOURCE = '<li>\n  $CMS_VALUE(nme)$\n</li>';

async function setup(inputs: Partial<{ value: string; readOnly: boolean; diagnostics: unknown[] }> = {}) {
  const valueChange = vi.fn();
  const view = await render(SfOctlEditorComponent, {
    componentInputs: {
      value: inputs.value ?? SOURCE,
      label: 'Record template for channel html',
      diagnostics: inputs.diagnostics ?? [],
      readOnly: inputs.readOnly ?? false,
    },
  });
  view.fixture.componentInstance.valueChange.subscribe(valueChange);
  const code = view.fixture.debugElement.query((el) => el.componentInstance instanceof SfCodeEditorComponent)
    .componentInstance as SfCodeEditorComponent;
  const editor = code.editorView as EditorView;
  return { ...view, editor, valueChange };
}

describe('SfOctlEditorComponent', () => {
  it('shows the source under its name and emits every edit', async () => {
    const { editor, valueChange } = await setup();
    expect(screen.getByRole('textbox', { name: 'Record template for channel html' })).toBeTruthy();
    expect(editor.state.doc.toString()).toBe(SOURCE);
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: 'x' } });
    expect(valueChange).toHaveBeenCalledWith('x');
  });

  it('lists diagnostics, underlines them and jumps to a diagnostic position on click', async () => {
    const { editor } = await setup({
      diagnostics: [{ severity: 'ERROR', code: 'SF-TPL-0103', message: 'Unknown editor name: nme', line: 2, column: 14 }],
    });
    expect(screen.getByText(/SF-TPL-0103/)).toBeTruthy();
    const marks: number[] = [];
    forEachDiagnostic(editor.state, (_d, from) => marks.push(from));
    expect(marks).toEqual([SOURCE.indexOf('nme')]);
    fireEvent.click(screen.getByRole('button', { name: 'Go to line 2, column 14' }));
    expect(editor.state.selection.main.head).toBe(SOURCE.indexOf('nme'));
  });

  it('inserts a snippet at the caret and leaves the caret where the snippet says', async () => {
    const { fixture, editor, valueChange } = await setup({ value: '<p></p>' });
    editor.dispatch({ selection: { anchor: 3 } });
    fixture.componentInstance.insert('$CMS_IF(_first)$$CMS_END_IF$', '$CMS_IF(_first)$'.length);
    expect(valueChange).toHaveBeenCalledWith('<p>$CMS_IF(_first)$$CMS_END_IF$</p>');
    expect(editor.state.selection.main.head).toBe(3 + '$CMS_IF(_first)$'.length);
  });

  it('is read-only on request: no insert, a read-only editor', async () => {
    const { fixture, editor, valueChange } = await setup({ readOnly: true });
    expect(editor.state.readOnly).toBe(true);
    fixture.componentInstance.insert('$CMS_VALUE(_uid)$');
    expect(valueChange).not.toHaveBeenCalled();
    expect(editor.state.doc.toString()).toBe(SOURCE);
  });
});
