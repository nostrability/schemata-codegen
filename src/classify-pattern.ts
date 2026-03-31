/**
 * Regex pattern classifier: JSON Schema regex → native PatternCheck IR.
 *
 * Converts regex patterns from schemata schemas into language-independent
 * check operations that can be rendered as native code (no regex dependency)
 * in any target language.
 *
 * Classification categories:
 *   - hex: hex-character string with fixed or ranged length
 *   - all_digits: numeric string (optionally signed)
 *   - starts_with_any: string starting with known prefixes
 *   - chars_in: string composed of a specific character set
 *   - compound: multiple checks combined (AND)
 *   - regex: fallback (original regex preserved)
 */

/** Native check operation that replaces a regex pattern */
export type PatternCheck =
  | { op: 'hex'; len: number; case: 'lower' | 'mixed' }
  | { op: 'hex_range'; min: number; max: number; case: 'lower' | 'mixed' }
  | { op: 'hex_prefixed'; prefix: string; hexLen: number; case: 'lower' }
  | { op: 'all_digits'; allowNeg?: boolean }
  | { op: 'starts_with_any'; prefixes: string[] }
  | { op: 'chars_in'; charset: string; min?: number; max?: number }
  | { op: 'bech32'; hrp: string; dataLen?: number }
  | { op: 'relay_url' }
  | { op: 'a_tag'; kinds?: number[] }
  | { op: 'date_iso' }
  | { op: 'datetime_iso' }
  | { op: 'decimal' }
  | { op: 'compound'; checks: PatternCheck[] }
  | { op: 'regex'; pattern: string };

/**
 * Classify a JSON Schema regex pattern into a native check operation.
 *
 * Attempts to find the most efficient native representation. Falls back
 * to { op: 'regex', pattern } for patterns that don't match any known form.
 */
