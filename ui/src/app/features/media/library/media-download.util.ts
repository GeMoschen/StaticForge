/** The name of a folder as a file name: lower case, anything but letters and digits becomes one hyphen (`Spring Photos` → `spring-photos`). */
export function zipSlug(folderName: string, fallback = 'media'): string {
  const slug = folderName
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

/** Hands a blob to the browser as a download named `fileName`. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // The download has started by the time the click returns; revoke after the browser has taken the URL.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
