import type { components } from '../../../core/api/generated/schema.d.ts';
import {
  type CodeHighlightingOverrides,
  type ResolvedCodeFormat,
  extensionOf,
  resolveCodeFormat,
} from '../../../shared/code-editor/code-format';

type MediaView = components['schemas']['MediaView'];

/**
 * How a text file is highlighted (decisions 103 and 104): the project's override for its extension or media type, else
 * what its media type and extension say. The Details preview, Source and Rendered all use it, so one setting
 * re-highlights all three.
 */
export function resolveHighlight(
  media: Pick<MediaView, 'fileName' | 'mimeType'>,
  overrides: CodeHighlightingOverrides | null | undefined,
): ResolvedCodeFormat {
  return resolveCodeFormat({ extension: extensionOf(media.fileName), mimeType: media.mimeType, overrides });
}
