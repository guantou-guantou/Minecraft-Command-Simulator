import type { ReactNode } from 'react';
import { parseMarkdown, type Block, type Inline } from '../ai/markdown.ts';

function inline(items: Inline[]): ReactNode[] {
  return items.map((n, i) => {
    switch (n.t) {
      case 'text':
        return n.text;
      case 'code':
        return <code key={i}>{n.text}</code>;
      case 'bold':
        return <strong key={i}>{inline(n.children)}</strong>;
      case 'italic':
        return <em key={i}>{inline(n.children)}</em>;
      case 'strike':
        return <del key={i}>{inline(n.children)}</del>;
      case 'link':
        return <span key={i} className="mdlink" title={n.href}>{inline(n.children)}</span>;
    }
  });
}

function block(b: Block, key: number): ReactNode {
  switch (b.t) {
    case 'p':
      return <p key={key}>{inline(b.inline)}</p>;
    case 'h':
      return <div key={key} className={`mdh mdh${Math.min(b.level, 4)}`}>{inline(b.inline)}</div>;
    case 'hr':
      return <hr key={key} />;
    case 'quote':
      return <blockquote key={key}>{b.blocks.map(block)}</blockquote>;
    case 'list': {
      const Tag = b.ordered ? 'ol' : 'ul';
      return (
        <Tag key={key}>
          {b.items.map((it, i) => <li key={i} style={{ marginLeft: it.depth * 16 }}>{inline(it.inline)}</li>)}
        </Tag>
      );
    }
    case 'table':
      return (
        <table key={key} className="mdtable">
          <thead><tr>{b.head.map((c, i) => <th key={i}>{inline(c)}</th>)}</tr></thead>
          <tbody>{b.rows.map((r, i) => <tr key={i}>{r.map((c, k) => <td key={k}>{inline(c)}</td>)}</tr>)}</tbody>
        </table>
      );
  }
}

/** A reply rendered as markdown. Everything is built as elements (nothing is inserted as HTML), and links are shown but never followed. */
export function Markdown({ text }: { text: string }) {
  return <div className="md">{parseMarkdown(text).map(block)}</div>;
}