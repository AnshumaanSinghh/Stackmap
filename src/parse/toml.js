// A TOML 1.0 parser for the configuration files Stackmap reads: pyproject.toml,
// Cargo.toml, fly.toml, wrangler.toml, netlify.toml.
//
// Returns plain objects. Dates, times and date-times are kept as the strings
// they were written as. Integers too large for a JavaScript number to hold
// exactly are kept as their source text rather than silently rounded.
// Beyond TOML 1.0 it also accepts two TOML 1.1 relaxations seen in the wild:
// inline tables that span lines (with a trailing comma), and \e / \xHH escapes.
//
// The 1-based source line of every key, [table] header, [[array]] element and
// array item is recorded with setLine() (see lines.js) so callers can cite
// "file:line" evidence:
//   key = value        -> on the table that holds `key`
//   [a.b.c]            -> on table a.b, under 'c' (the header's last key)
//   [[a.b]]            -> on the array a.b, under the element's index
//
// The parser is a single pass over the text with a position (`pos`) and a line
// counter (`line`). TOML forbids defining anything twice, so it remembers how
// every table came to exist (see the *_TABLE kinds below) to tell legitimate
// additions from redefinitions.

import { setLine } from './lines.js';

export class TomlError extends Error {
  /**
   * @param {string} message
   * @param {number} line 1-based line where the problem was found
   */
  constructor(message, line) {
    super(`${message} (line ${line})`);
    this.name = 'TomlError';
    /** @type {number} */
    this.line = line;
  }
}

/**
 * Parse a TOML document into a plain object.
 * @param {string} text
 * @returns {Record<string, unknown>}
 * @throws {TomlError}
 */
export function parseToml(text) {
  return new TomlParser(text).parse();
}

// How a table came to exist decides what may still be added to it later.
/** Defined by a [header] (or an element of [[array.of.tables]]); cannot be defined again. */
const HEADER_TABLE = 1;
/** Created as a parent of a header ([a.b] creates a); may get its own [a] header later. */
const IMPLICIT_TABLE = 2;
/** Created by a dotted key (a.b = 1 creates a); may get [a.sub] tables, never an [a] header. */
const DOTTED_TABLE = 3;
/** An inline table { ... }: complete as written, can never be extended. */
const INLINE_TABLE = 4;

const BARE_KEY = /[A-Za-z0-9_-]+/y;

// Dates and times are matched before numbers because they start with digits.
// The date/time separator may be a space, but only when a time follows.
const DATE_TIME = /\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:\d{2})?)?/y;
const TIME = /\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?/y;

/** Everything else (numbers, booleans, inf, nan) is read as one token and classified. */
const TOKEN = /[0-9A-Za-z_.+-]+/y;
const DECIMAL = /^[+-]?(?:0|[1-9](?:_?[0-9])*)$/;
const HEX = /^0x[0-9A-Fa-f](?:_?[0-9A-Fa-f])*$/;
const OCTAL = /^0o[0-7](?:_?[0-7])*$/;
const BINARY = /^0b[01](?:_?[01])*$/;
const FLOAT = /^[+-]?(?:0|[1-9](?:_?[0-9])*)(?:\.[0-9](?:_?[0-9])*)?(?:[eE][+-]?[0-9](?:_?[0-9])*)?$/;

const ESCAPES = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', e: '\x1b', '"': '"', '\\': '\\' };
const HEX_ESCAPES = { x: 2, u: 4, U: 8 };

/** @param {unknown} v */
const isTable = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Integers beyond 2^53 would silently lose digits, so keep them as written. */
const safeInteger = (n, token) => (Number.isSafeInteger(n) ? n : token);

/**
 * Classify a bare token: boolean, integer, float, inf or nan.
 * Returns undefined when the token is none of these.
 * @param {string} token
 */
function tokenValue(token) {
  switch (token) {
    case 'true': return true;
    case 'false': return false;
    case 'inf': case '+inf': return Infinity;
    case '-inf': return -Infinity;
    case 'nan': case '+nan': case '-nan': return NaN;
  }
  const digits = token.replace(/_/g, '');
  if (DECIMAL.test(token)) return safeInteger(Number(digits), token);
  if (HEX.test(token)) return safeInteger(parseInt(digits.slice(2), 16), token);
  if (OCTAL.test(token)) return safeInteger(parseInt(digits.slice(2), 8), token);
  if (BINARY.test(token)) return safeInteger(parseInt(digits.slice(2), 2), token);
  if (FLOAT.test(token)) return Number(digits); // integers were caught above
  return undefined;
}

/**
 * Assign without tripping over `__proto__` (a plain assignment would replace
 * the object's prototype instead of creating a key).
 */
function setOwn(obj, key, value) {
  if (key === '__proto__') {
    Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
  } else {
    obj[key] = value;
  }
}

