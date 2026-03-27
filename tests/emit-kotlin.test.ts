import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { emitKotlinValidators } from '../src/emit-kotlin.js';
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

describe('emitKotlinValidators', () => {
  it('generates data class ValidationError', () => {
    const output = emitKotlinValidators([kind9735]);
    assert.ok(output.includes('data class ValidationError(val path: String, val message: String)'));
  });

  it('generates per-kind validation function', () => {
    const output = emitKotlinValidators([kind9735]);
    assert.ok(output.includes('fun validateKind9735(tags: List<List<String>>): List<ValidationError>'));
  });

  it('generates checkHex64 helper', () => {
    const output = emitKotlinValidators([kind9735]);
    assert.ok(output.includes('private fun checkHex64(s: String): Boolean'));
    assert.ok(output.includes("it in '0'..'9' || it in 'a'..'f'"));
  });

  it('uses .any { for tag search', () => {
    const output = emitKotlinValidators([kind9735]);
    assert.ok(output.includes('.any { t ->'));
    assert.ok(output.includes('t.firstOrNull() =='));
  });

  it('generates when (kind) dispatch', () => {
    const output = emitKotlinValidators([kind9735, bareKind]);
    assert.ok(output.includes('when (kind)'));
    assert.ok(output.includes('9735 -> validateKind9735'));
    assert.ok(!output.includes('1 -> validateKind1'));
  });

  it('skips bare kinds', () => {
    const output = emitKotlinValidators([bareKind]);
    assert.ok(!output.includes('validateKind1'));
  });

  it('handles optional enum ("read", "write")', () => {
    const output = emitKotlinValidators([optionalEnumKind]);
    assert.ok(output.includes('validateKind10002'));
    assert.ok(output.includes('"read"'));
    assert.ok(output.includes('"write"'));
    assert.ok(output.includes('in listOf('));
  });

  it('handles any-of-group', () => {
    const output = emitKotlinValidators([anyOfKind]);
    assert.ok(output.includes('validateKind777'));
    assert.ok(output.includes('.any { t ->'));
    assert.ok(output.includes(' || '));
  });

  it('generates valid Kotlin for mixed kind types', () => {
    const kinds: KindShape[] = [kind9735, bareKind, optionalEnumKind, anyOfKind];
    const output = emitKotlinValidators(kinds);
    assert.ok(output.length > 500);
    assert.ok(output.includes('validateKind9735'));
    assert.ok(output.includes('validateKind10002'));
    assert.ok(output.includes('validateKind777'));
    assert.ok(!output.includes('fun validateKind1('));
    // dispatch has all three constrained kinds
    assert.ok(output.includes('9735 -> validateKind9735'));
    assert.ok(output.includes('10002 -> validateKind10002'));
    assert.ok(output.includes('777 -> validateKind777'));
    assert.ok(output.includes('else -> emptyList()'));
  });

  it('uses mutableListOf for error collection', () => {
    const output = emitKotlinValidators([kind9735]);
    assert.ok(output.includes('val errors = mutableListOf<ValidationError>()'));
    assert.ok(output.includes('errors.add('));
    assert.ok(output.includes('return errors'));
  });

  it('uses getOrNull for safe position access', () => {
    const output = emitKotlinValidators([kind9735]);
    assert.ok(output.includes('.getOrNull('));
  });

  it('does not add regex import when not needed', () => {
    const output = emitKotlinValidators([kind9735]);
    assert.ok(!output.includes('import kotlin.text.Regex'));
  });
});
