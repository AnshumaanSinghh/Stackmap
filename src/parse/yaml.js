// A YAML parser for the configuration files Stackmap reads: docker-compose,
// Kubernetes manifests, GitHub Actions workflows, render.yaml,
// pnpm-workspace.yaml and friends.
//
// It is small and dependency-free rather than a complete YAML implementation.
// Supported: block mappings and sequences (including the compact `- key: value`
// form), plain, 'single' and "double" quoted scalars, block scalars (| and >
// with chomping and indentation indicators), flow collections ([..] and {..},
// nested, spanning lines), anchors, aliases, `<<` merge keys, tags (parsed and
// ignored, except that !!str keeps a plain scalar as a string), multiple
// documents, and the YAML 1.2 core schema for scalars (so `on`, `yes` and `no`
// stay strings). Not supported: explicit `? ` keys and collections used as
// mapping keys. %TAG/%YAML directives are skipped.
//
// The 1-based source line of every mapping key and sequence item is recorded
// with setLine() (see lines.js) so callers can cite "file:line" evidence.
//
// How it works
// ------------
// Block structure is decided by indentation, so the parser works on an array of
// lines with a block cursor, `this.i` (the next line to look at). A block
// collection knows its own indentation: it consumes the lines at exactly that
// indentation and stops at the first line that is indented less.
//
// Flow collections and quoted scalars ignore indentation and may run over
// several lines; they are read with a character cursor (`this.row`, `this.col`).
//
// Compact forms such as `- key: value` and `- - a` are handled with one trick:
// once a sequence item is recognised, its `-` is overwritten with a space. The
// rest of the line then looks like an ordinary, deeper-indented line, and the
// item's content (a mapping at the column of `key`, a nested sequence, ...) is
// parsed by the same code that parses it on a line of its own. This mirrors the
// YAML spec, which counts the `-` as indentation for the node that follows it.

import { setLine } from './lines.js';

export class YamlError extends Error {
  /**
   * @param {string} message
   * @param {number} [line] 1-based line where the problem was found
   */
  constructor(message, line) {
    super(line ? `${message} (line ${line})` : message);
    this.name = 'YamlError';
    /** @type {number|undefined} */
    this.line = line;
  }
}

/**
 * Parse the first YAML document in `text`. An empty input gives null.
 * @param {string} text
 * @returns {unknown}
 * @throws {YamlError}
 */
export function parseYaml(text) {
  const docs = new YamlParser(text).parseStream(true);
  return docs.length > 0 ? docs[0] : null;
}

/**
 * Parse every document in `text` (documents are separated by `---`, as in
 * multi-document Kubernetes files). An explicitly started but empty document
 * yields null; input with no documents at all yields [].
 * @param {string} text
 * @returns {unknown[]}
 * @throws {YamlError}
 */
export function parseYamlAll(text) {
  return new YamlParser(text).parseStream(false);
}

// ---------------------------------------------------------------------------
// Character helpers

/** @param {string|undefined} c */
const isWs = (c) => c === ' ' || c === '\t';

/** True when `c` may follow a `:` or `-` indicator (whitespace or end of line). */
const isSeparator = (c) => c === undefined || c === ' ' || c === '\t';

/** Characters that end a plain scalar or a name inside a flow collection. */
const isFlowIndicator = (c) => c === ',' || c === '[' || c === ']' || c === '{' || c === '}';

