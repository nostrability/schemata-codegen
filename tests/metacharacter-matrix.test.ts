/**
 * Metacharacter coverage matrix test for all PatternCheck ops.
 *
 * Each native PatternCheck op must be behaviorally equivalent to its source
 * regex when evaluated in JavaScript. This test defines a shared library of
 * adversarial inputs organized by category, then for each op, verifies that
 * `regex.test(input) === nativeReference(input)` for every relevant input.
 *
 * Key edge cases targeted:
 *   - `.` vs line terminators (\n, \r, \u2028, \u2029, \u0085)
 *   - `\s` vs Unicode whitespace (ECMAScript's 23 codepoints)
 *   - `$` anchoring with trailing \n
 *   - Optional groups requiring minimum counts (e.g., `(\.\d+)?`)
 *   - Leading zeros in numeric fields
 *   - Bech32 charset boundaries (excluded: 1, b, i, o)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ============================================================================
// Shared adversarial input library
// ============================================================================

const LINE_TERMINATORS = ['', '\n', '\r', '\r\n', '\u0085', '\u2028', '\u2029'];

const UNICODE_WHITESPACE = [
  '\u00A0', '\u1680',
  '\u2000', '\u2001', '\u2002', '\u2003', '\u2004', '\u2005',
  '\u2006', '\u2007', '\u2008', '\u2009', '\u200A',
  '\u202F', '\u205F', '\u3000', '\uFEFF',
  '\t', ' ', '\x0B', '\x0C',
];

const EMPTY_AND_BOUNDS = [
  '',
  'x',
  'xx',
  'a'.repeat(63),
  'a'.repeat(64),
  'a'.repeat(65),
  'a'.repeat(128),
];

const NUMERIC_EDGE = [
  '0', '00', '01', '001', '-0', '-1', '1.', '1.0', '1.23', '.5',
  '123', '999999', '0000', '-', '1e5', '+1', ' 1', '1 ',
];

const HEX_EDGE = [
  '0'.repeat(64), 'f'.repeat(64), 'a'.repeat(64),
  'g' + '0'.repeat(63),
  '0'.repeat(63), '0'.repeat(65),
  'F'.repeat(64), 'A'.repeat(64),
  'abcdef0123456789'.repeat(4),
  '0'.repeat(128), 'f'.repeat(128),
  '0'.repeat(40), 'f'.repeat(40),
  '0x' + '0'.repeat(64),
];

const ANCHOR_EDGE = [
  'valid\n', '\nvalid', 'valid\nvalid',
  'valid\r', '\rvalid', 'valid\rvalid',
  'valid\u2028', 'valid\u2029',
  'valid\u0085',
];

const BECH32_CHARSET = '023456789acdefghjklmnpqrstuvwxyz';
const BECH32_EXCLUDED = '1bio';
const BECH32_EDGE = [
  'npub1' + BECH32_CHARSET[0].repeat(58),
  'npub1' + 'q'.repeat(58),
  'npub1' + '1'.repeat(58),  // '1' excluded from bech32 data
  'npub1' + 'b'.repeat(58),  // 'b' excluded
  'npub1' + 'i'.repeat(58),  // 'i' excluded
  'npub1' + 'o'.repeat(58),  // 'o' excluded
  'npub1' + 'q'.repeat(57),  // too short
  'npub1' + 'q'.repeat(59),  // too long
  'npub1',                    // no data
  'npub1' + 'Q'.repeat(58),  // uppercase
  'nprofile1' + 'q'.repeat(10),
  'nprofile1' + 'q',
  'nprofile1',                // no data
  'nprofile1' + '1'.repeat(10),
];

// ============================================================================
// JS line terminator helper — used by native reference implementations
// ============================================================================

/** Returns true if c is a JS regex `.` line terminator (\n, \r, LS, PS) */
function isJsLineTerm(c: string): boolean {
  return c === '\n' || c === '\r' || c === '\u2028' || c === '\u2029';
}

/** Returns true if c is ECMAScript whitespace (\s) */
function isEcmaWs(c: string): boolean {
  const cp = c.codePointAt(0)!;
  return cp === 0x09 || cp === 0x0A || cp === 0x0B || cp === 0x0C || cp === 0x0D || cp === 0x20 ||
         cp === 0xA0 || cp === 0x1680 ||
         (cp >= 0x2000 && cp <= 0x200A) ||
         cp === 0x2028 || cp === 0x2029 || cp === 0x202F || cp === 0x205F ||
         cp === 0x3000 || cp === 0xFEFF;
}

// ============================================================================
// Helper: run matrix and collect mismatches
// ============================================================================

interface MatrixResult {
  mismatches: Array<{ input: string; regex: boolean; native: boolean }>;
  total: number;
}

function runMatrix(
  inputs: string[],
  regex: RegExp,
  nativeFn: (s: string) => boolean,
): MatrixResult {
  const mismatches: MatrixResult['mismatches'] = [];
  for (const input of inputs) {
    const regexResult = regex.test(input);
    const nativeResult = nativeFn(input);
    if (regexResult !== nativeResult) {
      mismatches.push({ input, regex: regexResult, native: nativeResult });
    }
  }
  return { mismatches, total: inputs.length };
}

function assertMatrix(
  opName: string,
  inputs: string[],
  regex: RegExp,
  nativeFn: (s: string) => boolean,
): void {
  const { mismatches, total } = runMatrix(inputs, regex, nativeFn);
  if (mismatches.length > 0) {
    const details = mismatches.map(m =>
      `  input=${JSON.stringify(m.input)} regex=${m.regex} native=${m.native}`
    ).join('\n');
    assert.fail(
      `${mismatches.length}/${total} mismatches for op=${opName}:\n${details}`
    );
  }
}

// ============================================================================
// Native reference implementations
// ============================================================================

function checkHex(s: string, len: number, lowerOnly: boolean): boolean {
  if (s.length !== len) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c >= '0' && c <= '9') continue;
    if (c >= 'a' && c <= 'f') continue;
    if (!lowerOnly && c >= 'A' && c <= 'F') continue;
    return false;
  }
  return true;
}

function checkHexRange(s: string, min: number, max: number, lowerOnly: boolean): boolean {
  if (s.length < min || s.length > max) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c >= '0' && c <= '9') continue;
    if (c >= 'a' && c <= 'f') continue;
    if (!lowerOnly && c >= 'A' && c <= 'F') continue;
    return false;
  }
  return true;
}

function checkHexPrefixed(s: string, prefix: string, hexLen: number): boolean {
  if (!s.startsWith(prefix)) return false;
  if (s.length !== prefix.length + hexLen) return false;
  for (let i = prefix.length; i < s.length; i++) {
    const c = s[i];
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
  }
  return true;
}

function checkAllDigits(s: string, allowNeg: boolean): boolean {
  if (s.length === 0) return false;
  let start = 0;
  if (allowNeg && s[0] === '-') start = 1;
  if (start >= s.length) return false;
  for (let i = start; i < s.length; i++) {
    if (s[i] < '0' || s[i] > '9') return false;
  }
  return true;
}

function checkStartsWithAny(s: string, prefixes: string[]): boolean {
  for (const p of prefixes) {
    if (s.startsWith(p) && s.length > p.length) {
      // .+ tail: check no JS line terminators
      for (let i = p.length; i < s.length; i++) {
        if (isJsLineTerm(s[i])) return false;
      }
      return true;
    }
  }
  return false;
}

