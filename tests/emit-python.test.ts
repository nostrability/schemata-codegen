import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { emitPythonValidators } from '../src/emit-python.js';
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

const kindWithContent: KindShape = {
  kindNumber: 13,
  nip: 'nip-59',
  requiredTags: [],
  perItemConditionals: [],
  arrayLevelConditionals: [],
  anyOfTagGroups: [],
  contentConstraints: { minLength: 1 },
  category: 'bare',
};

describe('emitPythonValidators', () => {
  it('generates ValidationError dataclass', () => {
    const output = emitPythonValidators([kind9735]);
    assert.ok(output.includes('@dataclass'));
    assert.ok(output.includes('class ValidationError:'));
    assert.ok(output.includes('path: str'));
    assert.ok(output.includes('message: str'));
  });

  it('generates from __future__ import annotations', () => {
    const output = emitPythonValidators([kind9735]);
    assert.ok(output.includes('from __future__ import annotations'));
  });

  it('generates from dataclasses import dataclass', () => {
    const output = emitPythonValidators([kind9735]);
    assert.ok(output.includes('from dataclasses import dataclass'));
  });

  it('generates per-kind validation function', () => {
    const output = emitPythonValidators([kind9735]);
    assert.ok(output.includes('def validate_kind_9735(tags: list[list[str]]) -> list[ValidationError]:'));
  });

  it('generates _check_hex_64 helper', () => {
    const output = emitPythonValidators([kind9735]);
    assert.ok(output.includes('def _check_hex_64(s: str) -> bool:'));
    assert.ok(output.includes('"0123456789abcdef"'));
    assert.ok(output.includes('len(s) == 64'));
  });

  it('uses any() for tag search', () => {
    const output = emitPythonValidators([kind9735]);
    assert.ok(output.includes('any('));
    assert.ok(output.includes('for t in tags)'));
  });

  it('generates dispatch function', () => {
    const output = emitPythonValidators([kind9735, bareKind]);
    assert.ok(output.includes('def validate_kind_tags(kind: int, tags: list[list[str]]) -> list[ValidationError]:'));
    assert.ok(output.includes('9735: validate_kind_9735'));
  });

  it('skips bare kinds', () => {
    const output = emitPythonValidators([bareKind]);
    assert.ok(!output.includes('validate_kind_1'));
  });

  it('does not include bare kind in dispatch', () => {
    const output = emitPythonValidators([kind9735, bareKind]);
    assert.ok(!output.includes('1: validate_kind_1'));
  });

  it('handles optional enum positions', () => {
    const output = emitPythonValidators([optionalEnumKind]);
    assert.ok(output.includes('validate_kind_10002'));
    assert.ok(output.includes('"read"'));
    assert.ok(output.includes('"write"'));
  });

  it('generates startswith for URL pattern', () => {
    const output = emitPythonValidators([optionalEnumKind]);
    assert.ok(output.includes('.startswith('));
  });

  it('handles any-of-group', () => {
    const output = emitPythonValidators([anyOfKind]);
    assert.ok(output.includes('validate_kind_777'));
    assert.ok(output.includes('any('));
    assert.ok(output.includes(' or '));
  });

  it('generates tag name check with t[0]', () => {
    const output = emitPythonValidators([kind9735]);
    assert.ok(output.includes('t[0] == "p"'));
    assert.ok(output.includes('t[0] == "bolt11"'));
  });

  it('generates len guard for position checks', () => {
    const output = emitPythonValidators([kind9735]);
    assert.ok(output.includes('len(t) >'));
    assert.ok(output.includes('len(t) >='));
  });

  it('uses Python boolean operators', () => {
    const output = emitPythonValidators([kind9735]);
    assert.ok(output.includes(' and '));
    assert.ok(output.includes('not any('));
  });
});

describe('emitPythonValidators full run', () => {
  it('generates valid Python for mixed kind types', () => {
    const kinds: KindShape[] = [kind9735, bareKind, optionalEnumKind, anyOfKind];
    const output = emitPythonValidators(kinds);
    assert.ok(output.length > 500);
    assert.ok(output.includes('validate_kind_9735'));
    assert.ok(output.includes('validate_kind_10002'));
    assert.ok(output.includes('validate_kind_777'));
    assert.ok(!output.includes('def validate_kind_1('));
  });

  it('includes auto-generated header comment', () => {
    const kinds: KindShape[] = [kind9735];
    const output = emitPythonValidators(kinds);
    assert.ok(output.includes('# Auto-generated by @nostrability/schemata-codegen'));
    assert.ok(output.includes('# Do not edit manually.'));
  });

  it('generates docstrings for kind functions', () => {
    const kinds: KindShape[] = [kind9735];
    const output = emitPythonValidators(kinds);
    assert.ok(output.includes('"""Validate tags for kind 9735 (nip-57)."""'));
  });

  it('generates dict dispatch for constrained kinds', () => {
    const kinds: KindShape[] = [kind9735, optionalEnumKind, anyOfKind];
    const output = emitPythonValidators(kinds);
    assert.ok(output.includes('_dispatch'));
    assert.ok(output.includes('.get(kind)'));
  });
});

describe('validate_event', () => {
  it('contains validate_event function', () => {
    const output = emitPythonValidators([kindWithContent]);
    assert.ok(output.includes('def validate_event('));
  });

  it('validates base fields', () => {
    const output = emitPythonValidators([kindWithContent]);
    assert.ok(output.includes('_check_hex_64'));
    assert.ok(output.includes('_check_hex_128'));
  });

  it('validates content for constrained kinds', () => {
    const output = emitPythonValidators([kindWithContent]);
    assert.ok(output.includes('len(content) < 1'));
  });

  it('dispatches to validate_kind_tags', () => {
    const output = emitPythonValidators([kindWithContent]);
    assert.ok(output.includes('validate_kind_tags('));
  });

  it('includes hex128 helper', () => {
    const output = emitPythonValidators([kindWithContent]);
    assert.ok(output.includes('def _check_hex_128'));
  });
});
