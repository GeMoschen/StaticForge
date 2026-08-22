import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  input,
  viewChild,
} from '@angular/core';
import { ReactiveFormsModule, FormControl, FormGroup } from '@angular/forms';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { EditorDefinition } from '../form.model';
import { errorMessageFor } from '../form-builder.service';

@Component({
  selector: 'sf-rich-text-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, SfFieldComponent],
  templateUrl: './rich-text-editor.component.html',
  styleUrl: './rich-text-editor.component.scss',
})
export class SfRichTextEditor {
  readonly definition = input.required<EditorDefinition>();
  readonly control = input.required<FormGroup>();

  private readonly editor = viewChild.required<ElementRef<HTMLDivElement>>('editor');

  readonly valueControl = computed(() => this.control().get('value') as FormControl);

  readonly message = computed(() =>
    errorMessageFor(this.definition(), this.valueControl()),
  );

  readonly count = computed(() => {
    const html = String(this.valueControl().value ?? '');
    return html.replace(/<[^>]*>/g, '').length;
  });

  constructor() {
    effect(() => {
      const element = this.editor().nativeElement;
      const value = String(this.valueControl().value ?? '');
      if (document.activeElement !== element && element.innerHTML !== value) {
        element.innerHTML = value;
      }
    });
  }

  enabled(feature: string): boolean {
    const features = this.definition().features;
    if (!features || features.length === 0) {
      return true;
    }
    return features.includes(feature);
  }

  onInput(event: Event): void {
    this.sync(event.target as HTMLElement);
  }

  exec(command: string): void {
    const element = this.editor().nativeElement;
    element.focus();
    document.execCommand(command, false);
    this.sync(element);
  }

  execBlock(tag: string): void {
    const element = this.editor().nativeElement;
    element.focus();
    document.execCommand('formatBlock', false, tag);
    this.sync(element);
  }

  insertLink(): void {
    const url = window.prompt('Link URL');
    if (url == null) {
      return;
    }
    const element = this.editor().nativeElement;
    element.focus();
    document.execCommand('createLink', false, url);
    this.sync(element);
  }

  private sync(element: HTMLElement): void {
    this.valueControl().setValue(element.innerHTML);
    this.valueControl().markAsDirty();
  }
}
