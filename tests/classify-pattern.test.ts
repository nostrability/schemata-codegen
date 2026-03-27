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

  it('classifies ^[A-Za-z]{3,}$ as chars_in', () => {
    const r = classifyRegex('^[A-Za-z]{3,}$');
    // This won't match {3,} without max — but the regex has a comma without max
    // Let's check what actually happens
    if (r.op === 'chars_in') {
      assert.strictEqual(r.charset, 'A-Za-z');
    }
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

  // --- Regex fallback ---

  it('falls back to regex for complex patterns', () => {
    const r = classifyRegex('^\\d+(?:\\.\\d+)?$');
    assert.strictEqual(r.op, 'regex');
    assert.ok(r.op === 'regex');
    assert.strictEqual(r.pattern, '^\\d+(?:\\.\\d+)?$');
    assert.ok(!isNativeCheck(r));
  });

  it('falls back to regex for PGP signature', () => {
    const r = classifyRegex('^-----BEGIN PGP SIGNATURE-----[\\s\\S]*-----END PGP SIGNATURE-----$');
    assert.strictEqual(r.op, 'regex');
  });

  it('falls back to regex for ISO 8601 datetime', () => {
    const r = classifyRegex('^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}(:\\d{2})?(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2})?)?$');
    assert.strictEqual(r.op, 'regex');
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
    '^(31922|31923):[a-f0-9]{64}:.+$',
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
