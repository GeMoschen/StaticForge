import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ToastService } from '../../../core/ui/toast.service';
import { SfAvatarComponent } from '../../../shared/components/display/sf-avatar.component';
import { SfBadgeComponent } from '../../../shared/components/display/sf-badge.component';
import { SfCopyableComponent } from '../../../shared/components/display/sf-copyable.component';
import { SfKbdComponent } from '../../../shared/components/display/sf-kbd.component';
import { SfLogoComponent } from '../../../shared/components/display/sf-logo.component';
import { SfRelativeTimeComponent } from '../../../shared/components/display/sf-relative-time.component';
import { SfStatusComponent } from '../../../shared/components/display/sf-status.component';
import { SfTagComponent } from '../../../shared/components/display/sf-tag.component';
import { SfBannerComponent } from '../../../shared/components/layout/sf-banner.component';
import { SfSectionComponent } from '../../../shared/components/layout/sf-section.component';
import { SfSideNavComponent } from '../../../shared/components/layout/sf-side-nav.component';
import { SfSkeletonComponent, SfSkeletonShape } from '../../../shared/components/layout/sf-skeleton.component';
import { SfToolbarComponent } from '../../../shared/components/layout/sf-toolbar.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfEmptyStateComponent } from '../../../shared/components/sf-empty-state.component';
import { SfSpinnerComponent } from '../../../shared/components/sf-spinner.component';
import { SfTabsComponent } from '../../../shared/components/sf-tabs.component';
import { BADGES, DISPLAY, LAYOUT, STATUSES, relativeMoments } from '../styleguide.demo';
import { sectionOf } from '../styleguide.sections';

/**
 * The display and layout sections of the style guide (M35.9): badges, statuses, tags, keys, avatars, copyable values,
 * relative times and the logo; toolbar, section, empty state, skeletons, banners, spinners and tabs. The page header
 * is shown by the style guide's own header.
 */
@Component({
  selector: 'sf-sg-display',
  standalone: true,
  imports: [
    SfAvatarComponent,
    SfBadgeComponent,
    SfBannerComponent,
    SfButtonComponent,
    SfCopyableComponent,
    SfEmptyStateComponent,
    SfKbdComponent,
    SfLogoComponent,
    SfRelativeTimeComponent,
    SfSectionComponent,
    SfSideNavComponent,
    SfSkeletonComponent,
    SfSpinnerComponent,
    SfStatusComponent,
    SfTabsComponent,
    SfTagComponent,
    SfToolbarComponent,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sg-display.component.html',
  styleUrl: './sg-display.component.scss',
})
export class SgDisplayComponent {
  private readonly toasts = inject(ToastService);

  protected readonly s = { display: sectionOf('display'), layout: sectionOf('layout') };
  protected readonly badges = BADGES;
  protected readonly statuses = STATUSES;
  protected readonly d = DISPLAY;
  protected readonly l = LAYOUT;
  protected readonly moments = relativeMoments();
  protected readonly skeletons: readonly SfSkeletonShape[] = ['text', 'row', 'tree', 'table', 'form'];

  protected readonly tags = signal<readonly string[]>(DISPLAY.tags);
  protected readonly dismissed = signal<ReadonlySet<number>>(new Set());
  protected readonly selectedTab = signal('content');
  protected readonly sideNavCurrent = signal('runs');

  protected removeTag(tag: string): void {
    this.tags.update((tags) => tags.filter((t) => t !== tag));
  }

  protected resetTags(): void {
    this.tags.set(DISPLAY.tags);
  }

  protected dismiss(index: number): void {
    this.dismissed.update((set) => new Set(set).add(index));
  }

  protected showBanners(): void {
    this.dismissed.set(new Set());
  }

  protected notify(message: string): void {
    this.toasts.show(message, 'info');
  }
}
