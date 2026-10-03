import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { SfDialogComponent } from '../../shared/components/dialog/sf-dialog.component';
import { SfKbdComponent } from '../../shared/components/display/sf-kbd.component';
import { SfSearchInputComponent } from '../../shared/components/forms/sf-search-input.component';
import { ShortcutGroup, ShortcutService } from './shortcut.service';

interface SheetSection {
  readonly key: string;
  readonly group: ShortcutGroup;
  /** Shortcuts of what is open (a screen or a component), as opposed to those that work everywhere. */
  readonly local: boolean;
  readonly items: readonly { readonly id: string; readonly label: string; readonly keys: string }[];
}

const GROUP_ORDER: readonly ShortcutGroup[] = [
  'screen',
  'mediaGrid',
  'mediaDrawer',
  'mediaFocal',
  'editing',
  'lists',
  'tree',
  'general',
  'goTo',
  'publishing',
];

/** The keys as plain words for searching: `Mod+K` → `ctrl k`, `ArrowUp` → `up`. */
function spoken(keys: string): string {
  return keys.toLowerCase().replace(/mod/g, 'ctrl').replace(/arrow/g, '').replace(/escape/g, 'esc').replace(/\+/g, ' ');
}

/**
 * The `?` sheet (M35.14): a dialog listing the shortcuts of what is open ("On this screen") first, then those that work
 * everywhere, grouped, with a search field that filters by description or keys. It is generated from the shortcut
 * registry, so it never drifts from what works.
 */
@Component({
  selector: 'sf-shortcut-sheet',
  standalone: true,
  imports: [SfDialogComponent, SfKbdComponent, SfSearchInputComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './shortcut-sheet.component.scss',
  templateUrl: './shortcut-sheet.component.html',
})
export class ShortcutSheetComponent {
  protected readonly shortcuts = inject(ShortcutService);
  private readonly transloco = inject(TranslocoService);
  private readonly translations = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  protected readonly search = signal('');

  protected readonly sections = computed<SheetSection[]>(() => {
    this.translations();
    const query = this.search().trim().toLowerCase();
    const buckets = new Map<string, { group: ShortcutGroup; local: boolean; items: SheetSection['items'][number][] }>();
    for (const def of this.shortcuts.commands()) {
      if (!def.keys) {
        continue;
      }
      const label = this.transloco.translate(def.description);
      if (query !== '' && !label.toLowerCase().includes(query) && !spoken(def.keys).includes(query)) {
        continue;
      }
      const local = def.scope !== 'global';
      const key = `${local ? 'local' : 'global'}-${def.group}`;
      const bucket = buckets.get(key) ?? { group: def.group, local, items: [] };
      bucket.items.push({ id: def.id, label, keys: def.keys });
      buckets.set(key, bucket);
    }
    return [...buckets.entries()]
      .map(([key, bucket]) => ({ key, ...bucket }))
      .sort((a, b) => Number(b.local) - Number(a.local) || GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
  });

  protected close(): void {
    this.shortcuts.shortcutSheetOpen.set(false);
    this.search.set('');
  }
}
