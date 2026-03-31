import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRegex, isNativeCheck, type PatternCheck } from '../src/classify-pattern.js';

describe('classifyRegex', () => {
  // --- Hex fixed-length ---

  it('classifies ^[a-f0-9]{64}$ as hex64 lower', () => {
    const r = classifyRegex('^[a-f0-9]{64}$');
    assert.deepStrictEqual(r, { op: 'hex', len: 64, case: 'lower' });
    assert.ok(isNativeCheck(r));
  });

  it('classifies ^[a-fA-F0-9]{64}$ as hex64 mixed', () => {
    const r = classifyRegex('^[a-fA-F0-9]{64}$');
    assert.deepStrictEqual(r, { op: 'hex', len: 64, case: 'mixed' });
  });

  it('classifies ^[a-f0-9]{128}$ as hex128 lower', () => {
    const r = classifyRegex('^[a-f0-9]{128}$');
    assert.deepStrictEqual(r, { op: 'hex', len: 128, case: 'lower' });
  });

  it('classifies ^[a-f0-9]{40}$ as hex40 lower', () => {
    const r = classifyRegex('^[a-f0-9]{40}$');
    assert.deepStrictEqual(r, { op: 'hex', len: 40, case: 'lower' });
  });

  it('classifies ^[a-fA-F0-9]{40}$ as hex40 mixed', () => {
    const r = classifyRegex('^[a-fA-F0-9]{40}$');
    assert.deepStrictEqual(r, { op: 'hex', len: 40, case: 'mixed' });
  });

  // --- Hex range ---

  it('classifies ^[a-f0-9]{7,40}$ as hex_range', () => {
    const r = classifyRegex('^[a-f0-9]{7,40}$');
    assert.deepStrictEqual(r, { op: 'hex_range', min: 7, max: 40, case: 'lower' });
    assert.ok(isNativeCheck(r));
  });

  // --- Hex prefixed ---

  it('classifies ^0x[0-9a-f]{4}$ as hex_prefixed', () => {
    const r = classifyRegex('^0x[0-9a-f]{4}$');
    assert.deepStrictEqual(r, { op: 'hex_prefixed', prefix: '0x', hexLen: 4, case: 'lower' });
    assert.ok(isNativeCheck(r));
  });

  // --- All digits ---

  it('classifies ^[0-9]+$ as all_digits', () => {
    const r = classifyRegex('^[0-9]+$');
    assert.deepStrictEqual(r, { op: 'all_digits' });
    assert.ok(isNativeCheck(r));
  });

  it('classifies ^\\d+$ as all_digits', () => {
    const r = classifyRegex('^\\d+$');
    assert.deepStrictEqual(r, { op: 'all_digits' });
  });

  it('classifies ^-?[0-9]+$ as all_digits with allowNeg', () => {
    const r = classifyRegex('^-?[0-9]+$');
    assert.deepStrictEqual(r, { op: 'all_digits', allowNeg: true });
  });

  // --- Starts-with prefixes ---

  it('classifies ^(https?://).+$ as starts_with_any', () => {
    const r = classifyRegex('^(https?://).+$');
    assert.strictEqual(r.op, 'starts_with_any');
    assert.ok(r.op === 'starts_with_any');
    assert.ok(r.prefixes.includes('http://'));
    assert.ok(r.prefixes.includes('https://'));
    assert.ok(isNativeCheck(r));
  });

  it('classifies ^(ws://|wss://).+$ as starts_with_any', () => {
    const r = classifyRegex('^(ws://|wss://).+$');
    assert.strictEqual(r.op, 'starts_with_any');
    assert.ok(r.op === 'starts_with_any');
    assert.ok(r.prefixes.includes('ws://'));
    assert.ok(r.prefixes.includes('wss://'));
  });

  it('classifies ^(https?://|rtmp://|ws://|wss://).+$ as starts_with_any', () => {
    const r = classifyRegex('^(https?://|rtmp://|ws://|wss://).+$');
    assert.strictEqual(r.op, 'starts_with_any');
    assert.ok(r.op === 'starts_with_any');
    assert.strictEqual(r.prefixes.length, 5); // http, https, rtmp, ws, wss
  });

  it('classifies ^wss?:// as starts_with_any', () => {
    const r = classifyRegex('^wss?://');
    assert.strictEqual(r.op, 'starts_with_any');
    assert.ok(r.op === 'starts_with_any');
    assert.ok(r.prefixes.includes('ws://'));
    assert.ok(r.prefixes.includes('wss://'));
  });

  it('classifies ^https?://.+$ as starts_with_any', () => {
    const r = classifyRegex('^https?://.+$');
    assert.strictEqual(r.op, 'starts_with_any');
  });

  it('classifies ^/.+ as starts_with_any(["/"])', () => {
    const r = classifyRegex('^/.+');
    assert.deepStrictEqual(r, { op: 'starts_with_any', prefixes: ['/'] });
  });

  // --- chars_in ---

  it('classifies ^[a-z0-9._-]+$ as chars_in', () => {
    const r = classifyRegex('^[a-z0-9._-]+$');
    assert.strictEqual(r.op, 'chars_in');
    assert.ok(r.op === 'chars_in');
    assert.strictEqual(r.charset, 'a-z0-9._-');
    assert.strictEqual(r.min, 1);
    assert.ok(isNativeCheck(r));
  });

  it('classifies ^[A-Za-z]{3,}$ as chars_in with unbounded max', () => {
    const r = classifyRegex('^[A-Za-z]{3,}$');
    assert.strictEqual(r.op, 'chars_in');
    assert.ok(r.op === 'chars_in');
    assert.strictEqual(r.charset, 'A-Za-z');
    assert.strictEqual(r.min, 3);
    assert.strictEqual(r.max, undefined);
    assert.ok(isNativeCheck(r));
  });

  it('classifies ^[A-Za-z]{3,6}$ as chars_in', () => {
    const r = classifyRegex('^[A-Za-z]{3,6}$');
    assert.strictEqual(r.op, 'chars_in');
    assert.ok(r.op === 'chars_in');
    assert.strictEqual(r.charset, 'A-Za-z');
    assert.strictEqual(r.min, 3);
    assert.strictEqual(r.max, 6);
  });

  it('classifies ^[A-Za-z]+$ as chars_in', () => {
    const r = classifyRegex('^[A-Za-z]+$');
    assert.strictEqual(r.op, 'chars_in');
    assert.ok(r.op === 'chars_in');
    assert.strictEqual(r.charset, 'A-Za-z');
    assert.strictEqual(r.min, 1);
  });

  it('classifies ^$ as chars_in empty', () => {
    const r = classifyRegex('^$');
    assert.strictEqual(r.op, 'chars_in');
    assert.ok(r.op === 'chars_in');
    assert.strictEqual(r.min, 0);
    assert.strictEqual(r.max, 0);
  });

  // --- Bech32 ---

  it('classifies ^npub1[02-9ac-hj-np-z]{58}$ as bech32 with fixed length', () => {
    const r = classifyRegex('^npub1[02-9ac-hj-np-z]{58}$');
    assert.deepStrictEqual(r, { op: 'bech32', hrp: 'npub', dataLen: 58 });
    assert.ok(isNativeCheck(r));
  });

  it('classifies ^note1[02-9ac-hj-np-z]{58}$ as bech32 with fixed length', () => {
    const r = classifyRegex('^note1[02-9ac-hj-np-z]{58}$');
    assert.deepStrictEqual(r, { op: 'bech32', hrp: 'note', dataLen: 58 });
    assert.ok(isNativeCheck(r));
  });

  it('classifies ^nprofile1[02-9ac-hj-np-z]+$ as bech32 variable length', () => {
    const r = classifyRegex('^nprofile1[02-9ac-hj-np-z]+$');
    assert.deepStrictEqual(r, { op: 'bech32', hrp: 'nprofile', dataLen: undefined });
    assert.ok(isNativeCheck(r));
  });

  it('classifies ^nevent1[02-9ac-hj-np-z]+$ as bech32 variable length', () => {
    const r = classifyRegex('^nevent1[02-9ac-hj-np-z]+$');
    assert.deepStrictEqual(r, { op: 'bech32', hrp: 'nevent', dataLen: undefined });
  });

  it('classifies ^naddr1[02-9ac-hj-np-z]+$ as bech32 variable length', () => {
    const r = classifyRegex('^naddr1[02-9ac-hj-np-z]+$');
    assert.deepStrictEqual(r, { op: 'bech32', hrp: 'naddr', dataLen: undefined });
  });

  it('classifies ^lnurl1[02-9ac-hj-np-z]+$ as bech32 variable length', () => {
    const r = classifyRegex('^lnurl1[02-9ac-hj-np-z]+$');
    assert.deepStrictEqual(r, { op: 'bech32', hrp: 'lnurl', dataLen: undefined });
  });

  // --- date_iso ---

  it('classifies ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ as date_iso', () => {
    const r = classifyRegex('^[0-9]{4}-[0-9]{2}-[0-9]{2}$');
    assert.deepStrictEqual(r, { op: 'date_iso' });
    assert.ok(isNativeCheck(r));
  });

  // --- decimal ---

  it('classifies ^\\d+(?:\\.\\d+)?$ as decimal', () => {
    const r = classifyRegex('^\\d+(?:\\.\\d+)?$');
    assert.deepStrictEqual(r, { op: 'decimal' });
    assert.ok(isNativeCheck(r));
  });

  // --- Relay URL ---

  it('classifies relay URL pattern as relay_url', () => {
    const r = classifyRegex('^wss?://[a-zA-Z0-9._-]+(?::[0-9]+)?(?:/.*)?$');
    assert.deepStrictEqual(r, { op: 'relay_url' });
    assert.ok(isNativeCheck(r));
  });

  // --- Regex fallback ---

  it('falls back to regex for PGP signature', () => {
    const r = classifyRegex('^-----BEGIN PGP SIGNATURE-----[\\s\\S]*-----END PGP SIGNATURE-----$');
    assert.strictEqual(r.op, 'regex');
  });

  it('classifies ISO 8601 datetime as datetime_iso', () => {
    const r = classifyRegex('^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}(:\\d{2})?(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2})?)?$');
    assert.deepStrictEqual(r, { op: 'datetime_iso' });
    assert.ok(isNativeCheck(r));
  });

  // --- a_tag ---

  it('classifies generic event coordinate as a_tag', () => {
    const r = classifyRegex('^\\d+:[a-f0-9]{64}:.+$');
    assert.deepStrictEqual(r, { op: 'a_tag' });
    assert.ok(isNativeCheck(r));
  });

  it('classifies single-kind coordinate as a_tag with kinds', () => {
    const r = classifyRegex('^30311:[a-f0-9]{64}:.+$');
    assert.deepStrictEqual(r, { op: 'a_tag', kinds: [30311] });
    assert.ok(isNativeCheck(r));
  });

  it('classifies multi-kind coordinate as a_tag with kinds', () => {
    const r = classifyRegex('^(31922|31923):[a-f0-9]{64}:.+$');
    assert.deepStrictEqual(r, { op: 'a_tag', kinds: [31922, 31923] });
    assert.ok(isNativeCheck(r));
  });

  it('isNativeCheck returns true for a_tag', () => {
    assert.ok(isNativeCheck({ op: 'a_tag' }));
    assert.ok(isNativeCheck({ op: 'a_tag', kinds: [30311] }));
  });

  it('isNativeCheck returns true for datetime_iso', () => {
    assert.ok(isNativeCheck({ op: 'datetime_iso' }));
  });

  // --- isNativeCheck ---

  it('isNativeCheck returns false for regex', () => {
    assert.ok(!isNativeCheck({ op: 'regex', pattern: 'foo' }));
  });

  it('isNativeCheck returns true for hex', () => {
    assert.ok(isNativeCheck({ op: 'hex', len: 64, case: 'lower' }));
  });

  it('isNativeCheck returns false for compound with regex', () => {
    assert.ok(!isNativeCheck({
      op: 'compound',
      checks: [
        { op: 'starts_with_any', prefixes: ['http://'] },
        { op: 'regex', pattern: 'foo' },
      ],
    }));
  });

  it('isNativeCheck returns true for compound with all native', () => {
    assert.ok(isNativeCheck({
      op: 'compound',
      checks: [
        { op: 'starts_with_any', prefixes: ['http://'] },
        { op: 'all_digits' },
      ],
    }));
  });
});

