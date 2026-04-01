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
 *   - exact_values: string equals one of N constants
 *   - prefix_nonempty: starts with literal prefix + ≥1 more char
 *   - wrapped: starts with prefix AND ends with suffix
 *   - csv_list: comma-separated items from a charset
 *   - ln_invoice: Lightning Network bech32 invoice
 *   - mime_type: simple MIME type/subtype
 *   - http_origin: base HTTP URL with no path
 *   - email_like: local@domain format
 *   - git_clone_url: git clone URL (scheme:// or git@)
 *   - content_type: full Content-Type with optional params
 *   - doi: Digital Object Identifier
 *   - annotate_user: image annotation coordinates
 *   - prefix_no_whitespace: literal prefix + non-whitespace tail
 *   - external_identity: NIP-39 identity tag format
 *   - package_id: hierarchical colon-separated ID
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
  | { op: 'a_tag'; kinds?: string[] }
  | { op: 'date_iso' }
  | { op: 'datetime_iso' }
  | { op: 'decimal' }
  | { op: 'exact_values'; values: string[] }
  | { op: 'prefix_nonempty'; prefix: string }
  | { op: 'wrapped'; prefix: string; suffix: string }
  | { op: 'csv_list'; itemCharset: string }
  | { op: 'ln_invoice'; prefix: string; minHrpLen: number }
  | { op: 'mime_type' }
  | { op: 'http_origin' }
  | { op: 'email_like' }
  | { op: 'git_clone_url' }
  | { op: 'content_type' }
  | { op: 'doi' }
  | { op: 'annotate_user' }
  | { op: 'prefix_no_whitespace'; prefixes: string[] }
  | { op: 'external_identity' }
  | { op: 'package_id' }
  | { op: 'imeta_dim' }
  | { op: 'dim' }
  | { op: 'no_uppercase' }
  | { op: 'dotted_digits' }
  | { op: 'slash_segments'; charset: string }
  | { op: 'space_separated_tokens' }
  | { op: 'starts_with_charset'; charset: string }
  | { op: 'base64' }
  | { op: 'nostr_uri' }
  | { op: 'nip04_encrypted' }
  | { op: 'nip05_identifier' }
  | { op: 'mime_type_strict' }
  | { op: 'prefix_delim_rest'; charset: string; delimiter: string }
  | { op: 'compound'; checks: PatternCheck[] }
  | { op: 'regex'; pattern: string };

/**
 * Classify a JSON Schema regex pattern into a native check operation.
 *
 * Attempts to find the most efficient native representation. Falls back
 * to { op: 'regex', pattern } for patterns that don't match any known form.
 */
export function classifyRegex(pattern: string): PatternCheck {
  // Filter errorMessage description strings (not real regex patterns)
  if (!/[\\[({^$*+?.|]/.test(pattern)) {
    // No regex metacharacters at all — this is a plain description string
    return { op: 'regex', pattern };
  }

  // Normalize escaped slashes: \/ → / (JSON Schema allows but doesn't require escaping /)
  const normalized = pattern.replace(/\\\//g, '/');
  if (normalized !== pattern) {
    return classifyRegex(normalized);
  }

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

  // Hex with literal prefix: ^0x[0-9a-f]{4}$ or ^x [a-f0-9]{64}$
  {
    const m = pattern.match(/^\^([a-zA-Z0-9 _:\-]+)\[(?:0-9a-f|a-f0-9)\]\{(\d+)\}\$$/);
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
      const charset = expandCharset(m[1]);
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

  // Compressed public key: ^(02|03)[a-f0-9]{64}$
  if (pattern === '^(02|03)[a-f0-9]{64}$') {
    return {
      op: 'compound',
      checks: [
        { op: 'hex', len: 66, case: 'lower' },
        { op: 'starts_with_any', prefixes: ['02', '03'] },
      ],
    };
  }

  // Git ref (unanchored): ^refs/.*
  if (pattern === '^refs/.*') {
    return { op: 'starts_with_any', prefixes: ['refs/'] };
  }

  // Git branch/tag ref: ^refs/(heads|tags)/[^\s]+$
  if (pattern === '^refs/(heads|tags)/[^\\s]+$') {
    return { op: 'prefix_no_whitespace', prefixes: ['refs/heads/', 'refs/tags/'] };
  }

  // HTTP(S) URL non-whitespace: ^https?://\S+$
  if (pattern === '^https?://\\S+$') {
    return { op: 'prefix_no_whitespace', prefixes: ['http://', 'https://'] };
  }

  // ^$ → empty string only — chars_in with 0 length
  if (pattern === '^$') {
    return { op: 'chars_in', charset: '', min: 0, max: 0 };
  }

  // Nostr event coordinates: ^\d+:[a-f0-9]{64}:.+$
  {
    const m = pattern.match(/^\^\\d\+:\[a-f0-9\]\{64\}:\.\+\$$/);
    if (m) {
      return { op: 'a_tag' };
    }
  }

  // Single-kind coordinates: ^30311:[a-f0-9]{64}:.+$
  {
    const m = pattern.match(/^\^(\d+):\[a-f0-9\]\{64\}:\.\+\$$/);
    if (m) {
      return { op: 'a_tag', kinds: [m[1]] };
    }
  }

  // Multi-kind coordinates: ^(31922|31923):[a-f0-9]{64}:.+$
  {
    const m = pattern.match(/^\^\((\d+(?:\|\d+)*)\):\[a-f0-9\]\{64\}:\.\+\$$/);
    if (m) {
      return { op: 'a_tag', kinds: m[1].split('|') };
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
  // NOTE: only the underscore variant matches — the no-underscore variant
  // (^wss?://[a-zA-Z0-9.-]+...) has a different hostname charset and MUST NOT
  // use relay_url (which allows _ in hostnames). See allowlist.
  if (pattern === '^wss?://[a-zA-Z0-9._-]+(?::[0-9]+)?(?:/.*)?$') {
    return { op: 'relay_url' };
  }

  // ISO 8601 datetime: ^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$
  if (pattern === '^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}(:\\d{2})?(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2})?)?$') {
    return { op: 'datetime_iso' };
  }

  // --- New ops below ---

  // Exact values: expand anchored literal alternation to string list
  {
    const values = expandLiteralAlternation(pattern);
    if (values && values.length > 0 && values.length <= 20) {
      return { op: 'exact_values', values };
    }
  }

  // PGP signature: ^-----BEGIN PGP SIGNATURE-----[\s\S]*-----END PGP SIGNATURE-----$
  if (pattern === '^-----BEGIN PGP SIGNATURE-----[\\s\\S]*-----END PGP SIGNATURE-----$') {
    return { op: 'wrapped', prefix: '-----BEGIN PGP SIGNATURE-----', suffix: '-----END PGP SIGNATURE-----' };
  }

  // CSV list: ^[charset]+(,[charset]+)*$
  {
    const m = pattern.match(/^\^\[([A-Za-z0-9_-]+)\]\+\(,\[([A-Za-z0-9_-]+)\]\+\)\*\$$/);
    if (m && m[1] === m[2]) {
      return { op: 'csv_list', itemCharset: expandCharset(m[1]) };
    }
  }

  // Prefix + non-whitespace tail: ^<prefix>https?://\S+$ or ^<prefix>[^\s]+$
  {
    // Pattern: ^<word> https?://\S+$
    const m = pattern.match(/^\^([a-zA-Z]+ )https\?:\/\/\\S\+\$$/);
    if (m) {
      const prefixes = [m[1] + 'http://', m[1] + 'https://'];
      return { op: 'prefix_no_whitespace', prefixes };
    }
  }
  // Pattern: ^ref: refs/heads/[^\s]+$
  if (pattern === '^ref: refs/heads/[^\\s]+$') {
    return { op: 'prefix_no_whitespace', prefixes: ['ref: refs/heads/'] };
  }

  // Prefix + nonempty tail: ^<literal>.+$
  {
    const m = pattern.match(/^\^([a-zA-Z][a-zA-Z0-9-]* )\.\+\$$/);
    if (m) {
      return { op: 'prefix_nonempty', prefix: m[1] };
    }
  }

  // HTTP origin: ^https?://[^/]+/?$
  if (pattern === '^https?://[^/]+/?$') {
    return { op: 'http_origin' };
  }

  // Git clone URL: ^(([a-z][a-z0-9+\\.-]*://)|git@)[^\s]+$
  if (pattern === '^(([a-z][a-z0-9+\\\\.-]*://)|git@)[^\\s]+$' ||
      pattern === '^(([a-z][a-z0-9+\\.-]*://)|git@)[^\\s]+$') {
    return { op: 'git_clone_url' };
  }

  // BOLT-11 invoice: ^lnbc[a-z0-9]*1[02-9ac-hj-np-z]+$
  if (pattern === '^lnbc[a-z0-9]*1[02-9ac-hj-np-z]+$') {
    return { op: 'ln_invoice', prefix: 'lnbc', minHrpLen: 4 };
  }

  // Generic LN bech32: ^ln[a-z0-9]+[02-9ac-hj-np-z]*1[02-9ac-hj-np-z]+$
  if (pattern === '^ln[a-z0-9]+[02-9ac-hj-np-z]*1[02-9ac-hj-np-z]+$') {
    return { op: 'ln_invoice', prefix: 'ln', minHrpLen: 3 };
  }

  // Simple MIME type: ^[a-z]+/[a-z0-9.+-]+$
  if (pattern === '^[a-z]+/[a-z0-9.+-]+$') {
    return { op: 'mime_type' };
  }

  // Content-Type with params
  if (pattern === '^[a-zA-Z][a-zA-Z0-9!#$&^_-]*/[a-zA-Z0-9*][a-zA-Z0-9!#$&^_.+-]*(\\s*;\\s*[a-zA-Z0-9!#$&^_.+-]+=[a-zA-Z0-9!#$&^_.+-]+)*$') {
    return { op: 'content_type' };
  }

  // Email-like: ^[^\s@]+@[^\s@]+$
  if (pattern === '^[^\\s@]+@[^\\s@]+$') {
    return { op: 'email_like' };
  }

  // DOI: ^10\.\d{4,9}/.+$
  if (pattern === '^10\\.\\d{4,9}/.+$') {
    return { op: 'doi' };
  }

  // Annotate user: ^annotate-user [a-f0-9]{64}:[0-9]+(?:\.[0-9]+)?:[0-9]+(?:\.[0-9]+)?$
  if (pattern === '^annotate-user [a-f0-9]{64}:[0-9]+(?:\\.[0-9]+)?:[0-9]+(?:\\.[0-9]+)?$') {
    return { op: 'annotate_user' };
  }

  // External identity: ^[a-z0-9._\-/]+:.+
  if (pattern === '^[a-z0-9._\\-/]+:.+') {
    return { op: 'external_identity' };
  }

  // Package ID: ^(#|[A-Za-z0-9][A-Za-z0-9._+-]*(?::[A-Za-z0-9][A-Za-z0-9._+-]*)*)$
  if (pattern === '^(#|[A-Za-z0-9][A-Za-z0-9._+-]*(?::[A-Za-z0-9][A-Za-z0-9._+-]*)*)$') {
    return { op: 'package_id' };
  }

  // imeta dimensions: ^dim [0-9]{1,5}x[0-9]{1,5}$
  if (pattern === '^dim [0-9]{1,5}x[0-9]{1,5}$') {
    return { op: 'imeta_dim' };
  }

  // Bare dimensions: ^[0-9]+x[0-9]+$ or ^\d+x\d+$
  if (pattern === '^[0-9]+x[0-9]+$' || pattern === '^\\d+x\\d+$') {
    return { op: 'dim' };
  }

  // No uppercase: ^[^A-Z]+$
  if (pattern === '^[^A-Z]+$') {
    return { op: 'no_uppercase' };
  }

  // Dotted version number: ^[0-9]+(\.[0-9]+)*$
  if (pattern === '^[0-9]+(\\.[0-9]+)*$') {
    return { op: 'dotted_digits' };
  }

  // Slash-separated segments: ^[A-Za-z0-9_\-+]+(?:/[A-Za-z0-9_\-+]+)*$
  if (pattern === '^[A-Za-z0-9_\\-+]+(?:/[A-Za-z0-9_\\-+]+)*$') {
    return { op: 'slash_segments', charset: expandCharset('A-Za-z0-9') + '_-+' };
  }

  // Space-separated non-whitespace tokens: ^\S+( \S+)*$
  if (pattern === '^\\S+( \\S+)*$') {
    return { op: 'space_separated_tokens' };
  }

  // Starts with bech32-data charset (no end anchor): ^[0-9bcdefghjkmnpqrstuvwxyz]+
  if (pattern === '^[0-9bcdefghjkmnpqrstuvwxyz]+') {
    return { op: 'starts_with_charset', charset: '0123456789bcdefghjkmnpqrstuvwxyz' };
  }

  // Base64: ^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$
  if (pattern === '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$') {
    return { op: 'base64' };
  }

  // Nostr URI: ^nostr:((npub|note)1[02-9ac-hj-np-z]{58}|(nprofile|nevent|naddr)1[02-9ac-hj-np-z]+)$
  if (pattern === '^nostr:((npub|note)1[02-9ac-hj-np-z]{58}|(nprofile|nevent|naddr)1[02-9ac-hj-np-z]+)$') {
    return { op: 'nostr_uri' };
  }

  // NIP-04 encrypted content: ^[A-Za-z0-9+/]+={0,2}\?iv=[A-Za-z0-9+/]+={0,2}$
  if (pattern === '^[A-Za-z0-9+/]+={0,2}\\?iv=[A-Za-z0-9+/]+={0,2}$') {
    return { op: 'nip04_encrypted' };
  }

  // NIP-05 identifier: ^(([_A-Za-z0-9.-]+)|_)@...domain...$
  if (pattern === '^(([_A-Za-z0-9.-]+)|_)@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$') {
    return { op: 'nip05_identifier' };
  }

  // Strict MIME type: ^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$
  if (pattern === '^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$') {
    return { op: 'mime_type_strict' };
  }

  // Prefix + delimiter + rest (no end anchor): ^[0-9]+:.+
  if (pattern === '^[0-9]+:.+') {
    return { op: 'prefix_delim_rest', charset: '0123456789', delimiter: ':' };
  }

  // Prefix + delimiter + rest (no end anchor): ^[a-zA-Z0-9_-]+: .+
  if (pattern === '^[a-zA-Z0-9_-]+: .+') {
    return { op: 'prefix_delim_rest', charset: expandCharset('a-zA-Z0-9') + '_-', delimiter: ': ' };
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
 * Expand an anchored regex consisting of only literals, groups, and alternation
 * into a list of all possible literal strings. Returns undefined if the regex
 * contains metacharacters that can't be expanded.
 *
 * Examples:
 *   ^(38172|38173)$ → ["38172", "38173"]
 *   ^m (image/(apng|avif))$ → ["m image/apng", "m image/avif"]
 */
function expandLiteralAlternation(pattern: string): string[] | undefined {
  if (!pattern.startsWith('^') || !pattern.endsWith('$')) return undefined;
  const body = pattern.slice(1, -1);
  if (body.length === 0) return undefined;
  return expandLiteralGroup(body);
}

function expandLiteralGroup(s: string): string[] | undefined {
  // Parse: literal chars, groups (...), alternation |
  // Returns all possible literal strings, or undefined if regex metacharacters found
  const alternatives: string[][] = [['']];
  let i = 0;
  while (i < s.length) {
    if (s[i] === '(') {
      // Find matching close paren
      let depth = 1;
      let j = i + 1;
      while (j < s.length && depth > 0) {
        if (s[j] === '(') depth++;
        if (s[j] === ')') depth--;
        j++;
      }
      if (depth !== 0) return undefined;
      const inner = expandLiteralGroup(s.slice(i + 1, j - 1));
      if (!inner) return undefined;
      // Cross product current alternatives with inner alternatives
      const last = alternatives[alternatives.length - 1];
      const newLast: string[] = [];
      for (const prefix of last) {
        for (const suffix of inner) {
          newLast.push(prefix + suffix);
        }
      }
      alternatives[alternatives.length - 1] = newLast;
      i = j;
    } else if (s[i] === '|') {
      alternatives.push(['']);
      i++;
    } else if (s[i] === '\\' && i + 1 < s.length) {
      // Escape sequence — only handle literal escapes
      const escaped = s[i + 1];
      if ('.*+?^${}()|[]\\'.includes(escaped)) {
        const last = alternatives[alternatives.length - 1];
        for (let k = 0; k < last.length; k++) {
          last[k] += escaped;
        }
        i += 2;
      } else {
        return undefined; // Unknown escape like \d, \s
      }
    } else if ('.*+?[]{}^$'.includes(s[i])) {
      return undefined; // Unescaped regex metacharacter
    } else {
      // Literal char
      const last = alternatives[alternatives.length - 1];
      for (let k = 0; k < last.length; k++) {
        last[k] += s[i];
      }
      i++;
    }
  }
  return alternatives.flat();
}

/**
 * ECMAScript whitespace code points.
 * These are the characters that `\s` matches in a JavaScript regex.
 * Each emitter renders the appropriate check for its target language.
 */
export const ECMA_WHITESPACE: readonly number[] = [
  0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, // ASCII
  0xA0, 0x1680, // Latin
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200A, // General punctuation
  0x2028, 0x2029, 0x202F, 0x205F, // Separators
  0x3000, // CJK
  0xFEFF, // BOM
] as const;

/**
 * Expand a charset range specification (e.g. "A-Za-z0-9_") into a string of
 * all individual characters. This eliminates the need for range expansion at
 * runtime in each of the 12 language emitters.
 *
 * Examples:
 *   "A-Za-z0-9_" → "ABCDEFGHIJKLMNOPQRSTUVWXYZ...0123456789_"
 *   "0-9" → "0123456789"
 */
export function expandCharset(rangeSpec: string): string {
  let result = '';
  let i = 0;
  while (i < rangeSpec.length) {
    if (i + 2 < rangeSpec.length && rangeSpec[i + 1] === '-') {
      const from = rangeSpec.charCodeAt(i);
      const to = rangeSpec.charCodeAt(i + 2);
      for (let c = from; c <= to; c++) {
        result += String.fromCharCode(c);
      }
      i += 3;
    } else {
      result += rangeSpec[i];
      i++;
    }
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
    case 'exact_values':
    case 'prefix_nonempty':
    case 'wrapped':
    case 'csv_list':
    case 'ln_invoice':
    case 'mime_type':
    case 'http_origin':
    case 'email_like':
    case 'git_clone_url':
    case 'content_type':
    case 'doi':
    case 'annotate_user':
    case 'prefix_no_whitespace':
    case 'external_identity':
    case 'package_id':
    case 'imeta_dim':
    case 'dim':
    case 'no_uppercase':
    case 'dotted_digits':
    case 'slash_segments':
    case 'space_separated_tokens':
    case 'starts_with_charset':
    case 'base64':
    case 'nostr_uri':
    case 'nip04_encrypted':
    case 'nip05_identifier':
    case 'mime_type_strict':
    case 'prefix_delim_rest':
      return true;
    case 'compound':
      return check.checks.every(isNativeCheck);
    case 'regex':
      return false;
  }
}
