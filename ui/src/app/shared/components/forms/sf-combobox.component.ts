import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfTooltipDirective } from '../../directives/sf-tooltip.directive';
import { anchorPanel } from '../../overlay/anchored-position';
import { SfTagComponent } from '../display/sf-tag.component';
import { SfIconComponent } from '../sf-icon.component';
import { SfControlBase, joinIds, provideSfControl } from './sf-control';
import { sfUniqueId } from './sf-field-context';

export interface SfComboboxOption<T> {
  value: T;
  label: string;
  /** A second, muted line under the label. */
  description?: string;
  /** Shown but not choosable (`aria-disabled`); stays reachable with the arrow keys. */
  disabled?: boolean;
  /** Options with the same `group` that follow each other are shown under that heading (a `role=group`). */
  group?: string;
}

/** A run of options under one group heading (`group: null`: no heading). */
interface SfComboboxSection<T> {
  group: string | null;
  items: { option: SfComboboxOption<T>; index: number }[];
}

/**
 * A combobox (M35.6): a text input with a listbox popup and type-ahead filtering (WAI-ARIA 1.2 combobox,
 * `aria-autocomplete=list`). Single or `multiple` choice.
 *
 * - Filtering: `filter: 'local'` (default) keeps the options whose label contains the typed text (case-insensitive);
 *   `'none'` leaves it to the host, which listens to `query` (the typed text, on every change) and feeds new `options`
 *   — `loading` shows a loading note meanwhile. A polite live region announces the number of results.
 * - Keyboard: `↓` opens (on the selected option, else the first) and moves, `↑` opens (selected, else last) and moves,
 *   both wrap; `Alt+↓` opens without moving, `Alt+↑` closes; `Home`/`End` move within the open list; `Enter` chooses
 *   the active option; `Escape` closes, a second `Escape` clears the text (and, single, the value); `Tab` closes and
 *   chooses nothing. Typing opens the list with the first enabled match active. In `multiple` mode `Backspace` in the
 *   empty input removes the last value.
 * - The icon-only toggle button (out of the tab order) opens and closes the list by mouse.
 * - Single: choosing shows the option's label in the input and closes the list. Leaving the input after typing
 *   restores the selected label — or, when the text was emptied, clears the value.
 * - Multiple: values show as removable `sf-tag` chips before the input; choosing toggles an option, empties the input
 *   and keeps the list open.
 * - Value: `T | null` (single) or `T[]` (multiple), options matched with `compareWith` (default `Object.is`).
 *
 * The list is a `position: fixed` panel anchored under the input (`anchorPanel`, at least as wide as the control).
 */