function checkCharsIn(s: string, charset: string, min?: number, max?: number): boolean {
  const effectiveMin = min ?? 0;
  const effectiveMax = max;
  if (s.length < effectiveMin) return false;
  if (effectiveMax !== undefined && s.length > effectiveMax) return false;
  for (let i = 0; i < s.length; i++) {
    if (!charset.includes(s[i])) return false;
  }
  return true;
}

function checkBech32(s: string, hrp: string, dataLen?: number): boolean {
  const prefix = hrp + '1';
  if (!s.startsWith(prefix)) return false;
  const data = s.slice(prefix.length);
  if (dataLen !== undefined) {
    if (data.length !== dataLen) return false;
  } else {
    if (data.length === 0) return false;
  }
  for (const c of data) {
    if (BECH32_EXCLUDED.includes(c)) return false;
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'z'))) return false;
  }
  return true;
}

function checkRelayUrl(s: string): boolean {
  let i = 0;
  if (s.startsWith('wss://')) i = 6;
  else if (s.startsWith('ws://')) i = 5;
  else return false;
  const hostStart = i;
  while (i < s.length) {
    const c = s[i];
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
        (c >= '0' && c <= '9') || c === '.' || c === '_' || c === '-') i++;
    else break;
  }
  if (i === hostStart) return false;
  if (i < s.length && s[i] === ':') {
    i++;
    const portStart = i;
    while (i < s.length && s[i] >= '0' && s[i] <= '9') i++;
    if (i === portStart) return false;
  }
  if (i < s.length && s[i] === '/') {
    for (let j = i + 1; j < s.length; j++) {
      if (isJsLineTerm(s[j])) return false;
    }
    return true;
  }
  return i === s.length;
}

function checkATag(s: string, kinds?: string[]): boolean {
  if (s.length < 68) return false;
  let pos = 0;
  if (s[pos] < '0' || s[pos] > '9') return false;
  const kindStart = pos;
  while (pos < s.length && s[pos] >= '0' && s[pos] <= '9') pos++;
  const kindStr = s.slice(kindStart, pos);
  if (pos >= s.length || s[pos] !== ':') return false;
  if (kinds && kinds.length > 0 && !kinds.includes(kindStr)) return false;
  pos++;
  if (pos + 64 >= s.length) return false;
  for (let i = 0; i < 64; i++) {
    const c = s[pos + i];
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
  }
  pos += 64;
  if (pos >= s.length || s[pos] !== ':') return false;
  pos++;
  if (pos >= s.length) return false;
  for (let j = pos; j < s.length; j++) {
    if (isJsLineTerm(s[j])) return false;
  }
  return true;
}

function checkContentType(s: string): boolean {
  function isTypeChar(c: string): boolean {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
           '!#$&^_-'.includes(c);
  }
  function isSubtypeChar(c: string): boolean {
    return isTypeChar(c) || c === '.' || c === '+';
  }
  if (s.length === 0) return false;
  let i = 0;
  if (!((s[i] >= 'a' && s[i] <= 'z') || (s[i] >= 'A' && s[i] <= 'Z'))) return false;
  i++;
  while (i < s.length && isTypeChar(s[i])) i++;
  if (i >= s.length || s[i] !== '/') return false;
  i++;
  if (i >= s.length) return false;
  if (!((s[i] >= 'a' && s[i] <= 'z') || (s[i] >= 'A' && s[i] <= 'Z') ||
        (s[i] >= '0' && s[i] <= '9') || s[i] === '*')) return false;
  i++;
  while (i < s.length && isSubtypeChar(s[i])) i++;
  while (i < s.length) {
    while (i < s.length && isEcmaWs(s[i])) i++;
    if (i >= s.length) return false;
    if (s[i] !== ';') return false;
    i++;
    while (i < s.length && isEcmaWs(s[i])) i++;
    const start = i;
    while (i < s.length && isSubtypeChar(s[i])) i++;
    if (i === start) return false;
    if (i >= s.length || s[i] !== '=') return false;
    i++;
    const vstart = i;
    while (i < s.length && isSubtypeChar(s[i])) i++;
    if (i === vstart) return false;
  }
  return i === s.length;
}

function checkExternalIdentity(s: string): boolean {
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '.' || c === '_' || c === '-' || c === '/') i++;
    else break;
  }
  if (i === 0 || i >= s.length || s[i] !== ':') return false;
  i++;
  if (i >= s.length) return false;
  for (let j = i; j < s.length; j++) {
    if (isJsLineTerm(s[j])) return false;
  }
  return true;
}

function checkAnnotateUser(s: string): boolean {
  if (!s.startsWith('annotate-user ')) return false;
  let i = 14;
  if (i + 64 > s.length) return false;
  for (let j = 0; j < 64; j++) {
    const c = s[i + j];
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
  }
  i += 64;
  for (let round = 0; round < 2; round++) {
    if (i >= s.length || s[i] !== ':') return false;
    i++;
    const start = i;
    while (i < s.length && s[i] >= '0' && s[i] <= '9') i++;
    if (i === start) return false;
    if (i < s.length && s[i] === '.') {
      i++;
      const ds = i;
      while (i < s.length && s[i] >= '0' && s[i] <= '9') i++;
      if (i === ds) return false;
    }
  }
  return i === s.length;
}

function checkDecimal(s: string): boolean {
  if (s.length === 0) return false;
  let i = 0;
  while (i < s.length && s[i] >= '0' && s[i] <= '9') i++;
  if (i === 0) return false;
  if (i < s.length && s[i] === '.') {
    i++;
    if (i >= s.length || s[i] < '0' || s[i] > '9') return false;
    while (i < s.length && s[i] >= '0' && s[i] <= '9') i++;
  }
  return i === s.length;
}

function checkDateIso(s: string): boolean {
  if (s.length !== 10) return false;
  for (let i = 0; i < 4; i++) if (s[i] < '0' || s[i] > '9') return false;
  if (s[4] !== '-') return false;
  for (let i = 5; i < 7; i++) if (s[i] < '0' || s[i] > '9') return false;
  if (s[7] !== '-') return false;
  for (let i = 8; i < 10; i++) if (s[i] < '0' || s[i] > '9') return false;
  return true;
}

function checkDatetimeIso(s: string): boolean {
  if (s.length < 10) return false;
  for (let i = 0; i < 4; i++) if (s[i] < '0' || s[i] > '9') return false;
  if (s[4] !== '-') return false;
  for (let i = 5; i < 7; i++) if (s[i] < '0' || s[i] > '9') return false;
  if (s[7] !== '-') return false;
  for (let i = 8; i < 10; i++) if (s[i] < '0' || s[i] > '9') return false;
  if (s.length === 10) return true;
  if (s[10] !== 'T' || s.length < 16) return false;
  for (let i = 11; i < 13; i++) if (s[i] < '0' || s[i] > '9') return false;
  if (s[13] !== ':') return false;
  for (let i = 14; i < 16; i++) if (s[i] < '0' || s[i] > '9') return false;
  let pos = 16;
  if (pos === s.length) return true;
  if (s[pos] === ':') {
    if (pos + 3 > s.length) return false;
    if (s[pos + 1] < '0' || s[pos + 1] > '9' || s[pos + 2] < '0' || s[pos + 2] > '9') return false;
    pos += 3;
  }
  if (pos === s.length) return true;
  if (s[pos] === '.') {
    pos++;
    if (pos >= s.length || s[pos] < '0' || s[pos] > '9') return false;
    while (pos < s.length && s[pos] >= '0' && s[pos] <= '9') pos++;
  }
  if (pos === s.length) return true;
  if (s[pos] === 'Z') return pos + 1 === s.length;
  if (s[pos] === '+' || s[pos] === '-') {
    if (pos + 6 !== s.length) return false;
    if (s[pos + 1] < '0' || s[pos + 1] > '9' || s[pos + 2] < '0' || s[pos + 2] > '9') return false;
    if (s[pos + 3] !== ':') return false;
    return s[pos + 4] >= '0' && s[pos + 4] <= '9' && s[pos + 5] >= '0' && s[pos + 5] <= '9';
  }
  return false;
}

