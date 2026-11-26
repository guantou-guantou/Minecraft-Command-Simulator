export interface McSpan {
  text: string;
  color: string | null;
  bold: boolean;
  italic: boolean;
}

const COLORS: Record<string, string> = {
  '0': '#000000', '1': '#0000aa', '2': '#00aa00', '3': '#00aaaa', '4': '#aa0000', '5': '#aa00aa', '6': '#ffaa00', '7': '#aaaaaa',
  '8': '#555555', '9': '#5555ff', a: '#55ff55', b: '#55ffff', c: '#ff5555', d: '#ff55ff', e: '#ffff55', f: '#ffffff',
  g: '#ddd605', h: '#e3d4d1', i: '#cecaca', j: '#443a3b', m: '#971607', n: '#b4684d', p: '#deb12d', q: '#47a036',
  s: '#2cbaa8', t: '#21497b', u: '#9a5cc6',
};

/** Splits Bedrock formatting codes (section sign + code) into styled spans. Unknown codes are kept as text. */
export function parseMcText(text: string): McSpan[] {
  const spans: McSpan[] = [];
  let color: string | null = null;
  let bold = false;
  let italic = false;
  let buf = '';
  const flush = () => {
    if (buf) spans.push({ text: buf, color, bold, italic });
    buf = '';
  };
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\u00a7' && i + 1 < text.length) {
      const code = text[i + 1].toLowerCase();
      if (code in COLORS) {
        flush();
        color = COLORS[code];
        i++;
        continue;
      }
      if (code === 'l' || code === 'o' || code === 'r') {
        flush();
        if (code === 'l') bold = true;
        else if (code === 'o') italic = true;
        else {
          color = null;
          bold = false;
          italic = false;
        }
        i++;
        continue;
      }
    }
    buf += text[i];
  }
  flush();
  return spans;
}
