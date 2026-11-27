import { writeFileSync } from 'node:fs';
import { aiPromptDoc } from '../src/ai/doc.ts';

writeFileSync(new URL('../docs/AI提示词.md', import.meta.url), aiPromptDoc());
console.log('wrote docs/AI提示词.md');