import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { ApiClient } from '../../../core/api/api.client';
import { assetIcon, assetLocation } from '../../../core/assets/asset-ref';
import { DeveloperModeService } from '../../../core/frame/developer-mode.service';
import { assetRoute } from '../../../shared/asset-route.util';
import { SfCopyableComponent } from '../../../shared/components/display/sf-copyable.component';
import { SfInputComponent } from '../../../shared/components/forms/sf-input.component';
import { SfSegmentedComponent, type SfSegmentedOption } from '../../../shared/components/forms/sf-segmented.component';
import { SfSwitchComponent } from '../../../shared/components/forms/sf-switch.component';
import { SfAssetPickerDialogComponent, AssetPicked } from '../../../shared/components/sf-asset-picker-dialog.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { SfIconComponent } from '../../../shared/components/sf-icon.component';
import { SfEditorBase } from '../editor-base';
import { SF_FORM_CONTEXT } from '../form.context';
import { Link, LinkKind } from '../form.model';

const KINDS: LinkKind[] = ['INTERNAL', 'MEDIA', 'EXTERNAL', 'ANCHOR', 'MAIL'];

const KIND_ICONS: Readonly<Record<LinkKind, string>> = {
  INTERNAL: 'description',
  MEDIA: 'image',
  EXTERNAL: 'public',
  ANCHOR: 'tag',
  MAIL: 'mail',
};

/**
 * The fields a kind keeps when the user switches to it: only the display ones it shows too. Every
 * other field is cleared, the link's destination (`uuid`, `url`, `anchor`) always — a page uuid is
 * no media uuid, a web address no mail address.
 */
const KEPT_ON_SWITCH: Record<LinkKind, (keyof Link)[]> = {
  INTERNAL: [],
  MEDIA: [],
  EXTERNAL: ['target', 'title'],
  ANCHOR: ['target'],
  MAIL: ['title'],
};

/** What the card shows about a page or file target: loading, its name and place, or gone. */
type Target = { state: 'loading' } | { state: 'found'; name: string; type: string; folderPath?: string } | { state: 'missing' };

/**
 * The LINK editor (M35.17, decision 79): a card that names what the link points to — a page or file by its **name** and
 * place, a web address, an anchor, an e-mail address — with *Open*, *Change* and *Remove*, never a UUID. *Change* opens the panel
 * below the card: the kind (page, file, web address, anchor, e-mail), and for a page or file the shared asset picker, for the others
 * the address, a title and *Open in a new tab*. Switching the kind keeps only the display fields the new kind shows too.
 */
@Component({
  selector: 'sf-link-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    SfAssetPickerDialogComponent,
    SfButtonComponent,
    SfCopyableComponent,
    SfFieldComponent,
    SfIconComponent,
    SfInputComponent,
    SfSegmentedComponent,
    SfSwitchComponent,
    TranslocoPipe,
  ],
  templateUrl: './link-editor.component.html',
  styleUrl: './link-editor.component.scss',
})
export class SfLinkEditor extends SfEditorBase<FormGroup> {
  /** The project, for the picker and the names; falls back to the form's. */
  readonly projectKey = input<string>();

  private readonly api = inject(ApiClient);
  private readonly context = inject(SF_FORM_CONTEXT, { optional: true });
  protected readonly developer = inject(DeveloperModeService).enabled;

  readonly open = signal(false);
  protected readonly pickerOpen = signal(false);
  readonly kinds = KINDS;
  private readonly resolved = signal<Target | null>(null);

  protected readonly project = computed(() => this.projectKey() ?? this.context?.projectKey() ?? null);
  protected readonly readOnly = computed(() => !!this.definition().readOnly);

  /**
   * The group's value as a signal. `FormGroup.value` is not reactive, so a `computed` reading it directly would never
   * re-run — switching the link kind left the fields of the old kind on screen.
   */
  private readonly value = computed(() => {
    this.changes();
    return this.control().getRawValue() as Record<string, unknown>;
  });

  readonly kind = computed(() => (this.value()['kind'] as LinkKind) ?? 'INTERNAL');
  protected readonly uuid = computed(() => String(this.value()['uuid'] ?? '').trim() || null);
  protected readonly url = computed(() => String(this.value()['url'] ?? '').trim());
  protected readonly anchor = computed(() => String(this.value()['anchor'] ?? '').trim());
  protected readonly title = computed(() => String(this.value()['title'] ?? ''));
  protected readonly newTab = computed(() => this.value()['target'] === '_blank');
  protected readonly hasTarget = computed(() => this.hasDestination(this.value()));

  protected readonly kindOptions = computed<SfSegmentedOption<LinkKind>[]>(() => {
    this.changes();
    return KINDS.map((kind) => ({ value: kind, label: this.transloco.translate(`forms.link.kinds.${kind}`) }));
  });
  protected readonly icon = computed(() => KIND_ICONS[this.kind()]);
  protected readonly pickerType = computed(() => (this.kind() === 'MEDIA' ? 'MEDIA' : 'PAGE'));

