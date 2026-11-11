// Colours. One hue per node family, taken in fixed order from a palette validated for
// colour-vision deficiency in both modes. Text always uses ink tokens, never a family colour;
// every node is labelled, so colour is never the only cue.

export const FAMILIES = [
  { key: 'app', label: 'Apps' },
  { key: 'service', label: 'Services' },
  { key: 'data', label: 'Data' },
  { key: 'worker', label: 'Workers' },
  { key: 'external', label: 'Third-party' },
  { key: 'neutral', label: 'Libraries & tools' },
];

export const THEMES = {
  light: {
    page: '#f9f9f7',
    surface: '#fcfcfb',
    card: '#ffffff',
    ink: '#0b0b0b',
    ink2: '#52514e',
    muted: '#6f6d68',
    hairline: '#e1e0d9',
    axis: '#c3c2b7',
    border: 'rgba(11,11,11,0.12)',
    edge: '#9b998f',
    edgeHi: '#2a2a28',
    app: '#2a78d6',
    service: '#eb6834',
    data: '#1baf7a',
    worker: '#eda100',
    external: '#e87ba4',
    neutral: '#898781',
  },
  dark: {
    page: '#0d0d0d',
    surface: '#1a1a19',
    card: '#232322',
    ink: '#f0efec',
    ink2: '#c3c2b7',
    muted: '#a3a199',
    hairline: '#2c2c2a',
    axis: '#383835',
    border: 'rgba(255,255,255,0.12)',
    edge: '#6b6a64',
    edgeHi: '#f0efec',
    app: '#3987e5',
    service: '#d95926',
    data: '#199e70',
    worker: '#c98500',
    external: '#d55181',
    neutral: '#898781',
  },
};

export function familyOf(node) {
  switch (node.kind) {
    case 'app':
    case 'mobile':
    case 'desktop':
      return 'app';
    case 'service':
    case 'container':
    case 'function':
      return 'service';
    case 'worker':
      return 'worker';
    case 'library':
    case 'cli':
      return 'neutral';
    case 'datastore':
      return 'data';
    case 'external':
      return node.column === 'data' ? 'data' : 'external';
    default:
      return node.column === 'data' ? 'data' : node.column === 'external' ? 'external' : 'service';
  }
}

/** CSS custom properties for both themes, scoped to `scope`. */
export function themeCss(scope, mode) {
  const vars = (t) => Object.entries(t).map(([k, v]) => `--sm-${k}:${v};`).join('');
  if (mode === 'light' || mode === 'dark') return `${scope}{${vars(THEMES[mode])}}`;
  return (
    `${scope}{${vars(THEMES.light)}}` +
    `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) ${scope}{${vars(THEMES.dark)}}}` +
    `:root[data-theme="dark"] ${scope}{${vars(THEMES.dark)}}`
  );
}
