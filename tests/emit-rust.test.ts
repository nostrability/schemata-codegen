import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { emitRustValidators } from '../src/emit-rust.js';
import type { KindShape } from '../src/kind-types.js';

const kind9735: KindShape = {
  kindNumber: 9735,
  nip: 'nip-57',
  requiredTags: [
    {
      tagName: 'p',
      positions: [
        { index: 0, required: true, constValue: 'p', type: 'string' },
        { index: 1, required: true, type: 'string', pattern: '^[a-f0-9]{64}$' },
      ],
      minItems: 2,
      additionalItems: false,
    },
    {
      tagName: 'bolt11',
      positions: [
        { index: 0, required: true, constValue: 'bolt11', type: 'string' },
        { index: 1, required: true, type: 'string' },
      ],
      minItems: 2,
      additionalItems: false,
    },
  ],
  perItemConditionals: [],
  arrayLevelConditionals: [],
  anyOfTagGroups: [],
  category: 'multi-contains',
};

const bareKind: KindShape = {
  kindNumber: 1,
  nip: 'nip-01',
  requiredTags: [],
  perItemConditionals: [],
  arrayLevelConditionals: [],
  anyOfTagGroups: [],
  category: 'bare',
};

const optionalEnumKind: KindShape = {
  kindNumber: 10002,
  nip: 'nip-65',
  requiredTags: [{
    tagName: 'r',
    positions: [
      { index: 0, required: true, constValue: 'r', type: 'string' },
      { index: 1, required: true, type: 'string', pattern: '^(ws://|wss://).+$' },
      { index: 2, required: false, type: 'string', enumValues: ['read', 'write'] },
    ],
    minItems: 2,
    maxItems: 3,
    additionalItems: false,
  }],
  perItemConditionals: [],
  arrayLevelConditionals: [],
  anyOfTagGroups: [],
  category: 'simple-contains',
};

const anyOfKind: KindShape = {
  kindNumber: 777,
  nip: 'nip-custom',
  requiredTags: [],
  perItemConditionals: [],
  arrayLevelConditionals: [],
  anyOfTagGroups: [{
    requirements: [
      { tagName: 'k', positions: [{ index: 0, required: true, constValue: 'k', type: 'string' }], minItems: 1, additionalItems: true },
      { tagName: 'authors', positions: [{ index: 0, required: true, constValue: 'authors', type: 'string' }], minItems: 1, additionalItems: true },
    ],
  }],
  category: 'conditional',
};

describe('emitRustValidators (generic, default)', () => {
  it('generates ValidationError struct', () => {
    const output = emitRustValidators([kind9735]);
    assert.ok(output.includes('pub struct ValidationError'));
    assert.ok(output.includes("pub path: &'static str"));
    assert.ok(output.includes("pub message: &'static str"));
  });

  it('generates per-kind validation function with generic param', () => {
    const output = emitRustValidators([kind9735]);
    assert.ok(output.includes('pub fn validate_kind_9735(tags: &[&[&str]])'));
    assert.ok(output.includes('Vec<ValidationError>'));
  });

  it('uses generic tag access', () => {
    const output = emitRustValidators([kind9735]);
    assert.ok(output.includes('.get('));
    assert.ok(output.includes('.copied()'));
    assert.ok(output.includes('.first() == Some(&'));
  });

  it('generates hex64 helper', () => {
    const output = emitRustValidators([kind9735]);
    assert.ok(output.includes('fn check_hex_64(s: &str) -> bool'));
    assert.ok(output.includes("b'0'..=b'9'"));
    assert.ok(output.includes("b'a'..=b'f'"));
  });

  it('generates dispatch match', () => {
    const output = emitRustValidators([kind9735, bareKind]);
    assert.ok(output.includes('match kind'));
    assert.ok(output.includes('9735 => validate_kind_9735'));
    assert.ok(!output.includes('1 => validate_kind_1'));
  });

  it('generates dispatch with generic param', () => {
    const output = emitRustValidators([kind9735]);
    assert.ok(output.includes('pub fn validate_kind_tags(kind: u32, tags: &[&[&str]])'));
  });

  it('skips bare kinds', () => {
    const output = emitRustValidators([bareKind]);
    assert.ok(!output.includes('validate_kind_1'));
  });

  it('generates optional position validation', () => {
    const output = emitRustValidators([optionalEnumKind]);
    assert.ok(output.includes('validate_kind_10002'));
    assert.ok(output.includes('"read"'));
    assert.ok(output.includes('"write"'));
  });

  it('generates any-of-group', () => {
    const output = emitRustValidators([anyOfKind]);
    assert.ok(output.includes('validate_kind_777'));
    assert.ok(output.includes('.any('));
  });
});

describe('emitRustValidators (nostr API)', () => {
  it('uses nostr crate tag access', () => {
    const output = emitRustValidators([kind9735], 'nostr');
    assert.ok(output.includes('as_slice()'));
    assert.ok(output.includes('.len()'));
  });

  it('generates function with Tags parameter', () => {
    const output = emitRustValidators([kind9735], 'nostr');
    assert.ok(output.includes('tags: &Tags'));
  });

  it('generates dispatch with Tags type', () => {
    const output = emitRustValidators([kind9735], 'nostr');
    assert.ok(output.includes('pub fn validate_kind_tags(kind: u32, tags: &Tags)'));
  });
});

describe('emitRustValidators (nostrdb API)', () => {
  it('uses nostrdb tag access', () => {
    const output = emitRustValidators([kind9735], 'nostrdb');
    assert.ok(output.includes('get_str('));
    assert.ok(output.includes('count()'));
  });

  it('generates function with Tag slice parameter', () => {
    const output = emitRustValidators([kind9735], 'nostrdb');
    assert.ok(output.includes('tags: &[Tag]'));
  });

  it('generates dispatch with nostrdb types', () => {
    const output = emitRustValidators([kind9735], 'nostrdb');
    assert.ok(output.includes('pub fn validate_kind_tags(kind: u32, tags: &[Tag])'));
  });
});

describe('emitRustValidators full run', () => {
  it('generates valid Rust for mixed kind types', () => {
    const kinds: KindShape[] = [kind9735, bareKind, optionalEnumKind, anyOfKind];
    const output = emitRustValidators(kinds);
    assert.ok(output.length > 500);
    assert.ok(output.includes('validate_kind_9735'));
    assert.ok(output.includes('validate_kind_10002'));
    assert.ok(output.includes('validate_kind_777'));
    assert.ok(!output.includes('pub fn validate_kind_1('));
  });
});
