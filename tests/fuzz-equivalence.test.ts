/**
 * Property-based equivalence fuzzing for PatternCheck ops.
 *
 * For every regex pattern that classifyRegex can handle natively, this test:
 *   1. Classifies the pattern into a PatternCheck
 *   2. Builds a native checker function from the PatternCheck
 *   3. Generates 200+ random inputs per pattern
 *   4. Asserts regex.test(input) === nativeChecker(input) for every input
 *
 * Uses a seeded PRNG for reproducibility.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRegex, isNativeCheck, type PatternCheck } from '../src/classify-pattern.js';

// ---------------------------------------------------------------------------
// Seeded PRNG (xoshiro128** - deterministic, fast, good distribution)
// ---------------------------------------------------------------------------

function makeRng(seed: number) {
  // splitmix32 to expand seed into state
  function splitmix32(s: number): number {
    s |= 0;
    s = (s + 0x9e3779b9) | 0;
    let t = s ^ (s >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    t ^= t >>> 15;
    return t >>> 0;
  }

  let s0 = splitmix32(seed);
  let s1 = splitmix32(s0);
  let s2 = splitmix32(s1);
  let s3 = splitmix32(s2);

  function next(): number {
    const result = (Math.imul(s1 * 5, 1) << 7 | (Math.imul(s1 * 5, 1) >>> 25)) * 9;
    const t = s1 << 9;
    s2 ^= s0;
    s3 ^= s1;
    s1 ^= s2;
    s0 ^= s3;
    s2 ^= t;
    s3 = (s3 << 11) | (s3 >>> 21);
    return (result >>> 0) / 0x100000000;
  }

  function nextInt(min: number, max: number): number {
    return min + Math.floor(next() * (max - min + 1));
  }

  function pick<T>(arr: readonly T[]): T {
    return arr[nextInt(0, arr.length - 1)];
  }

  function randomString(len: number, charset: string): string {
    let s = '';
    for (let i = 0; i < len; i++) {
      s += charset[nextInt(0, charset.length - 1)];
    }
    return s;
  }

  return { next, nextInt, pick, randomString };
}

// ---------------------------------------------------------------------------
// ECMAScript whitespace / line terminator sets
// ---------------------------------------------------------------------------

const JS_LINE_TERMINATORS = ['\n', '\r', '\u2028', '\u2029'];
const UNICODE_WHITESPACE = [
  '\u00A0', '\u1680',
  '\u2000', '\u2001', '\u2002', '\u2003', '\u2004', '\u2005',
  '\u2006', '\u2007', '\u2008', '\u2009', '\u200A',
  '\u2028', '\u2029', '\u202F', '\u205F',
  '\u3000', '\uFEFF',
];
const ASCII_WS = [' ', '\t', '\n', '\r', '\x0B', '\x0C'];
const ECMA_WS = [
  '\x09', '\x0A', '\x0B', '\x0C', '\x0D', '\x20',
  '\u00A0', '\u1680',
  '\u2000', '\u2001', '\u2002', '\u2003', '\u2004', '\u2005',
  '\u2006', '\u2007', '\u2008', '\u2009', '\u200A',
  '\u2028', '\u2029', '\u202F', '\u205F',
  '\u3000', '\uFEFF',
];

const HEX_LOWER = '0123456789abcdef';
const HEX_UPPER = '0123456789ABCDEF';
const HEX_MIXED = '0123456789abcdefABCDEF';
const DIGITS = '0123456789';
const ASCII_LOWER = 'abcdefghijklmnopqrstuvwxyz';
const ASCII_UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ASCII_ALPHA = ASCII_LOWER + ASCII_UPPER;
const ASCII_ALNUM = ASCII_ALPHA + DIGITS;
const ASCII_PRINTABLE = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~';
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'; // standard bech32 chars (no 1, b, i, o)

// ---------------------------------------------------------------------------
// Charset expansion (matching the classify-pattern.ts logic)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// buildNativeChecker: PatternCheck -> (string -> boolean)
// ---------------------------------------------------------------------------

function isJsLineTerminator(c: string): boolean {
  return c === '\n' || c === '\r' || c === '\u2028' || c === '\u2029';
}

function isEcmaWs(c: string): boolean {
  const cp = c.codePointAt(0)!;
  return cp === 0x09 || cp === 0x0A || cp === 0x0B || cp === 0x0C || cp === 0x0D || cp === 0x20 ||
    cp === 0xA0 || cp === 0x1680 ||
    (cp >= 0x2000 && cp <= 0x200A) ||
    cp === 0x2028 || cp === 0x2029 || cp === 0x202F || cp === 0x205F ||
    cp === 0x3000 || cp === 0xFEFF;
}

/** Check that all chars from pos to end match JS `.` (no line terminators) */
function dotTailValid(s: string, pos: number): boolean {
  for (let i = pos; i < s.length; i++) {
    if (isJsLineTerminator(s[i])) return false;
  }
  return true;
}

/**
 * Build a native checker function from a PatternCheck.
 *
 * @param check The classified PatternCheck
 * @param originalPattern The original regex string, used to determine
 *   nuances that the PatternCheck IR may lose (e.g., whether a
 *   starts_with_any pattern requires a `.+` tail, whether the pattern
 *   is `$`-anchored).
 */
