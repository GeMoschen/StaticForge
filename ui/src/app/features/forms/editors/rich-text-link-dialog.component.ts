import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ApiClient } from '../../../core/api/api.client';
import { SfAssetPickerDialogComponent, type AssetPicked } from '../../../shared/components/sf-asset-picker-dialog.component';
import { SfDialogComponent, SfDialogFooterDirective } from '../../../shared/components/dialog/sf-dialog.component';
import { SfCheckboxComponent } from '../../../shared/components/forms/sf-checkbox.component';
import { SfInputComponent } from '../../../shared/components/forms/sf-input.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { isValidLinkTarget, pagePath } from './rich-text.util';

/** What the link dialog hands back. */
export interface RichTextLink {
  readonly href: string;
  readonly newTab: boolean;
}

/**
 * The link dialog of the rich-text editor (M35.17): the address, a page chosen through the asset picker, and "Open in a
 * new tab". It replaces `window.prompt`. *Apply* stays disabled until the address is valid (a web address, a mail or
 * phone link, a site path or an anchor); when the caret was in a link, the dialog edits it and offers *Remove link*.
 */
@Component({
  selector: 'sf-rich-text-link-dialog',
  standalone: true,
  imports: [SfAssetPickerDialogComponent, SfButtonComponent, SfCheckboxComponent, SfDialogComponent, SfDialogFooterDirective, SfFieldComponent, SfInputComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './rich-text-link-dialog.component.scss',
  template: `
    <sf-dialog size="sm" [title]="(editing() ? 'forms.rich.editLinkTitle' : 'forms.rich.linkTitle') | transloco" (closed)="closed.emit()">
      <div class="link">
        <sf-field [label]="'forms.rich.address' | transloco" [error]="addressError() ? ('forms.rich.addressInvalid' | transloco) : null">
          <!-- i18n-ignore -->
          <sf-input icon="link" placeholder="https://" [value]="address()" (valueChange)="onAddress($event)" />
        </sf-field>
        @if (projectKey()) {
          <div class="link__pick">
            <sf-button variant="secondary" size="sm" icon="description" (click)="picking.set(true)">{{ 'forms.rich.pickPage' | transloco }}</sf-button>
            @if (pickedName(); as name) {
              <span class="link__picked">{{ 'forms.rich.picked' | transloco: { name } }}</span>
            }
          </div>
        }
        <sf-checkbox [value]="newTab()" (valueChange)="newTab.set($event)">{{ 'forms.rich.newTab' | transloco }}</sf-checkbox>
      </div>
      <ng-container sfDialogFooter>
        @if (editing()) {
          <sf-button class="link__remove" variant="ghost" (click)="removed.emit()">{{ 'forms.rich.removeLink' | transloco }}</sf-button>
        }
        <sf-button variant="ghost" (click)="closed.emit()">{{ 'common.cancel' | transloco }}</sf-button>
        <sf-button variant="primary" [disabled]="!valid()" (click)="apply()">{{ 'forms.rich.apply' | transloco }}</sf-button>
      </ng-container>
    </sf-dialog>
    @if (picking() && projectKey(); as key) {
      <sf-asset-picker-dialog [projectKey]="key" initialType="PAGE" [allowedTypes]="['PAGE']" (picked)="onPicked($event)" (closed)="picking.set(false)" />
    }
  `,
})
export class SfRichTextLinkDialogComponent {
  /** The address of the link being edited; empty for a new link. */
  readonly initialAddress = input('');
  readonly initialNewTab = input(false);
  /** Whether an existing link is being edited (adds *Remove link*). */
  readonly editing = input(false);
  /** The project, for the page picker; without it the picker is not offered. */
  readonly projectKey = input<string | undefined>(undefined);

  readonly applied = output<RichTextLink>();
  readonly removed = output<void>();
  readonly closed = output<void>();

  private readonly api = inject(ApiClient);

  protected readonly address = signal('');
  protected readonly newTab = signal(false);
  protected readonly picking = signal(false);
  protected readonly pickedName = signal<string | null>(null);

  protected readonly valid = computed(() => isValidLinkTarget(this.address()));
  protected readonly addressError = computed(() => this.address().trim() !== '' && !this.valid());

  constructor() {
    // The inputs are set before the first render; the dialog's own state starts from them.
    queueMicrotask(() => {
      this.address.set(this.initialAddress());
      this.newTab.set(this.initialNewTab());
    });
  }

  protected onAddress(value: string): void {
    this.address.set(value);
    this.pickedName.set(null);
  }

  /** A page was chosen: its site path becomes the address (the author can still edit it). */
  protected onPicked(picked: AssetPicked): void {
    this.picking.set(false);
    this.pickedName.set(picked.label);
    const key = this.projectKey();
    if (!key) {
      return;
    }
    this.api.assetDetail(key, picked.uuid).subscribe({
      next: (detail) => this.address.set(pagePath(detail.folderPath, detail.uid)),
      error: () => this.pickedName.set(null),
    });
  }

  protected apply(): void {
    if (this.valid()) {
      this.applied.emit({ href: this.address().trim(), newTab: this.newTab() });
    }
  }
}
