import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { ActiveEditorService } from '../../core/editor/active-editor.service';
import type { EditorError, EditorStateService } from '../../core/editor/editor-state';
import { SfSideNavComponent, SfSideNavItem } from '../../shared/components/layout/sf-side-nav.component';
import { AccountDraftStore } from './account-draft.store';
import { ACCOUNT_SECTIONS, SECTION_ICONS } from './account-sections';

/**
 * My account (M35.16): a secondary side menu (`sf-side-nav`) — Profile, Password, Preferences, My projects, Sessions —
 * and the chosen page beside it, each page with its own header (one `h1`). The frame's top bar and breadcrumb stay;
 * there is no rail. A section with unsaved changes shows an *Unsaved* badge in the menu. The open section is an editor
 * for the frame (M35.13): Ctrl/Cmd+S saves it and the route guards ask before it is left with unsaved changes.
 */
@Component({
  selector: 'sf-account-shell',
  standalone: true,
  imports: [RouterOutlet, SfSideNavComponent],
  providers: [AccountDraftStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './account-shell.component.scss',
  template: `
    <div class="area__body" [class.is-narrow]="nav.narrow()">
      <sf-side-nav #nav="sfSideNav" class="area__nav" [items]="items()" [label]="label()" />
      <div class="area__content">
        <router-outlet />
      </div>
    </div>
  `,
})
export class AccountShellComponent {
  private readonly transloco = inject(TranslocoService);
  private readonly store = inject(AccountDraftStore);

  protected readonly label = computed(() => this.transloco.translate('account.nav.label'));
  protected readonly items = computed<SfSideNavItem[]>(() =>
    ACCOUNT_SECTIONS.map((id) => ({
      id,
      label: this.transloco.translate(`account.sections.${id}`),
      icon: SECTION_ICONS[id],
      link: id,
      badge: this.store.dirtyOf(id) ? this.transloco.translate('account.nav.unsaved') : null,
      badgeTone: 'warning' as const,
    })),
  );

  constructor() {
    const store = this.store;
    const transloco = this.transloco;
    const editor: EditorStateService = {
      name: computed(() => `${transloco.translate('account.shell.title')} › ${transloco.translate(`account.sections.${store.section()}`)}`),
      dirty: computed(() => store.dirtyOf(store.section())),
      saving: store.saving,
      lastSaved: signal<string | null>(null),
      error: computed<EditorError | null>(() => {
        const message = store.messageOf(store.section());
        return message === null ? null : { message, count: store.errorCountOf(store.section()) };
      }),
      autosave: false,
      save: () => store.saveSection(store.section()),
      discard: async () => store.discardSection(store.section()),
    };
    const unregister = inject(ActiveEditorService).register(editor);
    inject(DestroyRef).onDestroy(unregister);
  }
}
