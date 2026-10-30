import React from 'react';

interface MarkdownRendererProps {
  content: string;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  const restoreMangledMarkdown = (text: string) => {
    if (!text) return text;
    if (text.split('\n').length > 5) return text;

    let restored = text;
    restored = restored.replace(/^(### 🤖 AI Research(?: \(Hermes Agent\))?)\s+/i, '$1\n\n');
    restored = restored.replace(/^(### AI Research)\s+/i, '$1\n\n');
    restored = restored.replace(/\s+---\s+/g, '\n\n---\n\n');
    restored = restored.replace(/\s+(#{1,6})\s/g, '\n\n$1 ');
    restored = restored.replace(/(\n#{1,6}\s+[^|]+?)\s+\|/g, '$1\n|');
    restored = restored.replace(/\|\s+\|/g, '|\n|');
    restored = restored.replace(/\s+(\d+\.)\s+(?=\*\*)/g, '\n$1 ');
    restored = restored.replace(/\s+-\s+(?=\*\*)/g, '\n- ');

    return restored.trim();
  };

  const parseMarkdown = (rawText: string) => {
    const text = restoreMangledMarkdown(rawText);
    if (!text) return null;

    const lines = text.split('\n');
    const elements: React.ReactNode[] = [];
    let inList = false;
    let listItems: React.ReactNode[] = [];
    let inTable = false;
    let tableRows: React.ReactNode[] = [];
    let inCodeBlock = false;
    let codeLines: string[] = [];
    let codeLanguage = '';

    const pushList = () => {
      if (inList && listItems.length > 0) {
        elements.push(<ul key={`ul-${elements.length}`} className="list-disc pl-5 mb-4 text-[var(--color-text-secondary)]">{listItems}</ul>);
        listItems = [];
        inList = false;
      }
    };

    const pushTable = () => {
      if (inTable && tableRows.length > 0) {
        elements.push(
          <div key={`table-wrapper-${elements.length}`} className="overflow-x-auto mb-4 border border-[var(--color-border)] rounded-lg">
            <table className="min-w-full divide-y divide-[var(--color-border)]">
              <tbody className="divide-y divide-[var(--color-border)] bg-[var(--color-bg-primary)]">
                {tableRows}
              </tbody>
            </table>
          </div>
        );
        tableRows = [];
        inTable = false;
      }
    };

    const pushCodeBlock = () => {
        if (inCodeBlock) {
            elements.push(
                <pre key={`pre-${elements.length}`} className="bg-[var(--color-bg-tertiary)] p-4 rounded-lg overflow-x-auto mb-4 border border-[var(--color-border)]">
                    <code className="text-sm font-mono text-[var(--color-text-primary)]">
                        {codeLines.join('\n')}
                    </code>
                </pre>
            );
            codeLines = [];
            inCodeBlock = false;
        }
    };

    // Everything is HTML-escaped BEFORE any markdown substitution, so raw tags/attributes in the source can never
    // become live markup; links are limited to http(s)/mailto so `javascript:` URLs are impossible.
    const escapeHtml = (t: string) =>
      t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const isSafeUrl = (url: string) => /^(https?:\/\/|mailto:)/i.test(url);

    const parseInline = (line: string): React.ReactNode => {
      let result = escapeHtml(line);

      // Bold
      result = result.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      // Italic
      result = result.replace(/\*(.*?)\*/g, '<em>$1</em>');
      // Inline Code
      result = result.replace(/`(.*?)`/g, '<code class="bg-[var(--color-bg-tertiary)] px-1 rounded text-sm text-[var(--color-brand-primary)]">$1</code>');
      // Links (label and url are already escaped)
      result = result.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) =>
        isSafeUrl(url)
          ? `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-[#7c3bed] hover:text-[#6b33cc] hover:underline">${label}</a>`
          : label
      );
      // Auto-link bare URLs
      result = result.replace(/(?<!=["'>])(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-[#7c3bed] hover:text-[#6b33cc] hover:underline">$1</a>');

      return <span dangerouslySetInnerHTML={{ __html: result }} />;
    };

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];

      // Code Block Handling
      if (line.startsWith('```')) {
          if (inCodeBlock) {
              pushCodeBlock();
          } else {
              pushList();
              pushTable();
              inCodeBlock = true;
              codeLanguage = line.substring(3).trim();
          }
          continue;
      }

      if (inCodeBlock) {
          codeLines.push(line);
          continue;
      }

      // Headers
      const headerMatch = line.match(/^(#{1,6})\s+(.*)/);
      if (headerMatch) {
        pushList();
        pushTable();
        const level = headerMatch[1].length;
        const text = headerMatch[2];
        const HeadingTag = `h${level}` as React.ElementType;
        const sizeClasses = {
          1: 'text-2xl font-bold mb-4 mt-6 text-[var(--color-text-primary)]',
          2: 'text-xl font-semibold mb-3 mt-5 text-[var(--color-text-primary)]',
          3: 'text-lg font-medium mb-3 mt-4 text-[var(--color-text-primary)]',
          4: 'text-base font-medium mb-2 mt-4 text-[var(--color-text-primary)]',
          5: 'text-sm font-medium mb-2 mt-4 text-[var(--color-text-primary)]',
          6: 'text-sm font-medium mb-2 mt-4 text-[var(--color-text-secondary)]',
        };
        elements.push(<HeadingTag key={`h-${i}`} className={sizeClasses[level as keyof typeof sizeClasses]}>{parseInline(text)}</HeadingTag>);
        continue;
      }

      // Blockquote
      if (line.startsWith('> ')) {
        pushList();
        pushTable();
        elements.push(
          <blockquote key={`bq-${i}`} className="border-l-4 border-[var(--color-brand-primary)] pl-4 italic text-[var(--color-text-secondary)] mb-4">
            {parseInline(line.substring(2))}
          </blockquote>
        );
        continue;
      }

      // Lists
      const listMatch = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)/);
      if (listMatch) {
        pushTable();
        inList = true;
        listItems.push(<li key={`li-${i}`} className="ml-4">{parseInline(listMatch[3])}</li>);
        continue;
      } else {
        pushList();
      }

      // Tables
      if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
        pushList();
        inTable = true;
        const cells = line.split('|').filter(c => c.trim() !== '' || line.indexOf(c) > 0 && line.indexOf(c) < line.length - 1);
        
        // Skip separator row
        if (cells.every(c => c.trim().match(/^[-:]+$/))) {
          continue;
        }

        const isHeader = tableRows.length === 0;
        
        tableRows.push(
          <tr key={`tr-${i}`}>
            {cells.map((cell, idx) => (
              isHeader ? 
                <th key={`th-${idx}`} className="px-4 py-3 text-left text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider bg-[var(--color-bg-secondary)] border-b border-[var(--color-border)]">
                  {parseInline(cell.trim())}
                </th>
              :
                <td key={`td-${idx}`} className="px-4 py-3 whitespace-nowrap text-sm text-[var(--color-text-primary)]">
                  {parseInline(cell.trim())}
                </td>
            ))}
          </tr>
        );
        continue;
      } else {
        pushTable();
      }

      // Horizontal Rule
      if (line.match(/^[-*_]{3,}$/)) {
          pushList();
          pushTable();
          elements.push(<hr key={`hr-${i}`} className="border-[var(--color-border)] my-6" />);
          continue;
      }

      // Paragraphs
      if (line.trim() !== '') {
        elements.push(<p key={`p-${i}`} className="mb-4 text-[var(--color-text-secondary)] leading-relaxed">{parseInline(line)}</p>);
      }
    }

    pushList();
    pushTable();
    pushCodeBlock();

    return elements;
  };

  return <div className="markdown-content">{parseMarkdown(content)}</div>;
};
