import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject } from '@angular/core';
import { SfSideNavComponent, SfSideNavItem } from '../../../../shared/components/layout/sf-side-nav.component';
import { injectSampleQuery, oneOf } from '../changes/sample-area.util';
import { SampleState } from '../sample-state';
import { ACCOUNT_SECTIONS, AccountSection, SECTION_ICONS } from './account-data';
import { AccountState } from './account-state';
import { SampleAccountPasswordComponent } from './sample-account-password.component';
import { SampleAccountPreferencesComponent } from './sample-account-preferences.component';
import { SampleAccountProfileComponent } from './sample-account-profile.component';
import { SampleAccountProjectsComponent } from './sample-account-projects.component';
import { SampleAccountSessionsComponent } from './sample-account-sessions.component';

/**
 * The sample's My account area (M35.16): a secondary side menu (`sf-side-nav`) — Profile, Password, Preferences, My
 * projects, Sessions — and the chosen page beside it, each with its own page header (one `h1`). The frame's top bar and
 * breadcrumb stay; there is no rail. Profile and Password have one save area each; leaving them with unsaved changes
 * asks first. Nothing is saved.
 *
 * Query parameters (read on load, written back as the user clicks): `acsec` — the section, `acstate=loading|error|empty` —
 * the state of My projects.
 */
@Component({
  selector: 'sf-sample-account-area',
  standalone: true,
  imports: [
    SampleAccountPasswordComponent,
    SampleAccountPreferencesComponent,
    SampleAccountProfileComponent,
    SampleAccountProjectsComponent,
    SampleAccountSessionsComponent,
    SfSideNavComponent,
  ],
  providers: [AccountState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sample-account-area.component.scss',
  template: `
    <div class="area__body" [class.is-narrow]="nav.narrow()">
      <sf-side-nav
        #nav="sfSideNav"
        class="area__nav"
        [items]="navItems()"
        [label]="t('nav.label')"
        [current]="state.section()"
        (select)="selectSection($event)"
      />
      <div class="area__content">
        @switch (state.section()) {
          @case ('profile') {
            <sf-sample-account-profile />
          }
          @case ('password') {
            <sf-sample-account-password />
          }
          @case ('preferences') {
            <sf-sample-account-preferences />
          }
          @case ('projects') {
            <sf-sample-account-projects />
          }
          @case ('sessions') {
            <sf-sample-account-sessions />
          }
        }
      </div>
    </div>
  `,
})
export class SampleAccountAreaComponent {
  protected readonly state = inject(AccountState);
  protected readonly t = this.state.t;
  private readonly query = injectSampleQuery();

  protected readonly navItems = computed<SfSideNavItem[]>(() =>
    ACCOUNT_SECTIONS.map((id) => ({
      id,
      label: this.t(`sections.${id}`),
      icon: SECTION_ICONS[id],
      badge: this.state.dirtyOf(id) ? this.t('nav.unsaved') : null,
      badgeTone: 'warning' as const,
    })),
  );

  constructor() {
    const section = oneOf<AccountSection>(this.query.get('acsec'), ACCOUNT_SECTIONS);
    if (section) {
      this.state.section.set(section);
    }

    // Leaving the screen (rail, tree, top bar) with unsaved changes in the open page asks first.
    const sample = inject(SampleState, { optional: true });
    const unregister = sample?.registerGuard(() => this.state.canLeaveSection());
    inject(DestroyRef).onDestroy(() => {
      unregister?.();
      this.query.set({ acsec: null, acstate: null });
    });

    effect(() => this.query.set({ acsec: this.state.section() }));
  }

  protected async selectSection(id: string): Promise<void> {
    if (await this.state.canLeaveSection()) {
      this.state.open(id as AccountSection);
    }
  }
}
