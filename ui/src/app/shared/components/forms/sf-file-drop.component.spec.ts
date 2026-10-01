import { Component } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { fireEvent, render, screen } from '@testing-library/angular';
import { describe, expect, it, vi } from 'vitest';
import { SfFieldComponent } from '../sf-field.component';
import { SfFileDropComponent, accepts } from './sf-file-drop.component';

const png = (name = 'logo.png', bytes = 10) => new File([new Uint8Array(bytes)], name, { type: 'image/png' });
const pdf = () => new File(['%PDF'], 'terms.pdf', { type: 'application/pdf' });

const zone = () => document.querySelector('.sf-file-drop__zone') as HTMLElement;
const picker = () => document.querySelector('input[type=file]') as HTMLInputElement;

@Component({
  standalone: true,
  imports: [SfFieldComponent, SfFileDropComponent, ReactiveFormsModule],
  template: `
    <sf-field label="Images" hint="PNG up to 1 KB">
      <sf-file-drop accept="image/*,.svg" [maxSize]="1024" [multiple]="multiple" [formControl]="files" />
    </sf-field>
  `,
})
class Host {
  multiple = true;
  readonly files = new FormControl<File[]>([], { nonNullable: true });
}

describe('SfFileDropComponent', () => {
  it('is a group named by its field; the choose button is the focus target, described by the hint', async () => {
    await render(Host);

    const group = screen.getByRole('group', { name: 'Images' });
    expect(group).not.toHaveAttribute('tabindex');
    const choose = screen.getByRole('button', { name: 'Choose files' });
    expect(group).toContainElement(choose);
    expect(choose).toHaveAccessibleDescription('PNG up to 1 KB');
    expect(screen.getByText('Drop files here or')).toBeInTheDocument();
  });

  it('takes aria-label outside a field and says "a file" when single', async () => {
    await render(`<sf-file-drop aria-label="Logo" />`, { imports: [SfFileDropComponent] });

    expect(screen.getByRole('group', { name: 'Logo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose a file' })).toBeInTheDocument();
    expect(screen.getByText('Drop a file here or')).toBeInTheDocument();
  });

  it('marks the group invalid with the field error, which describes the button', async () => {
    await render(`<sf-field label="Logo" error="A logo is required"><sf-file-drop /></sf-field>`, {
      imports: [SfFieldComponent, SfFileDropComponent],
    });

    expect(screen.getByRole('group', { name: 'Logo' })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Choose a file' })).toHaveAccessibleDescription('A logo is required');
  });

  it('opens the native picker from the button and adds what was picked', async () => {
    const { fixture } = await render(Host);
    const control = fixture.componentInstance.files;
    const click = vi.spyOn(picker(), 'click').mockImplementation(() => undefined);

    fireEvent.click(screen.getByRole('button', { name: 'Choose files' }));
    expect(click).toHaveBeenCalled();

    const file = png();
    fireEvent.change(picker(), { target: { files: [file] } });
    expect(control.value).toEqual([file]);
    fixture.detectChanges();
    expect(screen.getByRole('listitem')).toHaveTextContent('logo.png');
    expect(screen.getByRole('listitem')).toHaveTextContent('10 B');
  });

  it('highlights while dragging over and adds dropped files', async () => {
    const { fixture } = await render(Host);
    const control = fixture.componentInstance.files;

    expect(fireEvent.dragEnter(zone())).toBe(false);
    fixture.detectChanges();
    expect(zone()).toHaveClass('is-dragover');
    expect(screen.getByText('Release to add')).toBeInTheDocument();
    expect(fireEvent.dragOver(zone())).toBe(false);

    const a = png('a.png');
    const b = new File(['<svg/>'], 'b.svg', { type: '' });
    fireEvent.drop(zone(), { dataTransfer: { files: [a, b] } });
    fixture.detectChanges();
    expect(zone()).not.toHaveClass('is-dragover');
    expect(control.value).toEqual([a, b]);

    // Leaving without dropping clears the highlight too.
    fireEvent.dragEnter(zone());
    fireEvent.dragLeave(zone());
    fixture.detectChanges();
    expect(zone()).not.toHaveClass('is-dragover');
  });

  it('rejects files of other types or too large, and says why in a polite live region', async () => {
    const { fixture } = await render(Host);
    const control = fixture.componentInstance.files;
    const ok = png('ok.png');

    fireEvent.drop(zone(), { dataTransfer: { files: [pdf(), png('huge.png', 4096), ok] } });
    fixture.detectChanges();

    expect(control.value).toEqual([ok]);
    const region = document.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(region).toHaveTextContent('terms.pdf is not an accepted file type.');
    expect(region).toHaveTextContent('huge.png is larger than 1 KB.');
  });

  it('replaces the file when not multiple', async () => {
    const { fixture } = await render(Host, { componentProperties: { multiple: false } });
    fixture.detectChanges();
    const control = fixture.componentInstance.files;
    const first = png('first.png');
    const second = png('second.png');

    fireEvent.drop(zone(), { dataTransfer: { files: [first] } });
    fireEvent.drop(zone(), { dataTransfer: { files: [second] } });
    expect(control.value).toEqual([second]);
  });

  it('removes a file with its button and moves focus to the next one, then to "Choose"', async () => {
    const { fixture } = await render(Host);
    const control = fixture.componentInstance.files;
    const a = png('a.png');
    const b = png('b.png');
    control.setValue([a, b]);
    fixture.detectChanges();

    fireEvent.click(screen.getByRole('button', { name: 'Remove a.png' }));
    expect(control.value).toEqual([b]);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove b.png' }));

    fireEvent.click(screen.getByRole('button', { name: 'Remove b.png' }));
    expect(control.value).toEqual([]);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Choose files' }));
  });

  it('disabled with the control: no drop, buttons disabled', async () => {
    const { fixture } = await render(Host);
    const control = fixture.componentInstance.files;
    control.setValue([png('a.png')]);
    control.disable();
    fixture.detectChanges();

    expect(screen.getByRole('button', { name: 'Choose files' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove a.png' })).toBeDisabled();
    expect(fireEvent.dragOver(zone())).toBe(true);
    fireEvent.drop(zone(), { dataTransfer: { files: [png('b.png')] } });
    expect(control.value).toHaveLength(1);
  });

  it('read-only: lists the files without remove buttons and takes no new ones', async () => {
    const file = png('a.png');
    await render(`<sf-file-drop aria-label="Logo" readonly [value]="files" />`, {
      imports: [SfFileDropComponent],
      componentProperties: { files: [file] },
    });

    expect(screen.getByRole('listitem')).toHaveTextContent('a.png');
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Choose a file' })).toBeDisabled();
  });

  it('marks the control touched when focus leaves it', async () => {
    const { fixture } = await render(Host);
    const choose = screen.getByRole('button', { name: 'Choose files' });

    fireEvent.focusOut(choose);
    expect(fixture.componentInstance.files.touched).toBe(true);
  });

  it('matches the native accept syntax', () => {
    expect(accepts(png(), null)).toBe(true);
    expect(accepts(png(), 'image/*')).toBe(true);
    expect(accepts(png(), 'image/png')).toBe(true);
    expect(accepts(png('LOGO.PNG'), '.png')).toBe(true);
    expect(accepts(pdf(), 'image/*, .svg')).toBe(false);
  });
});
