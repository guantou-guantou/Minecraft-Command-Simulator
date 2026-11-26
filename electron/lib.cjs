const path = require('node:path');

const EXT = /\.(mcsim|txt)$/i;

/** Returns the first command line argument that names a script file (.mcsim or .txt), resolved against cwd. */
function pickFileArg(argv, cwd) {
  for (const arg of argv.slice(1)) {
    if (typeof arg === 'string' && !arg.startsWith('-') && EXT.test(arg)) return path.resolve(cwd, arg);
  }
  return null;
}

/** Puts `file` at the front of the recent list without duplicates (Windows paths compare case-insensitively). */
function addRecent(list, file, max = 10) {
  return [file, ...list.filter((f) => f.toLowerCase() !== file.toLowerCase())].slice(0, max);
}

function windowTitle(name, dirty) {
  return `${dirty ? '* ' : ''}${name} - MC Command Simulator`;
}

/** Writes through a temporary file next to the target so a crash never leaves a half written script. */
function atomicWrite(fs, file, content) {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, content, 'utf8');
    try {
      fs.renameSync(tmp, file);
    } catch {
      fs.writeFileSync(file, content, 'utf8');
      fs.rmSync(tmp, { force: true });
    }
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* nothing left to clean */
    }
    throw e;
  }
}

/** Drops a UTF-8 BOM and turns CRLF/CR into LF; the original line ending is returned so saving can restore it. */
function decodeText(raw) {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return { content: text.replace(/\r\n?/g, '\n'), eol: /\r\n/.test(text) ? 'crlf' : 'lf' };
}

function encodeText(content, eol) {
  return eol === 'crlf' ? content.replace(/\r?\n/g, '\r\n') : content.replace(/\r\n/g, '\n');
}

/**
 * Turns a saved window state into BrowserWindow options. The position is only kept when the window would still
 * be visible on one of the work areas (a monitor may have been unplugged since).
 */
function windowOptions(saved, workAreas, min = { width: 900, height: 600 }, fallback = { width: 1400, height: 900 }) {
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  if (!saved || !num(saved.width) || !num(saved.height)) return { ...fallback, maximized: false };
  const maxW = Math.max(...workAreas.map((a) => a.width), min.width);
  const maxH = Math.max(...workAreas.map((a) => a.height), min.height);
  const width = Math.min(maxW, Math.max(min.width, Math.round(saved.width)));
  const height = Math.min(maxH, Math.max(min.height, Math.round(saved.height)));
  const out = { width, height, maximized: saved.maximized === true };
  if (num(saved.x) && num(saved.y)) {
    const visible = workAreas.some((a) => {
      const w = Math.min(saved.x + width, a.x + a.width) - Math.max(saved.x, a.x);
      const h = Math.min(saved.y + height, a.y + a.height) - Math.max(saved.y, a.y);
      return w >= 100 && h >= 50;
    });
    if (visible) {
      out.x = Math.round(saved.x);
      out.y = Math.round(saved.y);
    }
  }
  return out;
}

/** A BDX file: the \BD@\ header and the brotli-compressed content (quality 6, like PhoenixBuilder). */
function bdxFile(content) {
  const zlib = require('node:zlib');
  const packed = zlib.brotliCompressSync(Buffer.from(content), { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6 } });
  return Buffer.concat([Buffer.from('BD@'), packed]);
}

/** Tells a .bdx from a .mcstructure and unpacks a .bdx (\BD@\ = brotli, \BDZ\ = gzip) to its content. */
function decodeStructureFile(buf) {
  const zlib = require('node:zlib');
  const head = Buffer.from(buf).subarray(0, 3).toString('latin1');
  if (head === 'BD@') return { kind: 'bdx', content: zlib.brotliDecompressSync(Buffer.from(buf).subarray(3)) };
  if (head === 'BDZ') return { kind: 'bdx', content: zlib.gunzipSync(Buffer.from(buf).subarray(3)) };
  return { kind: 'mcstructure', content: Buffer.from(buf) };
}

module.exports = { decodeStructureFile, bdxFile, pickFileArg, addRecent, windowTitle, atomicWrite, decodeText, encodeText, windowOptions };