@Component({
  selector: 'sf-combobox',
  standalone: true,
  imports: [NgTemplateOutlet, SfIconComponent, SfTagComponent, SfTooltipDirective, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sf-combobox.component.html',
  styleUrl: './sf-combobox.component.scss',
  providers: [provideSfControl(() => SfComboboxComponent)],
})
export class SfComboboxComponent<T = unknown> extends SfControlBase<T | T[] | null> implements OnDestroy {
  readonly options = input<readonly SfComboboxOption<T>[]>([]);
  readonly multiple = input(false, { transform: booleanAttribute });
  readonly filter = input<'local' | 'none'>('local');
  /** The host is fetching options (`filter: 'none'`): the list shows a loading note. */
  readonly loading = input(false, { transform: booleanAttribute });
  readonly placeholder = input<string | null>(null);
  readonly compareWith = input<(a: T, b: T) => boolean>(Object.is);
  readonly value = model<T | T[] | null>(null);

  /** The typed text, on every change (also when a choice or `Escape` empties it). */
  readonly query = output<string>();

  protected readonly listId = sfUniqueId('sf-combobox-list');
  protected readonly selectionId = `${this.listId}-selection`;
  protected readonly open = signal(false);

  /** The text in the input while the user edits it. */
  private readonly text = signal('');
  /** Whether the input shows typed text (filtering) rather than the selection. */
  private readonly editing = signal(false);
  private readonly active = signal(-1);
  /** Typing: the first enabled match is active — also among options the host feeds later (`filter: 'none'`). */
  private readonly autoActive = signal(false);
  /** Options chosen earlier, so chips keep their labels when the host swaps `options` (`filter: 'none'`). */
  private readonly known: SfComboboxOption<T>[] = [];

  private readonly shell = viewChild.required<ElementRef<HTMLElement>>('shell');
  private readonly inputEl = viewChild.required<ElementRef<HTMLInputElement>>('input');
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly document = inject(DOCUMENT);
  private stopAnchor: (() => void) | null = null;

  private readonly onDocumentPointerDown = (event: Event) => {
    const target = event.target as Node | null;
    if (!target || !this.host.nativeElement.contains(target)) {
      this.close();
    }
  };

  /** The chosen values as a list (single: zero or one). */
  protected readonly values = computed<T[]>(() => {
    const value = this.value();
    if (this.multiple()) {
      return Array.isArray(value) ? value : [];
    }
    return value === null || value === undefined ? [] : [value as T];
  });

  /** The chosen values' options (a stand-in with the value as label for an unknown value). */
  protected readonly selectedOptions = computed(() => this.values().map((value) => this.optionFor(value)));

  protected readonly filtered = computed(() => {
    const options = this.options();
    const query = this.editing() ? this.text().trim().toLowerCase() : '';
    if (this.filter() === 'none' || !query) {
      return options;
    }
    return options.filter((option) => option.label.toLowerCase().includes(query));
  });

  protected readonly sections = computed(() => {
    const sections: SfComboboxSection<T>[] = [];
    this.filtered().forEach((option, index) => {
      const group = option.group ?? null;
      const last = sections[sections.length - 1];
      if (last && last.group === group) {
        last.items.push({ option, index });
      } else {
        sections.push({ group, items: [{ option, index }] });
      }
    });
    return sections;
  });

  protected readonly activeIndex = computed(() => {
    const index = this.active();
    if (index >= 0 && index < this.filtered().length) {
      return index;
    }
    return this.autoActive() ? this.firstEnabled() : -1;
  });
  protected readonly activeId = computed(() =>
    this.open() && this.activeIndex() >= 0 ? this.optionId(this.activeIndex()) : null,
  );

  /** What the input shows: the typed text, else (single) the selected option's label. */
  protected readonly inputValue = computed(() => {
    if (this.multiple() || this.editing()) {
      return this.text();
    }
    return this.selectedOptions()[0]?.label ?? '';
  });

  protected readonly inputDescribedBy = computed(() =>
    joinIds(this.multiple() && this.values().length ? this.selectionId : null, this.describedBy()),
  );

  constructor() {
    super();
    // A form that disables the control (or makes it read-only) while the list is open closes the list.
    effect(
      () => {
        if (this.isDisabled() || this.readonly()) {
          untracked(() => this.close());
        }
      },
      { allowSignalWrites: true },
    );
  }

  /** Focuses the input. */
  focus(): void {
    this.inputEl().nativeElement.focus();
  }

  /** Whether the list is open (for hosts and tests). */
  isOpen(): boolean {
    return this.open();
  }

  ngOnDestroy(): void {
    this.close();
  }

  protected writeModel(value: T | T[] | null | undefined): void {
    this.editing.set(false);
    this.text.set('');
    this.value.set(this.multiple() ? (Array.isArray(value) ? [...value] : []) : (value ?? null));
  }

  protected optionId(index: number): string {
    return `${this.listId}-${index}`;
  }

  protected isSelected(option: SfComboboxOption<T>): boolean {
    const compare = this.compareWith();
    return this.values().some((value) => compare(option.value, value));
  }

  protected onInput(event: Event): void {
    const text = (event.target as HTMLInputElement).value;
    this.editing.set(true);
    this.setText(text);
    if (!this.open()) {
      this.openList(-1);
    }
    this.active.set(-1);
    this.autoActive.set(true);
    // Render the new matches now, then re-place the panel for its new height.
    this.changeDetector.detectChanges();
    this.place();
    this.scrollActiveIntoView();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (this.isDisabled() || this.readonly()) {
      return;
    }
    const open = this.open();
    switch (event.key) {
      case 'ArrowDown':
        if (event.altKey) {
          if (!open) {
            this.openList(-1);
          }
        } else if (open) {
          this.move(1);
        } else {
          this.openList(this.selectedIndex() >= 0 ? this.selectedIndex() : this.firstEnabled());
        }
        break;
      case 'ArrowUp':
        if (event.altKey) {
          this.close();
        } else if (open) {
          this.move(-1);
        } else {
          this.openList(this.selectedIndex() >= 0 ? this.selectedIndex() : this.filtered().length - 1);
        }
        break;
      case 'Home':
      case 'End':
        if (!open) {
          return; // caret movement in the input
        }
        this.setActive(event.key === 'Home' ? 0 : this.filtered().length - 1);
        break;
      case 'Enter':
        if (!open || this.activeIndex() < 0) {
          return;
        }
        this.choose(this.filtered()[this.activeIndex()]);
        break;
      case 'Escape':
        if (open) {
          this.close();
        } else if (this.inputValue()) {
          this.clearText();
        } else {
          return;
        }
        break;
      case 'Tab':
        this.close();
        return; // let the focus move on
      case 'Backspace':
        if (this.multiple() && !this.text() && this.values().length) {
          this.removeAt(this.values().length - 1);
          break;
        }
        return;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation(); // an Escape that closed the list doesn't close a surrounding dialog
  }

  protected onBlur(): void {
    this.markTouched();
    this.close();
    if (!this.editing()) {
      return;
    }
    if (!this.multiple() && !this.text().trim() && this.value() !== null) {
      this.commit(null);
    }
    this.editing.set(false);
    this.setText('');
  }

  /** A click on the control's empty area focuses the input. */
  protected onShellClick(event: MouseEvent): void {
    if (event.target === this.shell().nativeElement && !this.isDisabled()) {
      this.focus();
    }
  }

  protected toggleList(): void {
    if (this.open()) {
      this.close();
      return;
    }
    this.focus();
    this.openList(-1);
  }

  protected choose(option: SfComboboxOption<T> | undefined): void {
    if (!option || option.disabled || this.readonly() || this.isDisabled()) {
      return;
    }
    this.remember(option);
    this.editing.set(false);
    this.setText('');
    if (!this.multiple()) {
      this.commit(option.value);
      this.close();
      return;
    }
    const compare = this.compareWith();
    const values = this.values();
    this.commit(
      this.isSelected(option) ? values.filter((value) => !compare(value, option.value)) : [...values, option.value],
    );
    // The list stays open, now unfiltered, with the chosen option active.
    this.setActive(this.filtered().findIndex((candidate) => compare(candidate.value, option.value)));
    this.place();
  }

  protected removeAt(index: number): void {
    if (this.readonly() || this.isDisabled()) {
      return;
    }
    this.commit(this.values().filter((_, i) => i !== index));
  }

  /** A chip's remove button: remove the value and keep the focus in the control. */
  protected removeChip(index: number): void {
    this.removeAt(index);
    this.focus();
  }

  protected hover(index: number): void {
    if (this.active() !== index) {
      this.active.set(index);
    }
  }

  private openList(active: number): void {
    if (this.isDisabled() || this.readonly()) {
      return;
    }
    this.autoActive.set(false);
    if (!this.open()) {
      this.open.set(true);
      this.document.addEventListener('pointerdown', this.onDocumentPointerDown, true);
      this.active.set(active);
      // Render the panel now, so it can be placed in this same task.
      this.changeDetector.detectChanges();
      this.place();
    } else {
      this.active.set(active);
      this.changeDetector.detectChanges();
    }
    this.scrollActiveIntoView();
  }

  private close(): void {
    if (!this.open()) {
      return;
    }
    this.open.set(false);
    this.active.set(-1);
    this.autoActive.set(false);
    this.stopAnchor?.();
    this.stopAnchor = null;
    this.document.removeEventListener('pointerdown', this.onDocumentPointerDown, true);
  }

  private place(): void {
    const panel = this.panel()?.nativeElement;
    this.stopAnchor?.();
    this.stopAnchor = panel ? anchorPanel(this.shell().nativeElement, panel, { matchWidth: true }) : null;
  }

  private move(step: 1 | -1): void {
    const count = this.filtered().length;
    if (!count) {
      return;
    }
    const from = this.activeIndex();
    this.setActive(from < 0 ? (step > 0 ? 0 : count - 1) : (from + step + count) % count);
  }

  private setActive(index: number): void {
    this.autoActive.set(false);
    this.active.set(index);
    this.changeDetector.detectChanges();
    this.scrollActiveIntoView();
  }

  private scrollActiveIntoView(): void {
    const id = this.activeId();
    const option = id ? this.document.getElementById(id) : null;
    if (option && typeof option.scrollIntoView === 'function') {
      option.scrollIntoView({ block: 'nearest' });
    }
  }

  /** `Escape` on a closed list: empty the input (single: also clear the value). */
  private clearText(): void {
    this.editing.set(false);
    this.setText('');
    if (!this.multiple() && this.value() !== null) {
      this.commit(null);
    }
  }

  private setText(text: string): void {
    if (this.text() !== text) {
      this.text.set(text);
      this.query.emit(text);
    }
  }

  private commit(value: T | T[] | null): void {
    this.value.set(value);
    this.emitChange(value);
  }

  /** Single: the index of the selected option in the visible list; -1 if none and in `multiple` mode. */
  private selectedIndex(): number {
    return this.multiple() ? -1 : this.filtered().findIndex((option) => this.isSelected(option));
  }

  private firstEnabled(): number {
    return this.filtered().findIndex((option) => !option.disabled);
  }

  private remember(option: SfComboboxOption<T>): void {
    const compare = this.compareWith();
    if (!this.known.some((known) => compare(known.value, option.value))) {
      this.known.push(option);
    }
  }

  private optionFor(value: T): SfComboboxOption<T> {
    const compare = this.compareWith();
    const match = (option: SfComboboxOption<T>) => compare(option.value, value);
    return this.options().find(match) ?? this.known.find(match) ?? { value, label: String(value) };
  }
}
