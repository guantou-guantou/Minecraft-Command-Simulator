import fs, { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { parseArgs } from 'node:util';
import { parse } from './language/parser.ts';
import { lintCommands } from './language/cmdlint.ts';
import type { Diagnostic } from './language/types.ts';
import { Simulation } from './engine/simulation.ts';
import { lintProgram } from './engine/lint.ts';
import { snapshot } from './engine/snapshot.ts';
import type { SimEvent } from './engine/types.ts';
import { exportAllCommands, exportAllManifest, exportCommands, exportFunctionFiles, exportManifest, functionWarning } from './export.ts';
import { runTests, type TestResult } from './engine/testrun.ts';

const USAGE = `mcsim: offline Minecraft Bedrock command simulator

Usage:
  mcsim check  <file|-> [--json]
  mcsim run    <file|-> [chain...] [--chain name]... [--all] [--ticks N] [--command "/cmd"]... [--state] [--json]
  mcsim test   <file|-> [--only a,b] [--jobs N] [--json]
  mcsim export <file|-> [chain...] [--chain name]... [--format commands|manifest|functions] [--out dir]

  <file|-> is a .mcsim file, or - to read the script from standard input.
  Exit codes: 0 everything fine, 1 diagnostics / command errors / failed tests, 2 usage or file errors.

Legacy form (still supported):
  node src/cli.ts <file.mcsim> [chain] [--ticks N] [--export commands|manifest] | --test [--only a,b]`;

const SUBCOMMANDS = new Set(['check', 'run', 'test', 'export']);

/** A worker thread started by `--jobs`: runs the given tests of a script and sends the results back. */
if (!isMainThread && workerData?.mcsimTests) {
  const job = workerData.mcsimTests as { text: string; names: string[] };
  parentPort!.postMessage(runTests(parse(job.text), undefined, new Set(job.names)));
  process.exit(0);
}

/** Runs the tests in `jobs` worker threads (every test has its own simulation, so they do not depend on each other); the results come back in script order. */
function runTestsParallel(text: string, names: string[], jobs: number): Promise<TestResult[]> {
  const n = Math.min(jobs, names.length);
  const groups = Array.from({ length: n }, (_, i) => names.filter((_name, k) => k % n === i));
  return Promise.all(
    groups.map(
      (g) =>
        new Promise<TestResult[]>((resolve, reject) => {
          const w = new Worker(fileURLToPath(import.meta.url), { workerData: { mcsimTests: { text, names: g } } });
          w.once('message', resolve);
          w.once('error', reject);
          w.once('exit', (code) => code && reject(new Error(`test worker exited with code ${code}`)));
        }),
    ),
  ).then((all) => all.flat().sort((a, b) => names.indexOf(a.name) - names.indexOf(b.name)));
}

function fail(message: string, code = 2): never {
  console.error(message);
  process.exit(code);
}

function readSource(path: string | undefined): { text: string; label: string } {
  if (!path) fail(USAGE);
  try {
    return path === '-' ? { text: readFileSync(0, 'utf8'), label: '<stdin>' } : { text: readFileSync(path, 'utf8'), label: path };
  } catch (e) {
    return fail(`Cannot read ${path}: ${(e as Error).message}`);
  }
}

const eventsOf = (events: SimEvent[]) => events.filter((e) => e.type === 'chat' && e.kind === 'error').length;

function printEvent(e: SimEvent): void {
  const t = `t${e.tick}`;
  if (e.type === 'chat') console.log(`${t} [chat/${e.kind}] ${e.sender ? `<${e.sender}> ` : ''}${e.text}`);
  else if (e.type === 'trace') console.log(`${t}   line ${e.line}${e.branch ? ` [${e.branch}]` : ''}: ${e.message}${e.status ? ` (${e.status})` : ''}`);
  else if (e.type === 'change') console.log(`${t}   line ${e.line}: ${e.target}: ${e.what}`);
  else if (e.type === 'screen') console.log(`${t} [screen/${e.slot}] -> ${e.to}: ${e.text}`);
  else console.log(`${t}   line ${e.line}: particle ${e.id} at (${e.pos.join(', ')})`);
}

/** Every problem the editor would underline: parse errors, declaration checks and command syntax. */
function diagnose(text: string): { program: ReturnType<typeof parse>; all: (Diagnostic & { column?: number })[] } {
  const program = parse(text);
  const all = [...program.diagnostics, ...lintProgram(program), ...lintCommands(text)]
    .sort((a, b) => a.line - b.line)
    .map((d) => ({ ...d, ...(d.span ? { column: d.span.from - (text.lastIndexOf('\n', d.span.from - 1) + 1) + 1 } : {}) }));
  return { program, all };
}

const printDiagnostics = (label: string, ds: (Diagnostic & { column?: number })[]) =>
  ds.forEach((d) => console.error(`${label}:${d.line}${d.column ? `:${d.column}` : ''}: ${d.message}`));

const json = (value: unknown) => console.log(JSON.stringify(value, null, 2));

function subcommand(name: string, argv: string[]): never {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      json: { type: 'boolean' }, ticks: { type: 'string' }, chain: { type: 'string', multiple: true }, all: { type: 'boolean' },
      command: { type: 'string', multiple: true }, state: { type: 'boolean' }, only: { type: 'string' }, format: { type: 'string' }, out: { type: 'string' }, jobs: { type: 'string' },
    },
  });
  const { text, label } = readSource(positionals[0]);
  const named = [...positionals.slice(1), ...(values.chain ?? [])];

  if (name === 'check') {
    const { all } = diagnose(text);
    if (values.json) json({ ok: all.length === 0, diagnostics: all });
    else printDiagnostics(label, all);
    process.exit(all.length ? 1 : 0);
  }

  const { program, all } = diagnose(text);
  if (program.diagnostics.length) {
    if (values.json) json({ ok: false, diagnostics: all });
    else printDiagnostics(label, program.diagnostics);
    process.exit(1);
  }
  const pick = (): typeof program.chains => {
    if (values.all) return program.chains;
    if (!named.length) return program.chains.slice(0, 1);
    return named.map((n) => program.chains.find((c) => c.name === n) ?? fail(`No such chain: ${n}`));
  };

  if (name === 'test') {
    const only = values.only ? new Set(values.only.split(',').map((n) => n.trim())) : undefined;
    const unknown = [...(only ?? [])].filter((n) => !program.tests.some((t) => t.name === n));
    if (unknown.length) fail(`No such test: ${unknown.join(', ')}`);
    const jobs = values.jobs === undefined ? 1 : Number(values.jobs);
    if (!Number.isInteger(jobs) || jobs < 1) fail('--jobs must be a whole number of at least 1');
    const names = program.tests.map((t) => t.name).filter((n) => !only || only.has(n));
    const report = (results: TestResult[]): never => {
      const failed = results.filter((r) => !r.passed).length;
      if (values.json) json({ ok: failed === 0, total: results.length, passed: results.length - failed, failed, tests: results });
      else {
        for (const r of results) {
          console.log(`${r.passed ? 'PASS' : 'FAIL'} ${r.name} (${r.checks} checks)`);
          for (const f of r.failures) console.log(`  line ${f.line}: ${f.message}`);
        }
        console.log(results.length ? `${results.length - failed}/${results.length} tests passed` : 'no tests');
      }
      process.exit(failed ? 1 : 0);
    };
    if (jobs > 1 && names.length > 1) {
      runTestsParallel(text, names, jobs).then(report, (e: Error) => fail(`test worker failed: ${e.message}`));
      return undefined as never;
    }
    report(runTests(program, undefined, only));
  }

  if (name === 'export') {
    const format = values.format ?? 'commands';
    if (format !== 'commands' && format !== 'manifest' && format !== 'functions') fail('--format must be commands, manifest or functions');
    if (format === 'functions') {
      if (!values.out) fail('--format functions needs --out <directory>');
      const files = exportFunctionFiles(program);
      if (!files.length) fail('The script defines no functions');
      for (const f of files) {
        const target = path.join(values.out, ...f.path.split('/'));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, f.content);
      }
      console.error(`wrote ${files.length} function file(s) to ${values.out}`);
      process.exit(0);
    }
    const chains = pick();
    if (!chains.length) fail('No such chain');
    const warn = functionWarning(program, chains.flatMap((c) => c.nodes.map((n) => n.command)));
    if (warn.defined.length) console.error(`warning: the script defines ${warn.defined.length} function(s) (${warn.defined.join(', ')}); the exported commands do not contain them. Export them with --format functions.`);
    process.stdout.write(format === 'commands' ? exportAllCommands(chains) : exportAllManifest(chains));
    process.exit(0);
  }

  const chains = pick();
  if (!chains.length && !values.command?.length) fail('No such chain');
  const ticks = values.ticks === undefined ? 0 : Number(values.ticks);
  if (!Number.isInteger(ticks) || ticks < 0) fail('--ticks must be a whole number of at least 0');
  const sim = new Simulation(program);
  if (values.ticks !== undefined) {
    for (const c of chains) sim.activate(c.name);
    sim.advance(ticks);
  } else for (const c of chains) sim.runChain(c.name);
  for (const c of values.command ?? []) sim.runCommand(c, null, [0, 0, 0]);
  const errors = eventsOf(sim.events);
  if (values.json) json({ ok: errors === 0, errors, ticks, diagnostics: all, events: sim.events, ...(values.state ? { world: snapshot(sim) } : {}) });
  else {
    sim.events.forEach(printEvent);
    if (values.state) console.log(JSON.stringify(snapshot(sim), null, 2));
    if (errors) console.error(`${errors} command error(s)`);
  }
  process.exit(errors ? 1 : 0);
}

const [first, ...rest] = process.argv.slice(2);
if (first === '--help' || first === '-h' || first === 'help') {
  console.log(USAGE);
  process.exit(0);
}
if (first && SUBCOMMANDS.has(first)) {
  subcommand(first, rest);
  await new Promise(() => {});
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { ticks: { type: 'string' }, export: { type: 'string' }, test: { type: 'boolean' }, only: { type: 'string' } },
});
const [file, chainName] = positionals;
if (!file) {
  console.error(USAGE);
  process.exit(2);
}

const program = parse(readFileSync(file, 'utf8'));
for (const d of program.diagnostics) console.error(`line ${d.line}: ${d.message}`);
if (program.diagnostics.length) process.exit(1);

if (values.test) {
  const only = values.only ? new Set(values.only.split(',').map((n) => n.trim())) : undefined;
  const unknown = [...(only ?? [])].filter((n) => !program.tests.some((t) => t.name === n));
  if (unknown.length) {
    console.error(`No such test: ${unknown.join(', ')}`);
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
sim.events.forEach(printEvent);
const errors = eventsOf(sim.events);
if (errors) {
  console.error(`${errors} command error(s)`);
  process.exit(1);
}
