import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import { ReactiveFormsModule, FormControl, FormGroup } from '@angular/forms';
import { Subscription } from 'rxjs';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { EditorDefinition, Link, LinkKind } from '../form.model';

const KINDS: LinkKind[] = ['INTERNAL', 'EXTERNAL', 'MEDIA', 'ANCHOR', 'MAIL'];

/**
 * The fields a kind keeps when the user switches to it: only the display ones it shows too. Every
 * other field is cleared, the link's destination (`uuid`, `url`, `anchor`) always — a page uuid is
 * no media uuid, a web address no mail address.
 */
const KEPT_ON_SWITCH: Record<LinkKind, (keyof Link)[]> = {
  INTERNAL: [],
  MEDIA: [],
  EXTERNAL: ['target', 'title'],
  ANCHOR: ['target'],
  MAIL: ['title'],
};

@Component({
  selector: 'sf-link-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, SfFieldComponent, SfButtonComponent],
  templateUrl: './link-editor.component.html',
  styleUrl: './link-editor.component.scss',
})
export class SfLinkEditor {
  readonly definition = input.required<EditorDefinition>();
  readonly control = input.required<FormGroup>();

  readonly open = signal(false);
  readonly kinds = KINDS;

  /**
   * The group's value as a signal. `FormGroup.value` is not reactive, so a `computed` reading it
   * directly would never re-run — switching the link kind left the fields of the old kind on screen.
   */
  private readonly value = computed(() => {
    this.changes();
    return this.control().getRawValue() as Record<string, unknown>;
  });

  /** Bumped on every `valueChanges` of the current group, re-running {@link value}. */
  private readonly changes = signal(0);

  constructor() {
    let watching: Subscription | null = null;
    effect(() => {
      const group = this.control();
      untracked(() => {
        watching?.unsubscribe();
        watching = group.valueChanges.subscribe(() => this.changes.update((n) => n + 1));
      });
    });
    inject(DestroyRef).onDestroy(() => watching?.unsubscribe());
  }

  /** The user picked another kind: switch to it and clear what belonged to the old one, in one change. */
  selectKind(kind: LinkKind): void {
    const group = this.control();
    if (kind === this.kind()) {
      return;
    }
    const kept = KEPT_ON_SWITCH[kind];
    const cleared = Object.fromEntries(
      Object.keys(group.controls)
        .filter((name) => name !== 'kind' && !kept.includes(name as keyof Link))
        .map((name) => [name, null]),
    );
    group.patchValue({ ...cleared, kind });
    group.markAsDirty();
  }

  field(name: string): FormControl {
    return this.control().get(name) as FormControl;
  }

  readonly kind = computed(() => this.value()['kind'] as LinkKind);

  readonly summary = computed(() => {
    const group = this.value();
    switch (group['kind']) {
      case 'INTERNAL':
      case 'MEDIA':
        return group['uuid'] ?? '';
      case 'EXTERNAL':
      case 'MAIL':
        return group['url'] ?? '';
      case 'ANCHOR':
        return group['anchor'] ?? '';
      default:
        return group['title'] ?? '';
    }
  });
}
