import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/language/parser.ts';
import { Simulation } from '../src/engine/simulation.ts';

const O: [number, number, number] = [0, 0, 0];

function load(src = ''): Simulation {
  const p = parse(src);
  assert.deepEqual(p.diagnostics, []);
  return new Simulation(p);
}

const run = (s: Simulation, cmd: string, ex: ReturnType<Simulation['findEntity']> = undefined) => s.runCommand(cmd, ex ?? null, O);
const errors = (s: Simulation) => s.events.flatMap((e) => (e.type === 'chat' && e.kind === 'error' ? [e.text] : []));
const slots = (s: Simulation, name: string) =>
  Object.fromEntries(Object.entries(s.findEntity(name)!.items).map(([k, v]) => [k, `${v.count}x${v.id.replace('minecraft:', '')}`]));

const PLAYERS = `
alice = ent(type=player, position=(0,0,0), name=alice)
bob = ent(type=player, position=(1,0,0), name=bob, selected=2)
stand = ent(type=armor_stand, position=(2,0,0), name=stand)
`;

test('item declarations: entities, mainhand alias, containers', () => {
  const s = load(`${PLAYERS}
block(type=chest, position=(5, 0, 0))
item(target=alice, slot=slot.hotbar, index=0, type=apple, count=16)
item(target=bob, slot=slot.weapon.mainhand, type=diamond_sword)
item(target=stand, slot=slot.armor.head, type=iron_helmet)
item(target=(5, 0, 0), slot=slot.container, index=3, type=gold_ingot, count=5, components={"minecraft:item_lock":{"mode":"lock_in_slot"}})
`);
  assert.deepEqual(slots(s, 'alice'), { 'slot.hotbar:0': '16xapple' });
  assert.deepEqual(slots(s, 'bob'), { 'slot.hotbar:2': '1xdiamond_sword' });
  assert.deepEqual(slots(s, 'stand'), { 'slot.armor.head:0': '1xiron_helmet' });
  const chest = s.world.getBlockData([5, 0, 0]);
  assert.equal(chest.items!['slot.container:3'].count, 5);
  assert.deepEqual(chest.items!['slot.container:3'].components, { 'minecraft:item_lock': { mode: 'lock_in_slot' } });
});

test('item declaration errors', () => {
  const d = (extra: string) => parse(`${PLAYERS}\nblock(type=stone, position=(9,0,0))\nblock(type=chest, position=(5,0,0))\n${extra}`).diagnostics.map((x) => x.message);
  assert.equal(d('item(target=stand, slot=slot.hotbar, type=apple)').length, 1);
  assert.equal(d('item(target=alice, slot=slot.hotbar, index=9, type=apple)').length, 1);
  assert.equal(d('item(target=alice, slot=slot.bogus, type=apple)').length, 1);
  assert.equal(d('item(target=alice, slot=slot.saddle, type=apple)').length, 1);
  assert.equal(d('item(target=nobody, slot=slot.hotbar, type=apple)').length, 1);
  assert.equal(d('item(target=alice, slot=slot.hotbar, type=apple, count=65)').length, 1);
  assert.equal(d('item(target=alice, slot=slot.hotbar, type=diamond_sword, count=2)').length, 1);
  assert.equal(d('item(target=alice, slot=slot.hotbar, type=apple, components=[1])').length, 1);
  assert.equal(d('item(target=(9,0,0), slot=slot.container, type=apple)').length, 1);
  assert.equal(d('item(target=(7,0,0), slot=slot.container, type=apple)').length, 1);
  assert.equal(d('item(target=(5,0,0), slot=slot.container, index=27, type=apple)').length, 1);
  assert.equal(d('item(target=alice, slot=slot.weapon.mainhand, type=apple)\nitem(target=alice, slot=slot.hotbar, index=0, type=apple)').length, 1);
  assert.equal(d('item(target=alice, slot=slot.hotbar, type=apple)\nitem(target=alice, slot=slot.hotbar, type=apple)').length, 1);
  assert.equal(parse('ent(type=armor_stand, position=(0,0,0), selected=1)').diagnostics.length, 1);
  assert.equal(parse('ent(type=player, position=(0,0,0), selected=9)').diagnostics.length, 1);
});

