import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ReactiveFormsModule, FormControl, FormGroup } from '@angular/forms';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { SfButtonComponent } from '../../../shared/components/sf-button.component';
import { SfDropTargetDirective } from '../../../shared/directives/sf-drop-target.directive';
import { EditorDefinition } from '../form.model';

interface MediaResult {
  uuid: string;
  label: string;
}

@Component({
  selector: 'sf-media-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, SfFieldComponent, SfButtonComponent, SfDropTargetDirective],
  templateUrl: './media-editor.component.html',
  styleUrl: './media-editor.component.scss',
})
export class SfMediaEditor {
  readonly definition = input.required<EditorDefinition>();
  readonly control = input.required<FormGroup>();
  readonly projectKey = input<string>();

  private readonly http = inject(HttpClient, { optional: true });
  readonly results = signal<MediaResult[]>([]);

  field(name: string): FormControl {
    return this.control().get(name) as FormControl;
  }

  onDrop(event: DragEvent): void {
    const data =
      event.dataTransfer?.getData('application/json') ||
      event.dataTransfer?.getData('text/plain') ||
      '';
    if (!data) {
      return;
    }
    try {
      const parsed = JSON.parse(data) as { uuid?: string };
      if (parsed.uuid) {
        this.select(parsed.uuid);
      }
    } catch {
      this.select(data);
    }
  }

  choose(): void {
    const projectKey = this.projectKey();
    if (!this.http || !projectKey) {
      return;
    }
    this.http.get<ReadonlyArray<Record<string, unknown>>>(
      `/api/v1/projects/${projectKey}/media`,
      { params: { mimeType: this.definition().mimeTypes?.[0] ?? '' } },
    ).subscribe({
      next: (items) => {
        this.results.set(
          items.map((item) => ({
            uuid: String(item['uuid'] ?? item['id'] ?? ''),
            label: String(item['name'] ?? item['fileName'] ?? item['uuid'] ?? ''),
          })),
        );
      },
      error: () => this.results.set([]),
    });
  }

  select(uuid: string): void {
    this.field('uuid').setValue(uuid);
    this.field('uuid').markAsDirty();
  }
}
