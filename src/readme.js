// Keeps a Mermaid architecture diagram inside README.md (or any Markdown file) up to date,
// between two markers. The output is deterministic, so the file only changes when the
// architecture does.

import fs from 'node:fs';
import path from 'node:path';
import { viewGraph } from './graph/view.js';
import { toMermaid } from './render/mermaid.js';

export const START = '<!-- stackmap:start -->';
export const END = '<!-- stackmap:end -->';

export function readmeBlock(graph, opts = {}) {
  const view = viewGraph(graph, { libraries: Boolean(opts.libraries) });
  const mermaid = toMermaid(view, { direction: opts.direction ?? 'LR', collapseExternalOver: opts.collapseExternalOver ?? 14 });
  return [
    START,
    '```mermaid',
    mermaid,
    '```',
    '',
    '<sub>Architecture map generated from the code by [Stackmap](https://github.com/AnshumaanSinghh/Stackmap). Update it with `npx stackmap-cli readme`.</sub>',
    END,
  ].join('\n');
}

/**
 * @returns {{ file: string, status: 'updated'|'unchanged'|'inserted', content: string }}
 */
export function updateReadme(root, graph, opts = {}) {
  const file = path.resolve(root, opts.file ?? 'README.md');
  const exists = fs.existsSync(file);
  const before = exists ? fs.readFileSync(file, 'utf8') : '';
  const block = readmeBlock(graph, opts);
  let after;
  let status;
  const s = before.indexOf(START);
  const e = before.indexOf(END);
  if (s !== -1 && e > s) {
    after = before.slice(0, s) + block + before.slice(e + END.length);
    status = after === before ? 'unchanged' : 'updated';
  } else {
    const heading = opts.heading ?? '## Architecture';
    const sep = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
    after = `${before}${sep}${heading}\n\n${block}\n`;
    status = 'inserted';
  }
  if (!opts.check && status !== 'unchanged') fs.writeFileSync(file, after);
  return { file, status, content: after };
}
