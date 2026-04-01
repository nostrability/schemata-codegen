import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { emitJavaValidators } from '../src/emit-java.js';
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

describe('emitJavaValidators', () => {
  it('generates ValidationError record', () => {
    const output = emitJavaValidators([kind9735]);
    assert.ok(output.includes('public record ValidationError(String path, String message) {}'));
  });

  it('generates validateKind9735 method', () => {
    const output = emitJavaValidators([kind9735]);
    assert.ok(output.includes('public static List<ValidationError> validateKind9735(List<List<String>> tags)'));
  });

  it('generates checkHex64 helper', () => {
    const output = emitJavaValidators([kind9735]);
    assert.ok(output.includes('private static boolean checkHex64(String s)'));
    assert.ok(output.includes("(c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')"));
  });

  it('uses stream anyMatch and noneMatch', () => {
    const output = emitJavaValidators([kind9735]);
    assert.ok(output.includes('.stream().noneMatch(t ->'));
  });

  it('generates dispatch switch', () => {
    const output = emitJavaValidators([kind9735, bareKind]);
    assert.ok(output.includes('public static List<ValidationError> validateKindTags(int kind, List<List<String>> tags)'));
    assert.ok(output.includes('switch (kind)'));
    assert.ok(output.includes('case 9735:'));
    assert.ok(output.includes('return validateKind9735(tags)'));
    // bare kind should not appear
    assert.ok(!output.includes('case 1:'));
  });

  it('skips bare kinds', () => {
    const output = emitJavaValidators([bareKind]);
    assert.ok(!output.includes('validateKind1'));
  });

  it('handles optional enum positions', () => {
    const output = emitJavaValidators([optionalEnumKind]);
    assert.ok(output.includes('validateKind10002'));
    assert.ok(output.includes('"read"'));
    assert.ok(output.includes('"write"'));
  });

  it('handles any-of-group', () => {
    const output = emitJavaValidators([anyOfKind]);
    assert.ok(output.includes('validateKind777'));
    assert.ok(output.includes('tags.stream().anyMatch(t ->'));
    assert.ok(output.includes('"k"'));
    assert.ok(output.includes('"authors"'));
  });

  it('wraps output in class SchemataValidators', () => {
    const output = emitJavaValidators([kind9735]);
    assert.ok(output.includes('public final class SchemataValidators {'));
    assert.ok(output.includes('private SchemataValidators() {}'));
  });

  it('includes required imports', () => {
    const output = emitJavaValidators([kind9735]);
    assert.ok(output.includes('import java.util.ArrayList;'));
    assert.ok(output.includes('import java.util.List;'));
  });

  it('does not include regex import when not needed', () => {
    const output = emitJavaValidators([kind9735]);
    assert.ok(!output.includes('import java.util.regex.Pattern;'));
  });

  it('uses literal-first equals for NPE safety', () => {
    const output = emitJavaValidators([kind9735]);
    assert.ok(output.includes('"p".equals(t.get(0))'));
    assert.ok(output.includes('"bolt11".equals(t.get(0))'));
  });

  it('uses t.size() for length checks', () => {
    const output = emitJavaValidators([kind9735]);
    assert.ok(output.includes('t.size() >='));
  });

  it('generates maxItems check when present', () => {
    const output = emitJavaValidators([optionalEnumKind]);
    assert.ok(output.includes('t.size() <= 3'));
  });

  it('uses List.of for enum checks', () => {
    const output = emitJavaValidators([optionalEnumKind]);
    assert.ok(output.includes('List.of("read", "write").contains('));
  });

  it('uses startsWith for prefix patterns', () => {
    const output = emitJavaValidators([optionalEnumKind]);
    assert.ok(output.includes('.startsWith('));
  });

  it('full run with all 4 kinds does not crash', () => {
    const kinds: KindShape[] = [kind9735, bareKind, optionalEnumKind, anyOfKind];
    const output = emitJavaValidators(kinds);
    assert.ok(output.length > 500);
    assert.ok(output.includes('validateKind9735'));
    assert.ok(output.includes('validateKind10002'));
    assert.ok(output.includes('validateKind777'));
    assert.ok(!output.includes('public static List<ValidationError> validateKind1('));
  });
});

describe('validateEvent', () => {
  it('contains validateEvent function', () => {
    const output = emitJavaValidators([kindWithContent]);
    assert.ok(output.includes('validateEvent('));
  });

  it('validates base fields', () => {
    const output = emitJavaValidators([kindWithContent]);
    assert.ok(output.includes('checkHex64'));
    assert.ok(output.includes('checkHex128'));
  });

  it('validates content for constrained kinds', () => {
    const output = emitJavaValidators([kindWithContent]);
    assert.ok(output.includes('.length() < 1'));
  });

  it('dispatches to validateKindTags', () => {
    const output = emitJavaValidators([kindWithContent]);
    assert.ok(output.includes('validateKindTags('));
  });

  it('includes hex128 helper', () => {
    const output = emitJavaValidators([kindWithContent]);
    assert.ok(output.includes('boolean checkHex128'));
  });
});
