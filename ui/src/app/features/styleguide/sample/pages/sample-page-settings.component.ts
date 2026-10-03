import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ToastService } from '../../../../core/ui/toast.service';
import { SfDrawerComponent } from '../../../../shared/components/dialog/sf-drawer.component';
import { SfCopyableComponent } from '../../../../shared/components/display/sf-copyable.component';
import { SfRelativeTimeComponent } from '../../../../shared/components/display/sf-relative-time.component';
import { SfInputComponent } from '../../../../shared/components/forms/sf-input.component';
import { SfNumberInputComponent } from '../../../../shared/components/forms/sf-number-input.component';
import { SfSwitchComponent } from '../../../../shared/components/forms/sf-switch.component';
import { SfBannerComponent } from '../../../../shared/components/layout/sf-banner.component';
import { SfSaveState, SfSaveStatusComponent } from '../../../../shared/components/layout/sf-save-status.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../../shared/components/sf-field.component';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import { injectSampleText, minutesAgo } from '../changes/sample-area.util';
import { PICKER_PAGES, PickerItem } from '../forms/picker-data';
import { SampleAssetPickerComponent } from '../forms/sample-asset-picker.component';
import { LANGUAGE_NAMES, childrenOf, pathTo } from '../sample-data';
import { SampleState } from '../sample-state';
import { FOLDER_NAV, PAGE_NAV, SampleNavSettings } from './pages-data';
import { SampleAssetUrl, SampleAssetUrlsComponent } from './sample-asset-urls.component';
import { SamplePagesReview } from './sample-pages-review';

const SAVE_MS = 700;

/**
 * The Page settings / Folder settings drawer (M35.18 review round 8): a non-modal drawer from the right that starts below
 * the top bar, opened by *Page settings…* in the page's ⋮ menu or the settings button in the header — it replaces the title
 * popover of the old editor, and the folder settings that used to sit above a folder's title.
 *
 * Two kinds of change, as in the real editor:
 * - **Rename and UID change apply at once** (they are their own server calls) and offer **Undo** in a toast; changing the UID
 *   (developer mode only) warns first that the page's address and every link to it change.
 * - **Navigation settings are part of the page** (the payload's `nav`): they save with the page like any edit, so the drawer
 *   footer shows the same save status (*Saving…*, *Saved 12:04*) and has no Save button.
 *
 * A **page** shows its display name, the UID (developer mode), the navigation settings (show in navigation, label, position,
 * hide from search engines) and read-only facts. A **folder** shows its name, UID, the **start page** (chosen with the page
 * picker; *Change…* / *Remove*), its navigation settings and what it contains.
 */