test('give: stacks merge, hotbar fills first, overflow is reported', () => {
  const s = load(PLAYERS);
  assert.equal(run(s, '/give alice apple 40'), true);
  assert.equal(run(s, '/give alice apple 40'), true);
  assert.deepEqual(slots(s, 'alice'), { 'slot.hotbar:0': '64xapple', 'slot.hotbar:1': '16xapple' });
  run(s, '/give alice diamond_sword 3');
  assert.deepEqual(slots(s, 'alice'), {
    'slot.hotbar:0': '64xapple', 'slot.hotbar:1': '16xapple', 'slot.hotbar:2': '1xdiamond_sword',
    'slot.hotbar:3': '1xdiamond_sword', 'slot.hotbar:4': '1xdiamond_sword',
  });
  run(s, '/give alice apple 48');
  assert.equal(slots(s, 'alice')['slot.hotbar:1'], '64xapple');
  for (let i = 0; i < 40; i++) run(s, '/give alice diamond_sword');
  s.events = [];
  assert.equal(run(s, '/give alice diamond_sword'), true);
  assert.ok(s.events.some((e) => e.type === 'trace' && e.status === 'unimplemented' && /inventory full/.test(e.message)));
  assert.equal(run(s, '/give @e[name=stand] apple'), false);
  assert.equal(run(s, '/give alice air'), true);
  assert.equal(run(s, '/give alice apple 0'), false);
  assert.equal(run(s, '/give alice apple 1 0 [1]'), false);
  assert.equal(run(s, '/give @a[name=none] apple'), false);
});

test('give: components are kept and stacks only merge with equal components', () => {
  const s = load(PLAYERS);
  run(s, '/give alice apple 1 0 {"minecraft:keep_on_death":{}}');
  run(s, '/give alice apple 1');
  run(s, '/give alice apple 1 0 {"minecraft:keep_on_death":{}}');
  assert.deepEqual(slots(s, 'alice'), { 'slot.hotbar:0': '2xapple', 'slot.hotbar:1': '1xapple' });
  assert.deepEqual(s.findEntity('alice')!.items['slot.hotbar:0'].components, { 'minecraft:keep_on_death': {} });
});

test('clear: everything, by item, with max count and query mode', () => {
  const s = load(`${PLAYERS}
item(target=alice, slot=slot.hotbar, index=0, type=apple, count=10)
item(target=alice, slot=slot.inventory, index=0, type=apple, count=10)
item(target=alice, slot=slot.armor.head, type=iron_helmet)
item(target=bob, slot=slot.hotbar, index=0, type=apple, count=3)
`);
  assert.equal(run(s, '/clear alice apple -1 0'), true);
  assert.equal(slots(s, 'alice')['slot.hotbar:0'], '10xapple');
  assert.equal(run(s, '/clear alice apple -1 12'), true);
  assert.deepEqual(slots(s, 'alice'), { 'slot.inventory:0': '8xapple', 'slot.armor.head:0': '1xiron_helmet' });
  assert.equal(run(s, '/clear alice diamond'), false);
  assert.equal(run(s, '/clear @a apple'), true);
  assert.deepEqual(slots(s, 'alice'), { 'slot.armor.head:0': '1xiron_helmet' });
  assert.deepEqual(slots(s, 'bob'), {});
  assert.equal(s.runCommand('/clear', s.findEntity('alice')!, O), true);
  assert.deepEqual(slots(s, 'alice'), {});
  assert.equal(run(s, '/clear'), false);
  assert.equal(s.runCommand('/clear', s.findEntity('stand')!, O), false);
  assert.equal(run(s, '/clear @e[name=stand]'), false);
});