/** A line holding nothing but whitespace and/or a comment. */
const BLANK = /^[ \t]*(?:#.*)?$/;

/** A line holding nothing but whitespace. */
const WHITESPACE_ONLY = /^[ \t]*$/;

/** Node properties: `&anchor`, `!tag`, `!!tag` or a verbatim `!<tag>`. */
const PROPERTY = /&[^\s,[\]{}]+|!<[^>]*>|![^\s,[\]{}]*/y;

/** The name after `*` in an alias. */
const ALIAS_NAME = /[^\s,[\]{}]+/y;

/** Number of leading spaces (tabs are not indentation in YAML). */
function indentOf(line) {
  let n = 0;
  while (line.charCodeAt(n) === 32) n++;
  return n;
}

/** Index of the first character at or after `i` that is not a space or tab. */
function skipSpace(line, i) {
  while (i < line.length && isWs(line[i])) i++;
  return i;
}

/**
 * Remove trailing spaces and tabs. (String#trimEnd would also remove Unicode
 * spaces such as U+00A0, which YAML treats as content.)
 */
function trimTrailing(s) {
  let end = s.length;
  while (end > 0 && isWs(s[end - 1])) end--;
  return end === s.length ? s : s.slice(0, end);
}

/** `---` (document start) or `...` (document end) at column 0. */
function isDocMarker(line) {
  return (line.startsWith('---') || line.startsWith('...')) && isSeparator(line[3]);
}

/** A block sequence item indicator: `-` followed by whitespace or end of line. */
function isSeqIndicator(line, col) {
  return line[col] === '-' && isSeparator(line[col + 1]);
}

/**
 * Index of the `#` that starts a trailing comment at or after `from`, or
 * line.length. A `#` only starts a comment after whitespace, which is why
 * `http://host/#anchor` and `C#` are left alone.
 */
function commentStart(line, from) {
  for (let i = line.indexOf('#', from); i !== -1; i = line.indexOf('#', i + 1)) {
    if (i === 0 || isWs(line[i - 1])) return i;
  }
  return line.length;
}

/** True when only whitespace or a comment follows position `from`. */
function restIsEmpty(line, from) {
  const i = skipSpace(line, from);
  return i === line.length || (line[i] === '#' && (i === 0 || isWs(line[i - 1])));
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

// ---------------------------------------------------------------------------
// Scalars: the YAML 1.2 core schema

const INT_DECIMAL = /^[-+]?[0-9]+$/;
const INT_HEX = /^0x[0-9a-fA-F]+$/;
const INT_OCTAL = /^0o[0-7]+$/;
const FLOAT = /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?$/;
const INFINITY = /^[-+]?\.(?:inf|Inf|INF)$/;
const NOT_A_NUMBER = /^\.(?:nan|NaN|NAN)$/;
/** `08`, `0755`, `-012`: zero-padded numbers are kept as strings, not guessed at. */
const LEADING_ZERO = /^[-+]?0[0-9]/;

/** Integers beyond 2^53 would silently lose digits, so keep them as written. */
const safeInteger = (n, raw) => (Number.isSafeInteger(n) ? n : raw);

/**
 * Resolve a plain (unquoted) scalar: null, boolean, number or string.
 * Only true/false are booleans: yes/no/on/off stay strings (YAML 1.2), so a
 * workflow's `on:` key and `on` values are the string 'on'.
 * @param {string} raw
 */
function resolvePlain(raw) {
  if (raw === '' || raw === '~' || raw === 'null' || raw === 'Null' || raw === 'NULL') return null;
  if (raw.length === 4 || raw.length === 5) {
    const lower = raw.toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
  }
  // Every number starts with a digit, a sign or a dot; skip the regexes otherwise.
  const c = raw[0];
  if (!((c >= '0' && c <= '9') || c === '-' || c === '+' || c === '.')) return raw;
  if (LEADING_ZERO.test(raw)) return raw;
  if (INT_DECIMAL.test(raw)) return safeInteger(Number(raw), raw);
  if (INT_HEX.test(raw)) return safeInteger(parseInt(raw.slice(2), 16), raw);
  if (INT_OCTAL.test(raw)) return safeInteger(parseInt(raw.slice(2), 8), raw);
  if (FLOAT.test(raw)) return Number(raw);
  if (INFINITY.test(raw)) return raw[0] === '-' ? -Infinity : Infinity;
  if (NOT_A_NUMBER.test(raw)) return NaN;
  return raw; // `1.2.3`, `5432:5432`, `-` ...
}

/** Double-quoted escapes that map to a fixed string. */
const ESCAPES = {
  0: '\0', a: '\x07', b: '\b', t: '\t', '\t': '\t', n: '\n', v: '\v', f: '\f', r: '\r',
  e: '\x1b', ' ': ' ', '"': '"', '/': '/', '\\': '\\', N: '\x85', _: '\xa0', L: '\u2028', P: '\u2029',
};

/** Hex escapes and their digit counts: \x41, \u00e9, \U0001F600. */
const HEX_ESCAPES = { x: 2, u: 4, U: 8 };

/**
 * Text of a block scalar (`|` literal or `>` folded) from its content lines,
 * which have already had their indentation removed. Empty lines arrive as ''.
 * @param {string[]} lines
 * @param {boolean} literal
 * @param {'clip'|'strip'|'keep'} chomp
 */
function blockScalarText(lines, literal, chomp) {
  let last = lines.length - 1;
  while (last >= 0 && lines[last] === '') last--;
  const trailing = lines.length - 1 - last; // empty lines after the content
  if (last < 0) return chomp === 'keep' ? '\n'.repeat(trailing) : '';

  let text;
  if (literal) {
    text = lines.slice(0, last + 1).join('\n');
  } else {
    // Folding: a line break between two ordinary lines becomes a space, and
    // each empty line becomes "\n". Lines that are indented further than the
    // rest ("more-indented", e.g. code in a description) keep their breaks.
    text = '';
    let empty = 0;
    let started = false;
    let previousMoreIndented = false;
    for (let k = 0; k <= last; k++) {
      const line = lines[k];
      if (line === '') {
        empty++;
        continue;
      }
      const moreIndented = line[0] === ' ' || line[0] === '\t';
      if (!started) text = '\n'.repeat(empty) + line;
      else if (moreIndented || previousMoreIndented) text += '\n' + '\n'.repeat(empty) + line;
      else text += (empty > 0 ? '\n'.repeat(empty) : ' ') + line;
      started = true;
      empty = 0;
      previousMoreIndented = moreIndented;
    }
  }
  if (chomp === 'strip') return text;
  if (chomp === 'clip') return text + '\n';
  return text + '\n'.repeat(trailing + 1);
}

// ---------------------------------------------------------------------------
// The parser

class YamlParser {
  /** @param {string} text */
  constructor(text) {
    if (typeof text !== 'string') text = String(text ?? '');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // byte order mark
    /** @type {string[]} */
    this.lines = text.split(/\r\n|\r|\n/);
    /** Block cursor: index of the next line to examine. */
    this.i = 0;
    /** Character cursor for flow collections and quoted scalars. */
    this.row = 0;
    this.col = 0;
    /** Anchors of the current document. @type {Map<string, unknown>} */
    this.anchors = new Map();
  }

  /** @param {string} message @param {number} index 0-based line index */
  error(message, index) {
    // Helm charts and similar files are templates that only become YAML once
    // rendered; say so rather than leave the reader puzzling over the message.
    if (/(?:^|[^$]){{/.test(this.lines[index] ?? '')) message += ' (this looks like a {{ }} template, not plain YAML)';
    return new YamlError(message, index + 1);
  }

  // --- Documents -----------------------------------------------------------

  /** @param {boolean} firstOnly stop after the first document */
  parseStream(firstOnly) {
    const { lines } = this;
    const docs = [];
    for (;;) {
      // Before a document: blank lines, comments and %directives.
      while (this.i < lines.length && (BLANK.test(lines[this.i]) || lines[this.i][0] === '%')) this.i++;
      if (this.i >= lines.length) break;

      const line = lines[this.i];
      if (line.startsWith('...') && isDocMarker(line)) {
        this.i++; // a stray document end marker
        continue;
      }
      const explicitStart = line.startsWith('---') && isDocMarker(line);
      if (explicitStart) {
        // Content may follow the marker on the same line (`--- |`, `--- !tag`);
        // blank out the marker so that content reads as an indented line.
        lines[this.i] = '   ' + line.slice(3);
      }

      this.anchors = new Map();
      const hasContent = this.peek() !== -1;
      const value = hasContent ? this.parseBlockNode(-1, false) : null;
      const leftover = this.peek();
      if (leftover !== -1) throw this.error('unexpected content after the end of the document', leftover);
      if (explicitStart || hasContent) {
        docs.push(value);
        if (firstOnly) break;
      }
      // peek() stopped at the end of the input or at a marker. `...` is consumed
      // here; `---` starts the next document on the next pass.
      if (this.i < lines.length && lines[this.i].startsWith('...')) this.i++;
    }
    return docs;
  }

  /**
   * Skip blank and comment lines. Returns the index of the next content line,
   * or -1 at the end of the input or at a document marker.
   */
  peek() {
    const { lines } = this;
    while (this.i < lines.length) {
      const line = lines[this.i];
      if (isDocMarker(line)) return -1;
      if (!BLANK.test(line)) return this.i;
      this.i++;
    }
    return -1;
  }

  /** Indentation of a content line; a tab in the indentation is an error. */
  indentAt(index) {
    const line = this.lines[index];
    const n = indentOf(line);
    if (line[n] === '\t') throw this.error('tab characters must not be used for indentation', index);
    return n;
  }

  // --- Block nodes ---------------------------------------------------------

  /**
   * Parse the block node that starts on the next content line, provided it is
   * indented more than its parent. A mapping value may also be a sequence at
   * the same indentation as its key (`key:\n- a`), which `seqAtParentIndent`
   * allows. Returns null when there is no such node (an empty value).
   * @param {number} parentIndent
   * @param {boolean} seqAtParentIndent
   */
  parseBlockNode(parentIndent, seqAtParentIndent) {
    const index = this.peek();
    if (index === -1) return null;
    const indent = this.indentAt(index);
    if (indent > parentIndent) return this.parseNodeAt(index, indent, parentIndent, seqAtParentIndent);
    if (seqAtParentIndent && indent === parentIndent && isSeqIndicator(this.lines[index], indent)) {
      return this.parseBlockSequence(indent);
    }
    return null;
  }

  /** Parse the node whose first character is at (`index`, `col`). */
  parseNodeAt(index, col, parentIndent, seqAtParentIndent) {
    this.i = index;
    if (isSeqIndicator(this.lines[index], col)) return this.parseBlockSequence(col);
    if (this.scanKey(index, col)) return this.parseBlockMapping(col);
    return this.parseValue(index, col, parentIndent, seqAtParentIndent);
  }

  /** A block sequence whose `-` indicators sit at column `indent`. */
  parseBlockSequence(indent) {
    const { lines } = this;
    const seq = [];
    for (let index = this.peek(); index !== -1; index = this.peek()) {
      const n = this.indentAt(index);
      const line = lines[index];
      if (n < indent || (n === indent && !isSeqIndicator(line, n))) break;
      if (n > indent) throw this.error('bad indentation of a sequence item', index);

      setLine(seq, seq.length, index + 1);
      // Overwrite the "-" with a space so the item's content reads as an
      // indented line of its own (see "How it works" at the top).
      const content = skipSpace(line, n + 1);
      lines[index] = ' '.repeat(content) + line.slice(content);
      if (restIsEmpty(line, content)) {
        // "-" alone on its line: the item is on the following lines (or null).
        this.i = index + 1;
        seq.push(this.parseBlockNode(indent, false));
      } else {
        seq.push(this.parseNodeAt(index, content, indent, false));
      }
    }
    return seq;
  }

  /** A block mapping whose keys start at column `indent`. */
  parseBlockMapping(indent) {
    const map = {};
    for (let index = this.peek(); index !== -1; index = this.peek()) {
      const n = this.indentAt(index);
      if (n < indent) break;
      if (n > indent) throw this.error('bad indentation of a mapping entry', index);
      const key = this.scanKey(index, n);
      if (!key) {
        throw this.error(
          isSeqIndicator(this.lines[index], n)
            ? 'unexpected sequence item where a mapping key was expected'
            : 'expected a mapping key ("key: value")',
          index,
        );
      }
      if (key.anchor !== undefined) this.anchors.set(key.anchor, key.text);
      const value = this.parseValue(index, key.valueCol, indent, true);
      this.addEntry(map, key.text, value, key.merge, index);
    }
    return map;
  }

  /**
   * If an implicit mapping key ("key: ...") starts at `col`, return its text
   * and the column just after its ':'. Otherwise return null: the line holds a
   * scalar, flow collection, alias or block scalar instead.
   *
   * A plain key ends at the first ':' followed by whitespace or the end of the
   * line, so `image: postgres:16-alpine`, `url: http://x` and
   * `traefik.http.routers.x.rule: Host(...)` all split where they should.
   * @returns {{ text: string, valueCol: number, merge: boolean, anchor?: string } | null}
   */
  scanKey(index, col) {
    const line = this.lines[index];
    // Properties in front of a key (`&a key: v`) belong to the key.
    const { anchor, p } = this.readProperties(line, col, index);
    const c = line[p];
    if (c === undefined) return null;

    if (c === '"' || c === "'") {
      this.row = index;
      this.col = p;
      const text = this.readQuoted(true);
      if (text === null) return null; // a quoted value running onto the next line
      const colon = skipSpace(line, this.col);
      if (line[colon] !== ':' || !isSeparator(line[colon + 1])) return null;
      return { text, valueCol: colon + 1, merge: false, anchor };
    }

    if (c === '[' || c === '{' || c === '|' || c === '>' || c === '*' || c === '#') return null;
    if ((c === '-' || c === '?') && isSeparator(line[p + 1])) {
      if (c === '?') throw this.error('explicit mapping keys ("? key") are not supported', index);
      return null;
    }

    const limit = commentStart(line, p);
    for (let i = line.indexOf(':', p); i !== -1 && i < limit; i = line.indexOf(':', i + 1)) {
      if (isSeparator(line[i + 1])) {
        const text = trimTrailing(line.slice(p, i));
        return { text, valueCol: i + 1, merge: text === '<<', anchor };
      }
    }
    return null;
  }

  /**
   * Parse a node that begins on line `index` at or after `col`: the value after
   * "key:", the content after "- ", or a document's root. If the line holds only
   * node properties (or nothing), the node is the block node on the following
   * lines.
   */
  parseValue(index, col, parentIndent, seqAtParentIndent) {
    const line = this.lines[index];
    const { anchor, tag, p } = this.readProperties(line, skipSpace(line, col), index);
    let value;
    let raw; // the source text, for plain scalars only

    if (restIsEmpty(line, p)) {
      this.i = index + 1;
      value = this.parseBlockNode(parentIndent, seqAtParentIndent);
    } else {
      const c = line[p];
      if (c === '*') {
        const name = this.readAliasName(line, p, index);
        value = this.alias(name, index);
        this.expectLineEnd(index, p + 1 + name.length);
      } else if (c === '|' || c === '>') {
        value = this.parseBlockScalar(index, p, parentIndent);
      } else if (c === '[' || c === '{') {
        this.row = index;
        this.col = p;
        value = this.parseFlowCollection();
        this.expectLineEnd(this.row, this.col);
      } else if (c === '"' || c === "'") {
        this.row = index;
        this.col = p;
        value = this.readQuoted(false);
        this.expectLineEnd(this.row, this.col);
      } else if (isSeqIndicator(line, p)) {
        throw this.error('a block sequence must start on its own line', index);
      } else {
        raw = this.readPlain(index, p, parentIndent);
        value = resolvePlain(raw);
      }
    }
    return this.finishNode(value, anchor, tag, raw);
  }

  /** After a value that must end its line: allow only a comment, then move on. */
  expectLineEnd(row, col) {
    if (!restIsEmpty(this.lines[row], col)) throw this.error('unexpected text after the value', row);
    this.i = row + 1;
  }

  /** Read `&anchor` / `!tag` properties starting at `p`. */
  readProperties(line, p, index) {
    let anchor;
    let tag;
    while (line[p] === '&' || line[p] === '!') {
      PROPERTY.lastIndex = p;
      const match = PROPERTY.exec(line);
      if (!match) throw this.error('expected an anchor name after "&"', index);
      if (match[0][0] === '&') anchor = match[0].slice(1);
      else tag = match[0];
      p = skipSpace(line, p + match[0].length);
    }
    return { anchor, tag, p };
  }

  /**
   * Apply node properties. Tags are ignored except !!str, which keeps a plain
   * scalar as written (`!!str 123` is '123'). Custom tags such as !Ref,
   * !reset or !override keep the value unchanged.
   */
  finishNode(value, anchor, tag, raw) {
    if (raw !== undefined && (tag === '!!str' || tag === '!<tag:yaml.org,2002:str>')) value = raw;
    if (anchor !== undefined) this.anchors.set(anchor, value);
    return value;
  }

  readAliasName(line, p, index) {
    ALIAS_NAME.lastIndex = p + 1;
    const match = ALIAS_NAME.exec(line);
    if (!match) throw this.error('expected an alias name after "*"', index);
    return match[0];
  }

  /** Aliases return the anchored value itself (the same object, not a copy). */
  alias(name, index) {
    if (!this.anchors.has(name)) throw this.error(`unknown alias "*${name}"`, index);
    return this.anchors.get(name);
  }

  /**
   * Store `key: value` in a mapping and record its line. A `<<` merge key
   * copies in the keys of the referenced mapping (or list of mappings, earlier
   * ones winning) that the mapping does not already have. Keys written
   * explicitly always win: earlier ones because merging skips existing keys,
   * later ones because they overwrite what the merge brought in.
   */
  addEntry(map, key, value, isMerge, index) {
    if (!isMerge) {
      setOwn(map, key, value);
      setLine(map, key, index + 1);
      return;
    }
    for (const source of Array.isArray(value) ? value : [value]) {
      if (source === null) continue;
      if (typeof source !== 'object' || Array.isArray(source)) {
        throw this.error('"<<" (merge) needs a mapping or a list of mappings', index);
      }
      for (const k of Object.keys(source)) {
        if (Object.hasOwn(map, k)) continue;
        setOwn(map, k, source[k]);
        setLine(map, k, index + 1);
      }
    }
  }

  // --- Scalars -------------------------------------------------------------

  /**
   * A plain (unquoted) scalar in block context. It may continue on following
   * lines indented deeper than its parent; those fold into one string joined
   * by spaces, and each empty line in between becomes "\n". A comment ends it.
   */
  readPlain(index, p, parentIndent) {
    const { lines } = this;
    let line = lines[index];
    let end = commentStart(line, p);
    let text = trimTrailing(line.slice(p, end));
    let last = index;
    if (end === line.length) {
      let empty = 0;
      for (let j = index + 1; j < lines.length; j++) {
        line = lines[j];
        const start = skipSpace(line, 0);
        if (start === line.length) {
          empty++;
          continue;
        }
        if (isDocMarker(line) || indentOf(line) <= parentIndent || line[start] === '#') break;
        end = commentStart(line, start);
        text += (empty > 0 ? '\n'.repeat(empty) : ' ') + trimTrailing(line.slice(start, end));
        empty = 0;
        last = j;
        if (end < line.length) break;
      }
    }
    this.i = last + 1;
    return text;
  }

  /**
   * A block scalar: `|` keeps line breaks, `>` folds them. The header may carry
   * a chomping indicator (`-` strip the final line break, `+` keep all trailing
   * ones, default: keep exactly one) and an indentation digit, in either order:
   * `|-`, `>+`, `|2`, `>-2`. Without the digit, the first non-empty line sets
   * the indentation.
   */
  parseBlockScalar(index, p, parentIndent) {
    const { lines } = this;
    const header = lines[index];
    const literal = header[p] === '|';
    /** @type {'clip'|'strip'|'keep'} */
    let chomp = 'clip';
    let explicitIndent = 0;
    let q = p + 1;
    for (let k = 0; k < 2; k++) {
      const c = header[q];
      if ((c === '-' || c === '+') && chomp === 'clip') chomp = c === '-' ? 'strip' : 'keep';
      else if (c >= '1' && c <= '9' && !explicitIndent) explicitIndent = Number(c);
      else break;
      q++;
    }
    if (!restIsEmpty(header, q)) throw this.error('invalid block scalar header', index);

    let indent = Math.max(parentIndent, 0) + explicitIndent;
    if (!explicitIndent) {
      for (let j = index + 1; j < lines.length && !isDocMarker(lines[j]); j++) {
        if (!WHITESPACE_ONLY.test(lines[j])) {
          indent = indentOf(lines[j]);
          break;
        }
      }
      // Content must be indented deeper than the parent; if the next line is
      // not, the scalar is empty and that line belongs to the parent.
      indent = Math.max(indent, parentIndent + 1);
    }

    const content = [];
    let j = index + 1;
    for (; j < lines.length; j++) {
      const line = lines[j];
      if (isDocMarker(line)) break;
      if (WHITESPACE_ONLY.test(line)) {
        // An empty line, unless it has spaces beyond the content indentation:
        // those spaces are content (e.g. a blank line inside indented code).
        content.push(indentOf(line) > indent ? line.slice(indent) : '');
        continue;
      }
      if (indentOf(line) < indent) break;
      content.push(line.slice(indent));
    }
    this.i = j;
    return blockScalarText(content, literal, chomp);
  }

  /**
   * A quoted scalar starting at the character cursor. Quoted scalars may span
   * lines: a line break folds to a space, an empty line to "\n", and in double
   * quotes a backslash at the end of a line joins the lines with no space.
   * With `singleLine`, returns null if the closing quote is not on this line
   * (used to probe whether a line starts with a quoted key).
   * @param {boolean} singleLine
   * @returns {string|null}
   */
  readQuoted(singleLine) {
    const { lines } = this;
    const startRow = this.row;
    const quote = lines[this.row][this.col];
    let row = this.row;
    let col = this.col + 1;
    let out = '';
    let keep = 0; // out.slice(0, keep) must survive trimming at a line break (escapes)
    for (;;) {
      const line = lines[row];
      let joinNextLine = false;
      while (col < line.length) {
        const c = line[col];
        if (c === quote) {
          if (quote === "'" && line[col + 1] === "'") {
            out += "'";
            col += 2;
            keep = out.length;
            continue;
          }
          this.row = row;
          this.col = col + 1;
          return out;
        }
        if (c === '\\' && quote === '"') {
          if (col + 1 === line.length) {
            joinNextLine = true;
            break;
          }
          const [text, length] = this.escape(line, col, row);
          out += text;
          col += length;
          keep = out.length;
          continue;
        }
        out += c;
        col++;
      }

      // The line ended inside the quotes.
      if (singleLine) return null;
      let empty = 0;
      row++;
      if (!joinNextLine) {
        while (row < lines.length && WHITESPACE_ONLY.test(lines[row])) {
          empty++;
          row++;
        }
      }
      if (row >= lines.length) {
        throw this.error(`unterminated ${quote === '"' ? 'double' : 'single'}-quoted string`, startRow);
      }
      if (!joinNextLine) {
        out = out.slice(0, keep) + trimTrailing(out.slice(keep));
        out += empty > 0 ? '\n'.repeat(empty) : ' ';
      }
      keep = out.length;
      col = skipSpace(lines[row], 0);
    }
  }

  /** Decode the escape sequence at line[col] (a backslash). Returns [text, length]. */
  escape(line, col, row) {
    const c = line[col + 1];
    if (Object.hasOwn(ESCAPES, c)) return [ESCAPES[c], 2];
    if (Object.hasOwn(HEX_ESCAPES, c)) {
      const digits = HEX_ESCAPES[c];
      const hex = line.slice(col + 2, col + 2 + digits);
      const code = hex.length === digits && /^[0-9a-fA-F]+$/.test(hex) ? parseInt(hex, 16) : -1;
      if (code < 0 || code > 0x10ffff) throw this.error(`invalid escape "\\${c}${hex}"`, row);
      return [String.fromCodePoint(code), 2 + digits];
    }
    // Not a YAML escape (typically a Windows path such as "C:\tools" written in
    // double quotes). Strict parsers reject it; keeping it as written is kinder.
    return ['\\' + c, 2];
  }

  // --- Flow collections ----------------------------------------------------

  /** Skip whitespace, line breaks and comments inside a flow collection. */
  skipFlowSpace(openRow) {
    const { lines } = this;
    for (;;) {
      const line = lines[this.row];
      this.col = skipSpace(line, this.col);
      if (this.col < line.length && line[this.col] !== '#') return;
      this.row++;
      this.col = 0;
      if (this.row >= lines.length) throw this.error('unterminated flow collection', openRow);
    }
  }

  /** `[a, b]` or `{a: 1}`, possibly nested and spread over several lines. */
  parseFlowCollection() {
    const { lines } = this;
    const openRow = this.row;
    const isSeq = lines[this.row][this.col] === '[';
    const close = isSeq ? ']' : '}';
    const result = isSeq ? [] : {};
    this.col++;
    for (;;) {
      this.skipFlowSpace(openRow);
      if (lines[this.row][this.col] === close) break; // empty, or after a trailing comma

      const entryRow = this.row;
      const entry = this.parseFlowEntry(openRow, isSeq);
      if (isSeq) {
        setLine(result, result.length, entryRow + 1);
        result.push(entry.value);
      } else {
        this.addEntry(result, entry.key, entry.value, entry.merge, entryRow);
      }

      this.skipFlowSpace(openRow);
      const c = lines[this.row][this.col];
      if (c === close) break;
      if (c !== ',') {
        throw this.error(`expected "," or "${close}" in flow ${isSeq ? 'sequence' : 'mapping'}`, this.row);
      }
      this.col++;
    }
    this.col++; // past the closing bracket
    return result;
  }

  /**
   * One entry of a flow collection: a lone node, or "key: value". Inside a
   * sequence a "key: value" entry is a single-pair mapping (`[a: 1]`).
   * @returns {{ key: string, value: unknown, merge: boolean }}
   */
  parseFlowEntry(openRow, inSeq) {
    const { lines } = this;
    const keyRow = this.row;
    const node = this.parseFlowNode(openRow);
    const line = lines[this.row];
    const c = skipSpace(line, this.col);
    // After a quoted key or a collection (JSON style) the ':' needs no space.
    const isPair = line[c] === ':' && (node.json || isSeparator(line[c + 1]) || isFlowIndicator(line[c + 1]));
    if (!isPair) {
      if (inSeq) return { key: '', value: node.value, merge: false };
      if (node.key === undefined) throw this.error('a mapping key must be a scalar', keyRow);
      return { key: node.key, value: null, merge: false }; // `{ a, b }`: keys without values
    }
    if (node.key === undefined) throw this.error('a mapping key must be a scalar', keyRow);

    this.col = c + 1;
    this.skipFlowSpace(openRow);
    const next = lines[this.row][this.col];
    const value = next === ',' || next === ']' || next === '}' ? null : this.parseFlowNode(openRow).value;
    const merge = node.plain === true && node.key === '<<';
    if (!inSeq) return { key: node.key, value, merge };

    const pair = {};
    this.addEntry(pair, node.key, value, merge, keyRow);
    return { key: '', value: pair, merge: false };
  }

  /**
   * One node inside a flow collection.
   * `key` is the text the node has when used as a mapping key (undefined for
   * collections and aliases); `json` is true for quoted scalars and
   * collections; `plain` is true for plain scalars.
   * @returns {{ value: unknown, key?: string, json?: boolean, plain?: boolean }}
   */
  parseFlowNode(openRow) {
    const { lines } = this;
    let anchor;
    let tag;
    while (lines[this.row][this.col] === '&' || lines[this.row][this.col] === '!') {
      const props = this.readProperties(lines[this.row], this.col, this.row);
      if (props.anchor !== undefined) anchor = props.anchor;
      if (props.tag !== undefined) tag = props.tag;
      this.col = props.p;
      this.skipFlowSpace(openRow);
    }

    const line = lines[this.row];
    const c = line[this.col];
    let node;
    if (c === '[' || c === '{') {
      node = { value: this.parseFlowCollection(), json: true };
    } else if (c === '"' || c === "'") {
      const text = this.readQuoted(false);
      node = { value: text, key: text, json: true };
    } else if (c === '*') {
      const name = this.readAliasName(line, this.col, this.row);
      node = { value: this.alias(name, this.row) };
      this.col += 1 + name.length;
    } else if (isFlowIndicator(c)) {
      node = { value: null, key: '', plain: true }; // empty node, e.g. `[&a ]`
    } else {
      const raw = this.readFlowPlain();
      node = { value: this.finishNode(resolvePlain(raw), undefined, tag, raw), key: raw, plain: true };
    }
    node.value = this.finishNode(node.value, anchor, undefined, undefined);
    return node;
  }

  /**
   * A plain scalar inside a flow collection. It ends at , [ ] { }, at a ':'
   * followed by whitespace or an indicator, or at a comment, and may continue
   * on the next line (folded with a space).
   */
  readFlowPlain() {
    const { lines } = this;
    let out = '';
    for (;;) {
      const line = lines[this.row];
      const start = this.col;
      let end = start;
      for (; end < line.length; end++) {
        const c = line[end];
        if (isFlowIndicator(c)) break;
        if (c === ':' && (isSeparator(line[end + 1]) || isFlowIndicator(line[end + 1]))) break;
        if (c === '#' && end > start && isWs(line[end - 1])) break;
      }
      out += trimTrailing(line.slice(start, end));
      this.col = end;
      if (end < line.length) return out;

      // End of line: the scalar continues if the next non-empty line does not
      // start with an indicator.
      let r = this.row + 1;
      let empty = 0;
      while (r < lines.length && WHITESPACE_ONLY.test(lines[r])) {
        r++;
        empty++;
      }
      if (r >= lines.length) return out;
      const next = lines[r];
      const c0 = skipSpace(next, 0);
      const first = next[c0];
      if (isFlowIndicator(first) || first === '#' || (first === ':' && isSeparator(next[c0 + 1]))) return out;
      out += empty > 0 ? '\n'.repeat(empty) : ' ';
      this.row = r;
      this.col = c0;
    }
  }
}
