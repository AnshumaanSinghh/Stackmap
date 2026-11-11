// Public API.
//
//   import { scan, render } from 'stackmap-cli';
//   const graph = scan('.');
//   const mermaid = render(graph, 'mermaid');

import { scan, SCHEMA, VERSION } from './graph/build.js';
import { viewGraph, impactOf, neighbours } from './graph/view.js';
import { diffGraphs, diffToMarkdown } from './graph/diff.js';
import { checkRules } from './graph/rules.js';
import { findNode, selectNodes } from './graph/select.js';
import { layoutGraph } from './render/layout.js';
import { drawSvg } from './render/draw.js';
import { toMermaid } from './render/mermaid.js';
import { toMarkdown } from './render/markdown.js';
import { toDot } from './render/dot.js';
import { toHtml } from './render/html.js';
import { updateReadme, readmeBlock } from './readme.js';
import { loadConfig } from './config.js';
import { createCatalog } from './catalog/index.js';
import { summaryText } from './summary.js';

export const FORMATS = ['html', 'svg', 'mermaid', 'md', 'json', 'dot'];

export function toSvg(graph, opts = {}) {
  const view = viewGraph(graph, { libraries: Boolean(opts.libraries) });
  const layout = layoutGraph(view);
  const subtitle = summaryText(graph.summary);
  return drawSvg(view, layout, { mode: opts.mode ?? 'auto', legend: opts.legend !== false, title: opts.title === false ? undefined : graph.project.name, subtitle, credit: opts.credit });
}

/** Render a graph in one of FORMATS. */
export function render(graph, format, opts = {}) {
  const view = () => viewGraph(graph, { libraries: Boolean(opts.libraries) });
  switch (format) {
    case 'html':
      return toHtml(graph);
    case 'svg':
      return toSvg(graph, opts);
    case 'mermaid':
    case 'mmd':
      return toMermaid(view(), { direction: opts.direction, collapseExternalOver: opts.collapseExternalOver });
    case 'md':
    case 'markdown':
      return toMarkdown(graph, view(), opts);
    case 'json':
      return JSON.stringify(graph, null, 2);
    case 'dot':
      return toDot(view(), { name: graph.project.name });
    default:
      throw new Error(`Unknown format "${format}". Use one of: ${FORMATS.join(', ')}`);
  }
}

export {
  scan, SCHEMA, VERSION, viewGraph, impactOf, neighbours, diffGraphs, diffToMarkdown, checkRules, findNode, selectNodes,
  layoutGraph, drawSvg, toMermaid, toMarkdown, toDot, toHtml, updateReadme, readmeBlock, loadConfig, createCatalog, summaryText,
};