test('replaceitem: entities, containers, keep/destroy, air, errors', () => {
  const s = load(`${PLAYERS}
block(type=chest, position=(5, 0, 0))
`);
  assert.equal(run(s, '/replaceitem entity alice slot.weapon.mainhand 0 diamond_sword'), true);
  assert.equal(run(s, '/replaceitem entity bob slot.weapon.mainhand 0 apple 5'), true);
  assert.equal(s.findEntity('bob')!.items['slot.hotbar:2'].count, 5);
  assert.equal(run(s, '/replaceitem entity alice slot.hotbar 0 keep apple'), false);
  assert.equal(run(s, '/replaceitem entity alice slot.hotbar 0 destroy apple 7'), true);
  assert.equal(slots(s, 'alice')['slot.hotbar:0'], '7xapple');
  assert.equal(run(s, '/replaceitem entity alice slot.hotbar 0 air'), true);
  assert.equal(slots(s, 'alice')['slot.hotbar:0'], undefined);
  assert.equal(run(s, '/replaceitem entity @e[name=stand] slot.armor.chest 0 iron_chestplate'), true);
  assert.equal(run(s, '/replaceitem entity @e[name=stand] slot.hotbar 0 apple'), false);
  assert.equal(run(s, '/replaceitem entity alice slot.hotbar 9 apple'), false);
  assert.equal(run(s, '/replaceitem entity alice slot.saddle 0 apple'), false);
  assert.equal(run(s, '/replaceitem entity alice slot.bogus 0 apple'), false);
  assert.equal(run(s, '/replaceitem entity alice slot.hotbar 0 apple 99'), false);
  assert.equal(run(s, '/replaceitem entity @e[name=zzz] slot.hotbar 0 apple'), false);
  assert.equal(run(s, '/replaceitem block 5 0 0 slot.container 26 apple 3'), true);
  assert.equal(s.world.getBlockData([5, 0, 0]).items!['slot.container:26'].count, 3);
  assert.equal(run(s, '/replaceitem block 5 0 0 slot.container 26 keep gold_ingot'), false);
  assert.equal(run(s, '/replaceitem block 5 0 0 slot.container 27 apple'), false);
  assert.equal(run(s, '/replaceitem block 6 0 0 slot.container 0 apple'), false);
  assert.equal(run(s, '/replaceitem block 5 0 0 slot.hotbar 0 apple'), false);
  assert.equal(run(s, '/replaceitem block 5 0 0 slot.container 26 air'), true);
  assert.equal(s.world.getBlockData([5, 0, 0]).items!['slot.container:26'], undefined);
  assert.ok(errors(s).length >= 6);
});

