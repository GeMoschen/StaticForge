/**
 * Loads the code editor's CodeMirror chunk (M33) once and keeps it: the first editor waits for it, later ones are
 * created right away. Tests preload it in their setup, so editors are there synchronously.
 */
type Setup = typeof import('./code-editor.setup');

let loaded: Setup | null = null;
let loading: Promise<Setup> | null = null;

/** The loaded setup module, or `null` while it hasn't arrived. */
export function loadedCodeEditorSetup(): Setup | null {
  return loaded;
}

/** Loads the setup module (once). */
export function loadCodeEditorSetup(): Promise<Setup> {
  loading ??= import('./code-editor.setup').then((module) => (loaded = module));
  return loading;
}
