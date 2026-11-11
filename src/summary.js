// "2 apps · 1 service · 3 data stores · 7 third-party" with correct plurals; zero counts are left out.
export function summaryText(s, { sep = ' · ', connections = false } = {}) {
  const p = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return [
    s.apps && p(s.apps, 'app'),
    s.services && p(s.services, 'service'),
    s.workers && p(s.workers, 'worker'),
    s.datastores && p(s.datastores, 'data store'),
    s.external && `${s.external} third-party`,
    connections && s.edges && p(s.edges, 'connection'),
  ]
    .filter(Boolean)
    .join(sep);
}
