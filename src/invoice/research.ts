import { hasAiSection } from './aiSettings';

/**
 * Writing AI research into a job description (docs/DOCUMENTATION.md §13.11): replace OUR section if it is already there, otherwise
 * append; everything above it is left exactly as it was. A research section starts with a `###` line that contains "AI" and the
 * robot marker, runs until the next `###` heading (or the end), and is rendered by the job page as "AI Notes".
 */

const SECTION_START = /^###\s*🤖\s*AI\b.*$/m;

export function mergeResearch(description: string | null | undefined, heading: string, markdown: string): string {
  const current = description ?? '';
  const section = `${heading.trim()}\n\n${markdown.trim()}`;
  const m = SECTION_START.exec(current);
  if (!m) return current ? `${current}\n\n${section}` : section;
  const start = m.index;
  const rest = current.slice(start + m[0].length);
  const next = /^###\s/m.exec(rest);
  const end = next ? start + m[0].length + next.index : current.length;
  const before = current.slice(0, start).replace(/\s+$/, '');
  const after = current.slice(end).replace(/^\s+/, '');
  return [before, section, after].filter(Boolean).join('\n\n');
}

export { hasAiSection };
