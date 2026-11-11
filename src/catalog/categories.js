// Every technology in the catalog belongs to exactly one category.
// `column` decides where a node is drawn on the map:
//   data      -> the "Data" column (things that hold state)
//   external  -> the "Third-party" column (APIs your code sends requests to)
//   none      -> never drawn as a node (frameworks tag a unit, clients label an edge, hosting tags a unit)

export const CATEGORIES = {
  database: { label: 'Databases', column: 'data' },
  cache: { label: 'Caches', column: 'data' },
  queue: { label: 'Queues & streams', column: 'data' },
  storage: { label: 'Object storage', column: 'data' },
  search: { label: 'Search', column: 'data' },
  vector: { label: 'Vector databases', column: 'data' },

  auth: { label: 'Auth', column: 'external' },
  payments: { label: 'Payments', column: 'external' },
  email: { label: 'Email', column: 'external' },
  messaging: { label: 'SMS, chat & push', column: 'external' },
  ai: { label: 'AI', column: 'external' },
  observability: { label: 'Monitoring & logs', column: 'external' },
  analytics: { label: 'Analytics', column: 'external' },
  cms: { label: 'CMS', column: 'external' },
  flags: { label: 'Feature flags', column: 'external' },
  realtime: { label: 'Realtime', column: 'external' },
  workflow: { label: 'Jobs & workflows', column: 'external' },
  cloud: { label: 'Cloud APIs', column: 'external' },
  integrations: { label: 'Integrations', column: 'external' },

  framework: { label: 'Frameworks', column: 'none' },
  client: { label: 'Clients & ORMs', column: 'none' },
  hosting: { label: 'Hosting', column: 'none' },
};

export const KINDS = ['datastore', 'external', 'framework', 'client', 'platform'];

// Which kinds may use which categories.
export const KIND_CATEGORIES = {
  datastore: ['database', 'cache', 'queue', 'storage', 'search', 'vector'],
  external: [
    'auth', 'payments', 'email', 'messaging', 'ai', 'observability', 'analytics',
    'cms', 'flags', 'realtime', 'workflow', 'cloud', 'integrations',
    // A hosted API can also hold data (e.g. a managed vector or search API)
    'database', 'cache', 'queue', 'storage', 'search', 'vector',
  ],
  framework: ['framework'],
  client: ['client'],
  platform: ['hosting'],
};

export const ROLES = ['frontend', 'fullstack', 'backend', 'worker', 'mobile', 'desktop'];

export const ECOSYSTEMS = ['npm', 'pypi', 'go', 'cargo', 'gem', 'composer', 'maven', 'nuget', 'hex'];

export function columnOf(category) {
  return CATEGORIES[category]?.column ?? 'external';
}
