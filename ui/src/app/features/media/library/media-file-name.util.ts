/** Characters a file name can't have (they would break links or file systems). */
export const INVALID_FILE_NAME_CHARACTERS = /[\\/:*?"<>|]/;

/** The longest file name the Rename dialog accepts. */
export const MAX_FILE_NAME_LENGTH = 100;

/** The extension of a file name without the dot, lower case (`''` for none): `Photo.JPG` → `jpg`. */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** Why a file name is refused, as the key under `media.rename` of its message. */
export type FileNameProblem = 'required' | 'characters' | 'tooLong' | 'extension' | 'taken';

/**
 * Checks the name typed into the Rename dialog (decision 93) — required, none of `/ \ : * ? " < > |`, at most
 * {@link MAX_FILE_NAME_LENGTH} characters, the **same extension** as the current name (the file type stays), and not taken
 * by another file of the folder (`taken`: their names, lower case). `null` when the name is fine.
 */
export function fileNameProblem(name: string, current: string, taken: ReadonlySet<string>): FileNameProblem | null {
  const trimmed = name.trim();
  if (trimmed === '') {
    return 'required';
  }
  if (INVALID_FILE_NAME_CHARACTERS.test(trimmed)) {
    return 'characters';
  }
  if (trimmed.length > MAX_FILE_NAME_LENGTH) {
    return 'tooLong';
  }
  if (fileExtension(trimmed) !== fileExtension(current)) {
    return 'extension';
  }
  return taken.has(trimmed.toLowerCase()) ? 'taken' : null;
}
