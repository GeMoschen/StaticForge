import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { AssetRef } from '../../core/assets/asset-ref';
import { FavoritesService } from '../../core/assets/favorites.service';
import { ShortcutService } from '../../core/ui/shortcut.service';
import { ToastService } from '../../core/ui/toast.service';
import { SfTooltipDirective } from '../directives/sf-tooltip.directive';
import { SfButtonComponent } from './sf-button.component';
import { SfIconComponent } from './sf-icon.component';

/**
 * The favorite toggle (M35.15), a ☆ for the editor header of any asset or folder, whichever store it is in: a ghost
 * icon button with `aria-pressed`, filled in the warning colour while the asset is a favorite. It reads and writes the
 * project's favorites through {@link FavoritesService}, says what it did in a toast, and — while it is on the screen —
 * offers *Add to favorites* / *Remove from favorites* for the open asset in the command palette.
 *
 * It takes the open asset as plain inputs (so a template can pass `rec.uuid` straight in); with no `uuid` or `type` —
 * the asset has not loaded yet — it renders nothing.
 */
@Component({
  selector: 'sf-asset-favorite',
  standalone: true,
  imports: [SfButtonComponent, SfIconComponent, SfTooltipDirective, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sf-asset-favorite.component.scss',
  template: `
    @if (asset(); as current) {
      <sf-button
        class="sf-asset-favorite"
        [class.is-on]="on()"
        variant="ghost"
        size="sm"
        [aria-pressed]="on()"
        [aria-label]="label() | transloco: { name: current.displayName }"
        [sfTooltip]="label() | transloco: { name: current.displayName }"
        (click)="toggle()"
      >
        <sf-icon class="sf-asset-favorite__icon" name="star" />
      </sf-button>
    }
  `,
})
export class SfAssetFavoriteComponent {
  /** The asset type (`PAGE`, `RECORD`, `FOLDER`, …). */
  readonly type = input<string | null | undefined>(null);
  readonly uuid = input<string | null | undefined>(null);
  /** The name the toasts and the palette use. */
  readonly name = input<string | null | undefined>(null);
  readonly folderPath = input<string | null | undefined>(null);

  protected readonly asset = computed<AssetRef | null>(() => {
    const type = this.type();
    const uuid = this.uuid();
    return type && uuid ? { type, uuid, displayName: this.name() || uuid, folderPath: this.folderPath() ?? undefined } : null;
  });

  private readonly favorites = inject(FavoritesService);
  private readonly toasts = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  protected readonly on = computed(() => this.favorites.isFavorite(this.asset()?.uuid));
  protected readonly label = computed(() => (this.on() ? 'shared.favorite.remove' : 'shared.favorite.add'));

  constructor() {
    inject(ShortcutService).use([
      {
        id: 'favorite',
        scope: 'screen',
        group: 'general',
        description: 'frame.shortcuts.items.favoriteAdd',
        enabled: () => this.asset() !== null,
        handler: () => this.toggle(),
        palette: {
          icon: 'star',
          label: () => (this.on() ? 'frame.shortcuts.items.favoriteRemove' : 'frame.shortcuts.items.favoriteAdd'),
          context: () => this.asset()?.displayName ?? null,
        },
      },
    ]);
  }

  protected toggle(): void {
    const asset = this.asset();
    if (asset === null) {
      return;
    }
    const added = this.favorites.toggle(asset);
    this.toasts.show(this.transloco.translate(added ? 'shared.favorite.added' : 'shared.favorite.removed', { name: asset.displayName }), 'info');
  }
}
