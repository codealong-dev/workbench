import { create } from "zustand";

// What the editors know about each open path (paths are per workspace root,
// keyed "<root>|<path>"). Models themselves live in Monaco, one per path, so a
// file open in two tabs (a file tab and its diff) shares edits.
export interface Saved {
  content: string;
  hash: string | null;
}

interface EditorState {
  saved: Record<string, Saved>;
  dirty: Record<string, boolean>;
  /** changed on disk while dirty, or a save refused: what's there now */
  conflict: Record<string, Saved | null>;
  setSaved: (key: string, s: Saved) => void;
  setDirty: (key: string, dirty: boolean) => void;
  setConflict: (key: string, c: Saved | null) => void;
}

export const useEditors = create<EditorState>((set) => ({
  saved: {},
  dirty: {},
  conflict: {},
  setSaved: (key, s) => set((st) => ({ saved: { ...st.saved, [key]: s } })),
  setDirty: (key, dirty) => set((st) => (st.dirty[key] === dirty ? st : { dirty: { ...st.dirty, [key]: dirty } })),
  setConflict: (key, c) => set((st) => ({ conflict: { ...st.conflict, [key]: c } })),
}));

export const editorKey = (root: string, path: string) => `${root}|${path}`;
export const contextEditorKey = (root: string) => `context:${root}`;
