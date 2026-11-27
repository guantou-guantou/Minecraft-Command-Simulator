export interface FileResult {
  path: string;
  content: string;
  eol: 'lf' | 'crlf';
}

import type { AiMessage } from '../ai/messages.ts';

export interface AiSettings {
  enabled: boolean;
  baseUrl: string;
  model: string;
  includeScript: boolean;
  hasKey: boolean;
  canEncrypt: boolean;
}

export type { AiMessage };

export interface AiEvent {
  id: string;
  type: 'delta' | 'done' | 'error' | 'cancelled';
  text: string;
}

export interface DesktopApi {
  version(): Promise<string>;
  launchFile(): Promise<FileResult | null>;
  openDialog(): Promise<FileResult | null>;
  readFile(path: string): Promise<FileResult | null>;
  saveFile(path: string, content: string, eol: 'lf' | 'crlf'): Promise<string | null>;
  saveAsDialog(suggestedName: string, content: string, eol: 'lf' | 'crlf'): Promise<string | null>;
  exportText(suggestedName: string, content: string): Promise<string | null>;
  /** A .bdx comes back already unpacked (kind "bdx"); a .mcstructure is returned as it is. */
  importStructure(): Promise<{ name: string; kind: 'bdx' | 'mcstructure'; base64: string } | null>;
  exportStructure(suggestedName: string, base64: string): Promise<string | null>;
  /** ase64 is the uncompressed BDX content; the main process adds the BD@ header and brotli compression. */
  exportBdx(suggestedName: string, base64: string): Promise<string | null>;
  aiGetSettings(): Promise<AiSettings>;
  /** `key`: undefined keeps the saved key, an empty string removes it. */
  aiSetSettings(change: Partial<Omit<AiSettings, 'hasKey' | 'canEncrypt'>> & { key?: string }): Promise<{ settings?: AiSettings; error?: string }>;
  /** Starts a streamed chat; the pieces arrive through onAiEvent. */
  aiChat(id: string, messages: AiMessage[], opts?: { test?: boolean }): Promise<{ started?: boolean; error?: string }>;
  aiCancel(id: string): Promise<void>;
  onAiEvent(cb: (e: AiEvent) => void): () => void;
  /** Asks where to save a conversation (.mcchat); resolves to the path, or null when cancelled. */
  chatSaveAs(suggestedName: string, content: string): Promise<string | null>;
  chatOpen(): Promise<{ path: string; content: string } | null>;
  /** Asks for a folder and writes the files (relative paths with slashes) into it; resolves to the folder, or null when cancelled. */
  exportFolder(files: { path: string; content: string }[]): Promise<string | null>;
  /** A warning box with the given buttons; resolves to the index of the one pressed (the last one is also what closing the box does). */
  choose(message: string, buttons: string[]): Promise<number>;
  confirmDiscard(name: string): Promise<boolean>;
  setState(state: { dirty: boolean; name: string }): Promise<void>;
  forceClose(): Promise<void>;
  setLanguage(lang: string): Promise<void>;
  onMenu(cb: (action: string) => void): () => void;
  onOpenRecent(cb: (path: string) => void): () => void;
  onSaveAndClose(cb: () => void): () => void;
  onOpenExternal(cb: (path: string) => void): () => void;
}

declare global {
  interface Window {
    desktop?: DesktopApi;
  }
}

/** Defined only inside the Electron app; undefined in a normal browser. */
export const desktop: DesktopApi | undefined = typeof window === 'undefined' ? undefined : window.desktop;

export const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;
