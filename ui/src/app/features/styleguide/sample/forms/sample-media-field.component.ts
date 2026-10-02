import { booleanAttribute, ChangeDetectionStrategy, Component, computed, inject, input, model, signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { TranslocoPipe } from '@jsverse/transloco';
import { SfCopyableComponent } from '../../../../shared/components/display/sf-copyable.component';
import { SfInputComponent } from '../../../../shared/components/forms/sf-input.component';
import { SfButtonComponent } from '../../../../shared/components/sf-button.component';
import { SfFieldComponent } from '../../../../shared/components/sf-field.component';
import { SfIconComponent } from '../../../../shared/components/sf-icon.component';
import { SampleState } from '../sample-state';
import { HERO_SVG } from '../sample-preview';
import { PickerItem } from './picker-data';
import { SampleAssetPickerComponent } from './sample-asset-picker.component';

/** The chosen file: its name, size and the alternative text the editor wrote. */
export interface SampleMediaValue {
  readonly item: PickerItem;
  readonly alt: string;
}

/**
 * The media editor (M35.17 sample). Empty: a drop zone ("Drop a file here or choose one") with *Choose*. Filled: a
 * thumbnail card with the file's **name**, dimensions and size, *Replace* / *Remove*, and the **alternative text** field
 * under it (a warning finding while it is empty). There is no raw "Media UUID" input: the UUID only shows in developer
 * mode, as an `sf-copyable`. Choosing goes through the asset picker. Read-only: the card without actions.
 */
@Component({
  selector: 'sf-sample-media-field',
  standalone: true,
  imports: [SampleAssetPickerComponent, SfButtonComponent, SfCopyableComponent, SfFieldComponent, SfIconComponent, SfInputComponent, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sample-media-field.component.scss',
  template: `
    @if (value(); as media) {
      <div class="media">
        <div class="media__card">
          <img class="media__thumb" alt="" [src]="thumb" />
          <div class="media__info">
            <span class="media__name">{{ media.item.name }}</span>
            <span class="media__dims">{{ media.item.detail }}</span>
            @if (developer()) {
              <sf-copyable class="media__uuid" [value]="'0b9c3a8e-1d2f-4c5b-9a7e-' + media.item.id" [label]="'styleguide.sample.forms.media.uuid' | transloco" />
            }
          </div>
          @if (!readonly()) {
            <div class="media__actions">
              <sf-button variant="secondary" size="sm" icon="swap_horiz" (click)="picking.set(true)">{{ 'styleguide.sample.forms.media.replace' | transloco }}</sf-button>
              <sf-button variant="ghost" size="sm" icon="delete" [label]="'styleguide.sample.forms.media.remove' | transloco" (click)="remove()" />
            </div>
          }
        </div>
        <sf-field
          [label]="'styleguide.sample.forms.media.alt' | transloco"
          [hint]="'styleguide.sample.forms.media.altHint' | transloco"
          [findings]="media.alt.trim() === '' ? [{ level: 'warning', message: ('styleguide.sample.forms.media.altMissing' | transloco) }] : []"
        >
          <sf-input [readonly]="readonly()" [value]="media.alt" (valueChange)="setAlt($event)" />
        </sf-field>
      </div>
    } @else {
      <div class="drop" [class.is-over]="over()" [class.is-readonly]="readonly()" (dragover)="onOver($event)" (dragleave)="over.set(false)" (drop)="onDrop($event)">
        <sf-icon class="drop__icon" name="add_photo_alternate" />
        <span class="drop__text">{{ (readonly() ? 'styleguide.sample.forms.media.none' : 'styleguide.sample.forms.media.drop') | transloco }}</span>
        @if (!readonly()) {
          <sf-button variant="secondary" size="sm" icon="photo_library" (click)="picking.set(true)">{{ 'styleguide.sample.forms.media.choose' | transloco }}</sf-button>
        }
      </div>
    }

    @if (picking()) {
      <sf-sample-asset-picker [allowedTypes]="['MEDIA']" [current]="value()?.item ?? null" (choose)="onChoose($event)" (cancelled)="picking.set(false)" />
    }
  `,
})
export class SampleMediaFieldComponent {
  readonly value = model<SampleMediaValue | null>(null);
  readonly readonly = input(false, { transform: booleanAttribute });
  /** Developer mode shows the UUID; defaults to the sample screen's switch. */
  readonly developerMode = input<boolean | null>(null);

  private readonly sample = inject(SampleState, { optional: true });
  protected readonly developer = computed(() => this.developerMode() ?? this.sample?.devMode() ?? false);
  protected readonly picking = signal(false);
  protected readonly over = signal(false);
  protected readonly thumb = inject(DomSanitizer).bypassSecurityTrustUrl(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(HERO_SVG)}`);

  protected onChoose(item: PickerItem): void {
    this.value.set({ item, alt: this.value()?.alt ?? '' });
    this.picking.set(false);
  }

  protected remove(): void {
    this.value.set(null);
  }

  protected setAlt(alt: string): void {
    const current = this.value();
    if (current) {
      this.value.set({ ...current, alt });
    }
  }

  protected onOver(event: DragEvent): void {
    if (!this.readonly()) {
      event.preventDefault();
      this.over.set(true);
    }
  }

  /** Dropping a file picks the first file of the library in the sample (nothing is uploaded). */
  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.over.set(false);
    if (!this.readonly()) {
      this.picking.set(true);
    }
  }
}
