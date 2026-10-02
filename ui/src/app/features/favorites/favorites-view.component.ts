import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { assetIcon, assetLocation } from '../../core/assets/asset-ref';
import { FavoritesService } from '../../core/assets/favorites.service';
import { useFrameItem } from '../../core/frame/use-frame-item';
import { FrameContextStore } from '../../core/frame/frame-context.store';
import type { FavoriteEntry } from '../../core/preferences/preferences.types';
import { ToastService } from '../../core/ui/toast.service';
import { assetRoute } from '../../shared/asset-route.util';
import type { SfDataTableColumn } from '../../shared/components/data-table/data-table.types';
import { SfDataTableCellDirective } from '../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableComponent } from '../../shared/components/data-table/sf-data-table.component';
import { SfPageHeaderComponent } from '../../shared/components/layout/sf-page-header.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';

/**
 * The Favorites list (M35.15, M35.18): everything the person starred in this project, from every store — pages,
 * records, media, templates, folders — in one table with its type and where it lives. A row opens the item in its own
 * area; the star takes it off the list. Shown in the main pane when a tree's pinned *Favorites* node is opened.
 */
@Component({
  selector: 'sf-favorites-view',
  standalone: true,
  imports: [SfButtonComponent, SfDataTableCellDirective, SfDataTableComponent, SfIconComponent, SfPageHeaderComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './favorites-view.component.scss',
  template: `
    <sf-page-header class="favorites__header" [title]="'pages.favorites.title' | transloco" />
    <sf-data-table
      class="favorites__table"
      searchable
      [columnChooser]="false"
      [columns]="columns()"
      [rows]="rows()"
      [rowKey]="rowKey"
      [rowLabel]="rowLabel"
      [label]="'pages.favorites.table' | transloco"
      [searchPlaceholder]="'pages.favorites.search' | transloco"
      [emptyTitle]="'pages.favorites.empty' | transloco"
      [emptyDescription]="'pages.favorites.emptyHint' | transloco"
      (rowOpen)="open($event)"
    >
      <ng-template sfDataTableCell="name" [sfDataTableCellRows]="rows()" let-row>
        <span class="favorites__name">
          <sf-icon class="favorites__icon" [name]="icon(row)" />
          <span class="favorites__text">{{ rowLabel(row) }}</span>
          <sf-button
            class="favorites__star"
            variant="ghost"
            size="sm"
            [aria-pressed]="true"
            [aria-label]="'shared.favorite.remove' | transloco: { name: rowLabel(row) }"
            (click)="$event.stopPropagation(); remove(row)"
          >
            <sf-icon class="favorites__star-icon" name="star" />
          </sf-button>
        </span>
      </ng-template>
      <ng-template sfDataTableCell="type" [sfDataTableCellRows]="rows()" let-row>
        <span class="favorites__muted">{{ typeLabel(row) }}</span>
      </ng-template>
      <ng-template sfDataTableCell="location" [sfDataTableCellRows]="rows()" let-row>
        <span class="favorites__muted">{{ location(row) }}</span>
      </ng-template>
    </sf-data-table>
  `,
})
export class FavoritesViewComponent {
  private readonly favorites = inject(FavoritesService);
  private readonly frame = inject(FrameContextStore);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  protected readonly rows = computed(() => this.favorites.list());
  protected readonly rowKey = (row: FavoriteEntry) => row.uuid;
  protected readonly rowLabel = (row: FavoriteEntry) => row.title ?? row.uuid;

  protected readonly columns = computed<SfDataTableColumn<FavoriteEntry>[]>(() => {
    const header = (id: string) => this.transloco.translate(`pages.favorites.columns.${id}`);
    return [
      { id: 'name', header: header('name'), value: (row) => this.rowLabel(row), sortable: true, hideable: false, width: 340 },
      { id: 'type', header: header('type'), value: (row) => this.typeLabel(row), sortable: true, width: 160 },
      { id: 'location', header: header('location'), value: (row) => this.location(row), sortable: true, width: 280 },
    ];
  });

  constructor() {
    // The top bar's breadcrumb ends with "Favorites".
    useFrameItem(() => ({ label: this.transloco.translate('pages.favorites.title') }));
  }

  protected icon(row: FavoriteEntry): string {
    return assetIcon(row.kind);
  }

  protected typeLabel(row: FavoriteEntry): string {
    const key = `enum.assetType.${row.kind}`;
    const label = this.transloco.translate(key);
    return label === key ? row.kind : label;
  }

  protected location(row: FavoriteEntry): string {
    return assetLocation(row.folderPath, row.kind) ?? '';
  }

  protected open(row: FavoriteEntry): void {
    const key = this.frame.projectKey();
    if (key === null) {
      return;
    }
    const route = assetRoute(key, { type: row.kind, uuid: row.uuid, folderPath: row.folderPath });
    void this.router.navigate(route.commands, { queryParams: route.queryParams });
  }

  protected remove(row: FavoriteEntry): void {
    this.favorites.remove(row.uuid);
    this.toasts.show(this.transloco.translate('shared.favorite.removed', { name: this.rowLabel(row) }), 'info');
  }
}
