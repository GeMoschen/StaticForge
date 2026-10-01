import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { collapseCrumbs, type Crumb } from '../../core/frame/breadcrumb.util';
import { SfMenuComponent, type SfMenuItem } from '../../shared/components/menu/sf-menu.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfIconComponent } from '../../shared/components/sf-icon.component';

/**
 * The frame's breadcrumb: area › folders › item. Every segment but the last is a link; a long path collapses its middle
 * into a "…" menu. The last segment is the current place (`aria-current`).
 */
@Component({
  selector: 'sf-frame-breadcrumb',
  standalone: true,
  imports: [NgTemplateOutlet, SfButtonComponent, SfIconComponent, SfMenuComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './frame-breadcrumb.component.scss',
  template: `
    <nav class="crumbs" [attr.aria-label]="'frame.topbar.breadcrumb' | transloco">
      <ol class="crumbs__list">
        @for (crumb of collapsed().head; track crumb.id; let last = $last) {
          <ng-container *ngTemplateOutlet="segment; context: { $implicit: crumb, last: last && collapsed().tail.length === 0 }" />
        }
        @if (collapsed().hidden.length > 0) {
          <li class="crumbs__item crumbs__more">
            <sf-menu
              icon="more_horiz"
              size="sm"
              align="start"
              [label]="'frame.topbar.breadcrumbMore' | transloco"
              [items]="hiddenItems()"
            />
            <sf-icon class="crumbs__sep" name="chevron_right" />
          </li>
        }
        @for (crumb of collapsed().tail; track crumb.id; let last = $last) {
          <ng-container *ngTemplateOutlet="segment; context: { $implicit: crumb, last }" />
        }
      </ol>
    </nav>

    <ng-template #segment let-crumb let-last="last">
      <li class="crumbs__item">
        @if (last || !crumb.link) {
          <span class="crumbs__current" [attr.aria-current]="last ? 'page' : null">{{ crumb.label }}</span>
        } @else {
          <sf-button variant="ghost" size="sm" [link]="crumb.link">{{ crumb.label }}</sf-button>
          <sf-icon class="crumbs__sep" name="chevron_right" />
        }
      </li>
    </ng-template>
  `,
})
export class FrameBreadcrumbComponent {
  readonly crumbs = input.required<readonly Crumb[]>();

  protected readonly collapsed = computed(() => collapseCrumbs(this.crumbs()));
  protected readonly hiddenItems = computed<SfMenuItem[]>(() =>
    this.collapsed().hidden.map((crumb) => ({ id: crumb.id, label: crumb.label, link: crumb.link ? [...crumb.link] : undefined })),
  );
}
