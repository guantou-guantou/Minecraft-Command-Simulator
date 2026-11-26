export interface FileResult {
  path: string;
  content: string;
  eol: 'lf' | 'crlf';
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
