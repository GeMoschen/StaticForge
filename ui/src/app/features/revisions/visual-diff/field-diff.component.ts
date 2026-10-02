import { ChangeDetectionStrategy, Component, input } from '@angular/core';
// Through the barrel, not `editor-outlet.component` itself: the forms module graph is a cycle (outlet → registry → catalog editor
// → content form → outlet) that only evaluates in the right order when it is entered at the barrel.
import { SfEditorOutlet } from '../../forms';
import { formatValue, RenderedChange } from './field-diff.model';

/**
 * Renders a single field change as side-by-side read-only editors (before |
 * after) when an editor was resolved, or as a structured JSON view otherwise.
 */
@Component({
  selector: 'sf-field-diff',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SfEditorOutlet],
  templateUrl: './field-diff.component.html',
  styleUrl: './field-diff.component.scss',
})
export class SfFieldDiffComponent {
  readonly change = input.required<RenderedChange>();

  protected formatValue = formatValue;
}