/** A key path for error messages: a.b."c d" */
function keyPath(keys) {
  return keys.map((k) => (/^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(k))).join('.');
}

class TomlParser {
  /** @param {string} text */
  constructor(text) {
    if (typeof text !== 'string') text = String(text ?? '');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // byte order mark
    this.src = text.replace(/\r\n/g, '\n');
    this.pos = 0;
    this.line = 1;
    this.root = {};
    /** How each table was created. @type {WeakMap<object, number>} */
    this.kinds = new WeakMap();
    /** Arrays created by [[header]], as opposed to `key = [...]`. @type {WeakSet<unknown[]>} */
    this.tableArrays = new WeakSet();
  }

  error(message, line = this.line) {
    return new TomlError(message, line);
  }

  parse() {
    const { src } = this;
    let table = this.root; // where key = value lines go
    while (this.pos < src.length) {
      this.skipWs();
      const c = src[this.pos];
      if (c === undefined) break;
      if (c === '\n') {
        this.pos++;
        this.line++;
        continue;
      }
      if (c === '#') {
        this.skipComment();
        continue;
      }
      if (c === '[') table = this.parseHeader();
      else this.parseKeyValue(table, null);
      this.expectLineEnd();
    }
    return this.root;
  }

  // --- Whitespace and comments ---------------------------------------------

  skipWs() {
    const { src } = this;
    while (src[this.pos] === ' ' || src[this.pos] === '\t') this.pos++;
  }

  skipComment() {
    const end = this.src.indexOf('\n', this.pos);
    this.pos = end === -1 ? this.src.length : end;
  }

  /** Skip whitespace, comments and line breaks (inside arrays and inline tables). */
  skipSpaceAndNewlines(what, openLine) {
    const { src } = this;
    for (;;) {
      this.skipWs();
      const c = src[this.pos];
      if (c === '#') this.skipComment();
      else if (c === '\n') {
        this.pos++;
        this.line++;
      } else if (c === undefined) throw this.error(`unterminated ${what}`, openLine);
      else return;
    }
  }

  /** After a header or key/value pair only a comment may follow on the line. */
  expectLineEnd() {
    this.skipWs();
    if (this.src[this.pos] === '#') this.skipComment();
    const c = this.src[this.pos];
    if (c === undefined) return;
    if (c !== '\n') throw this.error(`unexpected "${c}" (expected the end of the line)`);
    this.pos++;
    this.line++;
  }

  // --- Keys and tables -----------------------------------------------------

  /** A key: bare, "basic", 'literal', or several of those joined by dots. Returns the parts. */
  parseKey() {
    const { src } = this;
    const keys = [];
    for (;;) {
      const c = src[this.pos];
      if (c === '"') keys.push(this.parseBasicString());
      else if (c === "'") keys.push(this.parseLiteralString());
      else {
        BARE_KEY.lastIndex = this.pos;
        const match = BARE_KEY.exec(src);
        if (!match) {
          throw this.error(c === undefined || c === '\n' || c === '=' ? 'expected a key' : `invalid character "${c}" in a key`);
        }
        keys.push(match[0]);
        this.pos += match[0].length;
      }
      this.skipWs();
      if (src[this.pos] !== '.') return keys;
      this.pos++;
      this.skipWs();
    }
  }

  /** `[table]` or `[[array.of.tables]]`. Returns the table that following keys go into. */
  parseHeader() {
    const { src } = this;
    const line = this.line;
    const isArray = src[this.pos + 1] === '[';
    this.pos += isArray ? 2 : 1;
    this.skipWs();
    const keys = this.parseKey();
    const close = isArray ? ']]' : ']';
    if (!src.startsWith(close, this.pos)) throw this.error(`expected "${close}" to close the table header`);
    this.pos += close.length;
    return isArray ? this.appendTableArray(keys, line) : this.defineTable(keys, line);
  }

  /**
   * Walk from the root to the table that holds a header's last key, creating
   * implicit tables on the way. `[a.b]` after `[[a]]` refers to the last
   * element of the array a.
   */
  descend(keys, line) {
    let table = this.root;
    for (let k = 0; k < keys.length - 1; k++) {
      const key = keys[k];
      if (!Object.hasOwn(table, key)) {
        const child = {};
        this.kinds.set(child, IMPLICIT_TABLE);
        setOwn(table, key, child);
        setLine(table, key, line);
        table = child;
        continue;
      }
      const child = table[key];
      if (this.tableArrays.has(child)) table = child[child.length - 1];
      else if (isTable(child) && this.kinds.get(child) !== INLINE_TABLE) table = child;
      else throw this.error(`"${keyPath(keys.slice(0, k + 1))}" is already defined and is not a table`, line);
    }
    return table;
  }