describe('classifyRegex coverage of schemata patterns', () => {
  // Test all patterns from schemata dist/ to ensure no crashes
  const patterns = [
    '^[a-f0-9]{64}$',
    '^[a-fA-F0-9]{64}$',
    '^[a-f0-9]{128}$',
    '^[a-f0-9]{40}$',
    '^[a-fA-F0-9]{40}$',
    '^[a-f0-9]{7,40}$',
    '^0x[0-9a-f]{4}$',
    '^[0-9]+$',
    '^\\d+$',
    '^-?[0-9]+$',
    '^(https?://).+$',
    '^(ws://|wss://).+$',
    '^wss?://',
    '^https?://',
    '^https?://.+',
    '^https?://.+$',
    '^https?://\\S+$',
    '^/.+',
    '^[a-z0-9._-]+$',
    '^[A-Za-z0-9]+$',
    '^[A-Za-z]+$',
    '^[A-Z]+$',
    '^[A-Za-z]{3,6}$',
    '^$',
    '^\\d+(?:\\.\\d+)?$',
    '^[0-9]{4}-[0-9]{2}-[0-9]{2}$',
    '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$',
    '^-----BEGIN PGP SIGNATURE-----[\\s\\S]*-----END PGP SIGNATURE-----$',
    '^[a-zA-Z][a-zA-Z0-9!#$&^_-]*/[a-zA-Z0-9*][a-zA-Z0-9!#$&^_.+-]*(\\s*;\\s*[a-zA-Z0-9!#$&^_.+-]+=[a-zA-Z0-9!#$&^_.+-]+)*$',
    '^\\d+:[a-f0-9]{64}:.+$',
    '^30311:[a-f0-9]{64}:.+$',
    '^30312:[a-f0-9]{64}:.+$',
    '^(31922|31923):[a-f0-9]{64}:.+$',
    '^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}(:\\d{2})?(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2})?)?$',
    '^[A-Za-z]{3,}$',
    '^npub1[02-9ac-hj-np-z]{58}$',
    '^note1[02-9ac-hj-np-z]{58}$',
    '^nprofile1[02-9ac-hj-np-z]+$',
    '^nevent1[02-9ac-hj-np-z]+$',
    '^naddr1[02-9ac-hj-np-z]+$',
    '^lnurl1[02-9ac-hj-np-z]+$',
    '^wss?://[a-zA-Z0-9._-]+(?::[0-9]+)?(?:/.*)?$',
  ];

  it('processes all schemata patterns without throwing', () => {
    for (const p of patterns) {
      const result = classifyRegex(p);
      assert.ok(result, `classifyRegex should return for: ${p}`);
      assert.ok(result.op, `result should have op for: ${p}`);
    }
  });

  it('classifies majority of patterns as native', () => {
    let nativeCount = 0;
    for (const p of patterns) {
      if (isNativeCheck(classifyRegex(p))) nativeCount++;
    }
    // At least 50% should be native
    assert.ok(nativeCount >= patterns.length * 0.5,
      `Expected >= 50% native, got ${nativeCount}/${patterns.length}`);
  });
});

