import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/language/parser.ts';
import { Simulation } from '../src/engine/simulation.ts';
import { PluginHost, type Plugin } from '../src/plugins/host.ts';

const plugin: Plugin = {
  id: 'demo',
  name: 'demo',
  version: '1.0.0',
  setup(api) {
    api.registerCommand({
      name: 'hello',
      support: 'full',
      run: ({ env }) => {
        env.emit({ type: 'chat', kind: 'say', tick: env.tick, line: env.line, sender: null, text: 'hello from a plugin' });
        return 1;
      },
    });
    api.registerPanel({ id: 'p', title: 'Demo', render: () => null });
  },
};

test('plugin host: commands reach the simulation, panels are namespaced, duplicates are rejected', () => {
  const host = new PluginHost();
  host.install(plugin);
  assert.throws(() => host.install(plugin), /already installed/);
  assert.deepEqual(host.panels.map((p) => p.id), ['demo:p']);
  const withPlugin = new Simulation(parse(''));
  host.apply(withPlugin);
  assert.equal(withPlugin.runCommand('/hello', null, [0, 0, 0]), true);
  assert.deepEqual(withPlugin.events.flatMap((e) => (e.type === 'chat' ? [e.text] : [])), ['hello from a plugin']);
  assert.equal(new Simulation(parse('')).runCommand('/hello', null, [0, 0, 0]), false);
});

test('trace budget drops excess events and says so; quiet mode drops them silently', () => {
  const sim = new Simulation(parse('ent(type=armor_stand, position=(0,0,0), tags=["a"])\nent(type=armor_stand, position=(0,0,0), tags=["a"])'));
  sim.traceBudget = 3;
  sim.runCommand('/execute as @e[tag=a] as @e[tag=a] as @e[tag=a] run say x', null, [0, 0, 0]);
  const traces = sim.events.filter((e) => e.type === 'trace');
  assert.equal(traces.length, 3 + 1);
  assert.match(traces.at(-1)!.type === 'trace' ? traces.at(-1)!.message : '', /further trace\/change event\(s\) were not recorded/);
  assert.equal(sim.events.filter((e) => e.type === 'chat').length, 8);
  sim.events = [];
  sim.quiet = true;
  sim.runCommand('/execute as @e[tag=a] run say x', null, [0, 0, 0]);
  assert.equal(sim.events.filter((e) => e.type === 'trace').length, 0);
  assert.equal(sim.events.filter((e) => e.type === 'chat').length, 2);
});
