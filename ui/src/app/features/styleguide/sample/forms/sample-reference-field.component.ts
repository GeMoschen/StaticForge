import { booleanAttribute, ChangeDetectionStrategy, Component, computed, input, model, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfInputComponent } from '../../../../shared/components/forms/sf-input.component';
import { SfSegmentedComponent, SfSegmentedOption } from '../../../../shared/components/forms/sf-segmented.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import { injectSampleNotice, injectSampleText } from '../changes/sample-area.util';
import { PickerItem, PickerKind, PickerType } from './picker-data';
import { SampleAssetPickerComponent } from './sample-asset-picker.component';

/** A link's value: an internal target (a page) or a web address. */
export interface SampleLinkValue {
  readonly mode: 'page' | 'web';
  readonly page: PickerItem | null;
  readonly url: string;
}

/**
 * The reference editor and the link editor (M35.17 sample). A **reference** to an asset shows the target as a card: its
 * icon, **name**, its URL or place, *Open*, *Change* and *Remove* — empty, a *Choose …* button. A **link** adds the
 * choice between an internal page (the same card) and a web address (an input). The target is picked through the
 * restyled asset picker; nothing in the editor ever shows a UUID.
 */
@Component({
  selector: 'sf-sample-reference-field',
  standalone: true,
  imports: [SampleAssetPickerComponent, SfButtonComponent, SfIconComponent, SfInputComponent, SfSegmentedComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sample-reference-field.component.scss',
  template: `
    @if (link()) {
      <sf-segmented
        class="ref__mode"
        size="sm"
        [options]="modes()"
        [value]="linkValue().mode"
        [readonly]="readonly()"
        [aria-label]="'styleguide.sample.forms.ref.linkKind' | transloco"
        (valueChange)="setMode($event)"
      />
    }
    @if (!link() || linkValue().mode === 'page') {
      @if (target(); as item) {
        <div class="ref__card">
          <sf-icon class="ref__icon" [name]="kind() === 'media' ? 'image' : kind() === 'record' ? 'table_rows' : 'description'" />
          <span class="ref__text">
            <span class="ref__name">{{ item.name }}</span>
            <span class="ref__path">{{ item.path }}</span>
          </span>
          <sf-button variant="ghost" size="sm" icon="open_in_new" (click)="open(item)">{{ 'styleguide.sample.forms.ref.open' | transloco }}</sf-button>
          @if (!readonly()) {
            <sf-button variant="secondary" size="sm" (click)="picking.set(true)">{{ 'styleguide.sample.forms.ref.change' | transloco }}</sf-button>
            <sf-button variant="ghost" size="sm" icon="close" [label]="'styleguide.sample.forms.ref.remove' | transloco" (click)="clear()" />
          }
        </div>
      } @else {
        <div class="ref__empty">
          <span>{{ 'styleguide.sample.forms.ref.none' | transloco }}</span>
          @if (!readonly()) {
            <sf-button variant="secondary" size="sm" icon="search" (click)="picking.set(true)">{{
              'styleguide.sample.forms.ref.choose.' + kind() | transloco
            }}</sf-button>
          }
        </div>
      }
    } @else {
      <!-- i18n-ignore -->
      <sf-input
        icon="link"
        placeholder="https://"
        [readonly]="readonly()"
        [aria-label]="'styleguide.sample.forms.ref.webAddress' | transloco"
        [value]="linkValue().url"
        (valueChange)="setUrl($event)"
      />
    }

    @if (picking()) {
      <sf-sample-asset-picker [allowedTypes]="allowed()" [dataset]="dataset()" [current]="target()" (choose)="onChoose($event)" (cancelled)="picking.set(false)" />
    }
  `,
})
export class SampleReferenceFieldComponent {
  /** What can be referenced (the icon family; the picker's types follow it unless `types` is given). */
  readonly kind = input<PickerKind>('page');
  /** The asset types the picker offers (the field's `assetTypes`); defaults to what `kind` names. */
  readonly types = input<readonly PickerType[] | null>(null);
  /** The field's `dataset "uid"` restriction: only that dataset's records and record sets. */
  readonly dataset = input<string | null>(null);
  /** A reference (`false`) or a link with the page / web address choice. */
  readonly link = input(false, { transform: booleanAttribute });
  readonly reference = model<PickerItem | null>(null);
  readonly linkValue = model<SampleLinkValue>({ mode: 'page', page: null, url: '' });
  readonly readonly = input(false, { transform: booleanAttribute });

  protected readonly picking = signal(false);
  protected readonly allowed = computed<readonly PickerType[]>(
    () => this.types() ?? (this.kind() === 'media' ? ['MEDIA'] : this.kind() === 'record' ? ['RECORD'] : ['PAGE']),
  );
  private readonly notice = injectSampleNotice();
  private readonly t = injectSampleText('styleguide.sample.forms');

  protected readonly target = computed(() => (this.link() ? this.linkValue().page : this.reference()));
  protected readonly modes = computed<SfSegmentedOption<'page' | 'web'>[]>(() => [
    { value: 'page', label: this.t('ref.modePage'), icon: 'description' },
    { value: 'web', label: this.t('ref.modeWeb'), icon: 'language' },
  ]);

  protected setMode(mode: 'page' | 'web' | null): void {
    if (mode) {
      this.linkValue.update((v) => ({ ...v, mode }));
    }
  }

  protected setUrl(url: string): void {
    this.linkValue.update((v) => ({ ...v, url }));
  }

  protected onChoose(item: PickerItem): void {
    if (this.link()) {
      this.linkValue.update((v) => ({ ...v, page: item }));
    } else {
      this.reference.set(item);
    }
    this.picking.set(false);
  }

  protected clear(): void {
    if (this.link()) {
      this.linkValue.update((v) => ({ ...v, page: null }));
    } else {
      this.reference.set(null);
    }
  }

  protected open(item: PickerItem): void {
    this.notice(this.t('ref.opens', { name: item.name }));
  }
}