test('hasitem selector parameter', () => {
  const s = load(`${PLAYERS}
item(target=alice, slot=slot.hotbar, index=0, type=diamond, count=5)
item(target=alice, slot=slot.inventory, index=4, type=diamond, count=3)
item(target=alice, slot=slot.hotbar, index=1, type=apple, count=2)
item(target=bob, slot=slot.weapon.mainhand, type=diamond, count=1)
item(target=stand, slot=slot.weapon.mainhand, type=diamond, count=1)
`);
  const who = (sel: string) => {
    s.events = [];
    s.runCommand(`/tag ${sel} add hit`, null, O);
    const names = s.world.entities.filter((e) => e.tags.has('hit')).map((e) => e.name);
    s.world.entities.forEach((e) => e.tags.delete('hit'));
    return names;
  };
  assert.deepEqual(who('@e[hasitem={item=diamond}]'), ['alice', 'bob', 'stand']);
  assert.deepEqual(who('@a[hasitem={item=diamond,quantity=8}]'), ['alice']);
  assert.deepEqual(who('@a[hasitem={item=diamond,quantity=9..}]'), []);
  assert.deepEqual(who('@a[hasitem={item=diamond,quantity=0}]'), []);
  assert.deepEqual(who('@a[hasitem={item=emerald,quantity=0}]'), ['alice', 'bob']);
  assert.deepEqual(who('@a[hasitem={item=diamond,location=slot.hotbar}]'), ['alice', 'bob']);
  assert.deepEqual(who('@a[hasitem={item=diamond,location=slot.hotbar,quantity=5}]'), ['alice']);
  assert.deepEqual(who('@a[hasitem={item=diamond,location=slot.inventory,slot=0..3}]'), []);
  assert.deepEqual(who('@a[hasitem={item=diamond,location=slot.inventory,slot=4}]'), ['alice']);
  assert.deepEqual(who('@a[hasitem={item=diamond,location=slot.weapon.mainhand}]'), ['alice', 'bob']);
  assert.deepEqual(who('@e[hasitem={item=diamond,location=slot.weapon.mainhand}]'), ['alice', 'bob', 'stand']);
  assert.deepEqual(who('@a[hasitem=[{item=diamond},{item=apple}]]'), ['alice']);
  assert.deepEqual(who('@a[hasitem=!{item=apple}]'), ['bob']);
  assert.deepEqual(who('@a[hasitem={item=diamond,quantity=!5..}]'), ['bob']);
  assert.equal(run(s, '/tag @a[hasitem={location=slot.hotbar}] add x'), false);
  assert.equal(run(s, '/tag @a[hasitem={item=diamond,slot=1}] add x'), false);
  assert.equal(run(s, '/tag @a[hasitem={item=diamond,bogus=1}] add x'), false);
  assert.equal(run(s, '/tag @a[hasitem=oops] add x'), false);
});

test('clone copies container contents; setblock and fill drop them; items are independent', () => {
  const s = load(`
block(type=chest, position=(0, 0, 0))
item(target=(0, 0, 0), slot=slot.container, index=1, type=apple, count=9)
`);
  assert.equal(run(s, '/clone 0 0 0 0 0 0 5 0 0'), true);
  assert.equal(s.world.getBlockData([5, 0, 0]).items!['slot.container:1'].count, 9);
  run(s, '/replaceitem block 5 0 0 slot.container 1 apple 2');
  assert.equal(s.world.getBlockData([0, 0, 0]).items!['slot.container:1'].count, 9);
  assert.equal(run(s, '/setblock 0 0 0 stone'), true);
  assert.equal(s.world.getBlockData([0, 0, 0]).items, undefined);
  assert.equal(run(s, '/fill 5 0 0 5 0 0 stone'), true);
  assert.equal(s.world.getBlockData([5, 0, 0]).items, undefined);
});

test('entities keep inventories across reset', () => {
  const s = load(`${PLAYERS}\nitem(target=alice, slot=slot.hotbar, type=apple)`);
  run(s, '/give alice diamond 3');
  s.reset();
  assert.deepEqual(slots(s, 'alice'), { 'slot.hotbar:0': '1xapple' });
});

test('give air succeeds with the game messages and changes nothing', () => {
  const s = new Simulation(parse('alice = ent(type=player, pos=(0, 0, 0), name=alice)\nbob = ent(type=player, pos=(1, 0, 0), name=bob)\n'));
  const before = JSON.stringify(s.world.entities[0].items);
  assert.equal(s.runCommand('/give alice air 5', null, [0, 0, 0]), true);
  assert.equal(JSON.stringify(s.world.entities[0].items), before);
  const chats = () => s.events.flatMap((e) => (e.type === 'chat' ? [{ text: e.text, to: e.to }] : []));
  assert.deepEqual(chats(), [{ text: 'Gave 5 Air to alice', to: undefined }, { text: 'You were given 5 Air', to: 'alice' }]);
  s.events.length = 0;
  s.runCommand('/gamerule sendcommandfeedback false', null, [0, 0, 0]);
  s.events.length = 0;
  s.runCommand('/give bob air', null, [0, 0, 0]);
  assert.deepEqual(chats(), [{ text: 'You were given 1 Air', to: 'bob' }]);
});