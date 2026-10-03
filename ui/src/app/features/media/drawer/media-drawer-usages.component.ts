import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { DeveloperModeService } from '../../../core/frame/developer-mode.service';
import { SfEmptyStateComponent } from '../../../shared/components/sf-empty-state.component';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { SfSkeletonComponent } from '../../../shared/components/layout/sf-skeleton.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { type RoutableAsset, assetRoute } from '../../../shared/asset-route.util';
import { SfAssetImpactComponent } from '../../generation/insight/sf-asset-impact.component';
import { SfAssetUrlsComponent } from '../../settings/asset-urls.component';
import { MediaDrawerUsagesStore } from './media-drawer-usages.store';
import { MediaDrawerStore } from './media-drawer.store';

/** The icon of what uses the file. */
const USAGE_ICONS: Readonly<Record<string, string>> = {
  PAGE: 'description',
  RECORD: 'table_rows',
  RECORD_SET: 'dataset',
  PAGE_TEMPLATE: 'code',
  SECTION_TEMPLATE: 'code',
  GLOBAL_SET: 'public',
  PAGE_REFERENCE: 'account_tree',
};

/**
 * The Used by tab (decision 21): the places that use the file — pages, records, templates, globals — each a link to
 * where it opens, with the field that holds the reference; then what changing the file would rebuild (the impact) and
 * the URLs it is served under.
 */
@Component({
  selector: 'sf-media-drawer-usages',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    SfAssetImpactComponent,
    SfAssetUrlsComponent,
    SfButtonComponent,
    SfEmptyStateComponent,
    SfIconComponent,
    SfSkeletonComponent,
    TranslocoPipe,
  ],
  templateUrl: './media-drawer-usages.component.html',
  styleUrl: './media-drawer-usages.component.scss',
})
export class MediaDrawerUsagesComponent {
  protected readonly core = inject(MediaDrawerStore);
  protected readonly store = inject(MediaDrawerUsagesStore);
  protected readonly devMode = inject(DeveloperModeService).enabled;
  private readonly transloco = inject(TranslocoService);

  protected readonly rows = computed(() =>
    this.store.usages().map((usage) => {
      const target = assetRoute(this.core.projectKey(), { type: usage.fromType, uuid: usage.fromUuid } satisfies RoutableAsset);
      return {
        usage,
        commands: target.commands,
        queryParams: target.queryParams,
        icon: USAGE_ICONS[usage.fromType ?? ''] ?? 'link',
        kind: this.kindLabel(usage.fromType),
      };
    }),
  );

  private kindLabel(type: string | undefined): string {
    const key = `media.drawer.usedBy.types.${type ?? ''}`;
    const label = this.transloco.translate(key);
    return label === key ? (type ?? '') : label;
  }
}
