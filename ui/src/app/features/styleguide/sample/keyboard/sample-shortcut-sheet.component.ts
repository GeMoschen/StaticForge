import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfDialogComponent } from '../../../../shared/components/dialog/sf-dialog.component';
import { SfKbdComponent } from '../../../../shared/components/display/sf-kbd.component';
import { SfSearchInputComponent } from '../../../../shared/components/forms/sf-search-input.component';
import { SampleState } from '../sample-state';
import { GLOBAL_SHORTCUTS, SheetGroup, screenShortcuts } from './keyboard-data';

interface SheetSection {
  readonly id: string;
  readonly scope: 'screen' | 'global';
  readonly items: SheetGroup['items'];
}

/**
 * The mocked M35.14 `?` sheet: the shortcuts of what is open first ("On this screen"), then the ones that work
 * everywhere ("Everywhere"), grouped, with a search field that filters by description or keys. In the app it is
 * generated from the shortcut registry, so it never drifts from what works.
 */
@Component({
  selector: 'sf-sample-shortcut-sheet',
  standalone: true,
  imports: [SfDialogComponent, SfKbdComponent, SfSearchInputComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sample-shortcut-sheet.component.scss',
  templateUrl: './sample-shortcut-sheet.component.html',
})
export class SampleShortcutSheetComponent {
  protected readonly state = inject(SampleState);
  protected readonly search = signal(this.state.shortcutsQuery());

  protected readonly sections = computed<SheetSection[]>(() => {
    this.state.t('keyboard.title'); // tracks the language file
    const query = this.search().trim().toLowerCase();
    const dev = this.state.devMode();
    const all: SheetSection[] = [
      ...screenShortcuts(this.state.view()).map((group) => ({ ...group, scope: 'screen' as const })),
      ...GLOBAL_SHORTCUTS.map((group) => ({ ...group, scope: 'global' as const })),
    ].map((section) => ({
      ...section,
      // "Go to Templates" is for developers: leave it out while developer mode is off.
      items: section.items.filter((item) => dev || item.id !== 'goTemplates'),
    }));
    return all
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => query === '' || this.describe(item.id).toLowerCase().includes(query) || this.spoken(item.keys).includes(query)),
      }))
      .filter((section) => section.items.length > 0);
  });

  protected describe(id: string): string {
    return this.state.t(`keyboard.sheet.items.${id}`);
  }

  protected close(): void {
    this.state.shortcutsOpen.set(false);
    this.state.shortcutsQuery.set('');
  }

  /** The keys as plain words for searching ("g p" → "g p", "Mod+K" → "ctrl k"). */
  private spoken(keys: string): string {
    return keys.toLowerCase().replace(/mod/g, 'ctrl').replace(/arrow/g, '').replace(/\+/g, ' ');
  }
}