describe('check_decimal behavioral correctness', () => {
  // Reference implementation matching the emitted code logic across all 12 languages.
  // This mirrors the fixed check_decimal: requires at least one leading digit
  // before the optional dot branch.
  function checkDecimal(s: string): boolean {
    if (s.length === 0) return false;
    let i = 0;
    while (i < s.length && s[i] >= '0' && s[i] <= '9') i++;
    if (i === 0) return false; // must have leading digits
    if (i < s.length && s[i] === '.') {
      i++;
      if (i >= s.length || s[i] < '0' || s[i] > '9') return false;
      while (i < s.length && s[i] >= '0' && s[i] <= '9') i++;
    }
    return i === s.length;
  }

  it('accepts integer', () => assert.ok(checkDecimal('1')));
  it('accepts multi-digit integer', () => assert.ok(checkDecimal('123')));
  it('accepts decimal', () => assert.ok(checkDecimal('1.5')));
  it('accepts long decimal', () => assert.ok(checkDecimal('123.456')));
  it('rejects leading dot', () => assert.ok(!checkDecimal('.5')));
  it('rejects empty', () => assert.ok(!checkDecimal('')));
  it('rejects alpha', () => assert.ok(!checkDecimal('a')));
  it('rejects trailing dot', () => assert.ok(!checkDecimal('1.')));
  it('rejects multiple dots', () => assert.ok(!checkDecimal('1.2.3')));
});

