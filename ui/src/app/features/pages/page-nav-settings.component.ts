import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfInputComponent } from '../../shared/components/forms/sf-input.component';
import { SfNumberInputComponent } from '../../shared/components/forms/sf-number-input.component';
import { SfSwitchComponent } from '../../shared/components/forms/sf-switch.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';

/** The page payload's navigation settings (spec §10.3): `nav{visible, position, label, noIndex}`. */
export type PageNav = Record<string, unknown>;

/**
 * The page's navigation and search settings in the Page settings drawer (M30.2.2, M35.18): "Show in navigation"
 * (`nav.visible`, default on), the navigation label, the position among the siblings and "Hide from search engines"
 * (`nav.noIndex`, default off — the page is left out of the sitemap and templates add the robots `noindex` meta).
 *
 * Presentational: every change emits the whole new `nav` object, keeping the members it doesn't edit; the drawer saves
 * it with the page. {@link navSettled} says when the edit is complete (a switch, or leaving a text field) so the
 * drawer can save at once instead of waiting for the debounce.
 */
@Component({
  selector: 'sf-page-nav-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfFieldComponent, SfInputComponent, SfNumberInputComponent, SfSwitchComponent, TranslocoPipe],
  styleUrl: './page-nav-settings.component.scss',
  template: `
    <div class="page-nav-settings">
      <sf-switch data-nav="visible" [value]="visible()" [disabled]="disabled()" (valueChange)="set({ visible: $event }, true)">{{
        'pages.settings.nav.visible' | transloco
      }}</sf-switch>
      <sf-field [label]="'pages.settings.nav.label' | transloco" [hint]="'pages.settings.nav.labelHint' | transloco">
        <sf-input
          data-nav="label"
          [value]="label()"
          [disabled]="disabled() || !visible()"
          (valueChange)="set({ label: $event })"
          (focusout)="navSettled.emit()"
          (keydown.enter)="navSettled.emit()"
        />
      </sf-field>
      <sf-field [label]="'pages.settings.nav.position' | transloco" [hint]="'pages.settings.nav.positionHint' | transloco">
        <sf-number-input
          data-nav="position"
          [min]="0"
          [value]="position()"
          [disabled]="disabled() || !visible()"
          (valueChange)="set({ position: $event ?? 0 })"
          (focusout)="navSettled.emit()"
          (keydown.enter)="navSettled.emit()"
        />
      </sf-field>
      <sf-switch
        data-nav="noIndex"
        aria-describedby="page-nav-settings-noindex-hint"
        [value]="noIndex()"
        [disabled]="disabled()"
        (valueChange)="set({ noIndex: $event }, true)"
        >{{ 'pages.settings.nav.noIndex' | transloco }}</sf-switch
      >
      <p id="page-nav-settings-noindex-hint" class="page-nav-settings__hint">{{ 'pages.settings.nav.noIndexHint' | transloco }}</p>
    </div>
  `,
})
export class PageNavSettingsComponent {
  /** The page's current `nav`; missing members read as their defaults. */
  readonly nav = input<PageNav | null | undefined>(undefined);
  /** Read-only: time travel or an archived project. */
  readonly disabled = input(false);

  /** The whole new `nav` object after a change. */
  readonly navChange = output<PageNav>();
  /** An edit is complete: a switch was flipped, or a text field was left or confirmed. */
  readonly navSettled = output<void>();

  protected readonly visible = computed(() => this.nav()?.['visible'] !== false);
  protected readonly noIndex = computed(() => this.nav()?.['noIndex'] === true);
  protected readonly label = computed(() => (typeof this.nav()?.['label'] === 'string' ? (this.nav()?.['label'] as string) : ''));
  protected readonly position = computed(() => (typeof this.nav()?.['position'] === 'number' ? (this.nav()?.['position'] as number) : 0));

  protected set(patch: PageNav, settled = false): void {
    this.navChange.emit({ ...(this.nav() ?? {}), ...patch });
    if (settled) {
      this.navSettled.emit();
    }
  }
}
