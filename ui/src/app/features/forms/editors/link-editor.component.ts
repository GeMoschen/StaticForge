import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { ReactiveFormsModule, FormControl, FormGroup } from '@angular/forms';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { EditorDefinition, LinkKind } from '../form.model';

const KINDS: LinkKind[] = ['INTERNAL', 'EXTERNAL', 'MEDIA', 'ANCHOR', 'MAIL'];

@Component({
  selector: 'sf-link-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, SfFieldComponent, SfButtonComponent],
  templateUrl: './link-editor.component.html',
  styleUrl: './link-editor.component.scss',
})
export class SfLinkEditor {
  readonly definition = input.required<EditorDefinition>();
  readonly control = input.required<FormGroup>();

  readonly open = signal(false);
  readonly kinds = KINDS;

  field(name: string): FormControl {
    return this.control().get(name) as FormControl;
  }

  readonly kind = computed(() => this.field('kind').value as LinkKind);

  readonly summary = computed(() => {
    const group = this.control().getRawValue() as Record<string, unknown>;
    switch (group['kind']) {
      case 'INTERNAL':
      case 'MEDIA':
        return group['uuid'] ?? '';
      case 'EXTERNAL':
      case 'MAIL':
        return group['url'] ?? '';
      case 'ANCHOR':
        return group['anchor'] ?? '';
      default:
        return group['title'] ?? '';
    }
  });
}
