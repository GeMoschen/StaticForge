import type { components } from '../../core/api/generated/schema.d.ts';
import { SfFileSizePipe } from '../../shared/pipes/sf-file-size.pipe';

type MediaLocaleFileView = components['schemas']['MediaLocaleFileView'];

/** One configured language of localized media in the drawer's Files section (M27.6.4). */
export interface LocaleFileRow {
  locale: string;
  /** "German (DE)". */
  label: string;
  /** The default language's file is the one every language falls back to: it can be replaced, never removed. */
  isDefault: boolean;
  /** The language has its own file; otherwise it uses {@link fromLocale}'s. */
  own: boolean;
  fromLocale: string | null;
  /** "Uses English's file" for a fallback row; empty for an own file. */
  fallbackText: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number | null;
  blobSha256: string;
  isImage: boolean;
}

/** A file the server would discard when un-localizing (`409 SF-MEDIA-0505`, `files`). */
export interface DiscardedFile {
  locale?: string;
  fileName?: string;
  sizeBytes?: number;
}

const sizePipe = new SfFileSizePipe();

/**
 * The Files section's rows: every configured language in project order, with its own file or the language it falls
 * back to. `files` is the server's `MediaView.localeFiles`.
 */
export function localeFileRows(
  files: Record<string, MediaLocaleFileView> | null | undefined,
  locales: readonly { code?: string; label?: string }[],
  defaultLocale: string | null,
): LocaleFileRow[] {
  const labelOf = (code: string) => locales.find((l) => l.code === code)?.label ?? code;
  return locales
    .map((l) => l.code ?? '')
    .filter((code) => code.length > 0)
    .map((code) => {
      const file = files?.[code];
      const own = file?.own ?? false;
      const fromLocale = file?.fromLocale ?? null;
      return {
        locale: code,
        label: `${labelOf(code)} (${code.toUpperCase()})`,
        isDefault: code === defaultLocale,
        own,
        fromLocale,
        fallbackText: own ? '' : fromLocale ? `Uses ${labelOf(fromLocale)}'s file` : 'No file',
        fileName: file?.fileName ?? '',
        mimeType: file?.mimeType ?? '',
        sizeBytes: file?.sizeBytes ?? null,
        blobSha256: file?.blobSha256 ?? '',
        isImage: (file?.mimeType ?? '').startsWith('image/'),
      };
    });
}

/** "EN hero-en.png (1.2 MB), FR hero-fr.png (800 KB)" — what un-localizing would discard. */
export function discardedFilesText(files: readonly DiscardedFile[]): string {
  return files
    .map((file) => {
      const size = file.sizeBytes != null ? ` (${sizePipe.transform(file.sizeBytes)})` : '';
      return `${(file.locale ?? '').toUpperCase()} ${file.fileName ?? 'file'}${size}`.trim();
    })
    .join(', ');
}
