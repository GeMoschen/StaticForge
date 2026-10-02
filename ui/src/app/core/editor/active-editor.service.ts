import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { ShortcutService } from '../ui/shortcut.service';
import { ToastService } from '../ui/toast.service';
import { UnsavedChangesService } from '../../shared/components/dialog/unsaved-changes.service';
import type { EditorStateService } from './editor-state';

/**
 * The editors that are open right now (M35.13). Each registers while it lives; the frame asks this service for
 * everything that has to be the same in every editor:
 *
 * - **Ctrl/Cmd+S** saves the active editor — the one registered last — through `ShortcutService`, so no editor
 *   listens for it on its own (it works inside inputs and code editors, and it is not the browser's "save page").
 * - **Leaving** (a route change, a switch of item inside a screen): {@link canLeave} asks first when an editor has
 *   unsaved changes. An autosave editor flushes silently; only a save that fails opens the Save / Discard / Cancel dialog.
 * - **Closing the tab** (`beforeunload`): the browser's own prompt while something is unsaved or waiting to be written.
 */
@Injectable({ providedIn: 'root' })
export class ActiveEditorService {
  private readonly unsaved = inject(UnsavedChangesService);
  private readonly toasts = inject(ToastService);
  private readonly shortcuts = inject(ShortcutService);
  private readonly window = inject(DOCUMENT).defaultView;

  private readonly open = signal<readonly EditorStateService[]>([]);

  /** The editor Ctrl+S saves: the one that registered last. */
  readonly active = computed(() => this.open().at(-1) ?? null);
  /** Whether any open editor has changes that are not on the server, or a save that was refused. */
  readonly hasUnsaved = computed(() => this.open().some((editor) => editor.dirty() || editor.error() !== null));

  constructor() {
    // Ctrl+Shift+S is not "save" (the registry matches the exact modifiers).
    const unregister = this.shortcuts.register({
      id: 'save',
      keys: 'Mod+S',
      scope: 'global',
      group: 'general',
      description: 'frame.shortcuts.items.save',
      allowInInput: true,
      handler: () => void this.saveActive(),
    });
    this.window?.addEventListener('beforeunload', this.onBeforeUnload);
    inject(DestroyRef).onDestroy(() => {
      unregister();
      this.window?.removeEventListener('beforeunload', this.onBeforeUnload);
    });
  }

  /** Registers an open editor; returns what removes it (call it when the editor goes away). */
  register(editor: EditorStateService): () => void {
    this.open.update((editors) => [...editors, editor]);
    return () => this.open.update((editors) => editors.filter((e) => e !== editor));
  }

  /** Ctrl/Cmd+S: saves the active editor. A refusal is said in a toast (the editor's header shows it too). */
  async saveActive(): Promise<void> {
    const editor = this.active();
    if (editor === null || (!editor.dirty() && editor.error() === null)) {
      return;
    }
    const result = await editor.save();
    if (!result.ok) {
      this.toasts.show(result.message, 'error');
    }
  }

  /**
   * Whether the screen may change: every editor with something unsaved is saved or discarded first, or the person
   * stays. Autosave editors write silently; the dialog is for the ones that cannot.
   */
  async canLeave(): Promise<boolean> {
    for (const editor of [...this.open()]) {
      if (!editor.dirty() && editor.error() === null) {
        continue;
      }
      if (editor.autosave) {
        const result = await editor.save();
        if (result.ok) {
          continue;
        }
      }
      const left = await this.unsaved.confirmLeave({
        name: editor.name(),
        save: () => editor.save(),
        discard: () => editor.discard(),
      });
      if (!left) {
        return false;
      }
    }
    return true;
  }

  private readonly onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (!this.hasUnsaved()) {
      return;
    }
    // Write what can be written: an autosave edit still waiting for its debounce.
    for (const editor of this.open()) {
      if (editor.autosave && editor.dirty()) {
        void editor.save();
      }
    }
    event.preventDefault();
    event.returnValue = '';
  };
}
