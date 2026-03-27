import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { emitCSharpValidators } from '../src/emit-csharp.js';
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

describe('emitCSharpValidators', () => {
  it('generates record ValidationError', () => {
    const output = emitCSharpValidators([kind9735]);
    assert.ok(output.includes('public record ValidationError(string Path, string Message)'));
  });

  it('generates per-kind validation method', () => {
    const output = emitCSharpValidators([kind9735]);
    assert.ok(output.includes('public static List<ValidationError> ValidateKind9735(IReadOnlyList<IReadOnlyList<string>> tags)'));
    assert.ok(output.includes('List<ValidationError>'));
  });

  it('generates CheckHex64 helper', () => {
    const output = emitCSharpValidators([kind9735]);
    assert.ok(output.includes('private static bool CheckHex64(string s)'));
    assert.ok(output.includes("(c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')"));
  });

  it('uses .Any( for tag search', () => {
    const output = emitCSharpValidators([kind9735]);
    assert.ok(output.includes('.Any('));
    assert.ok(output.includes('tags.Any(t =>'));
  });

  it('generates dispatch switch', () => {
    const output = emitCSharpValidators([kind9735, bareKind]);
    assert.ok(output.includes('kind switch'));
    assert.ok(output.includes('9735 => ValidateKind9735(tags)'));
    assert.ok(!output.includes('1 => ValidateKind1(tags)'));
  });

  it('skips bare kinds', () => {
    const output = emitCSharpValidators([bareKind]);
    assert.ok(!output.includes('ValidateKind1'));
  });

  it('handles optional enum', () => {
    const output = emitCSharpValidators([optionalEnumKind]);
    assert.ok(output.includes('ValidateKind10002'));
    assert.ok(output.includes('"read"'));
    assert.ok(output.includes('"write"'));
  });

  it('handles any-of-group', () => {
    const output = emitCSharpValidators([anyOfKind]);
    assert.ok(output.includes('ValidateKind777'));
    assert.ok(output.includes('.Any('));
  });

  it('wraps output in namespace Schemata', () => {
    const output = emitCSharpValidators([kind9735]);
    assert.ok(output.includes('namespace Schemata'));
  });

  it('wraps output in class SchemataValidators', () => {
    const output = emitCSharpValidators([kind9735]);
    assert.ok(output.includes('public static class SchemataValidators'));
  });
});

describe('emitCSharpValidators full run', () => {
  it('generates valid C# for mixed kind types', () => {
    const kinds: KindShape[] = [kind9735, bareKind, optionalEnumKind, anyOfKind];
    const output = emitCSharpValidators(kinds);
    assert.ok(output.length > 500);
    assert.ok(output.includes('ValidateKind9735'));
    assert.ok(output.includes('ValidateKind10002'));
    assert.ok(output.includes('ValidateKind777'));
    assert.ok(!output.includes('public static List<ValidationError> ValidateKind1('));
    assert.ok(output.includes('namespace Schemata'));
    assert.ok(output.includes('public static class SchemataValidators'));
    assert.ok(output.includes('using System.Collections.Generic;'));
    assert.ok(output.includes('using System.Linq;'));
  });
});
