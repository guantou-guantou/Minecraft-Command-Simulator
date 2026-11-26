import type { ReactNode } from 'react';
import type { CommandSpec } from '../engine/registry.ts';
import type { Simulation } from '../engine/simulation.ts';
import type { Program } from '../language/types.ts';

export interface PluginContext {
  insertText(text: string): void;
  /** Re-renders the app after a panel changed the live simulation. */
  refresh(): void;
  /** The live simulation. Panels re-render whenever it changes; treat it as read-only. */
  sim: Simulation;
  /** The parsed script, including its test blocks. */
  program: Program;
  /** A fresh simulation of the script with every plugin command installed. */
  newSim(): Simulation;
  /** Selects the logical script line in the editor. */
  jump(line: number): void;
  /** Panel state that should survive switching panels (kept per document). */
  panelState: Map<string, unknown>;
  /** Opens text in a new, unsaved document tab. */
  openAsNewDocument(text: string): void;
  /** Which tests are switched off in the tests panel (per document); every other test counts as checked. */
  testSelection: { unchecked: Set<string>; set(next: Set<string>): void };
}

export interface PanelSpec {
  id: string;
  title: string;
  render(ctx: PluginContext): ReactNode;
}

export interface PluginApi {
  registerCommand(spec: CommandSpec): void;
  registerPanel(panel: PanelSpec): void;
}

export interface Plugin {
  id: string;
  name: string;
  version: string;
  setup(api: PluginApi): void;
}

export class PluginHost {
  plugins: Plugin[] = [];
  commands: CommandSpec[] = [];
  panels: PanelSpec[] = [];

  install(plugin: Plugin): void {
    if (this.plugins.some((p) => p.id === plugin.id)) throw new Error(`Plugin "${plugin.id}" is already installed`);
    this.plugins.push(plugin);
    plugin.setup({
      registerCommand: (spec) => this.commands.push(spec),
      registerPanel: (panel) => this.panels.push({ ...panel, id: `${plugin.id}:${panel.id}` }),
    });
  }

  apply(sim: Simulation): void {
    for (const c of this.commands) sim.commands.register(c);
  }
}
