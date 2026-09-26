import type { components } from '../../core/api/generated/schema.d.ts';
import {
  type ReleaseBlock,
  type ReleaseStatus,
  canDiscardStatus,
  canReleaseStatus,
  canUnpublishStatus,
  localeStatuses,
  localeTag,
  releaseKeyFor,
  statusLabel,
} from './release-status.util';

type Item = components['schemas']['Item'];

/** What a release-state dialog does. */
export type ReleaseMode = 'release' | 'unpublish' | 'discard';

/**
 * One (asset, locale) a dialog offers: a locale of the asset open in an editor, or a row picked in the Changes view.
 * `locale` is the release key: `""` for the shared key ("every language").
 */
export interface ReleaseChoice {
  assetUuid: string;
  locale: string;
  /** What the checkbox says ("German (DE) — Changed", or "Home page · DE — Changed"). */
  label: string;
  status: ReleaseStatus | null;
  checked: boolean;
}

/** The asset an editor's release bar acts on. */
export interface ReleaseSubject {
  uuid: string;
  type?: string;
  uid?: string;
  displayName?: string;
  folderPath?: string;
  release: ReleaseBlock;
}

export function eligible(mode: ReleaseMode, status: string | null | undefined): boolean {
  switch (mode) {
    case 'release':
      return canReleaseStatus(status);
    case 'unpublish':
      return canUnpublishStatus(status);
    case 'discard':
      return canDiscardStatus(status);
  }
}

/** `uuid|locale` — how selections and dependency ticks are keyed. */
export function itemKey(assetUuid: string | undefined, locale: string | null | undefined): string {
  return `${assetUuid ?? ''}|${locale ?? ''}`;
}

/**
 * The locales of one asset a dialog offers for `mode`, the editing locale's ticked (explicitly — lessons: a default
 * is modelled, never left to the control). When the editing locale has nothing to do, a lone choice is ticked; with
 * several, nothing is, and the dialog's button stays disabled until the user picks.
 */
export function choicesFor(
  subject: ReleaseSubject,
  mode: ReleaseMode,
  editingLocale: string | null,
  labelOf: (code: string) => string = (code) => code,
): ReleaseChoice[] {
  const editingKey = releaseKeyFor(subject.release, editingLocale);
  const choices = localeStatuses(subject.release)
    .filter((entry) => eligible(mode, entry.status))
    .map<ReleaseChoice>((entry) => ({
      assetUuid: subject.uuid,
      locale: entry.key,
      label: `${entry.key ? `${labelOf(entry.key)} (${localeTag(entry.key)})` : 'All languages'} — ${statusLabel(entry.status)}`,
      status: entry.status,
      checked: entry.key === editingKey,
    }));
  if (choices.length === 1) {
    choices[0].checked = true;
  }
  return choices;
}

/** The request items of the ticked choices; the shared key travels as "no locale" (every locale). */
export function itemsOf(choices: readonly ReleaseChoice[]): Item[] {
  return choices.filter((choice) => choice.checked).map((choice) => toItem(choice.assetUuid, choice.locale));
}

export function toItem(assetUuid: string | undefined, locale: string | null | undefined): Item {
  return locale ? { assetUuid, locale } : { assetUuid };
}

/** "Home page", falling back to the uid, then to a short uuid. */
export function assetName(asset: { displayName?: string; uid?: string; uuid?: string } | null | undefined): string {
  return asset?.displayName || asset?.uid || (asset?.uuid ? asset.uuid.slice(0, 8) : 'Untitled');
}