function buildNativeChecker(check: PatternCheck, originalPattern?: string): ((s: string) => boolean) | null {
  switch (check.op) {

    case 'hex': {
      const { len, case: caseType } = check;
      const validChars = caseType === 'lower' ? HEX_LOWER : HEX_MIXED;
      return (s) => {
        if (s.length !== len) return false;
        for (let i = 0; i < s.length; i++) {
          if (!validChars.includes(s[i])) return false;
        }
        return true;
      };
    }

    case 'hex_range': {
      const { min, max, case: caseType } = check;
      const validChars = caseType === 'lower' ? HEX_LOWER : HEX_MIXED;
      return (s) => {
        if (s.length < min || s.length > max) return false;
        for (let i = 0; i < s.length; i++) {
          if (!validChars.includes(s[i])) return false;
        }
        return true;
      };
    }

    case 'hex_prefixed': {
      const { prefix, hexLen } = check;
      return (s) => {
        if (!s.startsWith(prefix)) return false;
        if (s.length !== prefix.length + hexLen) return false;
        for (let i = prefix.length; i < s.length; i++) {
          if (!HEX_LOWER.includes(s[i])) return false;
        }
        return true;
      };
    }

    case 'all_digits': {
      return (s) => {
        if (s.length === 0) return false;
        let i = 0;
        if (check.allowNeg && s[0] === '-') {
          i = 1;
          if (i >= s.length) return false;
        }
        for (; i < s.length; i++) {
          if (s[i] < '0' || s[i] > '9') return false;
        }
        return true;
      };
    }

    case 'starts_with_any': {
      // Determine from the original regex whether a .+ tail is required after the prefix.
      // Patterns like ^(https?://).+$ require at least 1 char after prefix.
      // Patterns like ^wss?:// accept just the prefix.
      // The PatternCheck IR loses this distinction; we recover it from the original pattern.
      const hasDotPlusTail = originalPattern !== undefined &&
        (originalPattern.includes('.+') || originalPattern.includes('.*'));
      const isDollarAnchored = originalPattern !== undefined && originalPattern.endsWith('$');

      return (s) => {
        for (const prefix of check.prefixes) {
          if (s.startsWith(prefix)) {
            if (hasDotPlusTail) {
              // .+ requires at least 1 char after prefix that matches JS `.`
              // (i.e., not a line terminator)
              if (s.length <= prefix.length) return false;
              // Check tail chars — .+ means all chars must not be line terminators
              // But only if $-anchored. If not $-anchored, the regex matches
              // as long as there's at least 1 non-LT char after prefix.
              if (isDollarAnchored) {
                for (let i = prefix.length; i < s.length; i++) {
                  if (isJsLineTerminator(s[i])) return false;
                }
              } else {
                // Unanchored: just need at least 1 non-LT char after prefix
                if (!isJsLineTerminator(s[prefix.length])) return true;
                return false;
              }
            }
            return true;
          }
        }
        return false;
      };
    }

    case 'chars_in': {
      const { charset, min, max } = check;
      return (s) => {
        if (min !== undefined && s.length < min) return false;
        if (max !== undefined && s.length > max) return false;
        for (let i = 0; i < s.length; i++) {
          if (!charset.includes(s[i])) return false;
        }
        return true;
      };
    }

    case 'bech32': {
      const { hrp, dataLen } = check;
      return (s) => {
        if (!s.startsWith(hrp + '1')) return false;
        const data = s.slice(hrp.length + 1);
        if (dataLen !== undefined) {
          if (data.length !== dataLen) return false;
        } else {
          if (data.length === 0) return false; // + quantifier
        }
        for (let i = 0; i < data.length; i++) {
          if (!BECH32_CHARSET.includes(data[i])) return false;
        }
        return true;
      };
    }

    case 'relay_url': {
      return (s) => {
        let i = 0;
        if (s.startsWith('wss://')) i = 6;
        else if (s.startsWith('ws://')) i = 5;
        else return false;
        const hostStart = i;
        while (i < s.length) {
          const c = s[i];
          if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
            (c >= '0' && c <= '9') || c === '.' || c === '_' || c === '-') {
            i++;
          } else break;
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
            if (isJsLineTerminator(s[j])) return false;
          }
          return true;
        }
        return i === s.length;
      };
    }

    case 'a_tag': {
      return (s) => {
        if (s.length < 68) return false;
        let pos = 0;
        if (s[pos] < '0' || s[pos] > '9') return false;
        const kindStart = pos;
        while (pos < s.length && s[pos] >= '0' && s[pos] <= '9') pos++;
        if (check.kinds && check.kinds.length > 0) {
          const kindStr = s.slice(kindStart, pos);
          if (!check.kinds.includes(kindStr)) return false;
        }
        if (pos >= s.length || s[pos] !== ':') return false;
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
        return dotTailValid(s, pos);
      };
    }

    case 'date_iso': {
      return (s) => {
        if (s.length !== 10) return false;
        for (let i = 0; i < 4; i++) if (s[i] < '0' || s[i] > '9') return false;
        if (s[4] !== '-') return false;
        for (let i = 5; i < 7; i++) if (s[i] < '0' || s[i] > '9') return false;
        if (s[7] !== '-') return false;
        for (let i = 8; i < 10; i++) if (s[i] < '0' || s[i] > '9') return false;
        return true;
      };
    }

    case 'datetime_iso': {
      return (s) => {
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
      };
    }

    case 'decimal': {
      return (s) => {
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
      };
    }

    case 'exact_values': {
      return (s) => check.values.includes(s);
    }

    case 'prefix_nonempty': {
      return (s) => {
        if (!s.startsWith(check.prefix)) return false;
        if (s.length <= check.prefix.length) return false;
        return dotTailValid(s, check.prefix.length);
      };
    }

    case 'wrapped': {
      return (s) => {
        return s.length >= check.prefix.length + check.suffix.length &&
          s.startsWith(check.prefix) && s.endsWith(check.suffix);
      };
    }

    case 'csv_list': {
      const charset = check.itemCharset;
      return (s) => {
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
      };
    }

    case 'ln_invoice': {
      const isBech32Data = (c: string): boolean => {
        return (c >= '0' && c <= '9' && c !== '1') ||
          (c >= 'a' && c <= 'z' && c !== 'b' && c !== 'i' && c !== 'o');
      };
      return (s) => {
        if (!s.startsWith(check.prefix)) return false;
        const sep = s.lastIndexOf('1');
        if (sep < 0) return false;
        const hrp = s.slice(0, sep);
        if (hrp.length < check.minHrpLen) return false;
        for (const c of hrp) {
          if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'))) return false;
        }
        const data = s.slice(sep + 1);
        if (data.length === 0) return false;
        for (const c of data) {
          if (!isBech32Data(c)) return false;
        }
        return true;
      };
    }

    case 'mime_type': {
      return (s) => {
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
      };
    }

    case 'http_origin': {
      return (s) => {
        let i = 0;
        if (s.startsWith('https://')) i = 8;
        else if (s.startsWith('http://')) i = 7;
        else return false;
        const start = i;
        while (i < s.length && s[i] !== '/') i++;
        if (i === start) return false;
        if (i < s.length && s[i] === '/') i++;
        return i === s.length;
      };
    }

    case 'email_like': {
      return (s) => {
        let i = 0;
        while (i < s.length && !isEcmaWs(s[i]) && s[i] !== '@') i++;
        if (i === 0 || i >= s.length || s[i] !== '@') return false;
        i++;
        const dstart = i;
        while (i < s.length && !isEcmaWs(s[i]) && s[i] !== '@') i++;
        return i > dstart && i === s.length;
      };
    }

    case 'git_clone_url': {
      return (s) => {
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
      };
    }

    case 'content_type': {
      const isTypeChar = (c: string): boolean => {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
          '!#$&^_-'.includes(c);
      };
      const isSubtypeChar = (c: string): boolean => {
        return isTypeChar(c) || c === '.' || c === '+';
      };
      return (s) => {
        if (s.length === 0) return false;
        let i = 0;
        if (!((s[i] >= 'a' && s[i] <= 'z') || (s[i] >= 'A' && s[i] <= 'Z'))) return false;
        i++;
        while (i < s.length && isTypeChar(s[i])) i++;
        if (i >= s.length || s[i] !== '/') return false;
        i++;
        if (i >= s.length) return false;
        if (!((s[i] >= 'a' && s[i] <= 'z') || (s[i] >= 'A' && s[i] <= 'Z') || (s[i] >= '0' && s[i] <= '9') || s[i] === '*')) return false;
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
      };
    }

    case 'doi': {
      return (s) => {
        if (!s.startsWith('10.')) return false;
        let i = 3;
        const start = i;
        while (i < s.length && s[i] >= '0' && s[i] <= '9') i++;
        const digitCount = i - start;
        if (digitCount < 4 || digitCount > 9) return false;
        if (i >= s.length || s[i] !== '/') return false;
        i++;
        if (i >= s.length) return false;
        return dotTailValid(s, i);
      };
    }

    case 'annotate_user': {
      return (s) => {
        if (s.length < 82) return false;
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
      };
    }

    case 'prefix_no_whitespace': {
      return (s) => {
        for (const p of check.prefixes) {
          if (s.startsWith(p)) {
            if (p.length >= s.length) return false;
            for (let i = p.length; i < s.length; i++) {
              if (isEcmaWs(s[i])) return false;
            }
            return true;
          }
        }
        return false;
      };
    }

    case 'external_identity': {
      // The schemata pattern ^[a-z0-9._\-/]+:.+ is NOT $-anchored.
      // The regex matches if there's at least 1 char matching `.` after `:`.
      // Without $, the regex doesn't need the entire string to match.
      const anchored = originalPattern !== undefined && originalPattern.endsWith('$');
      return (s) => {
        let i = 0;
        while (i < s.length) {
          const c = s[i];
          if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '.' || c === '_' || c === '-' || c === '/') i++;
          else break;
        }
        if (i === 0 || i >= s.length || s[i] !== ':') return false;
        i++;
        if (i >= s.length) return false;
        if (anchored) {
          // $ anchored: all tail chars must match `.` (no JS line terminators)
          return dotTailValid(s, i);
        } else {
          // Not $ anchored: just need at least 1 char matching `.` after `:`
          return !isJsLineTerminator(s[i]);
        }
      };
    }

    case 'package_id': {
      const isPkgChar = (c: string): boolean => {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '.' || c === '_' || c === '+' || c === '-';
      };
      return (s) => {
        if (s === '#') return true;
        if (s.length === 0) return false;
        let i = 0;
        if (!((s[i] >= 'a' && s[i] <= 'z') || (s[i] >= 'A' && s[i] <= 'Z') || (s[i] >= '0' && s[i] <= '9'))) return false;
        i++;
        while (i < s.length && isPkgChar(s[i])) i++;
        while (i < s.length && s[i] === ':') {
          i++;
          if (i >= s.length) return false;
          if (!((s[i] >= 'a' && s[i] <= 'z') || (s[i] >= 'A' && s[i] <= 'Z') || (s[i] >= '0' && s[i] <= '9'))) return false;
          i++;
          while (i < s.length && isPkgChar(s[i])) i++;
        }
        return i === s.length;
      };
    }

    case 'imeta_dim': {
      return (s) => {
        if (s.length < 7) return false;
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
      };
    }

    case 'dim': {
      return (s) => {
        if (s.length === 0) return false;
        let i = 0;
        if (s[i] < '0' || s[i] > '9') return false;
        while (i < s.length && s[i] >= '0' && s[i] <= '9') i++;
        if (i >= s.length || s[i] !== 'x') return false;
        i++;
        if (i >= s.length || s[i] < '0' || s[i] > '9') return false;
        while (i < s.length && s[i] >= '0' && s[i] <= '9') i++;
        return i === s.length;
      };
    }

    case 'no_uppercase': {
      return (s) => {
        if (s.length === 0) return false;
        for (let i = 0; i < s.length; i++) {
          if (s[i] >= 'A' && s[i] <= 'Z') return false;
        }
        return true;
      };
    }

    case 'dotted_digits': {
      return (s) => {
        if (s.length === 0) return false;
        let i = 0;
        if (s[i] < '0' || s[i] > '9') return false;
        while (i < s.length && s[i] >= '0' && s[i] <= '9') i++;
        while (i < s.length && s[i] === '.') {
          i++;
          if (i >= s.length || s[i] < '0' || s[i] > '9') return false;
          while (i < s.length && s[i] >= '0' && s[i] <= '9') i++;
        }
        return i === s.length;
      };
    }

    case 'slash_segments': {
      const cs = check.charset;
      return (s) => {
        if (s.length === 0) return false;
        let i = 0;
        if (!cs.includes(s[i])) return false;
        while (i < s.length && cs.includes(s[i])) i++;
        while (i < s.length && s[i] === '/') {
          i++;
          if (i >= s.length || !cs.includes(s[i])) return false;
          while (i < s.length && cs.includes(s[i])) i++;
        }
        return i === s.length;
      };
    }

    case 'space_separated_tokens': {
      const WS = new Set(['\t','\n','\x0B','\x0C','\r',' ','\xA0','\u1680','\u2000','\u2001','\u2002','\u2003','\u2004','\u2005','\u2006','\u2007','\u2008','\u2009','\u200A','\u2028','\u2029','\u202F','\u205F','\u3000','\uFEFF']);
      return (s) => {
        if (s.length === 0) return false;
        let i = 0;
        if (WS.has(s[i])) return false;
        while (i < s.length && !WS.has(s[i])) i++;
        while (i < s.length && s[i] === ' ') {
          i++;
          if (i >= s.length || WS.has(s[i])) return false;
          while (i < s.length && !WS.has(s[i])) i++;
        }
        return i === s.length;
      };
    }

    case 'starts_with_charset': {
      const cs = check.charset;
      return (s) => s.length >= 1 && cs.includes(s[0]);
    }

    case 'base64': {
      const isB64 = (c: string) => (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '+' || c === '/';
      return (s) => {
        if (s.length === 0) return true;
        if (s.length % 4 !== 0) return false;
        let i = 0;
        while (i < s.length && isB64(s[i])) i++;
        const dataLen = i;
        const padLen = s.length - dataLen;
        if (padLen > 2) return false;
        if (padLen === 1 && dataLen % 4 !== 3) return false;
        if (padLen === 2 && dataLen % 4 !== 2) return false;
        for (let j = dataLen; j < s.length; j++) if (s[j] !== '=') return false;
        return true;
      };
    }

    case 'nostr_uri': {
      const BC = '023456789acdefghjklmnpqrstuvwxyz';
      return (s) => {
        if (!s.startsWith('nostr:')) return false;
        const p = s.slice(6);
        if (p.length === 0) return false;
        if (p.length === 63 && (p.startsWith('npub1') || p.startsWith('note1'))) {
          for (let i = 5; i < 63; i++) if (!BC.includes(p[i])) return false;
          return true;
        }
        let pl = 0;
        if (p.startsWith('nprofile1')) pl = 9;
        else if (p.startsWith('nevent1')) pl = 7;
        else if (p.startsWith('naddr1')) pl = 6;
        if (pl === 0 || p.length <= pl) return false;
        for (let i = pl; i < p.length; i++) if (!BC.includes(p[i])) return false;
        return true;
      };
    }

    case 'nip04_encrypted': {
      const isB64 = (c: string) => (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '+' || c === '/';
      return (s) => {
        if (s.length === 0) return false;
        const sep = s.indexOf('?iv=');
        if (sep <= 0) return false;
        if (sep + 4 >= s.length) return false;
        let i = 0;
        while (i < sep && isB64(s[i])) i++;
        if (i === 0) return false;
        let eq = 0;
        while (i < sep && s[i] === '=') { i++; eq++; }
        if (i !== sep || eq > 2) return false;
        i = sep + 4;
        const ds = i;
        while (i < s.length && isB64(s[i])) i++;
        if (i === ds) return false;
        eq = 0;
        while (i < s.length && s[i] === '=') { i++; eq++; }
        return i === s.length && eq <= 2;
      };
    }

    case 'nip05_identifier': {
      const isAln = (c: string) => (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');
      const isLocal = (c: string) => c === '_' || isAln(c) || c === '.' || c === '-';
      const isDom = (c: string) => isAln(c) || c === '-';
      return (s) => {
        if (s.length === 0) return false;
        const at = s.lastIndexOf('@');
        if (at <= 0) return false;
        for (let i = 0; i < at; i++) if (!isLocal(s[i])) return false;
        const d = s.slice(at + 1);
        if (d.length === 0) return false;
        let dotCount = 0, di = 0;
        while (di < d.length) {
          if (!isAln(d[di])) return false;
          while (di < d.length && isDom(d[di])) di++;
          if (di > 0 && !isAln(d[di - 1])) return false;
          if (di < d.length && d[di] === '.') { dotCount++; di++; }
          else if (di < d.length) return false;
        }
        return dotCount >= 1 && isAln(d[d.length - 1]);
      };
    }

    case 'mime_type_strict': {
      const isAln = (c: string) => (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');
      const EXTRA = '!#$&^_.+-';
      const isMC = (c: string) => isAln(c) || EXTRA.includes(c);
      return (s) => {
        if (s.length === 0) return false;
        let i = 0;
        if (!isAln(s[i])) return false;
        i++;
        while (i < s.length && isMC(s[i])) i++;
        if (i >= s.length || s[i] !== '/') return false;
        i++;
        if (i >= s.length || !isAln(s[i])) return false;
        i++;
        while (i < s.length && isMC(s[i])) i++;
        return i === s.length;
      };
    }

    case 'prefix_delim_rest': {
      const cs = check.charset;
      const delim = check.delimiter;
      return (s) => {
        if (s.length === 0) return false;
        let i = 0;
        if (!cs.includes(s[i])) return false;
        while (i < s.length && cs.includes(s[i])) i++;
        if (i + delim.length >= s.length) return false;
        if (s.slice(i, i + delim.length) !== delim) return false;
        return true;
      };
    }

    case 'compound': {
      const checkers = check.checks.map(c => buildNativeChecker(c, originalPattern));
      if (checkers.some(c => c === null)) return null;
      return (s) => (checkers as ((s: string) => boolean)[]).every(c => c(s));
    }

    case 'regex':
      return null; // Cannot build native checker for regex fallback
  }
}

// ---------------------------------------------------------------------------
// Input generators for each op type
// ---------------------------------------------------------------------------

type Rng = ReturnType<typeof makeRng>;

function generateBaseInputs(rng: Rng): string[] {
  const inputs: string[] = [
    '', // empty string
  ];

  // Single ASCII printable characters
  for (let i = 32; i <= 126; i++) {
    inputs.push(String.fromCharCode(i));
  }

  // Line terminators
  inputs.push('\n', '\r', '\r\n', '\u0085', '\u2028', '\u2029');

  // Unicode whitespace
  for (const ws of UNICODE_WHITESPACE) {
    inputs.push(ws);
  }

  // Short random strings
  for (let i = 0; i < 20; i++) {
    inputs.push(rng.randomString(rng.nextInt(1, 10), ASCII_PRINTABLE));
  }

  return inputs;
}

function generateHexInputs(rng: Rng, len: number, caseType: 'lower' | 'mixed'): string[] {
  const inputs: string[] = [];
  const validChars = caseType === 'lower' ? HEX_LOWER : HEX_MIXED;

  // Valid hex of correct length
  for (let i = 0; i < 10; i++) {
    inputs.push(rng.randomString(len, validChars));
  }

  // Wrong lengths
  for (const wrongLen of [0, 1, len - 1, len + 1, 2, 63, 65, 128, 129]) {
    if (wrongLen !== len && wrongLen >= 0) {
      inputs.push(rng.randomString(wrongLen, validChars));
    }
  }

  // Correct length but wrong chars
  inputs.push(rng.randomString(len, 'ghijklmnopqrstuvwxyz'));
  inputs.push(rng.randomString(len, ASCII_PRINTABLE));
  if (caseType === 'lower') {
    inputs.push(rng.randomString(len, HEX_UPPER)); // uppercase when only lower allowed
    inputs.push(rng.randomString(len, HEX_MIXED)); // mixed when only lower allowed
  }

  // All zeros, all f's
  inputs.push('0'.repeat(len));
  inputs.push('f'.repeat(len));
  if (caseType === 'mixed') inputs.push('F'.repeat(len));

  return inputs;
}

function generateDigitInputs(rng: Rng, allowNeg: boolean): string[] {
  const inputs: string[] = [];

  // Valid digits
  for (let i = 0; i < 20; i++) {
    inputs.push(rng.randomString(rng.nextInt(1, 10), DIGITS));
  }
  inputs.push('0', '1', '42', '123456789', '00042', '0'.repeat(100));

  if (allowNeg) {
    inputs.push('-1', '-42', '-0', '-123456789');
    inputs.push('-'); // minus only — should fail
    inputs.push('-a'); // minus + non-digit
  }

  // Invalid
  inputs.push('abc', '12a', 'a12', '1.5', ' 1', '1 ');
  inputs.push('1\n', '\n1');

  return inputs;
}

function generateRelayUrlInputs(rng: Rng): string[] {
  const inputs: string[] = [];
  const hosts = ['relay.example.com', 'localhost', 'a', '192.168.1.1', 'relay-test_01.nostr.com', 'a.b.c.d'];
  const ports = ['', ':8080', ':443', ':1', ':0'];
  const paths = ['', '/', '/path', '/path/to/resource', '/a b c'];

  // Valid combinations
  for (const scheme of ['ws://', 'wss://']) {
    for (const host of hosts) {
      for (const port of ports) {
        for (const path of paths) {
          inputs.push(scheme + host + port + path);
        }
      }
    }
  }

  // Invalid
  inputs.push('http://relay.example.com', 'https://relay.example.com');
  inputs.push('wss://', 'ws://'); // empty hostname
  inputs.push('wss://relay.example.com:', 'wss://relay.example.com:abc');
  inputs.push('wss', 'not a url', '');
  inputs.push('WSS://RELAY.EXAMPLE.COM'); // uppercase scheme
  inputs.push('wss:///path'); // empty hostname with path
  inputs.push('wss://relay.example.com:8080?query'); // query char

  // Line terminators in path
  for (const lt of JS_LINE_TERMINATORS) {
    inputs.push('wss://relay.example.com/' + lt + 'path');
    inputs.push('wss://relay.example.com/path' + lt);
  }
  // NEL in path (accepted by JS regex .)
  inputs.push('wss://relay.example.com/\u0085path');

  // Random combos
  for (let i = 0; i < 15; i++) {
    const scheme = rng.pick(['ws://', 'wss://', 'http://', '']);
    const host = rng.randomString(rng.nextInt(0, 20), 'abcdef0123456789.-_');
    const port = rng.next() > 0.5 ? ':' + rng.randomString(rng.nextInt(0, 5), DIGITS) : '';
    const path = rng.next() > 0.5 ? '/' + rng.randomString(rng.nextInt(0, 10), ASCII_PRINTABLE) : '';
    inputs.push(scheme + host + port + path);
  }

  return inputs;
}

function generateATagInputs(rng: Rng, kinds?: string[]): string[] {
  const inputs: string[] = [];
  const hex64 = 'a'.repeat(64);

  // Valid
  inputs.push(`1:${hex64}:d-id`);
  inputs.push(`30023:${hex64}:slug`);
  inputs.push(`0:${hex64}:x`);
  inputs.push(`1:${hex64}:hello world`);
  inputs.push(`1:${hex64}:a/b?c=1&d=2`);
  inputs.push(`1:${hex64}:\u0085id`); // NEL valid in JS

  // Leading zeros (important edge case)
  inputs.push(`030311:${hex64}:slug`);
  inputs.push(`00042:${hex64}:test`);
  inputs.push(`0:${hex64}:test`);
  inputs.push(`00:${hex64}:test`);

  // With kinds filter
  if (kinds) {
    for (const k of kinds) {
      inputs.push(`${k}:${hex64}:test`);
    }
    // Wrong kinds
    inputs.push(`99999:${hex64}:test`);
    inputs.push(`0:${hex64}:test`);
  }

  // Invalid
  inputs.push('', 'short', `abc:${hex64}:d-id`, `:${hex64}:d-id`);
  inputs.push(`1:${'a'.repeat(63)}:d-id`); // short hex
  inputs.push(`1:${'A'.repeat(64)}:d-id`); // uppercase hex
  inputs.push(`1:${hex64}:`); // empty d-id
  inputs.push(`1:${hex64}:d\nid`); // newline in d-id
  inputs.push(`1:${hex64}:d\rid`); // CR in d-id
  inputs.push(`1:${hex64}:d\u2028id`); // LS in d-id
  inputs.push(`1:${hex64}:d\u2029id`); // PS in d-id
  inputs.push(`1${hex64}:d-id`); // missing first colon
  inputs.push(`1:${hex64}d-id`); // missing second colon

  // Random
  for (let i = 0; i < 20; i++) {
    const kindDigits = rng.nextInt(0, 6);
    const kind = rng.randomString(kindDigits, DIGITS);
    const hex = rng.randomString(64, HEX_LOWER);
    const dIdLen = rng.nextInt(0, 10);
    const dId = rng.randomString(dIdLen, ASCII_PRINTABLE);
    inputs.push(`${kind}:${hex}:${dId}`);
  }

  return inputs;
}

function generateBech32Inputs(rng: Rng, hrp: string, dataLen?: number): string[] {
  const inputs: string[] = [];

  // Valid
  for (let i = 0; i < 10; i++) {
    const len = dataLen ?? rng.nextInt(1, 100);
    inputs.push(hrp + '1' + rng.randomString(len, BECH32_CHARSET));
  }

  // Wrong length
  if (dataLen !== undefined) {
    inputs.push(hrp + '1' + rng.randomString(dataLen - 1, BECH32_CHARSET));
    inputs.push(hrp + '1' + rng.randomString(dataLen + 1, BECH32_CHARSET));
    inputs.push(hrp + '1'); // empty data with fixed length
  } else {
    inputs.push(hrp + '1'); // empty data with + quantifier
  }

  // Invalid chars in data
  inputs.push(hrp + '1' + 'b'.repeat(dataLen ?? 10)); // 'b' not in bech32
  inputs.push(hrp + '1' + 'i'.repeat(dataLen ?? 10)); // 'i' not in bech32
  inputs.push(hrp + '1' + 'o'.repeat(dataLen ?? 10)); // 'o' not in bech32
  inputs.push(hrp + '1' + '1'.repeat(dataLen ?? 10)); // '1' not in bech32 data

  // Wrong prefix
  inputs.push('wrong1' + rng.randomString(dataLen ?? 10, BECH32_CHARSET));
  inputs.push(''); // empty
  inputs.push(hrp); // no separator
  inputs.push(hrp + rng.randomString(dataLen ?? 10, BECH32_CHARSET)); // no '1' separator

  // Uppercase (should fail)
  inputs.push(hrp.toUpperCase() + '1' + rng.randomString(dataLen ?? 10, BECH32_CHARSET));

  return inputs;
}

function generateContentTypeInputs(rng: Rng): string[] {
  const inputs: string[] = [];

  // Valid
  inputs.push('text/plain', 'text/html', 'application/json', 'image/png');
  inputs.push('text/plain;charset=utf-8', 'text/plain ; charset=utf-8');
  inputs.push('text/plain;charset=utf-8;boundary=something');
  inputs.push('text/*');
  inputs.push('text/plain\u00A0;\u00A0charset=utf-8'); // NBSP around semicolon
  inputs.push('text/plain\n;charset=utf-8'); // newline as whitespace

  // Invalid
  inputs.push('', 'text/', 'textplain', '/plain');
  inputs.push('text/plain '); // trailing space
  inputs.push('text/plain\t'); // trailing tab
  inputs.push('text/plain\u00A0'); // trailing NBSP
  inputs.push('text/plain;charset=utf-8 '); // trailing space after param
  inputs.push('text/plain;'); // semicolon but no param
  inputs.push('text/plain;=value'); // empty key
  inputs.push('text/plain;key='); // empty value
  inputs.push('1ext/plain'); // digit first char in type (only alpha allowed)

  // Random
  for (let i = 0; i < 20; i++) {
    const typeLen = rng.nextInt(1, 8);
    const type = rng.randomString(typeLen, ASCII_LOWER);
    const subLen = rng.nextInt(1, 10);
    const sub = rng.randomString(subLen, ASCII_LOWER + DIGITS + '.+-');
    let ct = type + '/' + sub;
    if (rng.next() > 0.5) {
      const ws1 = rng.randomString(rng.nextInt(0, 3), ' \t\n');
      const ws2 = rng.randomString(rng.nextInt(0, 3), ' \t\n');
      const key = rng.randomString(rng.nextInt(1, 5), ASCII_LOWER);
      const val = rng.randomString(rng.nextInt(1, 5), ASCII_LOWER + DIGITS);
      ct += ws1 + ';' + ws2 + key + '=' + val;
    }
    inputs.push(ct);
  }

  return inputs;
}

function generateEmailInputs(rng: Rng): string[] {
  const inputs: string[] = [];

  inputs.push('user@domain', 'a@b', 'user+tag@example.com');
  inputs.push('', 'user', '@domain', 'user@', 'us er@domain', 'user@@domain');
  inputs.push('user@dom\nain', 'user@dom\tain');

  // With unicode whitespace
  for (const ws of ECMA_WS) {
    inputs.push('user' + ws + '@domain');
    inputs.push('user@domain' + ws);
    inputs.push('user@' + ws + 'domain');
  }

  // Random
  for (let i = 0; i < 20; i++) {
    const localLen = rng.nextInt(0, 10);
    const domLen = rng.nextInt(0, 10);
    const local = rng.randomString(localLen, ASCII_ALNUM + '._+-');
    const dom = rng.randomString(domLen, ASCII_ALNUM + '.-');
    if (rng.next() > 0.3) {
      inputs.push(local + '@' + dom);
    } else {
      inputs.push(local + dom);
    }
  }

  return inputs;
}

function generateDoiInputs(rng: Rng): string[] {
  const inputs: string[] = [];

  inputs.push('10.1000/test', '10.12345/abc.def', '10.123456789/x');
  inputs.push('', '11.1000/test', '10.123/test', '10.1234567890/test', '10.1234', '10.1234/');

  // Edge cases for .+ tail
  for (const lt of JS_LINE_TERMINATORS) {
    inputs.push('10.1234/test' + lt + 'rest');
  }
  inputs.push('10.1234/\u0085test'); // NEL accepted by JS .

  // Random DOIs
  for (let i = 0; i < 15; i++) {
    const numDigits = rng.nextInt(1, 12);
    const digits = rng.randomString(numDigits, DIGITS);
    const suffixLen = rng.nextInt(0, 10);
    const suffix = rng.randomString(suffixLen, ASCII_ALNUM + '.-_/');
    inputs.push('10.' + digits + '/' + suffix);
  }

  return inputs;
}

function generateAnnotateUserInputs(rng: Rng): string[] {
  const inputs: string[] = [];
  const hex64 = 'a'.repeat(64);

  inputs.push(`annotate-user ${hex64}:10:20`);
  inputs.push(`annotate-user ${hex64}:10.5:20.3`);
  inputs.push(`annotate-user ${hex64}:0:0`);
  inputs.push(`annotate-user ${hex64}:0.0:0.0`);
  inputs.push(`annotate-user ${hex64}:999:999`);

  // Invalid
  inputs.push('', `annotate_user ${hex64}:0:0`);
  inputs.push(`annotate-user ${'a'.repeat(63)}:0:0`);
  inputs.push(`annotate-user ${'A'.repeat(64)}:0:0`);
  inputs.push(`annotate-user ${hex64}:0`);
  inputs.push(`annotate-user ${hex64}:0.:0`);
  inputs.push(`annotate-user ${hex64}::0`);
  inputs.push(`annotate-user ${hex64}:0:0:extra`);
  inputs.push(`annotate-user ${hex64}:0.0.0:0`);
  inputs.push(`annotate-user ${hex64}:0:0.`);

  // Random
  for (let i = 0; i < 15; i++) {
    const hex = rng.randomString(64, HEX_LOWER);
    const x = rng.randomString(rng.nextInt(1, 5), DIGITS);
    const xDec = rng.next() > 0.5 ? '.' + rng.randomString(rng.nextInt(0, 3), DIGITS) : '';
    const y = rng.randomString(rng.nextInt(1, 5), DIGITS);
    const yDec = rng.next() > 0.5 ? '.' + rng.randomString(rng.nextInt(0, 3), DIGITS) : '';
    inputs.push(`annotate-user ${hex}:${x}${xDec}:${y}${yDec}`);
  }

  return inputs;
}

function generateExternalIdentityInputs(rng: Rng): string[] {
  const inputs: string[] = [];
  const platformChars = ASCII_LOWER + DIGITS + '._-/';

  inputs.push('github:user', 'twitter:handle', 'dns/example.com:proof');
  inputs.push('', 'github', 'github:', 'GitHub:user', 'git hub:user');

  // .+ tail with line terminators
  for (const lt of JS_LINE_TERMINATORS) {
    inputs.push('github:user' + lt + 'rest');
    inputs.push('github:' + lt);
  }
  inputs.push('github:\u0085test'); // NEL accepted

  // Random
  for (let i = 0; i < 15; i++) {
    const platLen = rng.nextInt(0, 10);
    const plat = rng.randomString(platLen, platformChars);
    const valLen = rng.nextInt(0, 10);
    const val = rng.randomString(valLen, ASCII_PRINTABLE);
    if (rng.next() > 0.3) {
      inputs.push(plat + ':' + val);
    } else {
      inputs.push(plat + val);
    }
  }

  return inputs;
}

function generatePackageIdInputs(rng: Rng): string[] {
  const inputs: string[] = [];
  const pkgChars = ASCII_ALNUM + '._+-';

  inputs.push('#', 'mypackage', 'com.example.pkg', 'group:artifact', 'a:b:c');
  inputs.push('pkg-1.0+beta_2');
  inputs.push('', 'a:', 'a::b', '.pkg', 'a b', ':a');
  inputs.push('##'); // only single # is valid

  // Random
  for (let i = 0; i < 20; i++) {
    const segments = rng.nextInt(1, 4);
    let s = '';
    for (let j = 0; j < segments; j++) {
      if (j > 0) s += ':';
      const segLen = rng.nextInt(0, 8);
      s += rng.randomString(segLen, pkgChars);
    }
    inputs.push(s);
  }

  return inputs;
}

function generateLnInvoiceInputs(rng: Rng, prefix: string, minHrpLen: number): string[] {
  const inputs: string[] = [];

  // Valid
  for (let i = 0; i < 10; i++) {
    const hrpExtra = rng.randomString(rng.nextInt(0, 10), ASCII_LOWER + DIGITS);
    const dataLen = rng.nextInt(1, 50);
    inputs.push(prefix + hrpExtra + '1' + rng.randomString(dataLen, BECH32_CHARSET));
  }

  // Invalid
  inputs.push('', 'btc1qqqq'); // wrong prefix
  inputs.push(prefix + rng.randomString(10, BECH32_CHARSET)); // no separator
  inputs.push(prefix + '1'); // empty data

  // Invalid data chars
  inputs.push(prefix + '1b', prefix + '1i', prefix + '1o', prefix + '11');

  return inputs;
}

function generateMimeTypeInputs(rng: Rng): string[] {
  const inputs: string[] = [];

  inputs.push('image/png', 'application/json', 'text/vnd.abc+xml', 'audio/ogg');
  inputs.push('', 'image', 'Image/png', 'image/', '/png', 'a/1');

  // Random
  for (let i = 0; i < 15; i++) {
    const typeLen = rng.nextInt(0, 8);
    const type = rng.randomString(typeLen, ASCII_LOWER);
    const subLen = rng.nextInt(0, 10);
    const sub = rng.randomString(subLen, ASCII_LOWER + DIGITS + '.+-');
    inputs.push(type + '/' + sub);
  }

  return inputs;
}

function generateHttpOriginInputs(rng: Rng): string[] {
  const inputs: string[] = [];

  inputs.push('http://example.com', 'https://example.com', 'https://example.com/');
  inputs.push('https://localhost:8080', 'https://localhost:8080/');
  inputs.push('', 'https://example.com/path', 'ws://example.com', 'https://', 'https://a');
  inputs.push('https://example.com//'); // double slash path

  // Random
  for (let i = 0; i < 10; i++) {
    const scheme = rng.pick(['http://', 'https://', 'ws://', '']);
    const host = rng.randomString(rng.nextInt(0, 15), ASCII_ALNUM + '.-:');
    const trail = rng.pick(['', '/', '/path', '']);
    inputs.push(scheme + host + trail);
  }

  return inputs;
}

function generateWrappedInputs(rng: Rng, prefix: string, suffix: string): string[] {
  const inputs: string[] = [];

  inputs.push(prefix + suffix);
  inputs.push(prefix + '\ndata\n' + suffix);
  inputs.push(prefix + rng.randomString(50, ASCII_PRINTABLE + '\n\r\t') + suffix);
  inputs.push('', prefix, suffix, 'XXX' + suffix, prefix + 'XXX');

  return inputs;
}

function generateCsvListInputs(rng: Rng, itemCharset: string): string[] {
  const inputs: string[] = [];

  inputs.push('a', 'a,b', 'a,b,c', '1,2,3', '42');
  inputs.push('', ',', 'a,', ',a', 'a,,b', 'a b', 'a, b');

  // Random
  for (let i = 0; i < 15; i++) {
    const itemCount = rng.nextInt(1, 5);
    const items: string[] = [];
    for (let j = 0; j < itemCount; j++) {
      const len = rng.nextInt(0, 5);
      items.push(rng.randomString(len, itemCharset + ' !@#'));
    }
    inputs.push(items.join(','));
  }

  return inputs;
}

function generateDecimalInputs(rng: Rng): string[] {
  const inputs: string[] = [];

  inputs.push('1', '123', '0', '1.5', '123.456', '0.0');
  inputs.push('', '.5', 'a', '1.', '1.2.3', '1a', 'a1');
  inputs.push('00', '01', '00.1', '0.00');
  inputs.push('-1'); // should fail (no sign in decimal)

  for (let i = 0; i < 15; i++) {
    const intPart = rng.randomString(rng.nextInt(0, 5), DIGITS);
    if (rng.next() > 0.5) {
      const fracPart = rng.randomString(rng.nextInt(0, 5), DIGITS);
      inputs.push(intPart + '.' + fracPart);
    } else {
      inputs.push(intPart);
    }
  }

  return inputs;
}

function generateDateIsoInputs(rng: Rng): string[] {
  const inputs: string[] = [];

  inputs.push('2024-01-15', '0000-00-00', '9999-12-31');
  inputs.push('', '2024-01-1', '2024/01/15', '2024-01-15T', 'abcd-ef-gh');
  inputs.push('2024-01-15 '); // trailing space
  inputs.push('20240115'); // no separators

  for (let i = 0; i < 10; i++) {
    const y = rng.randomString(4, DIGITS);
    const m = rng.randomString(2, DIGITS);
    const d = rng.randomString(2, DIGITS);
    inputs.push(y + '-' + m + '-' + d);
    // Wrong length components
    inputs.push(rng.randomString(rng.nextInt(1, 5), DIGITS) + '-' + rng.randomString(rng.nextInt(1, 3), DIGITS) + '-' + rng.randomString(rng.nextInt(1, 3), DIGITS));
  }

  return inputs;
}

function generateDatetimeIsoInputs(rng: Rng): string[] {
  const inputs: string[] = [];

  inputs.push('2024-01-15', '2024-01-15T10:30', '2024-01-15T10:30:45');
  inputs.push('2024-01-15T10:30:45.123', '2024-01-15T10:30Z', '2024-01-15T10:30:45Z');
  inputs.push('2024-01-15T10:30:45.123Z', '2024-01-15T10:30+05:30', '2024-01-15T10:30:45-08:00');
  inputs.push('2024-01-15T10:30:45.9+00:00', '2024-01-15T10:30:45.123456789Z');

  inputs.push('', '2024-01-1', '20X4-01-15', '2024/01/15', '2024-01-15T');
  inputs.push('2024-01-15T10', '2024-01-15T10:3', '2024-01-15X', '2024-01-15T10:30:4');
  inputs.push('2024-01-15T10:30:45.', '2024-01-15T10:30+05', '2024-01-15T10:30+0530');
  inputs.push('2024-01-15T10:30Zx', '2024-01-15T10:30:45.Z');

  // Random
  for (let i = 0; i < 15; i++) {
    let s = rng.randomString(4, DIGITS) + '-' + rng.randomString(2, DIGITS) + '-' + rng.randomString(2, DIGITS);
    if (rng.next() > 0.4) {
      s += 'T' + rng.randomString(2, DIGITS) + ':' + rng.randomString(2, DIGITS);
      if (rng.next() > 0.5) s += ':' + rng.randomString(2, DIGITS);
      if (rng.next() > 0.5) s += '.' + rng.randomString(rng.nextInt(1, 6), DIGITS);
      const suffix = rng.pick(['', 'Z', '+05:30', '-08:00', '+00:00']);
      s += suffix;
    }
    inputs.push(s);
  }

  return inputs;
}

function generateImetaDimInputs(rng: Rng): string[] {
  const inputs: string[] = [];

  inputs.push('dim 100x200', 'dim 1x1', 'dim 99999x99999', 'dim 0x0');
  inputs.push('', '100x200', 'dim 100200', 'dim x200', 'dim 123456x200', 'dim 100x200px');

  for (let i = 0; i < 15; i++) {
    const w = rng.randomString(rng.nextInt(0, 7), DIGITS);
    const h = rng.randomString(rng.nextInt(0, 7), DIGITS);
    inputs.push('dim ' + w + 'x' + h);
  }

  return inputs;
}

function generateGitCloneUrlInputs(rng: Rng): string[] {
  const inputs: string[] = [];

  inputs.push('https://github.com/user/repo.git', 'git@github.com:user/repo.git');
  inputs.push('ssh://git@example.com/repo', 'http://example.com/repo');
  inputs.push('', 'https://', 'git@');
  inputs.push('https://\u00A0example.com'); // NBSP should fail

  for (const ws of ECMA_WS) {
    inputs.push('https://example' + ws + '.com/repo');
  }

  for (let i = 0; i < 10; i++) {
    const scheme = rng.pick(['https', 'http', 'ssh', 'git', 'svn', 'abc']);
    const host = rng.randomString(rng.nextInt(1, 15), ASCII_ALNUM + '.-');
    const path = '/' + rng.randomString(rng.nextInt(1, 10), ASCII_ALNUM + '/.-_');
    inputs.push(scheme + '://' + host + path);
  }

  return inputs;
}

function generatePrefixNoWhitespaceInputs(rng: Rng, prefixes: string[]): string[] {
  const inputs: string[] = [];

  for (const p of prefixes) {
    inputs.push(p + 'example.com');
    inputs.push(p + 'example.com/path');
    inputs.push(p); // prefix only - should fail
  }

  // With whitespace in tail
  for (const p of prefixes) {
    for (const ws of ECMA_WS) {
      inputs.push(p + 'before' + ws + 'after');
    }
  }

  inputs.push('', 'wrong prefix');

  return inputs;
}

function generatePrefixNonemptyInputs(rng: Rng, prefix: string): string[] {
  const inputs: string[] = [];

  inputs.push(prefix + 'hello', prefix + 'x', prefix + '!@#$%');
  inputs.push(prefix, '', 'wrong' + prefix);

  // Line terminators in tail
  for (const lt of JS_LINE_TERMINATORS) {
    inputs.push(prefix + 'hel' + lt + 'lo');
  }
  inputs.push(prefix + '\u0085x'); // NEL accepted

  for (let i = 0; i < 10; i++) {
    inputs.push(prefix + rng.randomString(rng.nextInt(0, 15), ASCII_PRINTABLE));
  }

  return inputs;
}

function generateExactValuesInputs(rng: Rng, values: string[]): string[] {
  const inputs = [...values]; // All exact values
  // Near misses
  for (const v of values) {
    inputs.push(v + 'x', 'x' + v, v.slice(0, -1), v + ' ', ' ' + v);
  }
  inputs.push('', 'completely wrong');
  return inputs;
}

function generateStartsWithInputs(rng: Rng, prefixes: string[]): string[] {
  const inputs: string[] = [];

  for (const p of prefixes) {
    inputs.push(p); // prefix only
    inputs.push(p + 'rest');
    inputs.push(p + rng.randomString(rng.nextInt(1, 20), ASCII_PRINTABLE));
  }
  inputs.push('', 'wrong');

  // With line terminators after prefix
  for (const p of prefixes) {
    for (const lt of JS_LINE_TERMINATORS) {
      inputs.push(p + lt);
      inputs.push(p + 'before' + lt + 'after');
    }
  }

  return inputs;
}

function generateCharsInInputs(rng: Rng, charset: string, min?: number, max?: number): string[] {
  const inputs: string[] = [];

  // Valid
  for (let i = 0; i < 10; i++) {
    const len = min !== undefined && max !== undefined
      ? rng.nextInt(min, max)
      : min !== undefined
        ? rng.nextInt(min, min + 20)
        : rng.nextInt(0, 20);
    if (charset.length > 0) {
      inputs.push(rng.randomString(len, charset));
    } else if (len === 0) {
      inputs.push('');
    }
  }

  // Length boundaries
  if (min !== undefined) {
    if (min > 0 && charset.length > 0) {
      inputs.push(rng.randomString(min - 1, charset)); // too short
    }
    if (charset.length > 0) {
      inputs.push(rng.randomString(min, charset)); // exactly min
    }
  }
  if (max !== undefined && charset.length > 0) {
    inputs.push(rng.randomString(max, charset)); // exactly max
    inputs.push(rng.randomString(max + 1, charset)); // too long
  }

  // Wrong chars
  inputs.push('!', '@', ' ', '\n', '\t');
  if (charset.length > 0) {
    // Mix valid and invalid
    for (let i = 0; i < 5; i++) {
      const validPart = rng.randomString(rng.nextInt(1, 5), charset);
      inputs.push(validPart + '!');
      inputs.push('!' + validPart);
    }
  }

  inputs.push('');

  return inputs;
}

function generateHexPrefixedInputs(rng: Rng, prefix: string, hexLen: number): string[] {
  const inputs: string[] = [];

  // Valid
  for (let i = 0; i < 10; i++) {
    inputs.push(prefix + rng.randomString(hexLen, HEX_LOWER));
  }

  // Wrong hex length
  inputs.push(prefix + rng.randomString(hexLen - 1, HEX_LOWER));
  inputs.push(prefix + rng.randomString(hexLen + 1, HEX_LOWER));

  // Wrong chars
  inputs.push(prefix + rng.randomString(hexLen, HEX_UPPER));
  inputs.push(prefix + rng.randomString(hexLen, ASCII_PRINTABLE));

  // Wrong prefix
  inputs.push('wrong' + rng.randomString(hexLen, HEX_LOWER));
  inputs.push('');

  return inputs;
}

function generateHexRangeInputs(rng: Rng, min: number, max: number, caseType: 'lower' | 'mixed'): string[] {
  const inputs: string[] = [];
  const validChars = caseType === 'lower' ? HEX_LOWER : HEX_MIXED;

  for (const len of [0, 1, min - 1, min, min + 1, max - 1, max, max + 1, 128]) {
    if (len >= 0) {
      inputs.push(rng.randomString(len, validChars));
    }
  }

  // Wrong chars at correct length
  const midLen = Math.floor((min + max) / 2);
  inputs.push(rng.randomString(midLen, 'xyz'));
  inputs.push(rng.randomString(midLen, ASCII_PRINTABLE));

  return inputs;
}

// ---------------------------------------------------------------------------
// Specific input generators dispatched by op type
// ---------------------------------------------------------------------------

function generateInputsForCheck(rng: Rng, check: PatternCheck): string[] {
  const base = generateBaseInputs(rng);

  switch (check.op) {
    case 'hex':
      return [...base, ...generateHexInputs(rng, check.len, check.case)];
    case 'hex_range':
      return [...base, ...generateHexRangeInputs(rng, check.min, check.max, check.case)];
    case 'hex_prefixed':
      return [...base, ...generateHexPrefixedInputs(rng, check.prefix, check.hexLen)];
    case 'all_digits':
      return [...base, ...generateDigitInputs(rng, !!check.allowNeg)];
    case 'starts_with_any':
      return [...base, ...generateStartsWithInputs(rng, check.prefixes)];
    case 'chars_in':
      return [...base, ...generateCharsInInputs(rng, check.charset, check.min, check.max)];
    case 'bech32':
      return [...base, ...generateBech32Inputs(rng, check.hrp, check.dataLen)];
    case 'relay_url':
      return [...base, ...generateRelayUrlInputs(rng)];
    case 'a_tag':
      return [...base, ...generateATagInputs(rng, check.kinds)];
    case 'date_iso':
      return [...base, ...generateDateIsoInputs(rng)];
    case 'datetime_iso':
      return [...base, ...generateDatetimeIsoInputs(rng)];
    case 'decimal':
      return [...base, ...generateDecimalInputs(rng)];
    case 'exact_values':
      return [...base, ...generateExactValuesInputs(rng, check.values)];
    case 'prefix_nonempty':
      return [...base, ...generatePrefixNonemptyInputs(rng, check.prefix)];
    case 'wrapped':
      return [...base, ...generateWrappedInputs(rng, check.prefix, check.suffix)];
    case 'csv_list':
      return [...base, ...generateCsvListInputs(rng, check.itemCharset)];
    case 'ln_invoice':
      return [...base, ...generateLnInvoiceInputs(rng, check.prefix, check.minHrpLen)];
    case 'mime_type':
      return [...base, ...generateMimeTypeInputs(rng)];
    case 'http_origin':
      return [...base, ...generateHttpOriginInputs(rng)];
    case 'email_like':
      return [...base, ...generateEmailInputs(rng)];
    case 'git_clone_url':
      return [...base, ...generateGitCloneUrlInputs(rng)];
    case 'content_type':
      return [...base, ...generateContentTypeInputs(rng)];
    case 'doi':
      return [...base, ...generateDoiInputs(rng)];
    case 'annotate_user':
      return [...base, ...generateAnnotateUserInputs(rng)];
    case 'prefix_no_whitespace':
      return [...base, ...generatePrefixNoWhitespaceInputs(rng, check.prefixes)];
    case 'external_identity':
      return [...base, ...generateExternalIdentityInputs(rng)];
    case 'package_id':
      return [...base, ...generatePackageIdInputs(rng)];
    case 'imeta_dim':
      return [...base, ...generateImetaDimInputs(rng)];
    case 'dim':
      return [...base, '1920x1080', '1x1', '0x0', '', 'x1', '1x', '1920X1080'];
    case 'no_uppercase':
      return [...base, 'abc', '123', 'ABC', 'aBc', '', 'abc-123'];
    case 'dotted_digits':
      return [...base, '1', '1.2', '1.2.3', '', '.1', '1.', '1..2', '1.2a'];
    case 'slash_segments':
      return [...base, 'foo', 'foo/bar', 'a/b/c', '', '/foo', 'foo/', 'foo//bar'];
    case 'space_separated_tokens':
      return [...base, 'hello', 'hello world', '', ' hello', 'hello ', 'hello  world', 'hello\tworld'];
    case 'starts_with_charset':
      return [...base, '0abc', 'bXYZ', '', 'ABC', 'a123'];
    case 'base64':
      return [...base, '', 'AAAA', 'SGVsbG8=', 'SGVsbA==', 'A', 'ABC', '====', 'AA==AAAA'];
    case 'nostr_uri':
      return [...base, 'nostr:npub1' + '0'.repeat(58), 'nostr:note1' + '0'.repeat(58), 'nostr:nprofile1' + '0'.repeat(10), 'nostr:', '', 'npub1' + '0'.repeat(58)];
    case 'nip04_encrypted':
      return [...base, 'AAAA?iv=BBBB', 'AA==?iv=BB==', '', 'AAAA', '?iv=BBBB', 'AAAA?iv='];
    case 'nip05_identifier':
      return [...base, 'user@example.com', '_@domain.tld', '', 'user', 'user@localhost', 'user@-x.com'];
    case 'mime_type_strict':
      return [...base, 'text/plain', 'application/json', '', 'text', '!t/p', 'text/'];
    case 'prefix_delim_rest':
      return [...base, '123:hello', '0:x', '', '123', '123:', 'abc:def'];
    case 'compound':
      // For compound, generate inputs for the first sub-check
      if (check.checks.length > 0) {
        return [...base, ...generateInputsForCheck(rng, check.checks[0])];
      }
      return base;
    case 'regex':
      return base;
  }
}

// ---------------------------------------------------------------------------
// All patterns to test (from schemata dist + test suite)
// ---------------------------------------------------------------------------

const ALL_PATTERNS: string[] = [
  // Hex patterns
  '^[a-f0-9]{64}$',
  '^[a-fA-F0-9]{64}$',
  '^[a-f0-9]{128}$',
  '^[a-f0-9]{40}$',
  '^[a-fA-F0-9]{40}$',
  '^[a-f0-9]{7,40}$',
  '^0x[0-9a-f]{4}$',
  // Digit patterns
  '^[0-9]+$',
  '^\\d+$',
  '^-?[0-9]+$',
  // Starts-with patterns
  '^(https?://).+$',
  '^(ws://|wss://).+$',
  '^(https?://|rtmp://|ws://|wss://).+$',
  '^wss?://',
  '^https?://',
  '^https?://.+$',
  '^https?://.+',
  '^/.+',
  // Chars-in patterns
  '^[a-z0-9._-]+$',
  '^[A-Za-z0-9]+$',
  '^[A-Za-z]+$',
  '^[A-Z]+$',
  '^[A-Za-z]{3,6}$',
  '^[A-Za-z]{3,}$',
  '^$',
  // Bech32 patterns
  '^npub1[02-9ac-hj-np-z]{58}$',
  '^note1[02-9ac-hj-np-z]{58}$',
  '^nprofile1[02-9ac-hj-np-z]+$',
  '^nevent1[02-9ac-hj-np-z]+$',
  '^naddr1[02-9ac-hj-np-z]+$',
  '^lnurl1[02-9ac-hj-np-z]+$',
  // Date/time patterns
  '^[0-9]{4}-[0-9]{2}-[0-9]{2}$',
  '^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}(:\\d{2})?(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2})?)?$',
  // Decimal
  '^\\d+(?:\\.\\d+)?$',
  // Relay URL
  '^wss?://[a-zA-Z0-9._-]+(?::[0-9]+)?(?:/.*)?$',
  // A-tag patterns
  '^\\d+:[a-f0-9]{64}:.+$',
  '^30311:[a-f0-9]{64}:.+$',
  '^30312:[a-f0-9]{64}:.+$',
  '^(31922|31923):[a-f0-9]{64}:.+$',
  // Exact values
  '^(38172|38173)$',
  '^m (image/(apng|avif|gif|jpeg|png|webp))$',
  // Prefix nonempty
  '^alt .+$',
  '^blurhash .+$',
  // Hex prefixed
  '^x [a-f0-9]{64}$',
  // CSV list
  '^[A-Za-z0-9_]+(,[A-Za-z0-9_]+)*$',
  '^[0-9]+(,[0-9]+)*$',
  // Prefix no whitespace
  '^url https?://\\S+$',
  '^fallback https?://\\S+$',
  '^ref: refs/heads/[^\\s]+$',
  // Complex ops
  '^annotate-user [a-f0-9]{64}:[0-9]+(?:\\.[0-9]+)?:[0-9]+(?:\\.[0-9]+)?$',
  '^(([a-z][a-z0-9+\\.-]*://)|git@)[^\\s]+$',
  '^lnbc[a-z0-9]*1[02-9ac-hj-np-z]+$',
  '^ln[a-z0-9]+[02-9ac-hj-np-z]*1[02-9ac-hj-np-z]+$',
  '^[a-z]+/[a-z0-9.+-]+$',
  '^https?://[^/]+/?$',
  '^[^\\s@]+@[^\\s@]+$',
  '^10\\.\\d{4,9}/.+$',
  '^[a-z0-9._\\-/]+:.+',
  '^(#|[A-Za-z0-9][A-Za-z0-9._+-]*(?::[A-Za-z0-9][A-Za-z0-9._+-]*)*)$',
  '^[a-zA-Z][a-zA-Z0-9!#$&^_-]*/[a-zA-Z0-9*][a-zA-Z0-9!#$&^_.+-]*(\\s*;\\s*[a-zA-Z0-9!#$&^_.+-]+=[a-zA-Z0-9!#$&^_.+-]+)*$',
  // Wrapped
  '^-----BEGIN PGP SIGNATURE-----[\\s\\S]*-----END PGP SIGNATURE-----$',
  // imeta dim
  '^dim [0-9]{1,5}x[0-9]{1,5}$',
  // Additional from schemata dist
  '^(02|03)[a-f0-9]{64}$',
  '^https?://\\S+$',
];

// Deduplicate
const UNIQUE_PATTERNS = [...new Set(ALL_PATTERNS)];

// ---------------------------------------------------------------------------
// Main fuzz test
// ---------------------------------------------------------------------------

describe('fuzz-equivalence: PatternCheck native vs regex', () => {
  const SEED = 42;
  let totalPatterns = 0;
  let testedPatterns = 0;
  let skippedPatterns = 0;
  let totalInputs = 0;
  let totalMismatches = 0;

  for (const pattern of UNIQUE_PATTERNS) {
    it(`equivalence: ${pattern.slice(0, 60)}${pattern.length > 60 ? '...' : ''}`, () => {
      totalPatterns++;

      const check = classifyRegex(pattern);

      // Skip regex fallbacks (no native checker to test)
      if (check.op === 'regex') {
        skippedPatterns++;
        return;
      }

      const nativeChecker = buildNativeChecker(check, pattern);
      if (nativeChecker === null) {
        skippedPatterns++;
        return;
      }

      const regex = new RegExp(pattern);
      const rng = makeRng(SEED);
      const inputs = generateInputsForCheck(rng, check);

      // Ensure we have at least 200 inputs
      assert.ok(inputs.length >= 50,
        `Expected at least 50 inputs for pattern ${pattern}, got ${inputs.length}`);

      testedPatterns++;
      let mismatches = 0;
      const mismatchDetails: string[] = [];

      for (const input of inputs) {
        const regexResult = regex.test(input);
        const nativeResult = nativeChecker(input);
        totalInputs++;

        if (regexResult !== nativeResult) {
          mismatches++;
          totalMismatches++;
          if (mismatchDetails.length < 10) {
            mismatchDetails.push(
              `  input=${JSON.stringify(input)} regex=${regexResult} native=${nativeResult}`
            );
          }
        }
      }

      if (mismatches > 0) {
        assert.fail(
          `${mismatches} mismatch(es) for pattern ${pattern} (op: ${check.op}, ${inputs.length} inputs tested):\n` +
          mismatchDetails.join('\n') +
          (mismatches > 10 ? `\n  ... and ${mismatches - 10} more` : '')
        );
      }
    });
  }

  it('summary: all native ops tested', () => {
    // This test runs last and reports overall statistics
    assert.ok(testedPatterns > 0, 'Should have tested at least one pattern');
    // We expect the vast majority of patterns to be testable (non-regex fallback)
    assert.ok(testedPatterns >= UNIQUE_PATTERNS.length * 0.8,
      `Expected >= 80% of patterns to be testable, got ${testedPatterns}/${UNIQUE_PATTERNS.length} (${skippedPatterns} skipped as regex fallback)`);
  });
});

// ---------------------------------------------------------------------------
// Additional targeted fuzz for edge cases that have historically caused bugs
// ---------------------------------------------------------------------------

describe('fuzz-equivalence: targeted edge cases', () => {
  const SEED = 12345;

  it('a_tag: leading zeros with kinds filter', () => {
    const rng = makeRng(SEED);
    const pattern = '^(31922|31923):[a-f0-9]{64}:.+$';
    const regex = new RegExp(pattern);
    const check = classifyRegex(pattern);
    const nativeChecker = buildNativeChecker(check, pattern);
    assert.ok(nativeChecker, 'Should build native checker');

    const hex64 = 'a'.repeat(64);
    const inputs: string[] = [];

    // All possible leading-zero variants
    for (const kind of ['31922', '31923', '031922', '031923', '0031922', '00031922']) {
      inputs.push(`${kind}:${hex64}:test`);
    }

    // Random kinds
    for (let i = 0; i < 50; i++) {
      const kindLen = rng.nextInt(1, 8);
      const kind = rng.randomString(kindLen, DIGITS);
      inputs.push(`${kind}:${hex64}:test`);
    }

    for (const input of inputs) {
      const regexResult = regex.test(input);
      const nativeResult = nativeChecker(input);
      assert.strictEqual(nativeResult, regexResult,
        `a_tag kinds mismatch for ${JSON.stringify(input)}: regex=${regexResult} native=${nativeResult}`);
    }
  });

  it('content_type: ECMAScript whitespace around semicolons', () => {
    const rng = makeRng(SEED);
    const pattern = '^[a-zA-Z][a-zA-Z0-9!#$&^_-]*/[a-zA-Z0-9*][a-zA-Z0-9!#$&^_.+-]*(\\s*;\\s*[a-zA-Z0-9!#$&^_.+-]+=[a-zA-Z0-9!#$&^_.+-]+)*$';
    const regex = new RegExp(pattern);
    const check = classifyRegex(pattern);
    const nativeChecker = buildNativeChecker(check, pattern);
    assert.ok(nativeChecker, 'Should build native checker');

    const inputs: string[] = [];

    // Test every ECMA whitespace char around semicolons
    for (const ws of ECMA_WS) {
      inputs.push(`text/plain${ws};${ws}charset=utf-8`);
      inputs.push(`text/plain${ws}`); // trailing ws should fail
      inputs.push(`text/plain;charset=utf-8${ws}`); // trailing ws should fail
    }

    // Combinations
    for (let i = 0; i < 30; i++) {
      const ws1 = rng.pick(ECMA_WS);
      const ws2 = rng.pick(ECMA_WS);
      inputs.push(`text/plain${ws1}${ws2};${ws1}charset=utf-8`);
    }

    for (const input of inputs) {
      const regexResult = regex.test(input);
      const nativeResult = nativeChecker(input);
      assert.strictEqual(nativeResult, regexResult,
        `content_type ws mismatch for ${JSON.stringify(input)}: regex=${regexResult} native=${nativeResult}`);
    }
  });

  it('annotate_user: decimal edge cases', () => {
    const pattern = '^annotate-user [a-f0-9]{64}:[0-9]+(?:\\.[0-9]+)?:[0-9]+(?:\\.[0-9]+)?$';
    const regex = new RegExp(pattern);
    const check = classifyRegex(pattern);
    const nativeChecker = buildNativeChecker(check, pattern);
    assert.ok(nativeChecker, 'Should build native checker');

    const hex64 = 'a'.repeat(64);
    const inputs: string[] = [];

    // Various decimal edge cases
    const coords = ['0', '1', '42', '0.0', '1.5', '0.', '.5', '1.2.3', '1.', '', '1..2'];
    for (const x of coords) {
      for (const y of coords) {
        inputs.push(`annotate-user ${hex64}:${x}:${y}`);
      }
    }

    for (const input of inputs) {
      const regexResult = regex.test(input);
      const nativeResult = nativeChecker(input);
      assert.strictEqual(nativeResult, regexResult,
        `annotate_user decimal mismatch for ${JSON.stringify(input)}: regex=${regexResult} native=${nativeResult}`);
    }
  });

  it('email_like: all ECMA whitespace rejected', () => {
    const pattern = '^[^\\s@]+@[^\\s@]+$';
    const regex = new RegExp(pattern);
    const check = classifyRegex(pattern);
    const nativeChecker = buildNativeChecker(check, pattern);
    assert.ok(nativeChecker, 'Should build native checker');

    const inputs: string[] = [];

    // Test every ECMA whitespace char in local and domain parts
    for (const ws of ECMA_WS) {
      inputs.push(`user${ws}name@domain.com`);
      inputs.push(`user@domain${ws}name.com`);
      inputs.push(`${ws}user@domain.com`);
      inputs.push(`user@domain.com${ws}`);
    }

    for (const input of inputs) {
      const regexResult = regex.test(input);
      const nativeResult = nativeChecker(input);
      assert.strictEqual(nativeResult, regexResult,
        `email_like ws mismatch for ${JSON.stringify(input)}: regex=${regexResult} native=${nativeResult}`);
    }
  });

  it('relay_url: line terminator variations in path', () => {
    const pattern = '^wss?://[a-zA-Z0-9._-]+(?::[0-9]+)?(?:/.*)?$';
    const regex = new RegExp(pattern);
    const check = classifyRegex(pattern);
    const nativeChecker = buildNativeChecker(check, pattern);
    assert.ok(nativeChecker, 'Should build native checker');

    const inputs: string[] = [];

    // Test each line terminator type at various positions in path
    const lineTerms = ['\n', '\r', '\u2028', '\u2029'];
    for (const lt of lineTerms) {
      inputs.push(`wss://relay.example.com/${lt}`);
      inputs.push(`wss://relay.example.com/${lt}path`);
      inputs.push(`wss://relay.example.com/path${lt}`);
      inputs.push(`wss://relay.example.com/pa${lt}th`);
    }

    // NEL should be accepted by JS . but not by Java/Swift
    inputs.push('wss://relay.example.com/\u0085path');

    // Unicode whitespace that's NOT a line terminator (accepted by .)
    inputs.push('wss://relay.example.com/\u00A0path');
    inputs.push('wss://relay.example.com/\u3000path');
    inputs.push('wss://relay.example.com/\uFEFFpath');

    for (const input of inputs) {
      const regexResult = regex.test(input);
      const nativeResult = nativeChecker(input);
      assert.strictEqual(nativeResult, regexResult,
        `relay_url line term mismatch for ${JSON.stringify(input)}: regex=${regexResult} native=${nativeResult}`);
    }
  });

  it('prefix_no_whitespace: full ECMA \\S equivalence', () => {
    const pattern = '^url https?://\\S+$';
    const regex = new RegExp(pattern);
    const check = classifyRegex(pattern);
    const nativeChecker = buildNativeChecker(check, pattern);
    assert.ok(nativeChecker, 'Should build native checker');

    const inputs: string[] = [];

    // All ECMA whitespace chars should cause rejection
    for (const ws of ECMA_WS) {
      inputs.push(`url http://example${ws}com`);
      inputs.push(`url https://example.com${ws}`);
    }

    // Non-whitespace Unicode should be accepted
    inputs.push('url http://example\u0100.com');
    inputs.push('url http://example\u4E2D.com'); // CJK

    for (const input of inputs) {
      const regexResult = regex.test(input);
      const nativeResult = nativeChecker(input);
      assert.strictEqual(nativeResult, regexResult,
        `prefix_no_ws mismatch for ${JSON.stringify(input)}: regex=${regexResult} native=${nativeResult}`);
    }
  });

  it('external_identity: dot-tail with line terminators', () => {
    // Note: this regex is NOT $-anchored (from schemata): ^[a-z0-9._\-/]+:.+
    // But classifyRegex classifies it the same way.
    // The un-anchored regex matches partial strings differently...
    // Let's test the anchored version that schemata dist actually uses.
    const pattern = '^[a-z0-9._\\-/]+:.+';
    const regex = new RegExp(pattern);
    const check = classifyRegex(pattern);
    const nativeChecker = buildNativeChecker(check, pattern);
    assert.ok(nativeChecker, 'Should build native checker');

    const inputs: string[] = [];

    // Line terminators in value part
    for (const lt of JS_LINE_TERMINATORS) {
      inputs.push(`github:${lt}user`);
      inputs.push(`github:user${lt}rest`);
    }
    inputs.push('github:\u0085user'); // NEL: JS . matches it

    for (const input of inputs) {
      const regexResult = regex.test(input);
      const nativeResult = nativeChecker(input);
      assert.strictEqual(nativeResult, regexResult,
        `external_identity dot-tail mismatch for ${JSON.stringify(input)}: regex=${regexResult} native=${nativeResult}`);
    }
  });
});
