import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { SfTextareaComponent } from '../../../shared/components/forms/sf-textarea.component';
import { SfFieldComponent } from '../../../shared/components/sf-field.component';
import { SfEditorBase } from '../editor-base';

/**
 * Minimal, safe markdown preview: escapes HTML, then applies bold/italic,
 * ATX headings and unordered lists. This is the intended swap-in point for a
 * full editor (e.g. Monaco) — replace the `<textarea>` + this transformer while
 * keeping the `FormControl` (mode: markdown) as the single source of truth.
 */
export function markdownToHtml(markdown: string): string {
  const escaped = markdown
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const lines = escaped.split(/\r?\n/);
  const html: string[] = [];
  let inList = false;

  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      if (!inList) {
        html.push('<ul>');
        inList = true;
      }
      html.push(`<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`);
      continue;
    }
    if (inList) {
      html.push('</ul>');
      inList = false;
    }
    if (line.trim() === '') {
      continue;
    }
    html.push(`<p>${inline(line)}</p>`);
  }
  if (inList) {
    html.push('</ul>');
  }
  return html.join('');
}

function inline(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>');
}

/** The MARKDOWN editor (M35.17): a monospace `sf-textarea` with the live preview beside it, in an `sf-field`. */
@Component({
  selector: 'sf-markdown-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, SfFieldComponent, SfTextareaComponent],
  templateUrl: './markdown-editor.component.html',
  styleUrl: './markdown-editor.component.scss',
})
export class SfMarkdownEditor extends SfEditorBase<FormControl> {
  // Swap this computed's source for Monaco's model once it is introduced.
  readonly previewHtml = computed(() => {
    this.changes();
    return markdownToHtml(String(this.control().value ?? ''));
  });

  // Future extension point: disable split preview on small viewports.
  readonly preview = true;
}
