import { buildSystemPrompt } from './prompt.ts';

/** The text of docs/AI提示词.md: how to use the prompt by hand, and the prompt itself (the command lists come from the code). */
export function aiPromptDoc(): string {
  const prompt = buildSystemPrompt('zh');
  return `# AI 提示词

这份提示词让 AI 按本模拟器的语法写脚本。它由代码生成(\`npm run ai:doc\`),命令清单随引擎更新,请不要手动修改这个文件。

## 手动使用

1. 把下面代码块里的内容整段复制,作为 AI 对话的第一条消息(或系统提示词)。
2. 再把你的脚本(或要改的几行)和需求发给它。
3. 把 AI 回复的代码块粘回编辑器,用"检查"和"运行"确认没有问题。

界面里的"复制给 AI"按钮复制的是同一份提示词,它的末尾可以带上你当前的脚本和诊断。

## 提示词

\`\`\`\`text
${prompt}
\`\`\`\`
`;
}