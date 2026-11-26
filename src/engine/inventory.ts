import { CLEAR_ORDER, GIVE_ORDER, entitySlotKey, maxStack, sameItemKind, slotKey, slotSize, type Item } from '../language/items.ts';
import { normalizeId, parseArgs, splitTop } from '../language/parser.ts';
import { inRange } from './range.ts';
import { CommandError, type Entity } from './types.ts';

export const isPlayer = (e: Entity) => e.type === 'minecraft:player';

export const keyFor = (e: Entity, slot: string, index: number) => entitySlotKey(isPlayer(e), e.selected, slot, index);

export interface SlotChange {
  key: string;
  before: Item | null;
  after: Item | null;
}

export function giveTo(e: Entity, item: Item): { leftover: number; changes: SlotChange[] } {
  const limit = maxStack(item.id);
  let left = item.count;
  const changes: SlotChange[] = [];
  const touch = (key: string, after: Item) => {
    const before = e.items[key] ? { ...e.items[key] } : null;
    e.items[key] = after;
    changes.push({ key, before, after: { ...after } });
  };
  for (const key of GIVE_ORDER) {
    const cur = e.items[key];
    if (left > 0 && cur && sameItemKind(cur, item) && cur.count < limit) {
      const add = Math.min(limit - cur.count, left);
      touch(key, { ...cur, count: cur.count + add });
      left -= add;
    }
  }
  for (const key of GIVE_ORDER) {
    if (left > 0 && !e.items[key]) {
      const add = Math.min(limit, left);
      touch(key, { ...structuredClone(item), count: add });
      left -= add;
    }
  }
  return { leftover: left, changes };
}

export function clearFrom(e: Entity, id: string | null, data: number, max: number): { found: number; changes: SlotChange[] } {
  let found = 0;
  const changes: SlotChange[] = [];
  let budget = max;
  for (const key of CLEAR_ORDER) {
    const cur = e.items[key];
    if (!cur || (id !== null && cur.id !== id) || (data >= 0 && cur.data !== data)) continue;
    found += cur.count;
    if (max === 0) continue;
    const take = max < 0 ? cur.count : Math.min(cur.count, budget);
    if (take <= 0) continue;
    if (max > 0) budget -= take;
    changes.push({ key, before: { ...cur }, after: take === cur.count ? null : { ...cur, count: cur.count - take } });
    if (take === cur.count) delete e.items[key];
    else e.items[key] = { ...cur, count: cur.count - take };
  }
  return { found, changes };
}

interface HasItem {
  item: string;
  data: number;
  quantity: string;
  location: string | null;
  slot: string | null;
}

function parseHasItem(value: string): HasItem[] {
  const v = value.trim();
  const parts = v.startsWith('[') ? splitTop(v.slice(1, v.endsWith(']') ? -1 : undefined), (c) => c === ',').map((t) => t.text) : [v];
  return parts.map((p) => {
    const m = /^\{(.*)\}$/s.exec(p.trim());
    if (!m) throw new CommandError('syntax_error', 'hasitem expects {item=...} or a list of such objects');
    let args: Record<string, string>;
    try {
      args = parseArgs(m[1]);
    } catch (e) {
      throw new CommandError('syntax_error', `hasitem: ${(e as Error).message}`);
    }
    for (const k of Object.keys(args)) {
      if (!['item', 'data', 'quantity', 'location', 'slot'].includes(k)) {
        throw new CommandError('unimplemented', `hasitem field "${k}" is not implemented yet`);
      }
    }
    if (!args.item) throw new CommandError('syntax_error', 'hasitem requires item=...');
    if (args.slot !== undefined && !args.location) throw new CommandError('syntax_error', 'hasitem: slot requires location');
    const data = args.data !== undefined ? Number(args.data) : -1;
    if (!Number.isInteger(data)) throw new CommandError('syntax_error', 'hasitem: data must be an integer');
    return { item: normalizeId(args.item), data, quantity: args.quantity ?? '1..', location: args.location ?? null, slot: args.slot ?? null };
  });
}

export function hasItemFilter(value: string): (e: Entity) => boolean {
  const conds = parseHasItem(value);
  return (e) =>
    conds.every((c) => {
      let keys: string[];
      if (c.location) {
        const size = slotSize(c.location);
        if (size === undefined) throw new CommandError('syntax_error', `hasitem: unknown location "${c.location}"`);
        keys = Array.from({ length: size }, (_, i) => i)
          .filter((i) => !c.slot || inRange(i, c.slot))
          .map((i) => keyFor(e, c.location!, i));
      } else keys = Object.keys(e.items);
      const count = keys.reduce((n, k) => {
        const it = e.items[k];
        return it && it.id === c.item && (c.data < 0 || it.data === c.data) ? n + it.count : n;
      }, 0);
      return inRange(count, c.quantity);
    });
}

export { slotKey };
