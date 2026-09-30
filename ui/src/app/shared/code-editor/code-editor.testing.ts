import { EditorView } from '@codemirror/view';

/**
 * Test helpers for {@link SfCodeEditorComponent} (M33): its editable element is the one with role `textbox` and the
 * editor's label, so tests find it the way they found the textarea it replaced, and read or set its text here.
 */

/** The editor view behind an editor's textbox element. */
export function codeView(element: Element): EditorView {
  const view = EditorView.findFromDOM(element as HTMLElement);
  if (!view) {
    throw new Error('Not a code editor element');
  }
  return view;
}

/** The text a code editor shows. */
export function codeOf(element: Element): string {
  return codeView(element).state.doc.toString();
}

/** Replaces a code editor's text, as typing would (the editor reports the change). */
export function typeCode(element: Element, text: string): void {
  const view = codeView(element);
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
}
