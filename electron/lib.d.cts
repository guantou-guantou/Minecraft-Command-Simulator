declare const lib: {
  pickFileArg(argv: string[], cwd: string): string | null;
  addRecent(list: string[], file: string, max?: number): string[];
  windowTitle(name: string, dirty: boolean): string;
  bdxFile(content: Uint8Array): Buffer;
  decodeStructureFile(buf: Uint8Array): { kind: 'bdx' | 'mcstructure'; content: Buffer };
};
export default lib;
