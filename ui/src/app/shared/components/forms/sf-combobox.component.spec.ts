import { Component, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { fireEvent, render, screen } from '@testing-library/angular';
import { describe, expect, it, vi } from 'vitest';
import { SfFieldComponent } from '../sf-field.component';
import { SfComboboxComponent, SfComboboxOption } from './sf-combobox.component';

const languages: SfComboboxOption<string>[] = [
  { value: 'en', label: 'English', group: 'Europe' },
  { value: 'de', label: 'German', group: 'Europe', description: 'Deutsch' },
  { value: 'fr', label: 'French', group: 'Europe', disabled: true },
  { value: 'ja', label: 'Japanese', group: 'Asia' },
  { value: 'ko', label: 'Korean', group: 'Asia' },
];

async function setup(template = `<sf-combobox aria-label="Language" [options]="options" [(value)]="value" />`) {
  const result = await render(template, {
    imports: [SfComboboxComponent, SfFieldComponent],
    componentProperties: { options: languages, value: null as unknown },
  });
  const input = screen.getByRole('combobox') as HTMLInputElement;
  const host = result.fixture.componentInstance as unknown as { value: unknown };
  const key = (key: string, init: KeyboardEventInit = {}) => {
    fireEvent.keyDown(input, { key, ...init });
    result.fixture.detectChanges();
  };
  const type = (text: string) => {
    fireEvent.input(input, { target: { value: text } });
    result.fixture.detectChanges();
  };
  const active = () => {
    const id = input.getAttribute('aria-activedescendant');
    return id ? document.getElementById(id)?.querySelector('.sf-combobox__label')?.textContent : null;
  };
  const optionLabels = () =>
    screen.queryAllByRole('option').map((option) => option.querySelector('.sf-combobox__label')?.textContent);
  const live = () => document.querySelector('[aria-live="polite"]')?.textContent?.trim();
  return { ...result, input, host, key, type, active, optionLabels, live };
}

describe('SfComboboxComponent', () => {
  it('is a collapsed combobox with list autocomplete, labelled and described by its field', async () => {
    await render(
      `<sf-field label="Language" hint="Used for new pages" error="Pick a language" required>
         <sf-combobox [options]="options" placeholder="Choose…" />
       </sf-field>`,
      { imports: [SfComboboxComponent, SfFieldComponent], componentProperties: { options: languages } },
    );

    const input = screen.getByRole('combobox', { name: 'Language' });
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Used for new pages Pick a language');
    expect(input).not.toHaveAttribute('aria-activedescendant');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('has an icon-only toggle button out of the tab order that opens and closes the list', async () => {
    const { input, fixture } = await setup();

    const toggle = screen.getByRole('button', { name: 'Show options' });
    expect(toggle).toHaveAttribute('tabindex', '-1');
    fireEvent.click(toggle);
    fixture.detectChanges();
    const listbox = screen.getByRole('listbox', { name: 'Language' });
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveAttribute('aria-controls', listbox.id);
    expect(input).not.toHaveAttribute('aria-activedescendant');
    expect(document.activeElement).toBe(input);

    fireEvent.click(toggle);
    fixture.detectChanges();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('opens with ArrowDown on the first option and moves with the arrows (wrapping), Home and End', async () => {
    const { input, key, active } = await setup();

    key('ArrowDown');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(active()).toBe('English');
    key('ArrowDown');
    expect(active()).toBe('German');
    key('ArrowDown');
    expect(active()).toBe('French'); // disabled options stay reachable
    key('End');
    expect(active()).toBe('Korean');
    key('ArrowDown');
    expect(active()).toBe('English');
    key('ArrowUp');
    expect(active()).toBe('Korean');
    key('Home');
    expect(active()).toBe('English');
    expect(document.getElementById(input.getAttribute('aria-activedescendant')!)).toHaveClass('is-active');
  });

  it('opens with ArrowUp on the last option and with Alt+ArrowDown without an active option; Alt+ArrowUp closes', async () => {
    const { input, key, active } = await setup();

    key('ArrowUp');
    expect(active()).toBe('Korean');
    key('Escape');
    key('ArrowDown', { altKey: true });
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(active()).toBeNull();
    key('ArrowUp', { altKey: true });
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('renders option roles, groups, descriptions and disabled options', async () => {
    const { key } = await setup();
    key('ArrowDown');

    expect(screen.getByRole('group', { name: 'Europe' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Asia' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /German/ })).toHaveTextContent('Deutsch');
    const french = screen.getByRole('option', { name: /French/ });
    expect(french).toHaveAttribute('aria-disabled', 'true');
    screen.getAllByRole('option').forEach((option) => expect(option).toHaveAttribute('aria-selected', 'false'));
    expect(screen.getByRole('listbox')).not.toHaveAttribute('aria-multiselectable');
  });

  it('chooses the active option with Enter: value, label in the input, list closed', async () => {
    const { input, key, host } = await setup();

    key('ArrowDown');
    key('ArrowDown');
    key('Enter');
    expect(host.value).toBe('de');
    expect(input.value).toBe('German');
    expect(input).toHaveAttribute('aria-expanded', 'false');

    // Reopening starts on the selected option, now aria-selected.
    key('ArrowDown');
    expect(screen.getByRole('option', { name: /German/ })).toHaveAttribute('aria-selected', 'true');
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: /German/ }).id);
  });

  it('does not choose a disabled option', async () => {
    const { key, host, active } = await setup();

    key('ArrowDown');
    key('ArrowDown');
    key('ArrowDown');
    expect(active()).toBe('French');
    key('Enter');
    expect(host.value).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: /French/ }));
    expect(host.value).toBeNull();
  });

  it('chooses an option by click', async () => {
    const { input, key, host, fixture } = await setup();

    key('ArrowDown');
    fireEvent.click(screen.getByRole('option', { name: /Japanese/ }));
    fixture.detectChanges();
    expect(host.value).toBe('ja');
    expect(input.value).toBe('Japanese');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('filters by typed text (case-insensitive substring), activates the first match and announces the count', async () => {
    const queries: string[] = [];
    const { type, optionLabels, active, live, input, fixture } = await setup(
      `<sf-combobox aria-label="Language" [options]="options" (query)="onQuery($event)" />`,
    );
    (fixture.componentInstance as unknown as { onQuery: (q: string) => void }).onQuery = (q) => queries.push(q);

    type('AN');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(optionLabels()).toEqual(['German', 'Japanese', 'Korean']);
    expect(active()).toBe('German');
    expect(live()).toBe('3 options');

    type('ese');
    expect(optionLabels()).toEqual(['Japanese']);
    expect(live()).toBe('1 option');

    type('xyz');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('No matches', { selector: '.sf-combobox__message' })).toBeInTheDocument();
    expect(live()).toBe('No matches');
    expect(input).not.toHaveAttribute('aria-activedescendant');
    expect(queries).toEqual(['AN', 'ese', 'xyz']);
  });

  it('closes on Escape, and a second Escape clears the text and the value', async () => {
    const { input, key, type, host } = await setup();
    key('ArrowDown');
    key('Enter');
    expect(host.value).toBe('en');

    type('Ger');
    key('Escape');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input.value).toBe('Ger');
    expect(host.value).toBe('en');

    key('Escape');
    expect(input.value).toBe('');
    expect(host.value).toBeNull();
  });

  it('lets a closing Escape not reach a surrounding dialog', async () => {
    const { input, key } = await setup();
    const outer = vi.fn();
    document.body.addEventListener('keydown', outer);
    key('ArrowDown');

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(outer).not.toHaveBeenCalled();
    document.body.removeEventListener('keydown', outer);
  });

  it('closes on Tab without choosing, and restores the selected label when left with other text', async () => {
    const { input, key, type, host, fixture } = await setup();
    key('ArrowDown');
    key('Enter'); // English

    type('Kor');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    key('Tab');
    fireEvent.blur(input);
    fixture.detectChanges();
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(host.value).toBe('en');
    expect(input.value).toBe('English');
  });

  it('clears the value when left with an emptied input', async () => {
    const { input, key, type, host, fixture } = await setup();
    key('ArrowDown');
    key('Enter');

    type('');
    fireEvent.blur(input);
    fixture.detectChanges();
    expect(host.value).toBeNull();
    expect(input.value).toBe('');
  });

  it('closes on a pointer down outside', async () => {
    const { key, fixture } = await setup();
    key('ArrowDown');

    fireEvent.pointerDown(document.body);
    fixture.detectChanges();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes the open list when a form disables the control', async () => {
    @Component({
      standalone: true,
      imports: [SfComboboxComponent, ReactiveFormsModule],
      template: `<sf-combobox aria-label="Language" [options]="options" [formControl]="control" />`,
    })
    class Host {
      readonly options = languages;
      readonly control = new FormControl<string | null>(null);
    }
    const { fixture } = await render(Host);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
    fixture.detectChanges();
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fixture.componentInstance.control.disable();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('scrolls the active option into view when the browser supports it', async () => {
    const scroll = vi.fn();
    (Element.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = scroll;
    try {
      const { key } = await setup();
      key('ArrowDown');
      key('ArrowDown');
      expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
    } finally {
      delete (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it('is read-only: no list, no toggle', async () => {
    await render(`<sf-combobox aria-label="Language" readonly [options]="options" value="de" />`, {
      imports: [SfComboboxComponent],
      componentProperties: { options: languages },
    });
    const input = screen.getByRole('combobox', { name: 'Language' }) as HTMLInputElement;

    expect(input.readOnly).toBe(true);
    expect(input.value).toBe('German');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show options', hidden: true })).toBeDisabled();
  });

  describe('multiple', () => {
    const multi = `<sf-combobox aria-label="Languages" multiple [options]="options" [(value)]="value" />`;

    it('toggles options, keeps the list open and the input empty, and shows chips', async () => {
      const { input, key, type, host, active, fixture } = await setup(multi);
      host.value = [];
      fixture.detectChanges();

      key('ArrowDown');
      expect(screen.getByRole('listbox')).toHaveAttribute('aria-multiselectable', 'true');
      key('Enter'); // English
      type('jap');
      key('Enter'); // Japanese
      expect(host.value).toEqual(['en', 'ja']);
      expect(input.value).toBe('');
      expect(screen.getByRole('listbox')).toBeInTheDocument();
      expect(active()).toBe('Japanese');
      expect(screen.getAllByRole('option')).toHaveLength(languages.length); // unfiltered again
      expect(screen.getByRole('option', { name: /English/ })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('button', { name: 'Remove English' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Remove Japanese' })).toBeInTheDocument();
      expect(input).toHaveAccessibleDescription('2 selected');

      key('Enter'); // Japanese again: deselects
      expect(host.value).toEqual(['en']);
    });

    it('removes the last value with Backspace in the empty input', async () => {
      const { key, host, fixture } = await setup(multi);
      host.value = ['en', 'ko'];
      fixture.detectChanges();

      key('Backspace');
      expect(host.value).toEqual(['en']);
      key('Backspace');
      expect(host.value).toEqual([]);
      expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
    });

    it('does not remove a value with Backspace while there is text', async () => {
      const { key, type, host, fixture } = await setup(multi);
      host.value = ['en'];
      fixture.detectChanges();

      type('k');
      key('Backspace');
      expect(host.value).toEqual(['en']);
    });

    it('removes a value with its chip button and keeps the focus in the input', async () => {
      const { input, host, fixture } = await setup(multi);
      host.value = ['en', 'ko'];
      fixture.detectChanges();

      fireEvent.keyDown(screen.getByRole('button', { name: 'Remove English' }), { key: 'Backspace' });
      fixture.detectChanges();
      expect(host.value).toEqual(['ko']);
      expect(document.activeElement).toBe(input);
    });

    it('works with a reactive FormControl', async () => {
      @Component({
        standalone: true,
        imports: [SfComboboxComponent, ReactiveFormsModule],
        template: `<sf-combobox aria-label="Languages" multiple [options]="options" [formControl]="control" />`,
      })
      class Host {
        readonly options = languages;
        readonly control = new FormControl<string[]>(['de'], { nonNullable: true });
      }
      const { fixture } = await render(Host);
      const control = fixture.componentInstance.control;
      const input = screen.getByRole('combobox', { name: 'Languages' });
      expect(screen.getByRole('button', { name: 'Remove German' })).toBeInTheDocument();

      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(control.value).toEqual(['de', 'en']);

      control.setValue(['ko']);
      fixture.detectChanges();
      expect(screen.getByRole('button', { name: 'Remove Korean' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Remove German' })).toBeNull();

      control.disable();
      fixture.detectChanges();
      expect(input).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Remove Korean' })).toBeDisabled();
    });
  });

  describe("filter: 'none'", () => {
    @Component({
      standalone: true,
      imports: [SfComboboxComponent],
      template: `<sf-combobox
        aria-label="Page"
        filter="none"
        [options]="options()"
        [loading]="loading()"
        [(value)]="value"
        (query)="onQuery($event)"
      />`,
    })
    class RemoteHost {
      readonly options = signal<SfComboboxOption<string>[]>([]);
      readonly loading = signal(false);
      value: string | null = null;
      readonly queries: string[] = [];
      onQuery(query: string): void {
        this.queries.push(query);
        this.loading.set(true);
      }
    }

    it('emits the query, shows loading, and shows the options the host feeds unfiltered', async () => {
      const { fixture } = await render(RemoteHost);
      const host = fixture.componentInstance;
      const input = screen.getByRole('combobox', { name: 'Page' }) as HTMLInputElement;
      const live = () => document.querySelector('[aria-live="polite"]')?.textContent?.trim();

      fireEvent.input(input, { target: { value: 'ho' } });
      fixture.detectChanges();
      expect(host.queries).toEqual(['ho']);
      expect(screen.getByText('Loading…', { selector: '.sf-combobox__message' })).toBeInTheDocument();
      expect(live()).toBe('Loading…');

      host.options.set([
        { value: '/home', label: 'Home' },
        { value: '/about', label: 'About us' }, // no "ho" in it: the host decides
      ]);
      host.loading.set(false);
      fixture.detectChanges();
      expect(screen.getAllByRole('option')).toHaveLength(2);
      expect(live()).toBe('2 options');

      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'Enter' });
      fixture.detectChanges();
      expect(host.value).toBe('/about');
      expect(input.value).toBe('About us');
      // The text was reset by the choice: the host hears it.
      expect(host.queries).toEqual(['ho', '']);

      // The label survives the host swapping the options.
      host.options.set([]);
      fixture.detectChanges();
      expect(input.value).toBe('About us');
    });
  });

  it('works with a reactive FormControl (single), compareWith and touched state', async () => {
    @Component({
      standalone: true,
      imports: [SfComboboxComponent, ReactiveFormsModule],
      template: `<sf-combobox aria-label="Owner" [options]="options" [compareWith]="byId" [formControl]="control" />`,
    })
    class Host {
      readonly options: SfComboboxOption<{ id: number }>[] = [
        { value: { id: 1 }, label: 'Ada' },
        { value: { id: 2 }, label: 'Grace' },
      ];
      readonly byId = (a: { id: number }, b: { id: number }) => a.id === b.id;
      readonly control = new FormControl<{ id: number } | null>({ id: 2 });
    }
    const { fixture } = await render(Host);
    const control = fixture.componentInstance.control;
    const input = screen.getByRole('combobox', { name: 'Owner' }) as HTMLInputElement;
    expect(input.value).toBe('Grace');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fixture.detectChanges();
    expect(screen.getByRole('option', { name: 'Grace' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(control.value).toEqual({ id: 1 });
    fireEvent.blur(input);
    expect(control.touched).toBe(true);

    control.setValue(null);
    fixture.detectChanges();
    expect(input.value).toBe('');

    control.disable();
    fixture.detectChanges();
    expect(input).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Show options', hidden: true })).toBeDisabled();
  });
});
