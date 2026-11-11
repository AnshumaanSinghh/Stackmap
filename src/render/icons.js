// 24x24 stroke icons (original, generic; no brand marks). Drawn with stroke="currentColor".

export const ICONS = {
  app: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/>',
  mobile: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>',
  desktop: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M9 20h6M12 16v4"/>',
  service: '<rect x="4" y="4" width="16" height="6" rx="1.5"/><rect x="4" y="14" width="16" height="6" rx="1.5"/><path d="M8 7h.01M8 17h.01"/>',
  container: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
  function: '<path d="M14 4h-1.5A2.5 2.5 0 0 0 10 6.5V20M7 11h6"/><path d="M16 14l4 4M20 14l-4 4"/>',
  worker: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3.5 2"/>',
  cli: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M12 15h5"/>',
  library: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H19v14H5.5A1.5 1.5 0 0 0 4 19.5v-14z"/><path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H19v-3"/>',
  database: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.5"/><path d="M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5"/>',
  cache: '<path d="M13 2.5L5 13.5h6l-1 8 8-11h-6l1-8z"/>',
  queue: '<path d="M4 6h12M4 12h12M4 18h12"/><path d="M18 9l3 3-3 3"/>',
  storage: '<path d="M4 7l1.5 12.5A2 2 0 0 0 7.5 21h9a2 2 0 0 0 2-1.5L20 7"/><ellipse cx="12" cy="7" rx="8" ry="3"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  vector: '<circle cx="6" cy="17" r="2"/><circle cx="18" cy="17" r="2"/><circle cx="12" cy="6" r="2"/><path d="M7.5 15.5L11 7.8M16.5 15.5L13 7.8M8 17h8"/>',
  auth: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3M12 14.5v2.5"/>',
  payments: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>',
  email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5l8.5 6.5 8.5-6.5"/>',
  messaging: '<path d="M4 5.5h16v10H9l-5 4v-14z"/><path d="M8 10h8"/>',
  ai: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z"/>',
  observability: '<path d="M3 12h4l2.5-6 4 12 2.5-6h5"/>',
  analytics: '<path d="M5 20V12M10 20V6M15 20v-9M20 20V4"/>',
  cms: '<path d="M7 3h7l4 4v14H7V3z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>',
  flags: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  realtime: '<circle cx="12" cy="12" r="2"/><path d="M8 8a5.5 5.5 0 0 0 0 8M16 8a5.5 5.5 0 0 1 0 8M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/>',
  workflow: '<rect x="3" y="4" width="6" height="5" rx="1"/><rect x="15" y="15" width="6" height="5" rx="1"/><path d="M6 9v4a2 2 0 0 0 2 2h7"/><path d="M13 13l2 2-2 2"/>',
  cloud: '<path d="M7 18.5h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 9.6 4.5 4.5 0 0 0 7 18.5z"/>',
  integrations: '<path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0V7zM12 16v5"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
};

export function iconFor(node) {
  if (node.kind === 'datastore' || node.kind === 'external') return ICONS[node.category] ?? ICONS.external;
  return ICONS[node.kind] ?? ICONS.service;
}
