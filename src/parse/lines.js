// Source-line bookkeeping shared by the YAML and TOML parsers.
//
// The parsers return plain objects and arrays so callers can use them like
// JSON.parse output. To cite evidence ("compose.yml:12") the scanner also
// needs to know where each key or item came from, so the parsers record the
// 1-based line of every mapping key and sequence item here, keyed by the
// container that holds it. A WeakMap keeps the values themselves clean and lets
// the bookkeeping be garbage-collected together with the parsed tree.

/** @type {WeakMap<object, Map<string|number, number>>} */
const LINES = new WeakMap();

/**
 * Object keys are always strings in JavaScript and array indices are numbers,
 * so normalise whatever the caller passes ('0' vs 0, 8080 vs '8080').
 * @param {object} container
 * @param {string|number} keyOrIndex
 */
function normalise(container, keyOrIndex) {
  return Array.isArray(container) ? Number(keyOrIndex) : String(keyOrIndex);
}

/**
 * Record the 1-based line where `container[keyOrIndex]` starts.
 * @param {object} container  a parsed object or array
 * @param {string|number} keyOrIndex
 * @param {number} line
 */
export function setLine(container, keyOrIndex, line) {
  if (container === null || typeof container !== 'object') return;
  let lines = LINES.get(container);
  if (!lines) {
    lines = new Map();
    LINES.set(container, lines);
  }
  lines.set(normalise(container, keyOrIndex), line);
}

/**
 * The 1-based line where `container[keyOrIndex]` starts, if it was recorded.
 * @param {object} container
 * @param {string|number} keyOrIndex
 * @returns {number|undefined}
 */
export function lineOf(container, keyOrIndex) {
  if (container === null || typeof container !== 'object') return undefined;
  return LINES.get(container)?.get(normalise(container, keyOrIndex));
}
