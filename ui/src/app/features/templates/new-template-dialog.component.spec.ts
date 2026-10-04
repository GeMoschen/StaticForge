import '@angular/compiler';
import { fireEvent, render, screen, within } from '@testing-library/angular';
import { describe, expect, it, vi } from 'vitest';
import { SF_DIALOG_DATA, SfDialogRef } from '../../shared/components/dialog/dialog-ref';
import { type NewTemplateData, type NewTemplateResult, NewTemplateDialogComponent, uidOf } from './new-template-dialog.component';

/** The New template dialog (M35.21, gate decision 155): the kind is chosen explicitly. */

const FOLDERS = { page: 'Blog', section: 'Section Templates', dataset: 'Datasets' };

/** A disabled button with a reason stays focusable (`aria-disabled`); its tooltip describes why on focus. */
function reasonOf(button: HTMLElement): string {
  vi.spyOn(button, 'matches').mockReturnValue(true);
  fireEvent.focusIn(button);
  return button.getAttribute('aria-describedby') ? (document.getElementById(button.getAttribute('aria-describedby')!)?.textContent ?? '') : '';
}

async function open(data: Partial<NewTemplateData> = {}) {
  const ref = new SfDialogRef<NewTemplateResult>();
  const close = vi.spyOn(ref, 'close');
  await render(NewTemplateDialogComponent, {
    providers: [
      { provide: SF_DIALOG_DATA, useValue: { folders: FOLDERS, started: 'Blog', kind: null, candidates: CANDIDATES, ...data } },
      { provide: SfDialogRef, useValue: ref },
    ],
  });
  const dialog = await screen.findByRole('dialog', { name: 'New template' });
  return {
    close,
    dialog,
    create: within(dialog).getByRole('button', { name: 'Create' }),
    name: within(dialog).getByRole('textbox', { name: /^Name/ }),
    uid: within(dialog).getByRole('textbox', { name: /^UID/ }),
    kind: (label: string) => within(dialog).getByRole('radio', { name: label }),
  };
}

const CANDIDATES = [
  { uuid: 'article', name: 'Article', kind: 'page' as const },
  { uuid: 'teaser', name: 'Teaser', kind: 'section' as const },
];

describe('NewTemplateDialogComponent', () => {
  it('opened from the header button chooses nothing: three kinds, none checked, Create says to choose a kind first', async () => {
    const { dialog, create, kind } = await open({ kind: null });

    for (const label of ['Page template', 'Section template', 'Dataset']) {
      expect(kind(label)).not.toBeChecked();
    }
    expect(create).toHaveAttribute('aria-disabled', 'true');
    expect(reasonOf(create)).toBe('Choose a kind first.');
    expect(within(dialog).getByText('Created in Blog.')).toBeInTheDocument();
    expect(within(dialog).getByText('The kind can’t be changed after it is created.')).toBeInTheDocument();
  });

  it('opened from a New ▸ kind entry has that kind chosen, and says where it is created for that kind', async () => {
    const { dialog, kind } = await open({ kind: 'section' });

    expect(kind('Section template')).toBeChecked();
    expect(kind('Page template')).not.toBeChecked();
    expect(within(dialog).getByText('Created in Section Templates.')).toBeInTheDocument();
  });

  it('never takes the kind from where it was started: choosing another kind changes where it is created', async () => {
    const { dialog, kind } = await open({ kind: null });

    fireEvent.click(kind('Dataset'));

    expect(kind('Dataset')).toBeChecked();
    expect(await within(dialog).findByText('Created in Datasets.')).toBeInTheDocument();
  });

  it('says it goes into the folder of its kind when it was started at the top level and no kind is chosen', async () => {
    const { dialog } = await open({ started: null, kind: null });
    expect(within(dialog).getByText(/folder of its kind/)).toBeInTheDocument();
  });

  it('Create stays disabled until a kind, a name and a valid UID are there, and says which one is missing', async () => {
    const { dialog, create, name, uid, kind } = await open({ kind: null });
    expect(reasonOf(create)).toBe('Choose a kind first.');

    fireEvent.click(kind('Page template'));
    expect(create).toHaveAttribute('aria-disabled', 'true');
    expect(reasonOf(create)).toBe('Enter a name first.');

    fireEvent.input(name, { target: { value: 'Landing page' } });
    expect(create).not.toHaveAttribute('aria-disabled', 'true');

    fireEvent.input(uid, { target: { value: '9 bad' } });
    expect(create).toHaveAttribute('aria-disabled', 'true');
    expect(await within(dialog).findAllByText(/starts with a letter/)).not.toHaveLength(0);
  });

  it('derives the UID from the name until the UID is edited by hand', async () => {
    const { name, uid } = await open({ kind: 'page' });

    fireEvent.input(name, { target: { value: 'Landing Page 2' } });
    expect(uid).toHaveValue('landing_page_2');

    fireEvent.input(uid, { target: { value: 'my_own' } });
    fireEvent.input(name, { target: { value: 'Something else' } });
    expect(uid).toHaveValue('my_own');
  });

  it('closes with the kind, the name and the UID, with the button and with Enter', async () => {
    const { close, create, name, kind } = await open({ kind: null });
    fireEvent.click(kind('Dataset'));
    fireEvent.input(name, { target: { value: 'Team members' } });

    fireEvent.click(create);
    expect(close).toHaveBeenLastCalledWith({ kind: 'dataset', name: 'Team members', uid: 'team_members', basedOn: null });

    fireEvent.submit(name.closest('form')!);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('offers only the items of the chosen kind as Based on, and closes with the chosen one', async () => {
    const { dialog, close, create, name, kind } = await open({ kind: null });
    expect(within(dialog).queryByText('Based on')).not.toBeInTheDocument();
    fireEvent.click(kind('Page template'));
    expect(within(dialog).getByText('Based on')).toBeInTheDocument();
    expect(within(dialog).getByText('Nothing — start empty')).toBeInTheDocument();

    const select = within(dialog).getByRole('combobox', { name: /Based on/ }) as HTMLSelectElement;
    expect(within(select).getByRole('option', { name: 'Article' })).toBeInTheDocument();
    expect(within(select).queryByRole('option', { name: 'Teaser' })).not.toBeInTheDocument();
    fireEvent.change(select, { target: { value: '1' } });
    fireEvent.input(name, { target: { value: 'News' } });
    fireEvent.click(create);

    expect(close).toHaveBeenLastCalledWith({ kind: 'page', name: 'News', uid: 'news', basedOn: 'article' });
  });

  it('does nothing on Enter while something is missing, and closes without a result on Cancel', async () => {
    const { dialog, close, name } = await open({ kind: null });

    fireEvent.input(name, { target: { value: 'Only a name' } });
    fireEvent.submit(name.closest('form')!);
    expect(close).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(close).toHaveBeenCalledWith();
  });

  it('derives UIDs the way the server expects: lower case, digits and underscores, starting with a letter', () => {
    expect(uidOf('  Landing Page 2 ')).toBe('landing_page_2');
    expect(uidOf('2024 Review')).toBe('review');
    expect(uidOf('Ünïcode & more!')).toBe('n_code_more');
    expect(uidOf('???')).toBe('');
  });
});