export function classifyRegex(pattern: string): PatternCheck {
  // Fixed-length hex: ^[a-f0-9]{64}$ or ^[a-fA-F0-9]{64}$
  {
    const m = pattern.match(/^\^(\[(?:a-f0-9|a-fA-F0-9|0-9a-f|0-9a-fA-F)\])\{(\d+)\}\$$/);
    if (m) {
      const isLower = !m[1].includes('A-F');
      return { op: 'hex', len: parseInt(m[2], 10), case: isLower ? 'lower' : 'mixed' };
    }
  }

  // Range-length hex: ^[a-f0-9]{7,40}$
  {
    const m = pattern.match(/^\^\[(?:a-f0-9|a-fA-F0-9|0-9a-f|0-9a-fA-F)\]\{(\d+),(\d+)\}\$$/);
    if (m) {
      const isLower = !pattern.includes('A-F');
      return { op: 'hex_range', min: parseInt(m[1], 10), max: parseInt(m[2], 10), case: isLower ? 'lower' : 'mixed' };
    }
  }

  // Hex with prefix: ^0x[0-9a-f]{4}$
  {
    const m = pattern.match(/^\^(0x)\[(?:0-9a-f|a-f0-9)\]\{(\d+)\}\$$/);
    if (m) {
      return { op: 'hex_prefixed', prefix: m[1], hexLen: parseInt(m[2], 10), case: 'lower' };
    }
  }

  // All digits: ^[0-9]+$ or ^\d+$
  if (pattern === '^[0-9]+$' || pattern === '^\\d+$') {
    return { op: 'all_digits' };
  }

  // Signed integer: ^-?[0-9]+$
  if (pattern === '^-?[0-9]+$') {
    return { op: 'all_digits', allowNeg: true };
  }

  // Starts-with prefixes (simple alternation of literal prefixes)
  {
    // ^(https?://).+$ → starts_with_any(["http://", "https://"])
    // ^(ws://|wss://).+$ → starts_with_any(["ws://", "wss://"])
    // ^(https?://|rtmp://|ws://|wss://).+$ → starts_with_any(...)
    const m = pattern.match(/^\^\(([^)]+)\)\.?\+\$?$/);
    if (m) {
      const prefixes = expandPrefixAlternation(m[1]);
      if (prefixes) {
        return { op: 'starts_with_any', prefixes };
      }
    }
  }

  // Simple prefix without group: ^wss?:// or ^https?://
  {
    const m = pattern.match(/^\^((?:[a-z]+)\??\:\/\/)\s*$/);
    if (m) {
      const prefixes = expandOptionalChar(m[1]);
      if (prefixes) return { op: 'starts_with_any', prefixes };
    }
  }

  // Prefix with .+ or .* : ^wss?://.+ or ^https?://.+$
  {
    const m = pattern.match(/^\^((?:[a-z]+)\??\:\/\/)\.[\+\*](.*)$/);
    if (m) {
      const prefixes = expandOptionalChar(m[1]);
      if (prefixes) return { op: 'starts_with_any', prefixes };
    }
  }

  // ^/.+ → starts_with_any(["/"])
  if (pattern === '^/.+') {
    return { op: 'starts_with_any', prefixes: ['/'] };
  }

  // Character class with quantifier: ^[a-z0-9._-]+$ or ^[A-Za-z]+$
  {
    const m = pattern.match(/^\^\[([A-Za-z0-9_.+\-\/:#]+)\](\+|\{(\d+)(?:,(\d+)?)?\})\$$/);
    if (m) {
      const charset = m[1];
      if (m[2] === '+') {
        return { op: 'chars_in', charset, min: 1 };
      }
      const min = parseInt(m[3], 10);
      if (m[2].includes(',')) {
        const max = m[4] ? parseInt(m[4], 10) : undefined;
        return { op: 'chars_in', charset, min, max };
      }
      return { op: 'chars_in', charset, min, max: min };
    }
  }

  // ^[^A-Z]+$ → chars_in (everything except uppercase)
  // This is a negated class — keep as regex fallback since chars_in is for positive sets

  // ^$ → empty string only — chars_in with 0 length
  if (pattern === '^$') {
    return { op: 'chars_in', charset: '', min: 0, max: 0 };
  }

  // Nostr event coordinates: ^\d+:[a-f0-9]{64}:.+$
  {
    const m = pattern.match(/^\^\\?d\+:\[a-f0-9\]\{64\}:\.\+\$$/);
    if (m) {
      return { op: 'a_tag' };
    }
  }

  // Single-kind coordinates: ^30311:[a-f0-9]{64}:.+$
  {
    const m = pattern.match(/^\^(\d+):\[a-f0-9\]\{64\}:\.\+\$$/);
    if (m) {
      return { op: 'a_tag', kinds: [parseInt(m[1], 10)] };
    }
  }

  // Multi-kind coordinates: ^(31922|31923):[a-f0-9]{64}:.+$
  {
    const m = pattern.match(/^\^\((\d+(?:\|\d+)*)\):\[a-f0-9\]\{64\}:\.\+\$$/);
    if (m) {
      return { op: 'a_tag', kinds: m[1].split('|').map(k => parseInt(k, 10)) };
    }
  }

  // Bech32: ^<hrp>1[02-9ac-hj-np-z]{N}$ (fixed-length) or ^<hrp>1[02-9ac-hj-np-z]+$ (variable)
  {
    const m = pattern.match(/^\^([a-z]+)1\[02-9ac-hj-np-z\](\{(\d+)\}|\+)\$$/);
    if (m) {
      const hrp = m[1];
      const dataLen = m[3] ? parseInt(m[3], 10) : undefined;
      return { op: 'bech32', hrp, dataLen };
    }
  }

  // ISO date: ^[0-9]{4}-[0-9]{2}-[0-9]{2}$
  if (pattern === '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') {
    return { op: 'date_iso' };
  }

  // Decimal number: ^\d+(?:\.\d+)?$
  if (pattern === '^\\d+(?:\\.\\d+)?$') {
    return { op: 'decimal' };
  }

  // Relay URL: ^wss?://[a-zA-Z0-9._-]+(?::[0-9]+)?(?:/.*)?$
  if (pattern === '^wss?://[a-zA-Z0-9._-]+(?::[0-9]+)?(?:/.*)?$') {
    return { op: 'relay_url' };
  }

  // ISO 8601 datetime: ^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$
  if (pattern === '^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}(:\\d{2})?(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2})?)?$') {
    return { op: 'datetime_iso' };
  }

  // Fallback: preserve original regex
  return { op: 'regex', pattern };
}

/**
 * Expand a prefix alternation group like "https?://|rtmp://|ws://|wss://"
 * into literal prefix strings.
 */
function expandPrefixAlternation(group: string): string[] | undefined {
  const parts = group.split('|');
  const result: string[] = [];
  for (const part of parts) {
    const expanded = expandOptionalChar(part);
    if (!expanded) return undefined;
    result.push(...expanded);
  }
  return result.length > 0 ? result : undefined;
}

/**
 * Expand a string with optional character markers (e.g., "https?://")
 * into all literal variants (e.g., ["http://", "https://"]).
 */
function expandOptionalChar(s: string): string[] | undefined {
  const qIdx = s.indexOf('?');
  if (qIdx === -1) return [s];
  if (qIdx === 0) return undefined; // ?at start is invalid

  const before = s.slice(0, qIdx - 1);
  const optChar = s[qIdx - 1];
  const after = s.slice(qIdx + 1);

  // Recurse for multiple ? marks
  const afterExpanded = expandOptionalChar(after);
  if (!afterExpanded) return undefined;

  const result: string[] = [];
  for (const a of afterExpanded) {
    result.push(before + a);           // without optional char
    result.push(before + optChar + a); // with optional char
  }
  return result;
}

/**
 * Check if a PatternCheck can be rendered without regex in all target languages.
 * Returns true if the check uses only native operations (no regex fallback).
 */
export function isNativeCheck(check: PatternCheck): boolean {
  switch (check.op) {
    case 'hex':
    case 'hex_range':
    case 'hex_prefixed':
    case 'all_digits':
    case 'starts_with_any':
    case 'chars_in':
    case 'bech32':
    case 'relay_url':
    case 'a_tag':
    case 'date_iso':
    case 'datetime_iso':
    case 'decimal':
      return true;
    case 'compound':
      return check.checks.every(isNativeCheck);
    case 'regex':
      return false;
  }
}
