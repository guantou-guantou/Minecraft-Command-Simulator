const NUM = '-?(?:\\d+\\.?\\d*|\\.\\d+)';
const COMPONENT = new RegExp(`^(?:([~^])(${NUM})?|(${NUM}))`);
const INTERP = /^\$\{[^}]+\}$/;

/** The coordinate components glued together in one word ("~~", "0~", "~0~0~"), or null when the word is not made of whole components. `${name}` counts as three, `${name.part}` as one. */
export function components(word: string): ('~' | '^' | 'abs' | 'var')[] | null {
  if (INTERP.test(word)) return word.includes('.') ? ['var'] : ['var', 'var', 'var'];
  const out: ('~' | '^' | 'abs')[] = [];
  let s = word;
  while (s) {
    const m = COMPONENT.exec(s);
    if (!m) return null;
    out.push(m[1] ? (m[1] as '~' | '^') : 'abs');
    s = s.slice(m[0].length);
  }
  return out.length ? out : null;
}

/**
 * How many words a position takes, starting at words[i]: the components may be split over the words in any way
 * ("~~ 0", "~ 0~", "~0 0~0"). `complete` is false when the words end before the third component.
 * Returns null when the words cannot be a position (bad word, more than three components, or ^ mixed with other kinds).
 */
export function posSpan(words: string[], i: number): { n: number; complete: boolean } | null {
  let count = 0;
  let local = false;
  let world = false;
  for (let j = i; j < words.length; j++) {
    const cs = components(words[j]);
    if (!cs) return null;
    for (const c of cs) {
      if (c === '^') local = true;
      else if (c !== 'var') world = true;
    }
    count += cs.length;
    if (count > 3 || (local && world)) return null;
    if (count === 3) return { n: j - i + 1, complete: true };
  }
  return { n: words.length - i, complete: false };
}