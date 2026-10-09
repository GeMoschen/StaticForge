import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { SfSearchInputComponent } from '../../../shared/components/forms/sf-search-input.component';
import { SfSegmentedComponent, type SfSegmentedOption } from '../../../shared/components/forms/sf-segmented.component';
import { SfFilterPopoverComponent, type SfFilterGroup } from '../../../shared/components/filter/sf-filter-popover.component';
import { SfToolbarComponent } from '../../../shared/components/layout/sf-toolbar.component';
import { SfMenuComponent, type SfMenuItem } from '../../../shared/components/menu/sf-menu.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { MediaLibraryStore } from './media-library.store';
import { MEDIA_SORTS, MEDIA_TYPE_FILTERS, type MediaTypeFilter, type MediaViewMode } from './media-library.util';
import { MediaUploadStore } from './media-upload.store';

/**
 * Search, type filter, sort, grid/list and Upload above the files (decision 19). The search filters at once and reaches the
 * URL after a pause; type, sort and view go to the URL (the view is also remembered in the user's preferences).
 */
@Component({
  selector: 'sf-media-library-toolbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SfButtonComponent,
    SfFilterPopoverComponent,
    SfMenuComponent,
    SfSearchInputComponent,
    SfSegmentedComponent,
    SfToolbarComponent,
    TranslocoPipe,
  ],
  templateUrl: './media-library-toolbar.component.html',
  styleUrl: './media-library-toolbar.component.scss',
})
export class MediaLibraryToolbarComponent {
  protected readonly library = inject(MediaLibraryStore);
  protected readonly uploads = inject(MediaUploadStore);
  private readonly transloco = inject(TranslocoService);

  private t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(`media.toolbar.${key}`, params);
  }

  /** One group: the types without 'all' (no tag picked is 'all'). */
  protected readonly filterGroups = computed<SfFilterGroup[]>(() => [
    {
      id: 'type',
      label: this.t('type'),
      options: MEDIA_TYPE_FILTERS.filter((value) => value !== 'all').map((value) => ({ value, label: this.t(`types.${value}`) })),
    },
  ]);
  protected readonly pickedFilters = computed(() => {
    const type = this.library.typeFilter();
    return { type: type === 'all' ? [] : [type] };
  });

  /** Picking a tag selects it (replacing another); picking the picked one again returns to 'all'. */
  protected toggleType(value: string): void {
    this.library.setTypeFilter(value === this.library.typeFilter() ? 'all' : (value as MediaTypeFilter));
  }

  protected readonly viewOptions = computed<SfSegmentedOption<MediaViewMode>[]>(() => [
    { value: 'grid', label: this.t('grid'), icon: 'grid_view', iconOnly: true },
    { value: 'list', label: this.t('list'), icon: 'view_list', iconOnly: true },
  ]);

  /** "Sort: Name ↑" — the menu button's text (and name). */
  protected readonly sortText = computed(() =>
    this.t('sortButton', { field: this.t(`sortBy.${this.library.sort()}`), direction: this.library.direction() }),
  );

  protected readonly sortItems = computed<SfMenuItem[]>(() => {
    const sort = this.library.sort();
    const direction = this.library.direction();
    const sortGroup = this.t('sortGroup');
    const orderGroup = this.t('orderGroup');
    return [
      ...MEDIA_SORTS.map<SfMenuItem>((id) => ({
        id,
        label: this.t(`sortBy.${id}`),
        icon: id === sort ? 'check' : undefined,
        group: sortGroup,
        action: () => this.library.setSort(id, direction),
      })),
      ...(['asc', 'desc'] as const).map<SfMenuItem>((id) => ({
        id,
        label: this.t(id === 'asc' ? 'ascending' : 'descending'),
        icon: id === direction ? 'check' : undefined,
        group: orderGroup,
        action: () => this.library.setSort(sort, id),
      })),
    ];
  });
}
