import { exportFunctionFiles, functionWarning } from '../export.ts';
import type { Program } from '../language/types.ts';
import { desktop } from './desktop.ts';
import type { useT } from './I18n.tsx';

type Tr = ReturnType<typeof useT>;

/**
 * A script that defines functions exports files that do not contain them. Asks whether to go on (resolves to true), to write the
 * .mcfunction files as well and go on, or to cancel (false). Nothing to ask when there are no functions or no desktop shell.
 */
export async function guardFunctions(program: Program, commands: string[], t: Tr): Promise<boolean> {
  const w = functionWarning(program, commands);
  if (!w.defined.length || !desktop) return true;
  const message = [t('fn.warn', { n: w.defined.length, names: w.defined.join(', ') }), w.called.length ? t('fn.warnCalled', { names: w.called.join(', ') }) : ''].filter(Boolean).join('\n\n');
  const pick = await desktop.choose(message, [t('fn.continue'), t('fn.both'), t('fn.cancel')]);
  if (pick === 1) return (await desktop.exportFolder(exportFunctionFiles(program))) !== null;
  return pick === 0;
}