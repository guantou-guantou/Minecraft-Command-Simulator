export type Inline =
  | { t: 'text'; text: string }
  | { t: 'code'; text: string }
  | { t: 'bold' | 'italic' | 'strike'; children: Inline[] }
  | { t: 'link'; href: string; children: Inline[] };

export type Block =
  | { t: 'p'; inline: Inline[] }
  | { t: 'h'; level: number; inline: Inline[] }
  | { t: 'list'; ordered: boolean; items: { depth: number; inline: Inline[] }[] }
  | { t: 'quote'; blocks: Block[] }
  | { t: 'hr' }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][] };

const INLINE = /`([^`\n]+)`|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|\*(?!\s)([^*\n]+?)\*|\[([^\]\n]+)\]\(([^)\s]+)\)/;

/** Inline markdown: `code`, **bold**, *italic*, ~~strike~~ and [text](url). Underscores are left alone so names like command_block stay intact. */
export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let rest = s;
  while (rest) {
    const m = INLINE.exec(rest);
    if (!m) break;
    if (m.index > 0) out.push({ t: 'text', text: rest.slice(0, m.index) });
    if (m[1] !== undefined) out.push({ t: 'code', text: m[1] });
    else if (m[2] !== undefined || m[3] !== undefined) out.push({ t: 'bold', children: parseInline(m[2] ?? m[3]) });
    else if (m[4] !== undefined) out.push({ t: 'strike', children: parseInline(m[4]) });
    else if (m[5] !== undefined) out.push({ t: 'italic', children: parseInline(m[5]) });
    else out.push({ t: 'link', href: m[7], children: parseInline(m[6]) });
    rest = rest.slice(m.index + m[0].length);
  }
  if (rest) out.push({ t: 'text', text: rest });
  return out;
}

const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const isSeparator = (line: string) => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line) && line.includes('|');
const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

/** Block markdown: headings, lists, quotes, rules, tables and paragraphs. Fenced code is split off before this (see splitReply). */
export function parseMarkdown(text: string): Block[] {
  const lines = text.split('\n');
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ t: 'p', inline: parseInline(para.join('\n')) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      flush();
      continue;
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      flush();
      out.push({ t: 'h', level: h[1].length, inline: parseInline(h[2]) });
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      out.push({ t: 'hr' });
      continue;
    }
    if (/^\s*>/.test(line)) {
      flush();
      const q: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
      i--;
      out.push({ t: 'quote', blocks: parseMarkdown(q.join('\n')) });
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      flush();
      const head = cells(line).map(parseInline);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(cells(lines[i++]).map(parseInline));
      i--;
      out.push({ t: 'table', head, rows });
      continue;
    }
    const l = LIST.exec(line);
    if (l) {
      flush();
      const ordered = /\d/.test(l[2]);
      const items: { depth: number; inline: Inline[] }[] = [];
      while (i < lines.length) {
        const m = LIST.exec(lines[i]);
        if (!m) break;
        items.push({ depth: Math.min(3, Math.floor(m[1].replace(/\t/g, '  ').length / 2)), inline: parseInline(m[3]) });
        i++;
      }
      i--;
      out.push({ t: 'list', ordered, items });
      continue;
    }
    para.push(line);
  }
  flush();
  return out;
}