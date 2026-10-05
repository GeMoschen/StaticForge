import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { from, switchMap, tap } from 'rxjs';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { autosaveStatus } from '../../core/editor/autosave-editor-state';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { ToastService } from '../../core/ui/toast.service';
import { UndoService } from '../../core/ui/undo.service';
import { SfDrawerComponent, SfDrawerFooterDirective } from '../../shared/components/dialog/sf-drawer.component';
import { SfRelativeTimeComponent } from '../../shared/components/display/sf-relative-time.component';
import { SfInputComponent } from '../../shared/components/forms/sf-input.component';
import { SfSaveStatusComponent } from '../../shared/components/layout/sf-save-status.component';
import { SfButtonComponent } from '../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../shared/components/sf-field.component';
import { SfUidRenameComponent } from '../../shared/components/sf-uid-rename.component';
import { PageNav, PageNavSettingsComponent } from './page-nav-settings.component';
import { PageEditorStore } from './page-editor.store';
import { type PageAddress, PageUrlService, pageAddress } from './page-url.service';
import { ReleaseEventsStore } from '../release/release-events.store';

type PageView = components['schemas']['PageView'];

/**
 * The Page settings drawer (M35.18, decision 35): a non-modal drawer from the right that starts below the top bar, opened by
 * the header's settings button or *Page settings…* / *Rename…* in the page's ⋮ menu. It replaces the title popover of the
 * old editor.
 *
 * Two kinds of change, as before:
 * - **Rename and UID change apply at once** (they are their own server calls) and offer **Undo** in a toast; the UID is
 *   shown in developer mode only.
 * - **Navigation settings are part of the page** (the payload's `nav`): they save with the page like any edit, so the
 *   footer shows the editor's save status and there is no Save button.
 */
@Component({
  selector: 'sf-page-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PageNavSettingsComponent,
    SfButtonComponent,
    SfDrawerComponent,
    SfDrawerFooterDirective,
    SfFieldComponent,
    SfInputComponent,
    SfRelativeTimeComponent,
    SfSaveStatusComponent,
    SfUidRenameComponent,
    TranslocoPipe,
  ],
  styleUrl: './page-settings.component.scss',
  template: `
    <sf-drawer [title]="'pages.settings.title' | transloco" [width]="440" (closed)="close()">
      @if (editor.page(); as p) {
        @if (editor.readOnly()) {
          <p class="settings__muted">{{ 'pages.settings.readOnly' | transloco }}</p>
        }

        <section class="settings__section" aria-labelledby="page-settings-name">
          <h3 class="settings__heading" id="page-settings-name">{{ 'pages.settings.name.heading' | transloco }}</h3>
          @if (renaming()) {
            <sf-field [label]="'pages.settings.name.label' | transloco" [findings]="nameFindings()">
              <sf-input
                data-sf-autofocus
                [value]="draft()"
                (valueChange)="draft.set($event)"
                (keydown.enter)="saveName()"
                (keydown.escape)="cancelRename($event)"
              />
            </sf-field>
            <div class="settings__row">
              <sf-button variant="ghost" size="sm" (click)="cancelRename()">{{ 'pages.settings.cancel' | transloco }}</sf-button>
              <sf-button size="sm" [disabled]="saving() || !!nameFindings().length || draft().trim() === p.displayName" (click)="saveName()">{{
                'pages.settings.name.save' | transloco
              }}</sf-button>
            </div>
          } @else {
            <div class="settings__row is-spread">
              <span class="settings__value">{{ p.displayName ?? '—' }}</span>
              <sf-button variant="secondary" size="sm" icon="edit" [disabled]="editor.readOnly()" (click)="startRename()">{{
                'pages.settings.name.rename' | transloco
              }}</sf-button>
            </div>
          }
        </section>

        @if (developerMode()) {
          <section class="settings__section" aria-labelledby="page-settings-uid">
            <h3 class="settings__heading" id="page-settings-uid">{{ 'pages.settings.uid.heading' | transloco }}</h3>
            <sf-uid-rename
              [projectKey]="editor.projectKey()"
              [uuid]="editor.uuid()"
              [uid]="p.uid ?? ''"
              [undoable]="true"
              (uidChanged)="onUidChanged($event)"
            />
          </section>
        }

        <section class="settings__section" aria-labelledby="page-settings-nav">
          <h3 class="settings__heading" id="page-settings-nav">{{ 'pages.settings.nav.heading' | transloco }}</h3>
          <sf-page-nav-settings [nav]="navOf(p)" [disabled]="editor.readOnly()" (navChange)="onNavChange($event)" (navSettled)="onNavSettled()" />
        </section>

        <section class="settings__section" aria-labelledby="page-settings-facts">
          <h3 class="settings__heading" id="page-settings-facts">{{ 'pages.settings.facts.heading' | transloco }}</h3>
          <dl class="settings__facts">
            <dt>{{ 'pages.settings.facts.template' | transloco }}</dt>
            <dd>{{ p.template?.displayName ?? p.template?.uid }}</dd>
            <dt>{{ 'pages.settings.facts.address' | transloco }}</dt>
            @if (address(); as a) {
              <dd class="settings__mono" [class.settings__computed]="!a.registered" [attr.title]="a.registered ? null : ('pages.settings.facts.addressNotAssigned' | transloco)">{{ a.url }}</dd>
            }
            <dt>{{ 'pages.settings.facts.changed' | transloco }}</dt>
            <dd>{{ p.revision }}</dd>
          </dl>
        </section>
      }

      <div sfDrawerFooter class="settings__footer">
        <sf-save-status [state]="status().state" [savedAt]="savedAt()" [errorCount]="status().errorCount" />
      </div>
    </sf-drawer>
  `,
})
export class PageSettingsComponent {
  private readonly api = inject(ApiClient);
  private readonly toast = inject(ToastService);
  private readonly undo = inject(UndoService);
  private readonly transloco = inject(TranslocoService);
  private readonly pageUrls = inject(PageUrlService);
  private readonly releaseEvents = inject(ReleaseEventsStore);
  protected readonly editor = inject(PageEditorStore);
  protected readonly developerMode = inject(DeveloperModeService).enabled;

