import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  Directive,
  ElementRef,
  afterRender,
  booleanAttribute,
  computed,
  contentChildren,
  forwardRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfIconComponent } from './sf-icon.component';
import { SF_FIELD, SfFieldContext, sfUniqueId } from './forms/sf-field-context';
import { joinIds } from './forms/sf-control';

/** Marks projected error content (`<span sfFieldError>…</span>`); it shows in the field's error slot. */
@Directive({ selector: '[sfFieldError]', standalone: true })
export class SfFieldErrorDirective {}

const NATIVE_TEXT_CONTROL =
  'input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=button]):not([type=submit]), select, textarea';

/**
 * A labelled form field (M35.6): label with a required or optional marker, the control, a hint and an error.
 *
 * The label is a `<label for>` pointing at the control — never a `<label>` around it, so buttons inside the field don't
 * get the label in their accessible name. M35.6 controls (`sf-input`, `sf-combobox`, …) read the field through
 * {@link SF_FIELD}; a projected native `<input>`/`<select>`/`<textarea>` is wired by the field itself (id,
 * `aria-describedby`, `aria-invalid`, `aria-required`). Radio groups, checkbox sets and anything else without a single
 * text control are a `role=group` labelled by the field label.
 */
@Component({
  selector: 'sf-field',
  standalone: true,
  imports: [NgTemplateOutlet, SfIconComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sf-field.component.html',
  styleUrl: './sf-field.component.scss',
  providers: [{ provide: SF_FIELD, useExisting: forwardRef(() => SfFieldComponent) }],
})
export class SfFieldComponent implements SfFieldContext, AfterViewInit {
  readonly label = input<string>();
  readonly hint = input<string>();
  /** The error text; it marks the control invalid. Projected `[sfFieldError]` content does the same. */
  readonly error = input<string | null>(null);
  readonly required = input(false, { transform: booleanAttribute });
  /** Shows "(optional)" after the label; for forms where most fields are required. */
  readonly optional = input(false, { transform: booleanAttribute });
  readonly labelPosition = input<'top' | 'inline'>('top');

  readonly controlId = sfUniqueId('sf-field');
  readonly labelId = `${this.controlId}-label`;
  readonly hintId = `${this.controlId}-hint`;
  readonly errorId = `${this.controlId}-error`;

  private readonly projectedErrors = contentChildren(SfFieldErrorDirective, { descendants: true });
  private readonly slot = viewChild.required<ElementRef<HTMLElement>>('slot');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** The kind of M35.6 control that registered itself, if any. */
  private readonly registered = signal<'single' | 'group' | null>(null);
  /**
   * What the projected content is when no control registered: one native text control, or anything else. Starts as
   * the common case (a text control that takes the field's id), so the first render already has the right label.
   */
  private readonly nativeKind = signal<'single' | 'group'>('single');
  /** The id of the projected native control when it brought its own. */
  private readonly nativeId = signal<string | null>(null);

  protected readonly hasError = computed(() => !!this.error() || this.projectedErrors().length > 0);
  readonly invalid = this.hasError;
  readonly describedBy = computed(() => joinIds(this.hint() ? this.hintId : null, this.hasError() ? this.errorId : null));

  private readonly isGroup = computed(() => (this.registered() ?? this.nativeKind()) === 'group');
  /** The `<label for>` target; `null` renders the label as plain text (group controls). */
  protected readonly labelFor = computed(() => {
    if (this.isGroup()) {
      return null;
    }
    return this.registered() ? this.controlId : (this.nativeId() ?? this.controlId);
  });
  /** A group that doesn't label itself: the slot becomes a `role=group` named by the label. */
  protected readonly slotIsGroup = computed(() => !this.registered() && this.isGroup() && !!this.label());

  /** The `aria-describedby` a wired native control had of its own. */
  private readonly ownDescribedBy = new WeakMap<HTMLElement, string | null>();

  constructor() {
    // Projected content can change later (an @if inside the field): re-check after every render.
    afterRender({ write: () => this.wireNative() });
  }

  ngAfterViewInit(): void {
    this.wireNative();
  }

  registerControl(kind: 'single' | 'group'): void {
    if (!this.registered()) {
      this.registered.set(kind);
    }
  }

  /** Wires a projected native control; a no-op when one of our controls registered itself. */
  private wireNative(): void {
    if (this.registered()) {
      return;
    }
    // Only this field's own control: a nested sf-field (list rows, sections) wires its inputs itself.
    const host = this.host.nativeElement;
    const control = Array.from(this.slot().nativeElement.querySelectorAll<HTMLElement>(NATIVE_TEXT_CONTROL)).find(
      (candidate) => candidate.closest('sf-field') === host,
    );
    if (!control) {
      update(this.nativeKind, 'group');
      update(this.nativeId, null);
      return;
    }
    if (!control.id) {
      control.id = this.controlId;
    }
    update(this.nativeKind, 'single');
    update(this.nativeId, control.id === this.controlId ? null : control.id);

    if (!this.ownDescribedBy.has(control)) {
      this.ownDescribedBy.set(control, control.getAttribute('aria-describedby'));
    }
    const describedBy = joinIds(this.ownDescribedBy.get(control), this.describedBy());
    setAttr(control, 'aria-describedby', describedBy);
    // Only take back what the field set: a consumer's own `aria-invalid` binding stays untouched.
    setFlag(control, 'aria-invalid', this.hasError());
    setFlag(control, 'aria-required', this.required());
  }
}

const FIELD_FLAG = 'data-sf-field-flags';

function update<V>(target: { (): V; set(value: V): void }, value: V): void {
  if (target() !== value) {
    target.set(value);
  }
}

function setAttr(element: HTMLElement, name: string, value: string | null): void {
  if (value === null) {
    element.removeAttribute(name);
  } else if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}

/** Sets `name="true"` and remembers it; removes it again only if the field had set it. */
function setFlag(element: HTMLElement, name: string, on: boolean): void {
  const flags = new Set((element.getAttribute(FIELD_FLAG) ?? '').split(' ').filter(Boolean));
  if (on) {
    if (element.getAttribute(name) !== 'true') {
      element.setAttribute(name, 'true');
      flags.add(name);
    }
  } else if (flags.delete(name)) {
    element.removeAttribute(name);
  }
  setAttr(element, FIELD_FLAG, flags.size ? [...flags].join(' ') : null);
}