  /** `[a.b.c]` */
  defineTable(keys, line) {
    const parent = this.descend(keys, line);
    const last = keys[keys.length - 1];
    const name = keyPath(keys);
    if (!Object.hasOwn(parent, last)) {
      const table = {};
      this.kinds.set(table, HEADER_TABLE);
      setOwn(parent, last, table);
      setLine(parent, last, line);
      return table;
    }
    const existing = parent[last];
    if (this.tableArrays.has(existing)) throw this.error(`[${name}] is an array of tables; use [[${name}]]`, line);
    if (!isTable(existing)) throw this.error(`"${name}" is already defined as a value`, line);
    switch (this.kinds.get(existing)) {
      case IMPLICIT_TABLE:
        // [a.b] came first and created `a` implicitly; now `a` gets its own header.
        this.kinds.set(existing, HEADER_TABLE);
        setLine(parent, last, line);
        return existing;
      case DOTTED_TABLE:
        throw this.error(`table [${name}] was already defined with dotted keys`, line);
      case INLINE_TABLE:
        throw this.error(`table [${name}] was already defined as an inline table`, line);
      default:
        throw this.error(`table [${name}] is defined more than once`, line);
    }
  }

  /** `[[a.b]]`: append a new table to the array a.b. */
  appendTableArray(keys, line) {
    const parent = this.descend(keys, line);
    const last = keys[keys.length - 1];
    let array = parent[last];
    if (!Object.hasOwn(parent, last)) {
      array = [];
      this.tableArrays.add(array);
      setOwn(parent, last, array);
      setLine(parent, last, line);
    } else if (!this.tableArrays.has(array)) {
      const name = keyPath(keys);
      throw this.error(
        Array.isArray(array)
          ? `cannot append to the array "${name}" with [[${name}]]: it was defined with "${name} = [...]"`
          : `[[${name}]] conflicts with the existing ${isTable(array) ? 'table' : 'value'} "${name}"`,
        line,
      );
    }
    const table = {};
    this.kinds.set(table, HEADER_TABLE);
    setLine(array, array.length, line);
    array.push(table);
    return table;
  }

  /**
   * `key = value` (the key may be dotted). `created` is used inside inline
   * tables: the set of tables that inline table has created so far, the only
   * ones its dotted keys may add to.
   * @param {object} table
   * @param {Set<object>|null} created
   */
  parseKeyValue(table, created) {
    const line = this.line;
    const keys = this.parseKey();
    if (this.src[this.pos] !== '=') {
      throw this.error(`expected "=" after the key "${keyPath(keys)}"`);
    }
    this.pos++;
    this.skipWs();
    const value = this.parseValue();
    this.assign(table, keys, value, line, created);
  }

  /** Store a value under a (possibly dotted) key; dotted keys create intermediate tables. */
  assign(table, keys, value, line, created) {
    let t = table;
    for (let k = 0; k < keys.length - 1; k++) {
      const key = keys[k];
      if (!Object.hasOwn(t, key)) {
        const child = {};
        if (created) created.add(child);
        else this.kinds.set(child, DOTTED_TABLE);
        setOwn(t, key, child);
        setLine(t, key, line);
        t = child;
        continue;
      }
      const child = t[key];
      const kind = isTable(child) ? this.kinds.get(child) : undefined;
      const extendable = created ? created.has(child) : kind === DOTTED_TABLE || kind === IMPLICIT_TABLE;
      if (!extendable) {
        throw this.error(`cannot add keys to "${keyPath(keys.slice(0, k + 1))}": it is already defined`, line);
      }
      t = child;
    }
    const last = keys[keys.length - 1];
    if (Object.hasOwn(t, last)) throw this.error(`duplicate key "${keyPath(keys)}"`, line);
    setOwn(t, last, value);
    setLine(t, last, line);
  }

  // --- Values --------------------------------------------------------------

  parseValue() {
    const { src } = this;
    const c = src[this.pos];
    switch (c) {
      case '"':
        return src.startsWith('"""', this.pos) ? this.parseMultilineString('"') : this.parseBasicString();
      case "'":
        return src.startsWith("'''", this.pos) ? this.parseMultilineString("'") : this.parseLiteralString();
      case '[':
        return this.parseArray();
      case '{':
        return this.parseInlineTable();
      case undefined:
      case '\n':
      case '#':
        throw this.error('expected a value');
    }

    DATE_TIME.lastIndex = this.pos;
    let match = DATE_TIME.exec(src);
    if (!match) {
      TIME.lastIndex = this.pos;
      match = TIME.exec(src);
    }
    if (match) {
      this.pos += match[0].length;
      return match[0];
    }

    TOKEN.lastIndex = this.pos;
    match = TOKEN.exec(src);
    const value = match ? tokenValue(match[0]) : undefined;
    if (value === undefined) {
      throw this.error(match ? `invalid value "${match[0]}"` : `unexpected "${c}" (expected a value)`);
    }
    this.pos += match[0].length;
    return value;
  }

