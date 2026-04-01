import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { emitCppValidators } from '../src/emit-cpp.js';
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

describe('emitCppValidators', () => {
  it('generates struct ValidationError', () => {
    const output = emitCppValidators([kind9735]);
    assert.ok(output.includes('struct ValidationError'));
    assert.ok(output.includes('const char* path'));
    assert.ok(output.includes('const char* message'));
  });

  it('generates per-kind validation function', () => {
    const output = emitCppValidators([kind9735]);
    assert.ok(output.includes('validate_kind_9735'));
    assert.ok(output.includes('std::vector<ValidationError>'));
    assert.ok(output.includes('const std::vector<std::vector<std::string>>& tags'));
  });

  it('generates hex check helper', () => {
    const output = emitCppValidators([kind9735]);
    assert.ok(output.includes('inline bool check_hex_64(const std::string& s)'));
    assert.ok(output.includes("(c >= '0' && c <= '9')"));
    assert.ok(output.includes("(c >= 'a' && c <= 'f')"));
  });

  it('uses std::any_of for tag search', () => {
    const output = emitCppValidators([kind9735]);
    assert.ok(output.includes('std::any_of(tags.begin(), tags.end(),'));
  });

  it('generates dispatch switch', () => {
    const output = emitCppValidators([kind9735, bareKind]);
    assert.ok(output.includes('switch (kind)'));
    assert.ok(output.includes('case 9735: return validate_kind_9735'));
    assert.ok(!output.includes('case 1: return validate_kind_1'));
  });

  it('skips bare kinds', () => {
    const output = emitCppValidators([bareKind]);
    assert.ok(!output.includes('validate_kind_1'));
  });

  it('has #pragma once and includes', () => {
    const output = emitCppValidators([kind9735]);
    assert.ok(output.includes('#pragma once'));
    assert.ok(output.includes('#include <vector>'));
    assert.ok(output.includes('#include <string>'));
    assert.ok(output.includes('#include <algorithm>'));
    assert.ok(output.includes('#include <cstddef>'));
  });

  it('handles optional enum', () => {
    const output = emitCppValidators([optionalEnumKind]);
    assert.ok(output.includes('validate_kind_10002'));
    assert.ok(output.includes('"read"'));
    assert.ok(output.includes('"write"'));
  });

  it('handles any-of-group', () => {
    const output = emitCppValidators([anyOfKind]);
    assert.ok(output.includes('validate_kind_777'));
    assert.ok(output.includes('std::any_of('));
  });

  it('output wrapped in namespace schemata', () => {
    const output = emitCppValidators([kind9735]);
    assert.ok(output.includes('namespace schemata {'));
    assert.ok(output.includes('} // namespace schemata'));
  });

  it('full run generates valid output for mixed kind types', () => {
    const kinds: KindShape[] = [kind9735, bareKind, optionalEnumKind, anyOfKind];
    const output = emitCppValidators(kinds);
    assert.ok(output.length > 500);
    assert.ok(output.includes('validate_kind_9735'));
    assert.ok(output.includes('validate_kind_10002'));
    assert.ok(output.includes('validate_kind_777'));
    assert.ok(!output.includes('inline std::vector<ValidationError> validate_kind_1('));
    // Verify structural elements
    assert.ok(output.includes('#pragma once'));
    assert.ok(output.includes('namespace schemata {'));
    assert.ok(output.includes('switch (kind)'));
    assert.ok(output.includes('struct ValidationError'));
  });
});

describe('validate_event', () => {
  it('contains validate_event function', () => {
    const output = emitCppValidators([kindWithContent]);
    assert.ok(output.includes('validate_event('));
  });

  it('validates base fields', () => {
    const output = emitCppValidators([kindWithContent]);
    assert.ok(output.includes('check_hex_64'));
    assert.ok(output.includes('check_hex_128'));
  });

  it('validates content for constrained kinds', () => {
    const output = emitCppValidators([kindWithContent]);
    assert.ok(output.includes('utf8_char_count(event.content) < 1'));
  });

  it('dispatches to validate_kind_tags', () => {
    const output = emitCppValidators([kindWithContent]);
    assert.ok(output.includes('validate_kind_tags('));
  });

  it('includes hex128 helper', () => {
    const output = emitCppValidators([kindWithContent]);
    assert.ok(output.includes('struct SchemataEvent'));
    assert.ok(output.includes('check_hex_128'));
  });
});
