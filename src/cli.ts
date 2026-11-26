import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { parse } from './language/parser.ts';
import { Simulation } from './engine/simulation.ts';
import { exportCommands, exportManifest } from './export.ts';
import { runTests } from './engine/testrun.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { ticks: { type: 'string' }, export: { type: 'string' }, test: { type: 'boolean' }, only: { type: 'string' } },
});
const [file, chainName] = positionals;
if (!file) {
  console.error('Usage: node src/cli.ts <file.mcsim> [chain] [--ticks N] [--export commands|manifest] | --test [--only name1,name2]');
  process.exit(2);
}

const program = parse(readFileSync(file, 'utf8'));
for (const d of program.diagnostics) console.error(`line ${d.line}: ${d.message}`);
if (program.diagnostics.length) process.exit(1);

if (values.test) {
  const only = values.only ? new Set(values.only.split(",").map((n) => n.trim())) : undefined;
  const unknown = [...(only ?? [])].filter((n) => !program.tests.some((t) => t.name === n));
  if (unknown.length) {
    console.error(`No such test: ${unknown.join(", ")}`);
    process.exit(2);
  }
  const results = runTests(program, undefined, only);
  for (const r of results) {
    console.log(`${r.passed ? 'PASS' : 'FAIL'} ${r.name} (${r.checks} checks)`);
    for (const f of r.failures) console.log(`  line ${f.line}: ${f.message}`);
  }
  const failed = results.filter((r) => !r.passed).length;
  console.log(results.length ? `${results.length - failed}/${results.length} tests passed` : 'no tests');
  process.exit(failed ? 1 : 0);
}

const chain = program.chains.find((c) => c.name === (chainName ?? program.chains[0]?.name));
if (!chain) {
  console.error('No such chain');
  process.exit(1);
}

if (values.export) {
  if (values.export !== 'commands' && values.export !== 'manifest') {
    console.error('--export must be commands or manifest');
    process.exit(2);
  }
  process.stdout.write(values.export === 'commands' ? exportCommands(chain) : exportManifest(chain));
  process.exit(0);
}

const sim = new Simulation(program);
if (values.ticks) {
  sim.activate(chain.name);
  sim.advance(Number(values.ticks));
} else {
  sim.runChain(chain.name);
}
for (const e of sim.events) {
  const t = `t${e.tick}`;
  if (e.type === 'chat') console.log(`${t} [chat/${e.kind}] ${e.sender ? `<${e.sender}> ` : ''}${e.text}`);
  else if (e.type === 'trace') console.log(`${t}   line ${e.line}${e.branch ? ` [${e.branch}]` : ''}: ${e.message}${e.status ? ` (${e.status})` : ''}`);
  else if (e.type === 'change') console.log(`${t}   line ${e.line}: ${e.target}: ${e.what}`);
  else if (e.type === 'screen') console.log(`${t} [screen/${e.slot}] -> ${e.to}: ${e.text}`);
  else console.log(`${t}   line ${e.line}: particle ${e.id} at (${e.pos.join(', ')})`);
}
