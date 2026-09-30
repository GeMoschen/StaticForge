import {
  ChangeDetectionStrategy,
  Component,
  computed,
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
  /** What changed, for the summary line: the page editor's default, or e.g. a media `file`. */
  readonly subject = input('page');

  readonly keepMine = output<void>();
  readonly takeTheirs = output<void>();
  readonly resolve = output<{ fields: Record<string, ResolveMode> }>();

  protected readonly fmt = formatValue;

  /** The picks, with the conflict they were made for: another conflict starts with none (no effect writes them away). */
  private readonly picked = signal<{ conflict: ConflictInfo; modes: Record<string, ResolveMode> } | null>(null);
  private readonly picks = computed<Record<string, ResolveMode>>(() => {
    const picked = this.picked();
    return picked && picked.conflict === this.conflict() ? picked.modes : {};
  });

  protected readonly fields = computed(() => {
    const c = this.conflict();
    return c?.base != null && c?.theirs != null ? diffFields(c.base, c.theirs) : [];
  });

  protected pickFor(path: string): ResolveMode {
    return this.picks()[path] ?? 'mine';
  }

  protected choose(path: string, mode: ResolveMode): void {
    this.picked.set({ conflict: this.conflict(), modes: { ...this.picks(), [path]: mode } });
  }

  protected applyAll(mode: ResolveMode): void {
    const all: Record<string, ResolveMode> = {};
    for (const field of this.fields()) {
      all[field.path] = mode;
    }
    this.picked.set({ conflict: this.conflict(), modes: all });
  }

  protected apply(): void {
    const fields: Record<string, ResolveMode> = {};
    for (const field of this.fields()) {
      fields[field.path] = this.pickFor(field.path);
    }
    this.resolve.emit({ fields });
  }
}
