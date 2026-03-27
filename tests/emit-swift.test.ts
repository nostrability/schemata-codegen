import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { emitSwiftValidators } from '../src/emit-swift.js';
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

describe('emitSwiftValidators', () => {
  it('generates ValidationError struct', () => {
    const output = emitSwiftValidators([kind9735]);
    assert.ok(output.includes('public struct ValidationError'));
    assert.ok(output.includes('public let path: String'));
    assert.ok(output.includes('public let message: String'));
    assert.ok(output.includes('public init(path: String, message: String)'));
  });

  it('generates per-kind validation function', () => {
    const output = emitSwiftValidators([kind9735]);
    assert.ok(output.includes('public func validateKind9735(tags: [[String]]) -> [ValidationError]'));
    assert.ok(output.includes('var errors: [ValidationError] = []'));
    assert.ok(output.includes('return errors'));
  });

  it('generates hex64 check helper', () => {
    const output = emitSwiftValidators([kind9735]);
    assert.ok(output.includes('private func checkHex64(_ s: String) -> Bool'));
    assert.ok(output.includes('$0.isHexDigit'));
    assert.ok(output.includes('$0.isLowercase || $0.isNumber'));
  });

  it('uses .contains(where: for tag search', () => {
    const output = emitSwiftValidators([kind9735]);
    assert.ok(output.includes('.contains(where:'));
    assert.ok(output.includes('{ t in'));
  });

  it('generates dispatch switch', () => {
    const output = emitSwiftValidators([kind9735, bareKind]);
    assert.ok(output.includes('public func validateKindTags(kind: Int, tags: [[String]]) -> [ValidationError]'));
    assert.ok(output.includes('switch kind'));
    assert.ok(output.includes('case 9735: return validateKind9735(tags: tags)'));
    assert.ok(!output.includes('case 1:'));
  });

  it('skips bare kinds', () => {
    const output = emitSwiftValidators([bareKind]);
    assert.ok(!output.includes('validateKind1'));
    // Should still have the dispatch and struct
    assert.ok(output.includes('public struct ValidationError'));
    assert.ok(output.includes('switch kind'));
  });

  it('handles optional enum positions', () => {
    const output = emitSwiftValidators([optionalEnumKind]);
    assert.ok(output.includes('validateKind10002'));
    assert.ok(output.includes('"read"'));
    assert.ok(output.includes('"write"'));
    assert.ok(output.includes('.contains('));
  });

  it('handles any-of-group', () => {
    const output = emitSwiftValidators([anyOfKind]);
    assert.ok(output.includes('validateKind777'));
    assert.ok(output.includes('.contains(where:'));
    // Should have OR logic for the two tag alternatives
    assert.ok(output.includes('||'));
  });

  it('does not import Foundation when no regex needed', () => {
    const output = emitSwiftValidators([anyOfKind]);
    assert.ok(!output.includes('import Foundation'));
  });

  it('generates auto-generated header', () => {
    const output = emitSwiftValidators([kind9735]);
    assert.ok(output.includes('Auto-generated by @nostrability/schemata-codegen'));
    assert.ok(output.includes('Do not edit manually'));
  });
});

describe('emitSwiftValidators full run', () => {
  it('generates valid Swift for mixed kind types', () => {
    const kinds: KindShape[] = [kind9735, bareKind, optionalEnumKind, anyOfKind];
    const output = emitSwiftValidators(kinds);
    assert.ok(output.length > 500);
    assert.ok(output.includes('validateKind9735'));
    assert.ok(output.includes('validateKind10002'));
    assert.ok(output.includes('validateKind777'));
    assert.ok(!output.includes('public func validateKind1('));
    // Verify dispatch has all constrained kinds
    assert.ok(output.includes('case 777:'));
    assert.ok(output.includes('case 9735:'));
    assert.ok(output.includes('case 10002:'));
    assert.ok(output.includes('default: return []'));
  });

  it('sorts kind functions by number', () => {
    const kinds: KindShape[] = [kind9735, anyOfKind, optionalEnumKind];
    const output = emitSwiftValidators(kinds);
    const idx777 = output.indexOf('validateKind777');
    const idx9735 = output.indexOf('validateKind9735');
    const idx10002 = output.indexOf('validateKind10002');
    assert.ok(idx777 < idx9735, 'kind 777 should come before 9735');
    assert.ok(idx9735 < idx10002, 'kind 9735 should come before 10002');
  });
});
