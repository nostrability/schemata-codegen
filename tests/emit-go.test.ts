import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { emitGoValidators } from '../src/emit-go.js';
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

describe('emitGoValidators', () => {
  it('generates ValidationError struct', () => {
    const output = emitGoValidators([kind9735]);
    assert.ok(output.includes('type ValidationError struct'));
    assert.ok(output.includes('Path    string'));
    assert.ok(output.includes('Message string'));
  });

  it('generates per-kind validation function', () => {
    const output = emitGoValidators([kind9735]);
    assert.ok(output.includes('func ValidateKind9735(tags [][]string) []ValidationError'));
  });

  it('generates hex check helper with checkHex64', () => {
    const output = emitGoValidators([kind9735]);
    assert.ok(output.includes('func checkHex64(s string) bool'));
    assert.ok(output.includes("b >= '0' && b <= '9'"));
    assert.ok(output.includes("b >= 'a' && b <= 'f'"));
  });

  it('uses for _, t := range tags', () => {
    const output = emitGoValidators([kind9735]);
    assert.ok(output.includes('for _, t := range tags'));
  });

  it('uses loop + found flag + break pattern', () => {
    const output = emitGoValidators([kind9735]);
    assert.ok(output.includes('found := false'));
    assert.ok(output.includes('found = true'));
    assert.ok(output.includes('break'));
    assert.ok(output.includes('if !found {'));
  });

  it('generates dispatch switch', () => {
    const output = emitGoValidators([kind9735, bareKind]);
    assert.ok(output.includes('func ValidateKindTags(kind int, tags [][]string) []ValidationError'));
    assert.ok(output.includes('switch kind {'));
    assert.ok(output.includes('case 9735:'));
    assert.ok(output.includes('return ValidateKind9735(tags)'));
    // bare kind should not appear
    assert.ok(!output.includes('case 1:'));
  });

  it('skips bare kinds', () => {
    const output = emitGoValidators([bareKind]);
    assert.ok(!output.includes('ValidateKind1'));
  });

  it('handles optional enum positions', () => {
    const output = emitGoValidators([optionalEnumKind]);
    assert.ok(output.includes('ValidateKind10002'));
    assert.ok(output.includes('"read"'));
    assert.ok(output.includes('"write"'));
  });

  it('handles any-of-group', () => {
    const output = emitGoValidators([anyOfKind]);
    assert.ok(output.includes('ValidateKind777'));
    // Should have multiple found flags
    assert.ok(output.includes('found0'));
    assert.ok(output.includes('found1'));
    // Should check both tag names
    assert.ok(output.includes('"k"'));
    assert.ok(output.includes('"authors"'));
  });

  it('generates package schemata declaration', () => {
    const output = emitGoValidators([kind9735]);
    assert.ok(output.includes('package schemata'));
  });

  it('adds strings import when starts_with pattern is used', () => {
    const output = emitGoValidators([optionalEnumKind]);
    assert.ok(output.includes('import "strings"') || output.includes('"strings"'));
    assert.ok(output.includes('strings.HasPrefix'));
  });

  it('uses len(t) guards for tag access', () => {
    const output = emitGoValidators([kind9735]);
    assert.ok(output.includes('len(t) >'));
    assert.ok(output.includes('len(t) >='));
  });

  it('generates maxItems check when present', () => {
    const output = emitGoValidators([optionalEnumKind]);
    assert.ok(output.includes('len(t) <= 3'));
  });

  it('full run with all 4 kinds does not crash', () => {
    const kinds: KindShape[] = [kind9735, bareKind, optionalEnumKind, anyOfKind];
    const output = emitGoValidators(kinds);
    assert.ok(output.length > 500);
    assert.ok(output.includes('ValidateKind9735'));
    assert.ok(output.includes('ValidateKind10002'));
    assert.ok(output.includes('ValidateKind777'));
    assert.ok(!output.includes('func ValidateKind1('));
  });
});