function checkPrefixNonempty(s: string, prefix: string): boolean {
  if (!s.startsWith(prefix)) return false;
  if (s.length <= prefix.length) return false;
  for (let i = prefix.length; i < s.length; i++) {
    if (isJsLineTerm(s[i])) return false;
  }
  return true;
}

function checkWrapped(s: string, prefix: string, suffix: string): boolean {
  return s.length >= prefix.length + suffix.length && s.startsWith(prefix) && s.endsWith(suffix);
}

function checkCsvList(s: string, charset: string): boolean {
  if (s.length === 0) return false;
  let i = 0;
  while (true) {
    const start = i;
    while (i < s.length && charset.includes(s[i])) i++;
    if (i === start) return false;
    if (i === s.length) return true;
    if (s[i] !== ',') return false;
    i++;
  }
}

function checkMimeType(s: string): boolean {
  let i = 0;
  while (i < s.length && s[i] >= 'a' && s[i] <= 'z') i++;
  if (i === 0 || i >= s.length || s[i] !== '/') return false;
  i++;
  const start = i;
  while (i < s.length) {
    const c = s[i];
    if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '.' || c === '+' || c === '-') i++;
    else break;
  }
  return i > start && i === s.length;
}

function checkHttpOrigin(s: string): boolean {
  let i = 0;
  if (s.startsWith('https://')) i = 8;
  else if (s.startsWith('http://')) i = 7;
  else return false;
  const start = i;
  while (i < s.length && s[i] !== '/') i++;
  if (i === start) return false;
  if (i < s.length && s[i] === '/') i++;
  return i === s.length;
}

function checkEmailLike(s: string): boolean {
  let i = 0;
  while (i < s.length && !isEcmaWs(s[i]) && s[i] !== '@') i++;
  if (i === 0 || i >= s.length || s[i] !== '@') return false;
  i++;
  const dstart = i;
  while (i < s.length && !isEcmaWs(s[i]) && s[i] !== '@') i++;
  return i > dstart && i === s.length;
}

function checkDoi(s: string): boolean {
  if (!s.startsWith('10.')) return false;
  let i = 3;
  const start = i;
  while (i < s.length && s[i] >= '0' && s[i] <= '9') i++;
  const digitCount = i - start;
  if (digitCount < 4 || digitCount > 9) return false;
  if (i >= s.length || s[i] !== '/') return false;
  i++;
  if (i >= s.length) return false;
  for (let j = i; j < s.length; j++) {
    if (isJsLineTerm(s[j])) return false;
  }
  return true;
}

function checkPrefixNoWhitespace(s: string, prefixes: string[]): boolean {
  for (const p of prefixes) {
    if (s.startsWith(p)) {
      if (p.length >= s.length) return false;
      for (let i = p.length; i < s.length; i++) {
        if (isEcmaWs(s[i])) return false;
      }
      return true;
    }
  }
  return false;
}

function checkGitCloneUrl(s: string): boolean {
  if (s.length === 0) return false;
  let i: number;
  if (s.startsWith('git@')) {
    i = 4;
  } else {
    if (!(s[0] >= 'a' && s[0] <= 'z')) return false;
    i = 1;
    while (i < s.length && ((s[i] >= 'a' && s[i] <= 'z') || (s[i] >= '0' && s[i] <= '9') || s[i] === '+' || s[i] === '.' || s[i] === '-')) i++;
    if (i + 3 > s.length || s[i] !== ':' || s[i + 1] !== '/' || s[i + 2] !== '/') return false;
    i += 3;
  }
  if (i >= s.length) return false;
  for (let j = i; j < s.length; j++) {
    if (isEcmaWs(s[j])) return false;
  }
  return true;
}

function checkImetaDim(s: string): boolean {
  if (!s.startsWith('dim ')) return false;
  let i = 4;
  let dc = 0;
  while (i < s.length && s[i] >= '0' && s[i] <= '9') { i++; dc++; }
  if (dc < 1 || dc > 5) return false;
  if (i >= s.length || s[i] !== 'x') return false;
  i++; dc = 0;
  while (i < s.length && s[i] >= '0' && s[i] <= '9') { i++; dc++; }
  if (dc < 1 || dc > 5) return false;
  return i === s.length;
}

function checkExactValues(s: string, values: string[]): boolean {
  return values.includes(s);
}

function checkLnInvoice(s: string, prefix: string, minHrpLen: number): boolean {
  if (!s.startsWith(prefix)) return false;
  const sep = s.lastIndexOf('1');
  if (sep < 0) return false;
  const hrp = s.slice(0, sep);
  if (hrp.length < minHrpLen) return false;
  for (const c of hrp) {
    if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'))) return false;
  }
  const data = s.slice(sep + 1);
  if (data.length === 0) return false;
  for (const c of data) {
    if (BECH32_EXCLUDED.includes(c)) return false;
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'z'))) return false;
  }
  return true;
}

function checkPackageId(s: string): boolean {
  function isPkgChar(c: string): boolean {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '.' || c === '_' || c === '+' || c === '-';
  }
  if (s === '#') return true;
  if (s.length === 0) return false;
  if (!((s[0] >= 'a' && s[0] <= 'z') || (s[0] >= 'A' && s[0] <= 'Z') || (s[0] >= '0' && s[0] <= '9'))) return false;
  let i = 1;
  while (i < s.length && isPkgChar(s[i])) i++;
  while (i < s.length && s[i] === ':') {
    i++;
    if (i >= s.length) return false;
    if (!((s[i] >= 'a' && s[i] <= 'z') || (s[i] >= 'A' && s[i] <= 'Z') || (s[i] >= '0' && s[i] <= '9'))) return false;
    i++;
    while (i < s.length && isPkgChar(s[i])) i++;
  }
  return i === s.length;
}

// ============================================================================
// Charset helper (same as in classify-pattern.ts)
// ============================================================================