  /** The card's first line: a page or file by name, the title or address of the others. */
  protected readonly name = computed(() => {
    switch (this.kind()) {
      case 'INTERNAL':
      case 'MEDIA': {
        const target = this.resolved();
        return target?.state === 'found' ? target.name : '';
      }
      case 'EXTERNAL':
      case 'MAIL':
        return this.title().trim() || this.url();
      case 'ANCHOR':
        return `#${this.anchor().replace(/^#/, '')}`;
      default:
        return '';
    }
  });
  /** The muted line: where a page or file lives, the address behind a title. */
  protected readonly detail = computed(() => {
    switch (this.kind()) {
      case 'INTERNAL':
      case 'MEDIA': {
        const target = this.resolved();
        return target?.state === 'found' ? (assetLocation(target.folderPath, target.type) ?? '') : '';
      }
      case 'EXTERNAL':
      case 'MAIL':
        return this.title().trim() ? this.url() : '';
      default:
        return '';
    }
  });
  protected readonly missing = computed(() => this.resolved()?.state === 'missing');
  protected readonly loading = computed(() => {
    const kind = this.kind();
    return (kind === 'INTERNAL' || kind === 'MEDIA') && !!this.uuid() && (this.resolved() === null || this.resolved()?.state === 'loading');
  });

  /** Where *Open* goes, or `null` when there is nothing to open. */
  protected readonly external = computed(() => {
    if (!this.hasTarget()) {
      return null;
    }
    switch (this.kind()) {
      case 'EXTERNAL':
        return this.url();
      case 'MAIL':
        return `mailto:${this.url()}`;
      default:
        return null;
    }
  });
  protected readonly route = computed(() => {
    const key = this.project();
    const uuid = this.uuid();
    const target = this.resolved();
    if (!key || !uuid || (this.kind() !== 'INTERNAL' && this.kind() !== 'MEDIA') || target?.state !== 'found') {
      return null;
    }
    return assetRoute(key, { type: target.type, uuid });
  });

  private lastResolved: string | null = null;

  constructor() {
    super();
    effect(
      () => {
        const key = this.project();
        const kind = this.kind();
        const uuid = this.uuid();
        const id = key && uuid && (kind === 'INTERNAL' || kind === 'MEDIA') ? `${key}/${uuid}` : null;
        if (id === this.lastResolved) {
          return;
        }
        this.lastResolved = id;
        untracked(() => (id ? this.resolve(key!, uuid!) : this.resolved.set(null)));
      },
      { allowSignalWrites: true },
    );
  }

  /** A link is filled when it has a destination for its kind. */
  protected override isEmpty(value: unknown): boolean {
    return !this.hasDestination((value ?? {}) as Record<string, unknown>);
  }

  private hasDestination(group: Record<string, unknown>): boolean {
    const text = (name: string) => String(group[name] ?? '').trim() !== '';
    switch (group['kind']) {
      case 'INTERNAL':
      case 'MEDIA':
        return text('uuid');
      case 'EXTERNAL':
      case 'MAIL':
        return text('url');
      case 'ANCHOR':
        return text('anchor');
      default:
        return false;
    }
  }

  /** The user picked another kind: switch to it and clear what belonged to the old one, in one change. */
  selectKind(kind: LinkKind): void {
    const group = this.control();
    if (kind === this.kind()) {
      return;
    }
    const kept = KEPT_ON_SWITCH[kind];
    const cleared = Object.fromEntries(
      Object.keys(group.controls)
        .filter((name) => name !== 'kind' && !kept.includes(name as keyof Link))
        .map((name) => [name, null]),
    );
    group.patchValue({ ...cleared, kind });
    group.markAsDirty();
  }

  field(name: string): FormControl {
    return this.control().get(name) as FormControl;
  }

  protected setText(name: 'url' | 'anchor' | 'title', value: string): void {
    this.field(name).setValue(value === '' ? null : value);
    this.field(name).markAsDirty();
  }

  protected setNewTab(on: boolean): void {
    this.field('target').setValue(on ? '_blank' : null);
    this.field('target').markAsDirty();
  }

  protected onPicked(picked: AssetPicked): void {
    this.field('uuid').setValue(picked.uuid);
    this.field('uuid').markAsDirty();
    this.resolved.set({ state: 'found', name: picked.label, type: picked.assetType });
    this.lastResolved = `${this.project()}/${picked.uuid}`;
    this.pickerOpen.set(false);
  }

  /** Takes the destination off; the kind and the display fields stay. */
  protected remove(): void {
    this.control().patchValue({ uuid: null, url: null, anchor: null });
    this.control().markAsDirty();
    this.open.set(false);
  }

  private resolve(key: string, uuid: string): void {
    this.resolved.set({ state: 'loading' });
    this.api.assetDetail(key, uuid).subscribe({
      next: (detail) =>
        this.resolved.set(
          detail.deleted
            ? { state: 'missing' }
            : { state: 'found', name: detail.displayName ?? detail.uid ?? '', type: detail.type ?? this.pickerType(), folderPath: detail.folderPath },
        ),
      error: () => this.resolved.set({ state: 'missing' }),
    });
  }

  protected iconFor(): string {
    const target = this.resolved();
    return this.kind() === 'INTERNAL' || this.kind() === 'MEDIA' ? assetIcon(target?.state === 'found' ? target.type : this.pickerType()) : this.icon();
  }
}
