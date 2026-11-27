import type { Diagnostic } from './types.ts';

/** One logical line of the script: its comment-free text and how far it is indented. */
export interface Entry {
  line: number;
  text: string;
  indent: number;
  /** Set on the header of a chain with if:/run: parts: its first block defaults to a repeating, always-on one. */
  gate?: boolean;
  /** Marks the first command of a run: part: its block is the one that is switched between impulse and chain mode (the number counts the levels). */
  toggle?: number;
}

const HEADER = /^chain\s+\w+.*:$/;
const LABEL = /^(if|run)\s*:$/;

type Item = { kind: 'line'; e: Entry } | { kind: 'if' | 'run'; e: Entry; items: Item[] };

function build(list: Entry[], from: number, base: number): [Item[], number] {
  const items: Item[] = [];
  let k = from;
  while (k < list.length && list[k].indent > base) {
    const e = list[k];
    const m = LABEL.exec(e.text);
    if (m) {
      const [children, next] = build(list, k + 1, e.indent);
      items.push({ kind: m[1] as 'if' | 'run', e, items: children });
      k = next;
    } else {
      items.push({ kind: 'line', e });
      k++;
    }
  }
  return [items, k];
}

/**
 * Chains can contain `if:` and `run:` parts, the "break chain" of command blocks: a detector (`if:`) that, when its last
 * command succeeds, switches the first block of the `run:` part from an impulse block (which a chain cannot trigger) to a
 * chain block, so the run blocks run once. The run part ends with a command that switches that block back. The switched
 * block keeps its own command (it is the first command of `run:`); it is an always-active impulse block, which is what
 * keeps it running once it is a chain block. A `run:` may end with another `if:`/`run:` pair (several levels).
 *
 * This expands such a chain into one ordinary chain with generated commands. The coordinates are filled in later
 * (<<set:chain:level:block>>), once the positions are known.
 */export function expandGates(entries: Entry[]): { entries: Entry[]; diagnostics: Diagnostic[] } {
  const out: Entry[] = [];
  const diagnostics: Diagnostic[] = [];
  const diag = (line: number, message: string) => diagnostics.push({ line, message });
  let i = 0;
  while (i < entries.length) {
    const e = entries[i];
    if (e.indent > 0 && HEADER.test(e.text)) {
      diag(e.line, 'A chain header cannot be indented: command block chains cannot be nested (write the chain at the start of the line)');
      i++;
      continue;
    }
    if (!(e.indent === 0 && HEADER.test(e.text))) {
      out.push(e);
      i++;
      continue;
    }
    let j = i + 1;
    while (j < entries.length && entries[j].indent > 0) j++;
    const body = entries.slice(i + 1, j);
    i = j;
    if (!body.some((b) => LABEL.test(b.text))) {
      out.push(e);
      for (const b of body) {
        if (HEADER.test(b.text)) diag(b.line, 'A chain header cannot be indented: command block chains cannot be nested (write the chain at the start of the line)');
        else out.push(b);
      }
      continue;
    }
    expand(e, body, out, diag);
  }
  return { entries: out, diagnostics };
}

function expand(header: Entry, body: Entry[], out: Entry[], diag: (line: number, message: string) => void): void {
  const name = /^chain\s+(\w+)/.exec(header.text)![1];
  const [top] = build(body, 0, 0);
  if (top.length !== 2 || top[0].kind !== 'if' || top[1].kind !== 'run') {
    diag(header.line, `chain ${name}: a chain with if:/run: must contain exactly one if: followed by one run:, with every command inside one of them`);
    return;
  }
  const lines = (items: Item[], what: string): Entry[] | null => {
    const bad = items.find((it) => it.kind !== 'line');
    if (bad) {
      diag(bad.e.line, `${what} cannot contain ${bad.kind}:`);
      return null;
    }
    return items.map((it) => it.e);
  };
  const E = (text: string, line: number, indent = 4): Entry => ({ line, text, indent });
  let count = 0;
  const level = (ifLabel: Entry, runLabel: Entry, runItems: Item[]): boolean => {
    const k = ++count;
    const last = runItems[runItems.length - 1];
    const prev = runItems[runItems.length - 2];
    const nested = last?.kind === 'run' && prev?.kind === 'if' ? ([prev, last] as const) : null;
    const commands = lines(nested ? runItems.slice(0, -2) : runItems, 'run:');
    if (!commands) return false;
    const first = commands.findIndex((x) => !/^cb\s*\(/.test(x.text));
    if (first < 0) {
      diag(runLabel.line, 'run: needs at least one command');
      return false;
    }
    out.push(E('cb(conditional=true)', ifLabel.line), E(`/setblock <<set:${name}:${k}:chain_command_block>>`, ifLabel.line));
    commands.forEach((c, i) => out.push(i === first ? { ...c, toggle: k } : c));
    out.push(E(`/setblock <<set:${name}:${k}:command_block>>`, runLabel.line));
    if (!nested) return true;
    const nestedIf = lines(nested[0].items, 'if:');
    if (!nestedIf) return false;
    if (!nestedIf.some((x) => !/^cb\s*\(/.test(x.text))) {
      diag(nested[0].e.line, 'if: needs at least one command');
      return false;
    }
    out.push(...nestedIf);
    return level(nested[0].e, nested[1].e, nested[1].items);
  };  const ifItems = lines(top[0].items, 'if:');
  if (!ifItems) return;
  if (!ifItems.some((x) => !/^cb\s*\(/.test(x.text))) {
    diag(top[0].e.line, 'if: needs at least one command');
    return;
  }
  const start = out.length;
  out.push({ ...header, gate: true }, ...ifItems);
  if (!level(top[0].e, top[1].e, top[1].items)) out.length = start;
}