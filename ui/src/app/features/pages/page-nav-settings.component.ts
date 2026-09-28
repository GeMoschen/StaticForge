import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

/** The page payload's navigation settings (spec §10.3): `nav{visible, position, label, noIndex}`. */
export type PageNav = Record<string, unknown>;

/**
 * The page's navigation and search settings in the page editor's properties popover (M30.2.2):
 * "Show in navigation" (`nav.visible`, default on) and "Hide from search engines" (`nav.noIndex`,
 * default off — the page is left out of the sitemap and templates add the robots `noindex` meta).
 *
 * Presentational: every toggle emits the whole new `nav` object, keeping the members it doesn't
 * edit (`position`, `label`, …); the editor saves it with the page.
 */
@Component({
  selector: 'sf-page-nav-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-nav-settings">
      <label class="page-nav-settings__control">
        <input
          type="checkbox"
          role="switch"
          data-nav="visible"
          [checked]="visible()"
          [disabled]="disabled()"
          (change)="toggle('visible', $event)"
        />
        <span class="page-nav-settings__label">Show in navigation</span>
      </label>
      <label class="page-nav-settings__control">
        <input
          type="checkbox"
          role="switch"
          data-nav="noIndex"
          aria-describedby="page-nav-settings-noindex-hint"
          [checked]="noIndex()"
          [disabled]="disabled()"
          (change)="toggle('noIndex', $event)"
        />
        <span class="page-nav-settings__label">Hide from search engines</span>
      </label>
      <p id="page-nav-settings-noindex-hint" class="page-nav-settings__hint">
        Leaves the page out of the sitemap; the template adds a robots "noindex" tag.
      </p>
    </div>
  `,
  styles: `
    .page-nav-settings {
      display: flex;
      flex-direction: column;
      gap: var(--sf-2);
    }
    .page-nav-settings__control {
      display: inline-flex;
      align-items: center;
      gap: var(--sf-2);
      cursor: pointer;
    }
    .page-nav-settings__label {
      font-size: var(--sf-text-sm);
      color: var(--sf-ink);
    }
    .page-nav-settings__control input:disabled + .page-nav-settings__label {
      color: var(--sf-slate);
    }
    .page-nav-settings__hint {
      margin: 0;
      font-size: var(--sf-text-xs);
      color: var(--sf-slate);
    }
  `,
})
export class PageNavSettingsComponent {
  /** The page's current `nav`; missing members read as their defaults. */
  readonly nav = input<PageNav | null | undefined>(undefined);
  /** Read-only: time travel or an archived project. */
  readonly disabled = input(false);

  /** The whole new `nav` object after a toggle. */
  readonly navChange = output<PageNav>();

  protected readonly visible = computed(() => this.nav()?.['visible'] !== false);
  protected readonly noIndex = computed(() => this.nav()?.['noIndex'] === true);

  protected toggle(key: 'visible' | 'noIndex', event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.navChange.emit({ ...(this.nav() ?? {}), [key]: checked });
  }
}