  /** `"basic string"` with escapes, on one line. */
  parseBasicString() {
    const { src } = this;
    let out = '';
    let i = this.pos + 1;
    for (;;) {
      const c = src[i];
      if (c === '"') break;
      if (c === undefined || c === '\n') throw this.error('unterminated string');
      if (c === '\\') {
        const [text, length] = this.escape(i);
        out += text;
        i += length;
      } else {
        out += c;
        i++;
      }
    }
    this.pos = i + 1;
    return out;
  }

  /** `'literal string'`: no escapes, on one line. */
  parseLiteralString() {
    const { src } = this;
    const start = this.pos + 1;
    let end = start;
    while (end < src.length && src[end] !== "'" && src[end] !== '\n') end++;
    if (src[end] !== "'") throw this.error('unterminated string');
    this.pos = end + 1;
    return src.slice(start, end);
  }

  /**
   * `"""multi-line basic"""` or `'''multi-line literal'''`. A line break right
   * after the opening delimiter is dropped. In basic strings a backslash at the
   * end of a line removes the line break and the indentation that follows.
   * @param {'"'|"'"} quote
   */
  parseMultilineString(quote) {
    const { src } = this;
    const startLine = this.line;
    const delimiter = quote.repeat(3);
    let i = this.pos + 3;
    if (src[i] === '\n') {
      i++;
      this.line++;
    }
    let out = '';
    for (;;) {
      const c = src[i];
      if (c === undefined) throw this.error('unterminated multi-line string', startLine);
      if (c === quote && src.startsWith(delimiter, i)) {
        // Up to two quotes may sit right before the closing delimiter: """a""""" is a"".
        let run = 3;
        while (run < 5 && src[i + run] === quote) run++;
        out += quote.repeat(run - 3);
        this.pos = i + run;
        return out;
      }
      if (c === '\\' && quote === '"') {
        let j = i + 1;
        while (src[j] === ' ' || src[j] === '\t') j++;
        if (src[j] === '\n') {
          // Line-ending backslash: skip all whitespace and line breaks that follow.
          while (src[j] === ' ' || src[j] === '\t' || src[j] === '\n') {
            if (src[j] === '\n') this.line++;
            j++;
          }
          i = j;
          continue;
        }
        const [text, length] = this.escape(i);
        out += text;
        i += length;
        continue;
      }
      if (c === '\n') this.line++;
      out += c;
      i++;
    }
  }

  /** Decode the escape sequence at src[i] (a backslash). Returns [text, length]. */
  escape(i) {
    const c = this.src[i + 1];
    if (Object.hasOwn(ESCAPES, c)) return [ESCAPES[c], 2];
    if (Object.hasOwn(HEX_ESCAPES, c)) {
      const digits = HEX_ESCAPES[c];
      const hex = this.src.slice(i + 2, i + 2 + digits);
      const code = hex.length === digits && /^[0-9A-Fa-f]+$/.test(hex) ? parseInt(hex, 16) : -1;
      // Must be a Unicode scalar value: not a surrogate, not beyond U+10FFFF.
      if (code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
        throw this.error(`invalid escape "\\${c}${hex}"`);
      }
      return [String.fromCodePoint(code), 2 + digits];
    }
    throw this.error(`invalid escape "\\${c === undefined || c === '\n' ? '' : c}"`);
  }

  /** `[1, 2, 3]`: may span lines, hold comments and end with a trailing comma. */
  parseArray() {
    const openLine = this.line;
    const array = [];
    this.pos++;
    for (;;) {
      this.skipSpaceAndNewlines('array', openLine);
      if (this.src[this.pos] === ']') break;
      setLine(array, array.length, this.line);
      array.push(this.parseValue());
      this.skipSpaceAndNewlines('array', openLine);
      const c = this.src[this.pos];
      if (c === ']') break;
      if (c !== ',') throw this.error(`expected "," or "]" in the array, found "${c}"`);
      this.pos++;
    }
    this.pos++;
    return array;
  }

  /** `{ key = value, other.key = value }` */
  parseInlineTable() {
    const openLine = this.line;
    const table = {};
    const created = new Set([table]);
    this.pos++;
    for (;;) {
      this.skipSpaceAndNewlines('inline table', openLine);
      if (this.src[this.pos] === '}') break;
      this.parseKeyValue(table, created);
      this.skipSpaceAndNewlines('inline table', openLine);
      const c = this.src[this.pos];
      if (c === '}') break;
      if (c !== ',') throw this.error(`expected "," or "}" in the inline table, found "${c}"`);
      this.pos++;
    }
    this.pos++;
    // Seal the table (and the tables its dotted keys created) against later additions.
    for (const t of created) this.kinds.set(t, INLINE_TABLE);
    return table;
  }
}
