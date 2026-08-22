import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { components } from '../../core/api/generated/schema.d.ts';

type FieldChange = components['schemas']['FieldChange'];
type BlockChange = components['schemas']['BlockChange'];

export type BlockKind = 'ADD' | 'REMOVE' | 'UPDATE';

export function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

export function blockKind(block: BlockChange): BlockKind {
  if (block.kind === 'ADD' || block.kind === 'REMOVE') {
    return block.kind;
  }
  if (block.before !== undefined && block.after !== undefined) {
    return 'UPDATE';
  }
  return block.after !== undefined ? 'ADD' : 'REMOVE';
}

@Component({
  selector: 'sf-diff',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sf-diff.component.html',
  styleUrl: './sf-diff.component.scss',
})
export class SfDiffComponent {
  readonly changes = input<FieldChange[]>([]);

  protected formatValue = formatValue;

  protected trackChange(index: number, _change: FieldChange): string {
    return `${index}:${_change.path ?? ''}`;
  }

  protected kindOfBlock(block: BlockChange): BlockKind {
    return blockKind(block);
  }
}
