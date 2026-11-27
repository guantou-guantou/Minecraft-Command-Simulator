import { useEffect, useMemo, useRef, useState } from 'react';
import { lintCommands } from '../language/cmdlint.ts';
import type { Diagnostic } from '../language/types.ts';
import LintWorker from './lint.worker.ts?worker';

/** Scripts shorter than this are checked right away; longer ones are checked in a worker so that typing stays smooth. */
export const SYNC_LIMIT = 60_000;
const DELAY = 250;

/** The diagnostics of the commands of a script (`lintCommands`), computed off the interface thread for long scripts. */
export function useCommandLint(text: string): Diagnostic[] {
  const small = text.length < SYNC_LIMIT;
  const direct = useMemo(() => (small ? lintCommands(text) : null), [small, text]);
  const [late, setLate] = useState<Diagnostic[]>([]);
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (small) return;
    const id = ++seq.current;
    const timer = setTimeout(() => {
      try {
        if (!worker.current) {
          worker.current = new LintWorker();
          worker.current.onmessage = (e: MessageEvent<{ id: number; diagnostics: Diagnostic[] }>) => {
            if (e.data.id === seq.current) setLate(e.data.diagnostics);
          };
          worker.current.onerror = () => {
            console.error('The command check worker failed; checking on the interface thread instead');
            worker.current?.terminate();
            worker.current = null;
            setLate(lintCommands(text));
          };
        }
        worker.current.postMessage({ id, text });
      } catch (e) {
        console.error('The command check worker could not start; checking on the interface thread instead', e);
        setLate(lintCommands(text));
      }
    }, DELAY);
    return () => clearTimeout(timer);
  }, [small, text]);

  useEffect(() => () => worker.current?.terminate(), []);
  return direct ?? late;
}