@Component({
  selector: 'sf-sample-page-settings',
  standalone: true,
  imports: [
    SampleAssetPickerComponent,
    SampleAssetUrlsComponent,
    SfBannerComponent,
    SfButtonComponent,
    SfCopyableComponent,
    SfDrawerComponent,
    SfFieldComponent,
    SfIconComponent,
    SfInputComponent,
    SfNumberInputComponent,
    SfRelativeTimeComponent,
    SfSaveStatusComponent,
    SfSwitchComponent,
    TranslocoPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sample-page-settings.component.scss',
  template: `
    <sf-drawer [title]="t(isFolder() ? 'settings.folderTitle' : 'settings.pageTitle')" [width]="440" (closed)="closed.emit()">
      @if (review.readOnly()) {
        <p class="settings__hint">{{ t(isFolder() ? 'settings.readOnlyFolder' : 'settings.readOnly') }}</p>
      }

      <section class="settings__section" aria-labelledby="settings-name-heading">
        <h3 class="settings__heading" id="settings-name-heading">{{ t('settings.name.heading') }}</h3>
        @if (renaming()) {
          <sf-field [label]="t('settings.name.label')" [findings]="nameFindings()">
            <sf-input data-sf-autofocus [value]="draft()" (valueChange)="draft.set($event)" (keydown.enter)="saveName()" (keydown.escape)="cancelRename()" />
          </sf-field>
          <div class="settings__row">
            <sf-button variant="ghost" size="sm" (click)="cancelRename()">{{ t('settings.cancel') }}</sf-button>
            <sf-button size="sm" [disabled]="!!nameFindings().length || draft().trim() === name()" (click)="saveName()">{{ t('settings.name.save') }}</sf-button>
          </div>
        } @else {
          <div class="settings__row is-spread">
            <span class="settings__value">{{ name() }}</span>
            <sf-button variant="secondary" size="sm" icon="edit" [disabled]="review.readOnly()" (click)="startRename()">{{ t('settings.name.rename') }}</sf-button>
          </div>
        }
      </section>

      @if (state.devMode()) {
        <section class="settings__section" aria-labelledby="settings-uid-heading">
          <h3 class="settings__heading" id="settings-uid-heading">{{ t('settings.uid.heading') }}</h3>
          @if (changingUid()) {
            <sf-banner tone="warning">{{ t('settings.uid.warning') }}</sf-banner>
            <sf-field [label]="t('settings.uid.label')" [hint]="t('settings.uid.hint')">
              <sf-input class="settings__mono" [value]="uidDraft()" (valueChange)="uidDraft.set($event)" (keydown.escape)="changingUid.set(false)" />
            </sf-field>
            <div class="settings__row">
              <sf-button variant="ghost" size="sm" (click)="changingUid.set(false)">{{ t('settings.cancel') }}</sf-button>
              <sf-button size="sm" [disabled]="!uidValid()" (click)="saveUid()">{{ t('settings.uid.apply') }}</sf-button>
            </div>
          } @else {
            <div class="settings__row is-spread">
              <sf-copyable [value]="uid()" [label]="t('settings.uid.heading')" />
              <sf-button variant="secondary" size="sm" (click)="startUid()">{{ t('settings.uid.change') }}</sf-button>
            </div>
          }
        </section>
      }

      @if (isFolder()) {
        <section class="settings__section" aria-labelledby="settings-start-heading">
          <h3 class="settings__heading" id="settings-start-heading">{{ t('settings.start.heading') }}</h3>
          <p class="settings__hint">{{ t('settings.start.hint') }}</p>
          @if (startPage(); as start) {
            <div class="settings__card">
              <sf-icon name="home" />
              <span class="settings__card-text">
                <span class="settings__value">{{ start.name }}</span>
                <span class="settings__muted">{{ start.path }}</span>
              </span>
              <sf-button variant="ghost" size="sm" (click)="picking.set(true)">{{ t('settings.start.change') }}</sf-button>
              <sf-button variant="ghost" size="sm" icon="close" [label]="t('settings.start.remove')" (click)="removeStart()" />
            </div>
          } @else {
            <div class="settings__row">
              <sf-button variant="secondary" size="sm" icon="home" (click)="picking.set(true)">{{ t('settings.start.choose') }}</sf-button>
            </div>
          }
        </section>
      }

      <section class="settings__section" aria-labelledby="settings-nav-heading">
        <h3 class="settings__heading" id="settings-nav-heading">{{ t('settings.nav.heading') }}</h3>
        <label class="settings__switch">
          <sf-switch [value]="nav().visible" (valueChange)="setNav({ visible: $event })" [aria-label]="t(isFolder() ? 'settings.nav.visibleFolder' : 'settings.nav.visible')" />
          <span>{{ t(isFolder() ? 'settings.nav.visibleFolder' : 'settings.nav.visible') }}</span>
        </label>
        <sf-field [label]="t('settings.nav.label')" [hint]="t('settings.nav.labelHint')">
          <sf-input [value]="nav().label" [disabled]="!nav().visible" (valueChange)="setNav({ label: $event })" />
        </sf-field>
        <sf-field [label]="t('settings.nav.position')" [hint]="t('settings.nav.positionHint')">
          <sf-number-input [min]="1" [value]="nav().position" [disabled]="!nav().visible" (valueChange)="setNav({ position: $event ?? 1 })" />
        </sf-field>
        @if (!isFolder()) {
          <label class="settings__switch">
            <sf-switch [value]="nav().noIndex" (valueChange)="setNav({ noIndex: $event })" [aria-label]="t('settings.nav.noIndex')" />
            <span>
              {{ t('settings.nav.noIndex') }}
              <span class="settings__muted">{{ t('settings.nav.noIndexHint') }}</span>
            </span>
          </label>
        }
      </section>

      @if (isFolder()) {
        <section class="settings__section" aria-labelledby="settings-urls-heading">
          <h3 class="settings__heading" id="settings-urls-heading">{{ t('settings.urls.heading') }}</h3>
          <sf-sample-asset-urls [urls]="urls()" />
        </section>
      }

      <section class="settings__section" aria-labelledby="settings-facts-heading">
        <h3 class="settings__heading" id="settings-facts-heading">{{ t('settings.facts.heading') }}</h3>
        <dl class="settings__facts">
          @if (isFolder()) {
            <dt>{{ t('settings.facts.path') }}</dt>
            <dd class="settings__mono">{{ path() }}</dd>
            <dt>{{ t('settings.facts.contains') }}</dt>
            <dd>{{ t('settings.facts.containsValue', { pages: counts().pages, folders: counts().folders }) }}</dd>
          } @else {
            <dt>{{ t('settings.facts.template') }}</dt>
            <dd>{{ template() }}</dd>
            <dt>{{ t('settings.facts.address') }}</dt>
            <dd class="settings__mono">{{ url() }}</dd>
          }
          <dt>{{ t('settings.facts.changed') }}</dt>
          <dd>{{ modifiedBy() }} · <sf-relative-time [value]="changedAt()" /></dd>
        </dl>
      </section>

      <div sfDrawerFooter class="settings__footer">
        <sf-save-status [state]="saveState()" [savedAt]="savedAt()" />
      </div>
    </sf-drawer>

    @if (picking()) {
      <sf-sample-asset-picker [allowedTypes]="['PAGE']" [current]="startItem()" (choose)="chooseStart($event)" (cancelled)="picking.set(false)" />
    }
  `,
})
export class SamplePageSettingsComponent {
  protected readonly state = inject(SampleState);
  private readonly toasts = inject(ToastService);
  protected readonly review = inject(SamplePagesReview);
  protected readonly t = injectSampleText('styleguide.sample.pages');

  readonly kind = input.required<'page' | 'folder'>();
  readonly closed = output<void>();

  protected readonly isFolder = computed(() => this.kind() === 'folder');
  private readonly entry = computed(() => (this.isFolder() ? this.state.folder() : this.state.page()));

  // What the drawer shows; renames and UID changes live here (nothing is saved).
  protected readonly name = signal('');
  protected readonly uid = signal('');
  protected readonly nav = signal<SampleNavSettings>(PAGE_NAV);
  protected readonly startId = signal<string | null>(null);

  protected readonly renaming = signal(false);
  protected readonly draft = signal('');
  protected readonly changingUid = signal(false);
  protected readonly uidDraft = signal('');
  protected readonly picking = signal(false);

  protected readonly saving = signal(false);
  protected readonly savedAt = signal<string | null>(null);
  protected readonly saveState = computed<SfSaveState>(() => (this.saving() ? 'saving' : 'saved'));

  protected readonly template = computed(() => this.state.page().template ?? '');
  protected readonly url = computed(() => this.state.page().url);
  protected readonly path = computed(() => `/${pathTo(this.state.folderId()).map((e) => e.uid).join('/')}/`.replace('//', '/'));
  /** The folder's registered URLs: the build's output per language and the preview's. */
  protected readonly urls = computed<SampleAssetUrl[]>(() => {
    const path = this.path();
    return [
      { area: 'build', where: this.t('settings.urls.html', { language: LANGUAGE_NAMES.de }), url: path },
      { area: 'build', where: this.t('settings.urls.html', { language: LANGUAGE_NAMES.en }), url: `/en${path}` },
      { area: 'preview', where: this.t('settings.urls.html', { language: LANGUAGE_NAMES.de }), url: `/preview${path}` },
    ];
  });
  protected readonly modifiedBy = computed(() => this.entry()?.modifiedBy.name ?? '');
  private readonly now = Date.now();
  protected readonly changedAt = computed(() => minutesAgo(this.entry()?.modifiedMinutes ?? 0, this.now));
  protected readonly counts = computed(() => {
    const children = childrenOf(this.state.folderId());
    return { pages: children.filter((c) => c.kind === 'page').length, folders: children.filter((c) => c.kind === 'folder').length };
  });

  protected readonly startPage = computed(() => {
    const id = this.startId();
    const entry = id ? childrenOf(this.state.folderId()).find((c) => c.id === id) : null;
    return entry ? { name: entry.name, path: entry.url } : null;
  });
  protected readonly startItem = computed<PickerItem | null>(() => PICKER_PAGES.find((p) => p.id === this.startId()) ?? null);

  protected readonly nameFindings = computed(() =>
    this.draft().trim() === '' ? [{ level: 'error' as const, message: this.t('settings.name.required') }] : [],
  );
  protected readonly uidValid = computed(() => /^[a-z][a-z0-9_]*$/.test(this.uidDraft()) && this.uidDraft() !== this.uid());

  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // The open page or folder: its own values.
    effect(() => {
      const entry = this.entry();
      const folder = this.isFolder();
      untracked(() => {
        this.name.set(entry?.name ?? '');
        this.uid.set(entry?.uid ?? '');
        this.nav.set(folder ? FOLDER_NAV : { ...PAGE_NAV, label: entry?.name ?? PAGE_NAV.label });
        this.startId.set(folder ? (childrenOf(this.state.folderId()).find((c) => c.startPage)?.id ?? null) : null);
        this.renaming.set(false);
        this.changingUid.set(false);
      });
    });
    inject(DestroyRef).onDestroy(() => this.saveTimer && clearTimeout(this.saveTimer));
  }

  protected startRename(): void {
    this.draft.set(this.name());
    this.renaming.set(true);
  }

  protected cancelRename(): void {
    this.renaming.set(false);
  }

  /** The rename applies at once; Undo renames back. */
  protected saveName(): void {
    const next = this.draft().trim();
    const previous = this.name();
    if (next === '' || next === previous) {
      return;
    }
    this.name.set(next);
    this.renaming.set(false);
    this.toasts.undo(this.t('settings.name.renamed', { name: next }), () => this.name.set(previous));
  }

  protected startUid(): void {
    this.uidDraft.set(this.uid());
    this.changingUid.set(true);
  }

  /** The UID change applies at once (after the warning); Undo changes it back. */
  protected saveUid(): void {
    const next = this.uidDraft();
    const previous = this.uid();
    this.uid.set(next);
    this.changingUid.set(false);
    this.toasts.undo(this.t('settings.uid.changed', { uid: next }), () => this.uid.set(previous));
  }

  protected setNav(patch: Partial<SampleNavSettings>): void {
    this.nav.update((nav) => ({ ...nav, ...patch }));
    this.autosave();
  }

  protected chooseStart(item: PickerItem): void {
    this.picking.set(false);
    this.startId.set(item.id);
    this.autosave();
  }

  protected removeStart(): void {
    const previous = this.startId();
    this.startId.set(null);
    this.autosave();
    this.toasts.undo(this.t('settings.start.removed'), () => this.startId.set(previous));
  }

  /** A navigation or start-page edit saves with the page: the footer shows *Saving…*, then *Saved*. */
  private autosave(): void {
    this.saving.set(true);
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saving.set(false);
      this.savedAt.set(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    }, SAVE_MS);
  }
}
