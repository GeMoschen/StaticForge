import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfDataTableCellDirective } from '../../../shared/components/data-table/sf-data-table-templates.directive';
import { SfDataTableColumn } from '../../../shared/components/data-table/data-table.types';
import { SfDataTableComponent } from '../../../shared/components/data-table/sf-data-table.component';
import { SfPageHeaderComponent } from '../../../shared/components/layout/sf-page-header.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { SampleBreadcrumbComponent } from './sample-breadcrumb.component';
import { FAVORITE_ICONS, SampleFavorite } from './sample-favorites';
import { SampleState } from './sample-state';

/**
 * The Favorites list (M35.15): everything the person starred, from every store — pages, records, templates, media,
 * globals — in one table with its type and where it lives. A row opens the item in its own area; the star takes it off.
 */
@Component({
  selector: 'sf-sample-favorites-view',
  standalone: true,
  imports: [
    SampleBreadcrumbComponent,
    SfButtonComponent,
    SfDataTableCellDirective,
    SfDataTableComponent,
    SfIconComponent,
    SfPageHeaderComponent,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sample-favorites-view.component.scss',
  template: `
    <sf-page-header class="view__header" [title]="'styleguide.sample.favorites.node' | transloco">
      <sf-sample-breadcrumb
        sfPageHeaderBreadcrumb
        [crumbs]="state.breadcrumb()"
        [label]="'styleguide.sample.breadcrumb' | transloco"
        (navigate)="state.navigate($event)"
      />
    </sf-page-header>

    <sf-data-table
      class="view__table"
      searchable
      [columns]="columns()"
      [rows]="rows()"
      [rowKey]="rowKey"
      [rowLabel]="rowLabel"
      [label]="'styleguide.sample.favorites.table' | transloco"
      [searchPlaceholder]="'styleguide.sample.favorites.search' | transloco"
      [emptyTitle]="'styleguide.sample.favorites.empty' | transloco"
      (rowOpen)="state.openFavorite($event)"
    >
      <ng-template sfDataTableCell="name" [sfDataTableCellRows]="rows()" let-row>
        <span class="cell-name">
          <sf-icon class="cell-name__icon" [name]="icons[row.kind]" />
          <span class="cell-name__text">{{ row.name }}</span>
          <sf-button
            class="cell-fav is-on"
            variant="ghost"
            size="sm"
            [aria-pressed]="true"
            [aria-label]="'styleguide.sample.favorites.remove' | transloco"
            (click)="$event.stopPropagation(); state.removeFavorite(row.key)"
          >
            <sf-icon class="cell-fav__icon" name="star" />
          </sf-button>
        </span>
      </ng-template>
      <ng-template sfDataTableCell="type" [sfDataTableCellRows]="rows()" let-row>
        <span class="cell-muted">{{ 'styleguide.sample.favorites.kinds.' + row.kind | transloco }}</span>
      </ng-template>
      <ng-template sfDataTableCell="path" [sfDataTableCellRows]="rows()" let-row>
        <span class="cell-muted">{{ row.path }}</span>
      </ng-template>
    </sf-data-table>
  `,
})
export class SampleFavoritesViewComponent {
  protected readonly state = inject(SampleState);
  protected readonly icons = FAVORITE_ICONS;

  protected readonly rows = computed(() => this.state.favorites());
  protected readonly rowKey = (row: SampleFavorite) => row.key;
  protected readonly rowLabel = (row: SampleFavorite) => row.name;

  protected readonly columns = computed<SfDataTableColumn<SampleFavorite>[]>(() => {
    const header = (id: string) => this.state.t(`favorites.columns.${id}`);
    return [
      { id: 'name', header: header('name'), value: (r) => r.name, sortable: true, hideable: false, width: 320 },
      { id: 'type', header: header('type'), value: (r) => this.state.t(`favorites.kinds.${r.kind}`), sortable: true, width: 140 },
      { id: 'path', header: header('path'), value: (r) => r.path, sortable: true, width: 260 },
    ];
  });
}
