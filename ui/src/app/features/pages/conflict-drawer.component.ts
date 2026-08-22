import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import { formatValue } from '../../shared/components/sf-diff.component';
import { diffFields } from './conflict-util';
import type { ConflictInfo, ResolveMode } from './types';

/**
 * Right-side drawer shown when an autosave flush hits a 409 conflict. When
 * the 409 carries both payloads, it renders a per-field merge conversation;
 * otherwise it falls back to a summary with whole-asset actions (§24.6).
 */
@Component({
  selector: 'sf-conflict-drawer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './conflict-drawer.component.html',
  styleUrl: './conflict-drawer.component.scss',
})
export class ConflictDrawerComponent {
  readonly conflict = input.required<ConflictInfo>();
  readonly changedKeys = input<string[]>([]);

  readonly keepMine = output<void>();
  readonly takeTheirs = output<void>();
  readonly resolve = output<{ fields: Record<string, ResolveMode> }>();

  protected readonly fmt = formatValue;

  private readonly picks = signal<Record<string, ResolveMode>>({});

  protected readonly fields = computed(() => {
    const c = this.conflict();
    return c?.base != null && c?.theirs != null ? diffFields(c.base, c.theirs) : [];
  });

  constructor() {
    effect(() => {
      this.conflict();
      this.picks.set({});
    });
  }

  protected pickFor(path: string): ResolveMode {
    return this.picks()[path] ?? 'mine';
  }

  protected choose(path: string, mode: ResolveMode): void {
    this.picks.update((m) => ({ ...m, [path]: mode }));
  }

  protected applyAll(mode: ResolveMode): void {
    const all: Record<string, ResolveMode> = {};
    for (const field of this.fields()) {
      all[field.path] = mode;
    }
    this.picks.set(all);
  }

  protected apply(): void {
    const fields: Record<string, ResolveMode> = {};
    for (const field of this.fields()) {
      fields[field.path] = this.pickFor(field.path);
    }
    this.resolve.emit({ fields });
  }
}