  protected readonly renaming = signal(false);
  protected readonly draft = signal('');
  protected readonly saving = signal(false);

  protected readonly status = computed(() => autosaveStatus(this.editor.autosave));
  protected readonly savedAt = computed(() => this.editor.autosave.lastSavedAt());

  /** The registered URLs of this page (uuid → URL), read again after a release. */
  private readonly registered = signal<ReadonlyMap<string, string>>(new Map());

  /** The page's address: registered, or computed from its folder and UID while nothing is registered yet. */
  protected readonly address = computed<PageAddress | null>(() => {
    const page = this.editor.page();
    const uuid = this.editor.uuid();
    return page && uuid ? pageAddress(this.registered(), uuid, page.folderPath ?? '', page.uid ?? '') : null;
  });

  protected readonly nameFindings = computed(() =>
    this.draft().trim() === '' ? [{ level: 'error' as const, message: this.transloco.translate('pages.settings.name.required') }] : [],
  );

  /** The page the drawer was last shown for: this editor is reused when another page is opened. */
  private shownFor: string | null = null;

  constructor() {
    effect((onCleanup) => {
      const key = this.editor.projectKey();
      const uuid = this.editor.uuid();
      this.releaseEvents.version();
      if (!key || !uuid) {
        return;
      }
      const sub = this.pageUrls.registered(key, uuid).subscribe((urls) => this.registered.set(urls));
      onCleanup(() => sub.unsubscribe());
    });
    effect(() => {
      const uuid = this.editor.uuid();
      if (uuid && uuid !== this.shownFor) {
        untracked(() => {
          if (this.shownFor !== null) {
            this.editor.settingsOpen.set(false);
          }
          this.shownFor = uuid;
          this.renaming.set(false);
        });
      }
    });
    // ⋮ › Rename… opens the drawer with the name already in edit mode.
    effect(() => {
      if (this.editor.renameRequested()) {
        untracked(() => {
          this.editor.renameRequested.set(false);
          this.startRename();
        });
      }
    });
  }

  protected close(): void {
    this.renaming.set(false);
    this.editor.settingsOpen.set(false);
  }

  protected startRename(): void {
    if (this.editor.readOnly()) {
      return;
    }
    this.draft.set(this.editor.page()?.displayName ?? '');
    this.renaming.set(true);
  }

  /** Escape leaves the edit, not the drawer. */
  protected cancelRename(event?: Event): void {
    event?.stopPropagation();
    this.renaming.set(false);
  }

  /** The rename applies at once; Undo renames back, on top of whatever was saved since. */
  protected saveName(): void {
    const name = this.draft().trim();
    const key = this.editor.projectKey();
    const uuid = this.editor.uuid();
    if (!name || !key || !uuid || this.saving()) {
      return;
    }
    this.saving.set(true);
    const oldName = this.editor.page()?.displayName ?? '';
    this.api.renameAsset(key, uuid, { displayName: name }, this.editor.autosave.revision() ?? undefined).subscribe({
      next: (detail) => {
        this.saving.set(false);
        this.renaming.set(false);
        this.editor.page.update((cur) => (cur ? { ...cur, displayName: detail.displayName ?? name } : cur));
        if (detail.revision != null) {
          this.editor.autosave.setRevision(detail.revision);
        }
        // Pending edits are written first so the revision the rename back needs is current.
        this.undo.offer(this.transloco.translate('pages.settings.name.renamed', { old: oldName, name }), () =>
          from(this.editor.autosave.flush()).pipe(
            switchMap(() => this.api.renameAsset(key, uuid, { displayName: oldName }, this.editor.autosave.revision() ?? undefined)),
            tap((back) => {
              if (this.editor.uuid() !== uuid) {
                return;
              }
              this.editor.page.update((cur) => (cur ? { ...cur, displayName: back.displayName ?? oldName } : cur));
              if (back.revision != null) {
                this.editor.autosave.setRevision(back.revision);
              }
              this.editor.notifyOwnChange();
            }),
          ),
        );
        this.editor.notifyOwnChange();
      },
      error: () => {
        this.saving.set(false);
        this.toast.show(this.transloco.translate('pages.settings.name.failed'), 'error');
      },
    });
  }

  /** The page's `nav` settings (a `JsonNode` in the API types). */
  protected navOf(page: PageView): PageNav | undefined {
    return page.nav as PageNav | undefined;
  }

  /** Navigation and search settings are part of the page: the edit is saved with it. */
  protected onNavChange(nav: PageNav): void {
    if (this.editor.readOnly()) {
      return;
    }
    this.editor.page.update((cur) => (cur ? { ...cur, nav: nav as PageView['nav'] } : cur));
    this.editor.autosave.markDirty();
  }

  /** A switch was flipped or a field left: no reason to wait for the debounce. */
  protected onNavSettled(): void {
    if (!this.editor.readOnly()) {
      void this.editor.autosave.flush();
    }
  }

  protected onUidChanged(newUid: string): void {
    this.editor.page.update((cur) => (cur ? { ...cur, uid: newUid } : cur));
    this.editor.notifyOwnChange();
  }
}
