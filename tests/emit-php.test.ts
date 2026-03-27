import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { emitPhpValidators } from '../src/emit-php.js';
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

describe('emitPhpValidators', () => {
  it('output starts with <?php', () => {
    const output = emitPhpValidators([kind9735]);
    assert.ok(output.startsWith('<?php'));
  });

  it('generates class SchemataValidationError', () => {
    const output = emitPhpValidators([kind9735]);
    assert.ok(output.includes('class SchemataValidationError {'));
    assert.ok(output.includes('public string $path;'));
    assert.ok(output.includes('public string $message;'));
    assert.ok(output.includes('public function __construct(string $path, string $message)'));
    assert.ok(output.includes('$this->path = $path;'));
    assert.ok(output.includes('$this->message = $message;'));
  });

  it('generates per-kind validation function', () => {
    const output = emitPhpValidators([kind9735]);
    assert.ok(output.includes('function schemata_validate_kind_9735(array $tags): array'));
  });

  it('generates hex check helper', () => {
    const output = emitPhpValidators([kind9735]);
    assert.ok(output.includes('function schemata_check_hex64(string $s): bool'));
    assert.ok(output.includes('ctype_xdigit($s)'));
    assert.ok(output.includes('strtolower($s)'));
  });

  it('uses foreach ($tags as $t)', () => {
    const output = emitPhpValidators([kind9735]);
    assert.ok(output.includes('foreach ($tags as $t)'));
  });

  it('generates tag search with found flag', () => {
    const output = emitPhpValidators([kind9735]);
    assert.ok(output.includes('$found = false;'));
    assert.ok(output.includes('$found = true;'));
    assert.ok(output.includes('break;'));
    assert.ok(output.includes('if (!$found)'));
  });

  it('generates dispatch with match($kind)', () => {
    const output = emitPhpValidators([kind9735, bareKind]);
    assert.ok(output.includes('match($kind)'));
    assert.ok(output.includes('9735 => schemata_validate_kind_9735($tags)'));
    // Bare kind should not appear in dispatch
    assert.ok(!output.includes('1 => schemata_validate_kind_1'));
  });

  it('skips bare kinds', () => {
    const output = emitPhpValidators([bareKind]);
    assert.ok(!output.includes('schemata_validate_kind_1'));
  });

  it('does not include bare kind in dispatch', () => {
    const output = emitPhpValidators([kind9735, bareKind]);
    assert.ok(!output.includes('1 => schemata_validate_kind_1'));
  });

  it('handles optional enum positions', () => {
    const output = emitPhpValidators([optionalEnumKind]);
    assert.ok(output.includes('schemata_validate_kind_10002'));
    assert.ok(output.includes("'read'"));
    assert.ok(output.includes("'write'"));
  });

  it('generates str_starts_with for URL pattern', () => {
    const output = emitPhpValidators([optionalEnumKind]);
    assert.ok(output.includes('str_starts_with('));
  });

  it('handles any-of-group', () => {
    const output = emitPhpValidators([anyOfKind]);
    assert.ok(output.includes('schemata_validate_kind_777'));
    assert.ok(output.includes('$found0'));
    assert.ok(output.includes('$found1'));
    assert.ok(output.includes('$found0 || $found1'));
  });

  it('generates tag name check with isset and ===', () => {
    const output = emitPhpValidators([kind9735]);
    assert.ok(output.includes("isset($t[0]) && $t[0] === 'p'"));
    assert.ok(output.includes("isset($t[0]) && $t[0] === 'bolt11'"));
  });

  it('generates count guard for position checks', () => {
    const output = emitPhpValidators([kind9735]);
    assert.ok(output.includes('count($t) >'));
    assert.ok(output.includes('count($t) <') || output.includes('count($t) >='));
  });

  it('uses $errors array and new SchemataValidationError', () => {
    const output = emitPhpValidators([kind9735]);
    assert.ok(output.includes('$errors = [];'));
    assert.ok(output.includes("$errors[] = new SchemataValidationError('tags'"));
    assert.ok(output.includes('return $errors;'));
  });

  it('uses PHP single quotes for strings', () => {
    const output = emitPhpValidators([kind9735]);
    // Check that tag names use single quotes
    assert.ok(output.includes("'p'"));
    assert.ok(output.includes("'bolt11'"));
    assert.ok(output.includes("'tags'"));
  });

  it('generates dispatch function signature', () => {
    const output = emitPhpValidators([kind9735]);
    assert.ok(output.includes('function schemata_validate_kind_tags(int $kind, array $tags): array'));
  });

  it('includes auto-generated header comment', () => {
    const output = emitPhpValidators([kind9735]);
    assert.ok(output.includes('// Auto-generated by @nostrability/schemata-codegen'));
    assert.ok(output.includes('// Do not edit manually.'));
  });

  it('generates docstring for kind functions', () => {
    const output = emitPhpValidators([kind9735]);
    assert.ok(output.includes('/** Validate tags for kind 9735 (nip-57). */'));
  });
});

describe('emitPhpValidators full run', () => {
  it('generates valid PHP for mixed kind types', () => {
    const kinds: KindShape[] = [kind9735, bareKind, optionalEnumKind, anyOfKind];
    const output = emitPhpValidators(kinds);
    assert.ok(output.length > 500);
    assert.ok(output.includes('schemata_validate_kind_9735'));
    assert.ok(output.includes('schemata_validate_kind_10002'));
    assert.ok(output.includes('schemata_validate_kind_777'));
    assert.ok(!output.includes('function schemata_validate_kind_1('));
    // dispatch has all three constrained kinds
    assert.ok(output.includes('9735 => schemata_validate_kind_9735'));
    assert.ok(output.includes('10002 => schemata_validate_kind_10002'));
    assert.ok(output.includes('777 => schemata_validate_kind_777'));
    assert.ok(output.includes('default => []'));
  });

  it('generates strlen-based hex check', () => {
    const kinds: KindShape[] = [kind9735];
    const output = emitPhpValidators(kinds);
    assert.ok(output.includes('strlen($s) === 64'));
  });
});