function expandCharset(rangeSpec: string): string {
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

// ============================================================================
// Tests
// ============================================================================

const hex64 = 'a'.repeat(64);

describe('metacharacter matrix: hex', () => {
  const regex64Lower = /^[a-f0-9]{64}$/;
  const regex64Mixed = /^[a-fA-F0-9]{64}$/;

  it('hex64 lower — standard adversarial inputs', () => {
    const inputs = [
      ...HEX_EDGE,
      ...EMPTY_AND_BOUNDS,
      ...ANCHOR_EDGE,
      ...LINE_TERMINATORS,
      // Op-specific
      hex64 + '\n',
      '\n' + hex64,
      hex64.slice(0, 63) + 'G',
      hex64.slice(0, 63) + ' ',
      '0'.repeat(64),
      'f'.repeat(64),
      '0123456789abcdef'.repeat(4),
    ];
    assertMatrix('hex64_lower', inputs, regex64Lower,
      (s) => checkHex(s, 64, true));
  });

  it('hex64 mixed — uppercase accepted', () => {
    const inputs = [
      ...HEX_EDGE,
      'A'.repeat(64),
      'F'.repeat(64),
      'aAbBcCdDeEfF'.repeat(5) + 'aAbB',
      hex64.slice(0, 63) + 'G',
    ];
    assertMatrix('hex64_mixed', inputs, regex64Mixed,
      (s) => checkHex(s, 64, false));
  });

  it('hex_range 7-40 — boundary lengths', () => {
    const regex = /^[a-f0-9]{7,40}$/;
    const inputs = [
      'a'.repeat(6), 'a'.repeat(7), 'a'.repeat(8),
      'a'.repeat(39), 'a'.repeat(40), 'a'.repeat(41),
      '', 'a', 'g'.repeat(10),
      ...LINE_TERMINATORS,
    ];
    assertMatrix('hex_range', inputs, regex,
      (s) => checkHexRange(s, 7, 40, true));
  });

  it('hex_prefixed 0x + 4 hex digits', () => {
    const regex = /^0x[0-9a-f]{4}$/;
    const inputs = [
      '0x0000', '0xffff', '0xabcd',
      '0x000', '0x00000', '0xGGGG', '0x', '', '0X0000',
      ...LINE_TERMINATORS.map(lt => '0x00' + lt + '00'),
    ];
    assertMatrix('hex_prefixed', inputs, regex,
      (s) => checkHexPrefixed(s, '0x', 4));
  });
});

describe('metacharacter matrix: all_digits', () => {
  const regexUnsigned = /^[0-9]+$/;
  const regexSigned = /^-?[0-9]+$/;

  it('unsigned digits — numeric edge cases', () => {
    const inputs = [
      ...NUMERIC_EDGE,
      ...EMPTY_AND_BOUNDS,
      ...LINE_TERMINATORS,
      ...ANCHOR_EDGE,
      '0', '00', '01', '001', '999999999',
      '-1', '+1', ' 1', '1 ', '1e5',
      '\t0', '0\t', '\n0', '0\n',
    ];
    assertMatrix('all_digits', inputs, regexUnsigned,
      (s) => checkAllDigits(s, false));
  });

  it('signed digits — negative allowed', () => {
    const inputs = [
      ...NUMERIC_EDGE,
      '-0', '-1', '-999', '--1', '-', '- 1',
      ...LINE_TERMINATORS,
    ];
    assertMatrix('all_digits_signed', inputs, regexSigned,
      (s) => checkAllDigits(s, true));
  });
});

describe('metacharacter matrix: starts_with_any', () => {
  const regex = /^(https?:\/\/).+$/;

  it('http/https prefix — line terminators in tail', () => {
    const inputs = [
      'http://example.com',
      'https://example.com',
      'http://',   // no tail
      'https://',  // no tail
      'ftp://example.com',
      '',
      // Line terminators in tail
      'http://example\n.com',
      'http://example\r.com',
      'http://example\u2028.com',
      'http://example\u2029.com',
      'http://example\u0085.com',  // NEL: valid in JS .
      // Anchoring
      'http://example.com\n',
      'https://x\n',
      'http://x\r\n',
      // Single char tail
      'http://x',
      'https://x',
      // Unicode in tail
      ...UNICODE_WHITESPACE.map(ws => 'http://example' + ws + '.com'),
    ];
    assertMatrix('starts_with_any', inputs, regex,
      (s) => checkStartsWithAny(s, ['http://', 'https://']));
  });

  it('ws/wss prefix', () => {
    const regex2 = /^(ws:\/\/|wss:\/\/).+$/;
    const inputs = [
      'ws://relay', 'wss://relay',
      'ws://', 'wss://',
      'http://relay',
      'wss://relay\n', 'ws://relay\r',
    ];
    assertMatrix('starts_with_any_ws', inputs, regex2,
      (s) => checkStartsWithAny(s, ['ws://', 'wss://']));
  });
});

describe('metacharacter matrix: chars_in', () => {
  const charset = expandCharset('a-z0-9._-');
  const regex = /^[a-z0-9._-]+$/;

  it('lowercase alnums + punctuation — boundary and invalid chars', () => {
    const inputs = [
      'abc', 'a.b-c', '0_9',
      '', 'A', 'a b', 'a\n', 'a\t',
      ...EMPTY_AND_BOUNDS.map(s => s.replace(/a/g, 'z')),
      ...LINE_TERMINATORS,
      ...UNICODE_WHITESPACE,
      // Boundary chars
      'a', 'z', '0', '9', '.', '_', '-',
      'A', 'Z', '!', '@', '/', ':',
    ];
    assertMatrix('chars_in', inputs, regex,
      (s) => checkCharsIn(s, charset, 1));
  });

  it('chars_in with length bounds {3,6}', () => {
    const letterCharset = expandCharset('A-Za-z');
    const regexBounds = /^[A-Za-z]{3,6}$/;
    const inputs = [
      'ab', 'abc', 'abcd', 'abcde', 'abcdef', 'abcdefg',
      '', 'a', 'AB', 'ABCDEFG', '123', 'abc1',
    ];
    assertMatrix('chars_in_bounds', inputs, regexBounds,
      (s) => checkCharsIn(s, letterCharset, 3, 6));
  });

  it('empty string pattern ^$', () => {
    const regexEmpty = /^$/;
    const inputs = ['', 'x', '\n', ' ', ...LINE_TERMINATORS];
    assertMatrix('chars_in_empty', inputs, regexEmpty,
      (s) => checkCharsIn(s, '', 0, 0));
  });
});

describe('metacharacter matrix: bech32', () => {
  it('npub — fixed-length bech32 data', () => {
    const regex = /^npub1[02-9ac-hj-np-z]{58}$/;
    const inputs = [
      ...BECH32_EDGE,
      ...LINE_TERMINATORS,
      ...EMPTY_AND_BOUNDS,
      // Charset boundary probes
      'npub1' + '0'.repeat(58),
      'npub1' + '2'.repeat(58),
      'npub1' + '9'.repeat(58),
      'npub1' + 'a'.repeat(58),
      'npub1' + 'c'.repeat(58),
      'npub1' + 'z'.repeat(58),
      'npub1' + 'h'.repeat(58),
      'npub1' + 'j'.repeat(58),
      'npub1' + 'n'.repeat(58),
      'npub1' + 'p'.repeat(58),
      // Excluded chars
      'npub1' + '1'.repeat(58),
      'npub1' + 'b'.repeat(58),
      'npub1' + 'i'.repeat(58),
      'npub1' + 'o'.repeat(58),
      // Uppercase
      'npub1' + 'A'.repeat(58),
      'NPUB1' + 'q'.repeat(58),
      // Trailing line terminators
      'npub1' + 'q'.repeat(57) + '\n',
      'npub1' + 'q'.repeat(57) + '\r',
    ];
    assertMatrix('bech32_npub', inputs, regex,
      (s) => checkBech32(s, 'npub', 58));
  });

  it('nprofile — variable-length bech32 data', () => {
    const regex = /^nprofile1[02-9ac-hj-np-z]+$/;
    const inputs = [
      'nprofile1' + 'q'.repeat(1),
      'nprofile1' + 'q'.repeat(10),
      'nprofile1' + 'q'.repeat(100),
      'nprofile1',  // no data
      'nprofile1' + '1'.repeat(10),
      'nprofile1' + 'b'.repeat(10),
      'nprofile1\n',
      '',
      ...LINE_TERMINATORS,
    ];
    assertMatrix('bech32_nprofile', inputs, regex,
      (s) => checkBech32(s, 'nprofile'));
  });
});

describe('metacharacter matrix: relay_url', () => {
  const regex = /^wss?:\/\/[a-zA-Z0-9._-]+(?::[0-9]+)?(?:\/.*)?$/;

  it('line terminators in path', () => {
    const inputs = LINE_TERMINATORS.map(lt => 'wss://relay.example.com/' + lt + 'path');
    assertMatrix('relay_url_lt_path', inputs, regex,
      checkRelayUrl);
  });

  it('line terminators at end of path', () => {
    const inputs = LINE_TERMINATORS.map(lt => 'wss://relay.example.com/path' + lt);
    assertMatrix('relay_url_lt_end', inputs, regex,
      checkRelayUrl);
  });

  it('unicode whitespace in path', () => {
    const inputs = UNICODE_WHITESPACE.map(ws => 'wss://relay.example.com/' + ws + 'path');
    assertMatrix('relay_url_ws_path', inputs, regex,
      checkRelayUrl);
  });

  it('standard adversarial set', () => {
    const inputs = [
      // Valid
      'wss://relay.example.com',
      'ws://relay.example.com',
      'wss://localhost',
      'wss://a',
      'wss://relay.example.com:8080',
      'wss://relay.example.com/',
      'wss://relay.example.com/path',
      'wss://relay.example.com:443/path/to',
      'ws://192.168.1.1',
      'wss://relay-test_01.nostr.com',
      'wss://relay.example.com/path with stuff',
      // Invalid
      '',
      'http://relay.example.com',
      'https://relay.example.com',
      'wss://',
      'ws://',
      'wss://relay.example.com:',
      'wss://relay.example.com:abc',
      'not a url',
      'wss',
      'WSS://RELAY.EXAMPLE.COM',
      'wss:///path',
      // Edge: port boundaries
      'wss://host:0',
      'wss://host:65535',
      'wss://host:999999',
      'wss://host:0/',
      // Edge: hostname chars
      'wss://host name',
      'wss://host\tname',
      'wss://host/\u2028path',
      'wss://host/\u2029path',
      'wss://host/\u0085path',  // NEL: valid in JS
      // Edge: anchoring
      ...ANCHOR_EDGE.map(a => 'wss://relay.example.com/' + a),
      ...LINE_TERMINATORS,
      ...EMPTY_AND_BOUNDS,
    ];
    assertMatrix('relay_url', inputs, regex,
      checkRelayUrl);
  });
});

describe('metacharacter matrix: a_tag', () => {
  const regex = /^\d+:[a-f0-9]{64}:.+$/;

  it('line terminators in d-identifier', () => {
    const inputs = LINE_TERMINATORS.map(lt => `1:${hex64}:slug${lt}rest`);
    assertMatrix('a_tag_lt', inputs, regex,
      (s) => checkATag(s));
  });

  it('standard adversarial set', () => {
    const inputs = [
      // Valid
      `1:${hex64}:d-id`,
      `30023:${hex64}:slug`,
      `0:${hex64}:x`,
      `1:${hex64}:hello world`,
      `1:${hex64}:\u0085id`,  // NEL: valid in JS
      // Leading zeros in kind
      `030311:${hex64}:slug`,
      `00042:${hex64}:test`,
      // Invalid
      '',
      'short',
      `:${hex64}:d-id`,
      `abc:${hex64}:d-id`,
      `1:${hex64}:`,
      `1:${hex64}:d\nid`,
      `1:${hex64}:d\rid`,
      `1:${hex64}:\u2028`,
      `1:${hex64}:\u2029`,
      `1:${'A'.repeat(64)}:d-id`,
      `1:${'a'.repeat(63)}:d-id`,
      `1:${'g'.repeat(64)}:d-id`,
      ...LINE_TERMINATORS,
      ...EMPTY_AND_BOUNDS,
    ];
    assertMatrix('a_tag', inputs, regex,
      (s) => checkATag(s));
  });

  it('single-kind filter with leading zeros', () => {
    const regexKind = /^30311:[a-f0-9]{64}:.+$/;
    const inputs = [
      `30311:${hex64}:test`,
      `030311:${hex64}:test`,
      `30312:${hex64}:test`,
      `30311:${hex64}:`,
      `30311:${hex64}:\n`,
    ];
    assertMatrix('a_tag_kind_30311', inputs, regexKind,
      (s) => checkATag(s, ['30311']));
  });
});

describe('metacharacter matrix: content_type', () => {
  const regex = new RegExp('^[a-zA-Z][a-zA-Z0-9!#$&^_-]*/[a-zA-Z0-9*][a-zA-Z0-9!#$&^_.+-]*(\\s*;\\s*[a-zA-Z0-9!#$&^_.+-]+=[a-zA-Z0-9!#$&^_.+-]+)*$');

  it('unicode whitespace around semicolons', () => {
    const inputs = UNICODE_WHITESPACE.map(ws => `text/plain${ws};${ws}charset=utf-8`);
    assertMatrix('content_type_ws', inputs, regex,
      checkContentType);
  });

  it('line terminators around semicolons', () => {
    const inputs = LINE_TERMINATORS.map(lt => `text/plain${lt};charset=utf-8`);
    assertMatrix('content_type_lt', inputs, regex,
      checkContentType);
  });

  it('trailing whitespace (should reject)', () => {
    const inputs = UNICODE_WHITESPACE.map(ws => `text/plain${ws}`);
    assertMatrix('content_type_trailing_ws', inputs, regex,
      checkContentType);
  });

  it('standard adversarial set', () => {
    const inputs = [
      'text/plain',
      'text/html',
      'application/json',
      'text/plain;charset=utf-8',
      'text/plain ; charset=utf-8',
      'text/plain;charset=utf-8;boundary=something',
      'text/*',
      'text/plain\u00A0;\u00A0charset=utf-8',
      'text/plain\n;charset=utf-8',
      '',
      'text/',
      'textplain',
      'text/plain ',
      'text/plain\t',
      'text/plain\u00A0',
      '1text/plain',
      'text/plain;',
      'text/plain;charset',
      'text/plain;charset=',
      'text/plain;=utf-8',
      ...LINE_TERMINATORS,
      ...EMPTY_AND_BOUNDS,
    ];
    assertMatrix('content_type', inputs, regex,
      checkContentType);
  });
});

describe('metacharacter matrix: external_identity', () => {
  // NOTE: The schema pattern ^[a-z0-9._\-/]+:.+ is UN-anchored at the end.
  // For validator purposes, the generated code checks full strings, so we test
  // with the $ anchor to match the native reference (full-string check).
  const regex = /^[a-z0-9._\-/]+:.+$/;

  it('line terminators in value', () => {
    const inputs = LINE_TERMINATORS.map(lt => `github:user${lt}rest`);
    assertMatrix('external_identity_lt', inputs, regex,
      checkExternalIdentity);
  });

  it('standard adversarial set', () => {
    const inputs = [
      'github:user',
      'twitter:handle',
      'dns/example.com:proof',
      'a.b-c/d:value',
      '',
      'github',
      'github:',
      'GitHub:user',
      'git hub:user',
      'github:\nuser',
      'github:\ruser',
      'github:\u2028user',
      'github:\u2029user',
      'github:\u0085user',  // NEL: valid in JS
      'github:user\nrest',
      'github:user\rrest',
      ...LINE_TERMINATORS,
      ...EMPTY_AND_BOUNDS,
    ];
    assertMatrix('external_identity', inputs, regex,
      checkExternalIdentity);
  });
});

describe('metacharacter matrix: annotate_user', () => {
  const regex = /^annotate-user [a-f0-9]{64}:[0-9]+(?:\.[0-9]+)?:[0-9]+(?:\.[0-9]+)?$/;

  it('standard adversarial set', () => {
    const inputs = [
      // Valid
      `annotate-user ${hex64}:10:20`,
      `annotate-user ${hex64}:10.5:20.3`,
      `annotate-user ${hex64}:0:0`,
      `annotate-user ${hex64}:0.0:0.0`,
      `annotate-user ${hex64}:999:999.999`,
      // Trailing dot (no digits after)
      `annotate-user ${hex64}:0.:0`,
      `annotate-user ${hex64}:0:0.`,
      // Missing parts
      '',
      `annotate-user ${hex64}:0`,
      `annotate-user ${hex64}`,
      `annotate-user ${'a'.repeat(63)}:0:0`,
      `annotate-user ${'A'.repeat(64)}:0:0`,
      // Wrong prefix
      `annotate_user ${hex64}:0:0`,
      `annotate ${hex64}:0:0`,
      // Leading zeros in coordinates
      `annotate-user ${hex64}:00:00`,
      `annotate-user ${hex64}:01:02`,
      `annotate-user ${hex64}:00.00:00.00`,
      // Line terminators
      ...LINE_TERMINATORS.map(lt => `annotate-user ${hex64}:0${lt}:0`),
      ...LINE_TERMINATORS,
      ...EMPTY_AND_BOUNDS,
    ];
    assertMatrix('annotate_user', inputs, regex,
      checkAnnotateUser);
  });
});

describe('metacharacter matrix: decimal', () => {
  const regex = /^\d+(?:\.\d+)?$/;

  it('standard adversarial set', () => {
    const inputs = [
      ...NUMERIC_EDGE,
      '0', '1', '123', '0.0', '1.0', '1.23', '123.456',
      '.5', '1.', '', 'a', '1.2.3', '1e5', '-1', '+1',
      ' 1', '1 ', '00', '01', '001',
      '0.', '.0', '..', '1..2',
      ...LINE_TERMINATORS,
      ...ANCHOR_EDGE,
    ];
    assertMatrix('decimal', inputs, regex,
      checkDecimal);
  });
});

describe('metacharacter matrix: date_iso', () => {
  const regex = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

  it('standard adversarial set', () => {
    const inputs = [
      '2024-01-15', '0000-00-00', '9999-12-31',
      '', '2024-1-15', '2024-01-1', '2024-01-15T',
      '2024/01/15', '20240115', '24-01-15',
      '2024-01-15\n', '\n2024-01-15',
      ...LINE_TERMINATORS,
      ...EMPTY_AND_BOUNDS,
    ];
    assertMatrix('date_iso', inputs, regex,
      checkDateIso);
  });
});

describe('metacharacter matrix: datetime_iso', () => {
  const regex = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;

  it('standard adversarial set', () => {
    const inputs = [
      // Valid
      '2024-01-15',
      '2024-01-15T10:30',
      '2024-01-15T10:30:45',
      '2024-01-15T10:30:45.123',
      '2024-01-15T10:30Z',
      '2024-01-15T10:30:45Z',
      '2024-01-15T10:30:45.123Z',
      '2024-01-15T10:30+05:30',
      '2024-01-15T10:30:45-08:00',
      '2024-01-15T10:30:45.9+00:00',
      '2024-01-15T10:30:45.123456789Z',
      // Invalid
      '',
      '2024-01-1',
      '20X4-01-15',
      '2024/01/15',
      '2024-01-15T',
      '2024-01-15T10',
      '2024-01-15T10:3',
      '2024-01-15X',
      '2024-01-15T10:30:4',
      '2024-01-15T10:30:45.',
      '2024-01-15T10:30+05',
      '2024-01-15T10:30+0530',
      '2024-01-15T10:30Zx',
      '2024-01-15T10:30:45.Z',
      '2024-01-15T10:30:45+25:00',
      // Anchoring
      '2024-01-15\n',
      '\n2024-01-15',
      ...LINE_TERMINATORS,
    ];
    assertMatrix('datetime_iso', inputs, regex,
      checkDatetimeIso);
  });
});

describe('metacharacter matrix: prefix_nonempty', () => {
  const regex = /^alt .+$/;

  it('line terminators in tail', () => {
    const inputs = LINE_TERMINATORS.map(lt => `alt ${lt}content`);
    assertMatrix('prefix_nonempty_lt', inputs, regex,
      (s) => checkPrefixNonempty(s, 'alt '));
  });

  it('standard adversarial set', () => {
    const inputs = [
      'alt hello',
      'alt x',
      'alt !@#$%',
      'alt \u0085x',  // NEL: valid in JS
      'alt ',   // prefix only
      '',
      'foo bar',
      'alt hel\nlo',
      'alt hel\rlo',
      'alt hel\u2028lo',
      'alt hel\u2029lo',
      'alt \n',
      'alt \r',
      ...LINE_TERMINATORS,
      ...EMPTY_AND_BOUNDS,
    ];
    assertMatrix('prefix_nonempty', inputs, regex,
      (s) => checkPrefixNonempty(s, 'alt '));
  });
});

describe('metacharacter matrix: wrapped', () => {
  const pfx = '-----BEGIN PGP SIGNATURE-----';
  const sfx = '-----END PGP SIGNATURE-----';
  const regex = /^-----BEGIN PGP SIGNATURE-----[\s\S]*-----END PGP SIGNATURE-----$/;

  it('standard adversarial set', () => {
    const inputs = [
      pfx + sfx,
      pfx + '\ndata\n' + sfx,
      pfx + '\r\ndata\r\n' + sfx,
      pfx + '\u0085' + sfx,
      pfx + '\u2028' + sfx,
      pfx + ' '.repeat(1000) + sfx,
      '',
      pfx,
      sfx,
      'XXX' + sfx,
      pfx + 'XXX',
      ...LINE_TERMINATORS,
      ...EMPTY_AND_BOUNDS,
    ];
    assertMatrix('wrapped', inputs, regex,
      (s) => checkWrapped(s, pfx, sfx));
  });
});

describe('metacharacter matrix: csv_list', () => {
  const idChars = expandCharset('A-Za-z0-9_');
  const digitChars = expandCharset('0-9');
  const regexId = /^[A-Za-z0-9_]+(,[A-Za-z0-9_]+)*$/;
  const regexDigit = /^[0-9]+(,[0-9]+)*$/;

  it('ID charset — standard adversarial set', () => {
    const inputs = [
      'a', 'a,b', 'abc_123,DEF', 'A,B,C',
      '', ',', 'a,', ',a', 'a,,b', 'a b', 'a, b',
      'a\n', 'a,b\n', '\na,b',
      ...LINE_TERMINATORS,
      ...EMPTY_AND_BOUNDS,
    ];
    assertMatrix('csv_list_id', inputs, regexId,
      (s) => checkCsvList(s, idChars));
  });

  it('digit charset', () => {
    const inputs = [
      '1', '1,2,3', '42', '0,0', '123,456',
      '', ',', '1,', ',1', '1,,2', '1 2', 'a',
    ];
    assertMatrix('csv_list_digit', inputs, regexDigit,
      (s) => checkCsvList(s, digitChars));
  });
});

describe('metacharacter matrix: mime_type', () => {
  const regex = /^[a-z]+\/[a-z0-9.+-]+$/;

  it('standard adversarial set', () => {
    const inputs = [
      'image/png', 'text/html', 'application/json',
      'application/octet-stream', 'text/vnd.abc+xml',
      'audio/ogg', 'a/1',
      '', 'image', 'Image/png', 'image/', '/png',
      'text/PLAIN', 'text/ plain', 'text/plain ',
      '1/2',  // starts with digit
      ...LINE_TERMINATORS,
      ...EMPTY_AND_BOUNDS,
    ];
    assertMatrix('mime_type', inputs, regex,
      checkMimeType);
  });
});

describe('metacharacter matrix: http_origin', () => {
  const regex = /^https?:\/\/[^/]+\/?$/;

  it('standard adversarial set', () => {
    const inputs = [
      'http://example.com', 'https://example.com',
      'https://example.com/', 'https://localhost:8080',
      'https://localhost:8080/', 'https://a',
      '', 'https://example.com/path', 'ws://example.com',
      'https://', 'https://example.com//',
      'http://example.com\n', 'http://example.com\r',
      'http://\nexample.com',
      ...LINE_TERMINATORS,
      ...EMPTY_AND_BOUNDS,
    ];
    assertMatrix('http_origin', inputs, regex,
      checkHttpOrigin);
  });
});

describe('metacharacter matrix: email_like', () => {
  const regex = /^[^\s@]+@[^\s@]+$/;

  it('ECMAScript whitespace in local/domain', () => {
    const inputs = [
      // Whitespace in local part
      ...UNICODE_WHITESPACE.map(ws => `user${ws}name@domain`),
      // Whitespace in domain
      ...UNICODE_WHITESPACE.map(ws => `user@domain${ws}name`),
    ];
    assertMatrix('email_like_ws', inputs, regex,
      checkEmailLike);
  });

  it('standard adversarial set', () => {
    const inputs = [
      'user@domain', 'a@b', 'user+tag@example.com',
      '', 'user', '@domain', 'user@', 'us er@domain',
      'user@@domain', 'user@domain@extra',
      '@', '@@', 'user\n@domain', 'user@\ndomain',
      'user\t@domain', 'user@domain\t',
      ...LINE_TERMINATORS,
      ...EMPTY_AND_BOUNDS,
    ];
    assertMatrix('email_like', inputs, regex,
      checkEmailLike);
  });
});

describe('metacharacter matrix: doi', () => {
  const regex = /^10\.\d{4,9}\/.+$/;

  it('line terminators in suffix', () => {
    const inputs = LINE_TERMINATORS.map(lt => `10.1000/${lt}test`);
    assertMatrix('doi_lt', inputs, regex,
      checkDoi);
  });

  it('standard adversarial set', () => {
    const inputs = [
      '10.1000/test', '10.12345/abc.def', '10.123456789/x',
      '', '11.1000/test', '10.123/test', '10.1234567890/test',
      '10.1234', '10.1234/',
      '10.1234/\n', '10.1234/\r', '10.1234/\u0085',
      '10.1234/x\ny', '10.1234/x\ry',
      ...LINE_TERMINATORS,
      ...EMPTY_AND_BOUNDS,
    ];
    assertMatrix('doi', inputs, regex,
      checkDoi);
  });
});

describe('metacharacter matrix: prefix_no_whitespace', () => {
  const regex = /^url https?:\/\/\S+$/;

  it('ECMAScript whitespace in URL tail', () => {
    const inputs = UNICODE_WHITESPACE.map(ws => `url http://example${ws}com`);
    assertMatrix('prefix_no_ws_tail', inputs, regex,
      (s) => checkPrefixNoWhitespace(s, ['url http://', 'url https://']));
  });

  it('standard adversarial set', () => {
    const inputs = [
      'url http://example.com', 'url https://example.com',
      'url http://', 'url https://',
      'url http://example .com', 'url http://\texample',
      'url http://\u00A0example', 'url http://\uFEFFexample',
      '', 'url ftp://example.com',
      'url http://x', 'url https://x',
      ...LINE_TERMINATORS,
      ...EMPTY_AND_BOUNDS,
    ];
    assertMatrix('prefix_no_whitespace', inputs, regex,
      (s) => checkPrefixNoWhitespace(s, ['url http://', 'url https://']));
  });
});

describe('metacharacter matrix: git_clone_url', () => {
  const regex = /^(([a-z][a-z0-9+\.-]*:\/\/)|git@)[^\s]+$/;

  it('ECMAScript whitespace in URL', () => {
    const inputs = UNICODE_WHITESPACE.map(ws => `https://example${ws}com`);
    assertMatrix('git_clone_url_ws', inputs, regex,
      checkGitCloneUrl);
  });

  it('standard adversarial set', () => {
    const inputs = [
      'https://github.com/user/repo.git',
      'git@github.com:user/repo.git',
      'ssh://git@example.com/repo',
      'http://example.com/repo',
      '', 'https://', 'git@',
      'https://\u00A0example.com',
      'https://example.com',
      'git@github.com:x',
      'GIT@github.com:x',  // uppercase
      'ftp+ssh://example.com/repo',
      ...LINE_TERMINATORS,
      ...EMPTY_AND_BOUNDS,
    ];
    assertMatrix('git_clone_url', inputs, regex,
      checkGitCloneUrl);
  });
});

describe('metacharacter matrix: exact_values', () => {
  const regex = /^(38172|38173)$/;

  it('standard adversarial set', () => {
    const inputs = [
      '38172', '38173',
      '', '38174', '3817', '381720', '038172',
      '38172\n', '\n38172', '38172 ', ' 38172',
      ...LINE_TERMINATORS,
      ...EMPTY_AND_BOUNDS,
      ...NUMERIC_EDGE,
    ];
    assertMatrix('exact_values', inputs, regex,
      (s) => checkExactValues(s, ['38172', '38173']));
  });
});

describe('metacharacter matrix: ln_invoice', () => {
  const regexBolt11 = /^lnbc[a-z0-9]*1[02-9ac-hj-np-z]+$/;

  it('bech32 charset boundary — excluded chars in data', () => {
    const inputs = [
      'lnbc1' + 'q'.repeat(10),
      'lnbc1' + '1'.repeat(10),  // '1' excluded from data
      'lnbc1' + 'b'.repeat(10),  // 'b' excluded
      'lnbc1' + 'i'.repeat(10),  // 'i' excluded
      'lnbc1' + 'o'.repeat(10),  // 'o' excluded
      'lnbc1',  // empty data
      'lnbc500n1qqqqq',
      'lnbc1Q',  // uppercase in data
      '',
      'btc1qqqq',
      ...LINE_TERMINATORS,
    ];
    assertMatrix('ln_invoice', inputs, regexBolt11,
      (s) => checkLnInvoice(s, 'lnbc', 4));
  });
});

describe('metacharacter matrix: package_id', () => {
  const regex = /^(#|[A-Za-z0-9][A-Za-z0-9._+-]*(?::[A-Za-z0-9][A-Za-z0-9._+-]*)*)$/;

  it('standard adversarial set', () => {
    const inputs = [
      '#', 'mypackage', 'com.example.pkg', 'group:artifact',
      'a:b:c', 'pkg-1.0+beta_2', 'A', '0',
      '', 'a:', 'a::b', '.pkg', 'a b',
      '#pkg', '##',  // '#' followed by more
      ':a', 'a:',
      ...LINE_TERMINATORS,
      ...EMPTY_AND_BOUNDS,
    ];
    assertMatrix('package_id', inputs, regex,
      checkPackageId);
  });
});

describe('metacharacter matrix: imeta_dim', () => {
  const regex = /^dim [0-9]{1,5}x[0-9]{1,5}$/;

  it('standard adversarial set', () => {
    const inputs = [
      'dim 100x200', 'dim 1x1', 'dim 99999x99999', 'dim 0x0',
      '', '100x200', 'dim 100200', 'dim x200', 'dim 123456x200',
      'dim 100x200px', 'dim 100x', 'dim x100',
      'dim 0x0\n', 'dim 100x200\n',
      'dim 00000x00000',  // 5 digits, leading zeros OK
      'dim 000000x1',  // 6 digits
      ...LINE_TERMINATORS,
      ...EMPTY_AND_BOUNDS,
    ];
    assertMatrix('imeta_dim', inputs, regex,
      checkImetaDim);
  });
});

// ============================================================================
// Cross-cutting: $ anchor edge cases
// ============================================================================

describe('metacharacter matrix: anchor edge cases', () => {
  it('$ anchor with trailing newline — anchored patterns', () => {
    // In JS, $ in a non-multiline regex does NOT match before a trailing \n.
    // (Unlike some other engines.) Verify our native impls agree.
    const patterns: Array<{ name: string; regex: RegExp; native: (s: string) => boolean; validBase: string }> = [
      { name: 'hex64', regex: /^[a-f0-9]{64}$/, native: (s) => checkHex(s, 64, true), validBase: hex64 },
      { name: 'all_digits', regex: /^[0-9]+$/, native: (s) => checkAllDigits(s, false), validBase: '12345' },
      { name: 'date_iso', regex: /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, native: checkDateIso, validBase: '2024-01-15' },
      { name: 'bech32', regex: /^npub1[02-9ac-hj-np-z]{58}$/, native: (s) => checkBech32(s, 'npub', 58), validBase: 'npub1' + 'q'.repeat(58) },
    ];

    for (const { name, regex, native, validBase } of patterns) {
      // Base should match
      assert.strictEqual(native(validBase), regex.test(validBase),
        `Base mismatch for ${name}`);
      // Trailing \n should NOT match
      const withNewline = validBase + '\n';
      assert.strictEqual(native(withNewline), regex.test(withNewline),
        `Trailing \\n mismatch for ${name}: native=${native(withNewline)}, regex=${regex.test(withNewline)}`);
      // Trailing \r should NOT match
      const withCr = validBase + '\r';
      assert.strictEqual(native(withCr), regex.test(withCr),
        `Trailing \\r mismatch for ${name}: native=${native(withCr)}, regex=${regex.test(withCr)}`);
    }
  });
});

// ============================================================================
// Cross-cutting: NEL (U+0085) behavior
// ============================================================================

describe('metacharacter matrix: NEL (U+0085) consistency', () => {
  it('JS regex . matches NEL — ops using .+ should accept it', () => {
    // In JavaScript, regex `.` does NOT exclude U+0085 (NEL).
    // Only \n, \r, \u2028, \u2029 are JS LineTerminators.
    // Native reference implementations must agree.
    const dotPlusPatterns: Array<{ name: string; regex: RegExp; native: (s: string) => boolean; inputWithNel: string }> = [
      {
        name: 'relay_url_path',
        regex: /^wss?:\/\/[a-zA-Z0-9._-]+(?::[0-9]+)?(?:\/.*)?$/,
        native: checkRelayUrl,
        inputWithNel: 'wss://host/\u0085path',
      },
      {
        name: 'a_tag_dident',
        regex: /^\d+:[a-f0-9]{64}:.+$/,
        native: (s) => checkATag(s),
        inputWithNel: `1:${hex64}:\u0085`,
      },
      {
        name: 'external_identity',
        regex: /^[a-z0-9._\-/]+:.+$/,
        native: checkExternalIdentity,
        inputWithNel: 'github:\u0085user',
      },
      {
        name: 'prefix_nonempty',
        regex: /^alt .+$/,
        native: (s) => checkPrefixNonempty(s, 'alt '),
        inputWithNel: 'alt \u0085',
      },
      {
        name: 'doi_suffix',
        regex: /^10\.\d{4,9}\/.+$/,
        native: checkDoi,
        inputWithNel: '10.1234/\u0085',
      },
    ];

    for (const { name, regex, native, inputWithNel } of dotPlusPatterns) {
      const regexResult = regex.test(inputWithNel);
      const nativeResult = native(inputWithNel);
      assert.strictEqual(nativeResult, regexResult,
        `NEL mismatch for ${name}: native=${nativeResult}, regex=${regexResult}, input=${JSON.stringify(inputWithNel)}`);
    }
  });
});

// ============================================================================
// Cross-cutting: ECMAScript \s coverage
// ============================================================================

describe('metacharacter matrix: ECMAScript \\s coverage', () => {
  it('all 23 ECMAScript \\s codepoints are rejected by \\S ops', () => {
    // Ops that use \S (non-whitespace) must reject ALL ECMAScript \s chars.
    // The full set: 0x09-0x0D, 0x20, 0xA0, 0x1680, 0x2000-0x200A,
    // 0x2028-0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF
    const ecmaWsCodepoints = [
      0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20,
      0xA0, 0x1680,
      0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200A,
      0x2028, 0x2029, 0x202F, 0x205F,
      0x3000, 0xFEFF,
    ];

    // email_like: [^\s@] should reject all \s chars in local part
    const emailRegex = /^[^\s@]+@[^\s@]+$/;
    for (const cp of ecmaWsCodepoints) {
      const ws = String.fromCodePoint(cp);
      const input = `user${ws}name@domain`;
      assert.strictEqual(
        checkEmailLike(input),
        emailRegex.test(input),
        `email_like \\s mismatch for U+${cp.toString(16).padStart(4, '0').toUpperCase()}`
      );
    }

    // prefix_no_whitespace: \S+ tail must reject all \s chars
    const urlRegex = /^url https?:\/\/\S+$/;
    for (const cp of ecmaWsCodepoints) {
      const ws = String.fromCodePoint(cp);
      const input = `url http://example${ws}com`;
      assert.strictEqual(
        checkPrefixNoWhitespace(input, ['url http://', 'url https://']),
        urlRegex.test(input),
        `prefix_no_ws \\s mismatch for U+${cp.toString(16).padStart(4, '0').toUpperCase()}`
      );
    }

    // git_clone_url: [^\s]+ tail must reject all \s chars
    const gitRegex = /^(([a-z][a-z0-9+\.-]*:\/\/)|git@)[^\s]+$/;
    for (const cp of ecmaWsCodepoints) {
      const ws = String.fromCodePoint(cp);
      const input = `https://example${ws}com`;
      assert.strictEqual(
        checkGitCloneUrl(input),
        gitRegex.test(input),
        `git_clone_url \\s mismatch for U+${cp.toString(16).padStart(4, '0').toUpperCase()}`
      );
    }
  });

  it('all 23 ECMAScript \\s codepoints are accepted by \\s ops in content_type', () => {
    const ecmaWsCodepoints = [
      0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20,
      0xA0, 0x1680,
      0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200A,
      0x2028, 0x2029, 0x202F, 0x205F,
      0x3000, 0xFEFF,
    ];

    const ctRegex = new RegExp('^[a-zA-Z][a-zA-Z0-9!#$&^_-]*/[a-zA-Z0-9*][a-zA-Z0-9!#$&^_.+-]*(\\s*;\\s*[a-zA-Z0-9!#$&^_.+-]+=[a-zA-Z0-9!#$&^_.+-]+)*$');
    for (const cp of ecmaWsCodepoints) {
      const ws = String.fromCodePoint(cp);
      const input = `text/plain${ws};${ws}charset=utf-8`;
      assert.strictEqual(
        checkContentType(input),
        ctRegex.test(input),
        `content_type \\s accept mismatch for U+${cp.toString(16).padStart(4, '0').toUpperCase()}`
      );
    }
  });
});