describe('check_relay_url behavioral correctness', () => {
  // Reference implementation using JS semantics (. excludes \n AND \r).
  // NOTE: \r handling is language-specific — see AGENTS.md. JS/Java/Kotlin/Swift/Dart/C++
  // exclude \r from `.`; Python/Ruby/C/C#/Go/Rust/PHP do not. Each emitter matches its
  // target language's regex engine. This reference impl + equivalence test verify JS only.
  // Algorithm:
  //   1. Check starts with "wss://" (pos=6) or "ws://" (pos=5), else fail
  //   2. Hostname: consume [a-zA-Z0-9._-]+, must have >=1 char
  //   3. Optional port: if ':', consume [0-9]+, must have >=1 digit
  //   4. Optional path: if '/', scan remainder rejecting \n and \r (JS regex . semantics)
  //   5. Must be at end of string
  function checkRelayUrl(s: string): boolean {
    let i = 0;
    if (s.startsWith('wss://')) {
      i = 6;
    } else if (s.startsWith('ws://')) {
      i = 5;
    } else {
      return false;
    }
    // Hostname: [a-zA-Z0-9._-]+
    const hostStart = i;
    while (i < s.length) {
      const c = s[i];
      if (
        (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
        (c >= '0' && c <= '9') || c === '.' || c === '_' || c === '-'
      ) {
        i++;
      } else {
        break;
      }
    }
    if (i === hostStart) return false; // must have >=1 hostname char
    // Optional port
    if (i < s.length && s[i] === ':') {
      i++;
      const portStart = i;
      while (i < s.length && s[i] >= '0' && s[i] <= '9') i++;
      if (i === portStart) return false; // colon but no digits
    }
    // Optional path: '/' followed by chars matching JS regex `.` (excludes JS LineTerminators)
    if (i < s.length && s[i] === '/') {
      for (let j = i + 1; j < s.length; j++) {
        const c = s[j];
        if (c === '\n' || c === '\r' || c === '\u2028' || c === '\u2029') return false;
      }
      return true;
    }
    return i === s.length;
  }

  // --- Valid URLs ---
  it('accepts wss://relay.example.com', () => assert.ok(checkRelayUrl('wss://relay.example.com')));
  it('accepts ws://relay.example.com', () => assert.ok(checkRelayUrl('ws://relay.example.com')));
  it('accepts wss://localhost', () => assert.ok(checkRelayUrl('wss://localhost')));
  it('accepts wss://relay.example.com:8080', () => assert.ok(checkRelayUrl('wss://relay.example.com:8080')));
  it('accepts wss://relay.example.com/', () => assert.ok(checkRelayUrl('wss://relay.example.com/')));
  it('accepts wss://relay.example.com/path', () => assert.ok(checkRelayUrl('wss://relay.example.com/path')));
  it('accepts wss://relay.example.com:443/path/to', () => assert.ok(checkRelayUrl('wss://relay.example.com:443/path/to')));
  it('accepts wss://a', () => assert.ok(checkRelayUrl('wss://a'))); // minimal hostname
  it('accepts ws://192.168.1.1', () => assert.ok(checkRelayUrl('ws://192.168.1.1')));
  it('accepts wss://relay-test_01.nostr.com', () => assert.ok(checkRelayUrl('wss://relay-test_01.nostr.com')));
  it('accepts wss://relay.example.com:8080/', () => assert.ok(checkRelayUrl('wss://relay.example.com:8080/')));
  it('accepts wss://relay.example.com/path with spaces after slash', () => assert.ok(checkRelayUrl('wss://relay.example.com/path with stuff')));

  // --- Invalid URLs ---
  it('rejects empty string', () => assert.ok(!checkRelayUrl('')));
  it('rejects http://relay.example.com', () => assert.ok(!checkRelayUrl('http://relay.example.com')));
  it('rejects https://relay.example.com', () => assert.ok(!checkRelayUrl('https://relay.example.com')));
  it('rejects wss:// (empty hostname)', () => assert.ok(!checkRelayUrl('wss://')));
  it('rejects ws:// (empty hostname)', () => assert.ok(!checkRelayUrl('ws://')));
  it('rejects wss://relay.example.com: (colon no port)', () => assert.ok(!checkRelayUrl('wss://relay.example.com:')));
  it('rejects wss://relay.example.com:abc (non-digit port)', () => assert.ok(!checkRelayUrl('wss://relay.example.com:abc')));
  it('rejects plain text', () => assert.ok(!checkRelayUrl('not a url')));
  it('rejects wss (no colon-slash-slash)', () => assert.ok(!checkRelayUrl('wss')));
  it('rejects wss://relay.example.com/\\npath (newline in path)', () => assert.ok(!checkRelayUrl('wss://relay.example.com/\npath')));
  // \r rejection is JS-specific; Python/Ruby/C/C#/Go/Rust/PHP accept \r (their . matches it)
  it('rejects wss://relay.example.com/path\\r\\n (CRLF in path, JS semantics)', () => assert.ok(!checkRelayUrl('wss://relay.example.com/path\r\n')));
  it('rejects wss://relay.example.com/\\u2028path (LS in path)', () => assert.ok(!checkRelayUrl('wss://relay.example.com/\u2028path')));
  it('rejects wss://relay.example.com/\\u2029path (PS in path)', () => assert.ok(!checkRelayUrl('wss://relay.example.com/\u2029path')));
  // \u0085 is NOT a JS LineTerminator — JS . matches it (but Java/Kotlin/Swift reject it)
  it('accepts wss://relay.example.com/\\u0085path (NEL, valid in JS)', () => assert.ok(checkRelayUrl('wss://relay.example.com/\u0085path')));

  // --- Regex-vs-native equivalence ---
  it('reference implementation matches regex on all test inputs', () => {
    const regex = new RegExp('^wss?://[a-zA-Z0-9._-]+(?::[0-9]+)?(?:/.*)?$');
    const inputs = [
      // Valid
      'wss://relay.example.com',
      'ws://relay.example.com',
      'wss://localhost',
      'wss://relay.example.com:8080',
      'wss://relay.example.com/',
      'wss://relay.example.com/path',
      'wss://relay.example.com:443/path/to',
      'wss://a',
      'ws://192.168.1.1',
      'wss://relay-test_01.nostr.com',
      'wss://relay.example.com:8080/',
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
      'wss://relay.example.com:8080?query',
      'wss:///path',
      'WSS://RELAY.EXAMPLE.COM',
      'wss://relay.example.com/\npath',
      'wss://relay.example.com/path\r\n',
      'wss://relay.example.com/\rpath',
      'wss://relay.example.com/\u2028path',
      'wss://relay.example.com/\u2029path',
      'wss://relay.example.com/\u0085path',  // NEL: JS . matches, Java/Swift . does not
    ];
    for (const input of inputs) {
      const regexResult = regex.test(input);
      const nativeResult = checkRelayUrl(input);
      assert.strictEqual(nativeResult, regexResult,
        `Mismatch for "${input}": native=${nativeResult}, regex=${regexResult}`);
    }
  });
});

describe('check_a_tag behavioral correctness', () => {
  // Reference implementation matching JS regex semantics.
  // Pattern: ^\d+:[a-f0-9]{64}:.+$
  // JS . excludes \n, \r, \u2028, \u2029 but NOT \u0085 (NEL)
  function checkATag(s: string, kinds?: number[]): boolean {
    if (s.length < 68) return false;
    let pos = 0;
    if (s[pos] < '0' || s[pos] > '9') return false;
    let kind = 0;
    while (pos < s.length && s[pos] >= '0' && s[pos] <= '9') {
      kind = kind * 10 + (s.charCodeAt(pos) - 0x30);
      pos++;
    }
    if (pos >= s.length || s[pos] !== ':') return false;
    if (kinds && kinds.length > 0 && !kinds.includes(kind)) return false;
    pos++;
    if (pos + 64 >= s.length) return false;
    for (let i = 0; i < 64; i++) {
      const c = s[pos + i];
      if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
    }
    pos += 64;
    if (pos >= s.length || s[pos] !== ':') return false;
    pos++;
    // .+ means >=1 char, no JS line terminators
    if (pos >= s.length) return false;
    for (let j = pos; j < s.length; j++) {
      const c = s[j];
      if (c === '\n' || c === '\r' || c === '\u2028' || c === '\u2029') return false;
    }
    return true;
  }

  const hex64 = 'a'.repeat(64);

  // --- Valid ---
  it('accepts generic coordinate', () => assert.ok(checkATag(`1:${hex64}:d-id`)));
  it('accepts kind 30023', () => assert.ok(checkATag(`30023:${hex64}:slug`)));
  it('accepts single char d-id', () => assert.ok(checkATag(`0:${hex64}:x`)));
  it('accepts d-id with spaces', () => assert.ok(checkATag(`1:${hex64}:hello world`)));
  it('accepts d-id with special chars', () => assert.ok(checkATag(`1:${hex64}:a/b?c=1&d=2`)));
  it('accepts d-id with NEL (valid in JS)', () => assert.ok(checkATag(`1:${hex64}:\u0085id`)));
  it('accepts with kinds filter matching', () => assert.ok(checkATag(`30311:${hex64}:test`, [30311])));
  it('accepts with multi-kinds filter', () => assert.ok(checkATag(`31922:${hex64}:test`, [31922, 31923])));

  // --- Invalid ---
  it('rejects empty string', () => assert.ok(!checkATag('')));
  it('rejects too short', () => assert.ok(!checkATag('1:abc:d')));
  it('rejects missing kind digits', () => assert.ok(!checkATag(`:${hex64}:d-id`)));
  it('rejects non-digit kind', () => assert.ok(!checkATag(`abc:${hex64}:d-id`)));
  it('rejects missing first colon', () => assert.ok(!checkATag(`1${hex64}:d-id`)));
  it('rejects short hex', () => assert.ok(!checkATag(`1:${'a'.repeat(63)}:d-id`)));
  it('rejects uppercase hex', () => assert.ok(!checkATag(`1:${'A'.repeat(64)}:d-id`)));
  it('rejects missing second colon', () => assert.ok(!checkATag(`1:${hex64}d-id`)));
  it('rejects empty d-id', () => assert.ok(!checkATag(`1:${hex64}:`)));
  it('rejects newline in d-id', () => assert.ok(!checkATag(`1:${hex64}:d\nid`)));
  it('rejects \\r in d-id', () => assert.ok(!checkATag(`1:${hex64}:d\rid`)));
  it('rejects wrong kind with filter', () => assert.ok(!checkATag(`30312:${hex64}:test`, [30311])));
  it('rejects wrong kind with multi-filter', () => assert.ok(!checkATag(`30000:${hex64}:test`, [31922, 31923])));

  // --- Regex equivalence ---
  it('reference matches regex for generic pattern', () => {
    const regex = new RegExp('^\\d+:[a-f0-9]{64}:.+$');
    const inputs = [
      `1:${hex64}:d-id`,
      `30023:${hex64}:slug`,
      `0:${hex64}:x`,
      `1:${hex64}:hello world`,
      '',
      'short',
      `:${hex64}:d-id`,
      `abc:${hex64}:d-id`,
      `1:${hex64}:`,
      `1:${hex64}:d\nid`,
      `1:${hex64}:d\rid`,
      `1:${hex64}:\u0085id`,
      `1:${'A'.repeat(64)}:d-id`,
      `1:${'a'.repeat(63)}:d-id`,
    ];
    for (const input of inputs) {
      const regexResult = regex.test(input);
      const nativeResult = checkATag(input);
      assert.strictEqual(nativeResult, regexResult,
        `Mismatch for ${JSON.stringify(input)}: native=${nativeResult}, regex=${regexResult}`);
    }
  });
});

describe('check_datetime_iso behavioral correctness', () => {
  // Reference implementation matching the regex:
  // ^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$
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

  // --- Valid ---
  it('accepts date only', () => assert.ok(checkDatetimeIso('2024-01-15')));
  it('accepts date + time', () => assert.ok(checkDatetimeIso('2024-01-15T10:30')));
  it('accepts date + time + seconds', () => assert.ok(checkDatetimeIso('2024-01-15T10:30:45')));
  it('accepts date + time + fractional', () => assert.ok(checkDatetimeIso('2024-01-15T10:30:45.123')));
  it('accepts date + time + Z', () => assert.ok(checkDatetimeIso('2024-01-15T10:30Z')));
  it('accepts date + time + seconds + Z', () => assert.ok(checkDatetimeIso('2024-01-15T10:30:45Z')));
  it('accepts date + time + fractional + Z', () => assert.ok(checkDatetimeIso('2024-01-15T10:30:45.123Z')));
  it('accepts positive offset', () => assert.ok(checkDatetimeIso('2024-01-15T10:30+05:30')));
  it('accepts negative offset', () => assert.ok(checkDatetimeIso('2024-01-15T10:30:45-08:00')));
  it('accepts fractional + offset', () => assert.ok(checkDatetimeIso('2024-01-15T10:30:45.9+00:00')));
  it('accepts long fractional', () => assert.ok(checkDatetimeIso('2024-01-15T10:30:45.123456789Z')));

  // --- Invalid ---
  it('rejects empty', () => assert.ok(!checkDatetimeIso('')));
  it('rejects too short', () => assert.ok(!checkDatetimeIso('2024-01-1')));
  it('rejects alpha in year', () => assert.ok(!checkDatetimeIso('20X4-01-15')));
  it('rejects wrong separator', () => assert.ok(!checkDatetimeIso('2024/01/15')));
  it('rejects T without time', () => assert.ok(!checkDatetimeIso('2024-01-15T')));
  it('rejects T with incomplete time', () => assert.ok(!checkDatetimeIso('2024-01-15T10')));
  it('rejects T with partial time', () => assert.ok(!checkDatetimeIso('2024-01-15T10:3')));
  it('rejects trailing garbage', () => assert.ok(!checkDatetimeIso('2024-01-15X')));
  it('rejects incomplete seconds', () => assert.ok(!checkDatetimeIso('2024-01-15T10:30:4')));
  it('rejects dot without digits', () => assert.ok(!checkDatetimeIso('2024-01-15T10:30:45.')));
  it('rejects incomplete offset', () => assert.ok(!checkDatetimeIso('2024-01-15T10:30+05')));
  it('rejects offset wrong format', () => assert.ok(!checkDatetimeIso('2024-01-15T10:30+0530')));
  it('rejects Z with trailing', () => assert.ok(!checkDatetimeIso('2024-01-15T10:30Zx')));

  // --- Regex equivalence ---
  it('reference matches regex on all test inputs', () => {
    const regex = new RegExp('^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}(:\\d{2})?(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2})?)?$');
    const inputs = [
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
    ];
    for (const input of inputs) {
      const regexResult = regex.test(input);
      const nativeResult = checkDatetimeIso(input);
      assert.strictEqual(nativeResult, regexResult,
        `Mismatch for "${input}": native=${nativeResult}, regex=${regexResult}`);
    }
  });
});
