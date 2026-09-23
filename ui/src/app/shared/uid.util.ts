/** What a uid may contain — the server's `UidChangeRequest` and every uid field check the same. */
export const UID_PATTERN = /^[a-z0-9_]+$/;

const LIGATURES: ReadonlyArray<[string, string]> = [
  ['ß', 'ss'],
  ['æ', 'ae'],
  ['œ', 'oe'],
  ['ø', 'o'],
  ['ł', 'l'],
  ['đ', 'd'],
  ['ð', 'd'],
  ['þ', 'th'],
];

/**
 * The uid the server derives from a display name (`Slugifier`, spec §6.3): NFKD, ligatures
 * transliterated, combining marks stripped, lowercased, every run of other characters one
 * underscore, at most 96 characters (cut at an underscore when that loses at most 12). The server
 * still appends `_1`, `_2` … when the uid is taken or reserved, so this is the uid a create dialog
 * *suggests*, not a promise.
 */
export function deriveUid(displayName: string): string {
  let s = (displayName ?? '').normalize('NFKD');
  for (const [from, to] of LIGATURES) {
    s = s.split(from).join(to);
  }
  s = s
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (s.length > 96) {
    let cut = s.slice(0, 96);
    const lastUnderscore = cut.lastIndexOf('_');
    if (lastUnderscore >= 84) {
      cut = cut.slice(0, lastUnderscore);
    }
    s = cut;
  }
  return s;
}
