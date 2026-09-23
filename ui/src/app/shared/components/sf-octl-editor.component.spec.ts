import '@angular/compiler';
import { fireEvent, render, screen } from '@testing-library/angular';
import { describe, expect, it, vi } from 'vitest';
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
  const area = screen.getByRole('textbox', { name: 'Record template for channel html' }) as HTMLTextAreaElement;
  return { ...view, area, valueChange };
}

describe('SfOctlEditorComponent', () => {
  it('shows the source and emits every edit', async () => {
    const { area, valueChange } = await setup();
    expect(area.value).toBe(SOURCE);
    fireEvent.input(area, { target: { value: 'x' } });
    expect(valueChange).toHaveBeenCalledWith('x');
  });

  it('lists diagnostics and jumps to a diagnostic position on click', async () => {
    const { area } = await setup({
      diagnostics: [{ severity: 'ERROR', code: 'SF-TPL-0103', message: 'Unknown editor name: nme', line: 2, column: 14 }],
    });
    expect(area.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText(/SF-TPL-0103/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Go to line 2, column 14' }));
    expect(area.selectionStart).toBe(SOURCE.indexOf('nme'));
    expect(document.activeElement).toBe(area);
  });

  it('inserts a snippet at the caret and leaves the caret where the snippet says', async () => {
    const { fixture, area, valueChange } = await setup({ value: '<p></p>' });
    area.setSelectionRange(3, 3);
    fixture.componentInstance.insert('$CMS_IF(_first)$$CMS_END_IF$', '$CMS_IF(_first)$'.length);
    expect(valueChange).toHaveBeenCalledWith('<p>$CMS_IF(_first)$$CMS_END_IF$</p>');
    expect(area.selectionStart).toBe(3 + '$CMS_IF(_first)$'.length);
  });

  it('is read-only on request: no insert, readonly textarea', async () => {
    const { fixture, area, valueChange } = await setup({ readOnly: true });
    expect(area.readOnly).toBe(true);
    fixture.componentInstance.insert('$CMS_VALUE(_uid)$');
    expect(valueChange).not.toHaveBeenCalled();
    expect(area.value).toBe(SOURCE);
  });
});
