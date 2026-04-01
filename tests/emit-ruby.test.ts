import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { emitRubyValidators } from '../src/emit-ruby.js';
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

describe('emitRubyValidators', () => {
  it('generates ValidationError Struct', () => {
    const output = emitRubyValidators([kind9735]);
    assert.ok(output.includes('ValidationError = Struct.new(:path, :message)'));
  });

  it('generates per-kind validation method', () => {
    const output = emitRubyValidators([kind9735]);
    assert.ok(output.includes('def self.validate_kind_9735(tags)'));
    assert.ok(output.includes('errors = []'));
    assert.ok(output.includes('errors'));
  });

  it('generates hex check helper', () => {
    const output = emitRubyValidators([kind9735]);
    assert.ok(output.includes('def self.check_hex_64(s)'));
    assert.ok(output.includes('[a-f0-9]'));
  });

  it('uses .any? for tag search', () => {
    const output = emitRubyValidators([kind9735]);
    assert.ok(output.includes('.any?'));
    assert.ok(output.includes('{ |t|'));
  });

  it('generates case dispatch', () => {
    const output = emitRubyValidators([kind9735, bareKind]);
    assert.ok(output.includes('case kind'));
    assert.ok(output.includes('when 9735 then validate_kind_9735'));
    assert.ok(!output.includes('when 1 then'));
  });

  it('skips bare kinds', () => {
    const output = emitRubyValidators([bareKind]);
    assert.ok(!output.includes('validate_kind_1'));
  });

  it('handles optional enum', () => {
    const output = emitRubyValidators([optionalEnumKind]);
    assert.ok(output.includes('validate_kind_10002'));
    assert.ok(output.includes("'read'"));
    assert.ok(output.includes("'write'"));
    assert.ok(output.includes('.include?'));
  });

  it('handles any-of-group', () => {
    const output = emitRubyValidators([anyOfKind]);
    assert.ok(output.includes('validate_kind_777'));
    assert.ok(output.includes('.any?'));
    assert.ok(output.includes('||'));
  });

  it('generates full output for mixed kind types', () => {
    const kinds: KindShape[] = [kind9735, bareKind, optionalEnumKind, anyOfKind];
    const output = emitRubyValidators(kinds);
    assert.ok(output.length > 500);
    assert.ok(output.includes('validate_kind_9735'));
    assert.ok(output.includes('validate_kind_10002'));
    assert.ok(output.includes('validate_kind_777'));
    assert.ok(!output.includes('def self.validate_kind_1('));
  });

  it('wraps output in module SchemataValidators', () => {
    const output = emitRubyValidators([kind9735]);
    assert.ok(output.includes('module SchemataValidators'));
    assert.ok(output.includes('end'));
    // Module end should be the last non-empty line
    const trimmed = output.trimEnd();
    const lastLines = trimmed.split('\n').slice(-2);
    assert.ok(lastLines.some(l => l.trim() === 'end'));
  });

  it('starts with frozen_string_literal comment', () => {
    const output = emitRubyValidators([kind9735]);
    assert.ok(output.startsWith('# frozen_string_literal: true'));
  });

  it('uses single quotes for Ruby strings', () => {
    const output = emitRubyValidators([kind9735]);
    assert.ok(output.includes("'tags'"));
    assert.ok(output.includes("'p'"));
    assert.ok(output.includes("'bolt11'"));
  });

  it('generates unless for require_tag', () => {
    const output = emitRubyValidators([kind9735]);
    assert.ok(output.includes('unless tags.any?'));
  });

  it('generates tags.each do for optional positions', () => {
    const output = emitRubyValidators([optionalEnumKind]);
    assert.ok(output.includes('tags.each do |t|'));
  });

  it('uses << for error append', () => {
    const output = emitRubyValidators([kind9735]);
    assert.ok(output.includes('errors << ValidationError.new('));
  });

  it('generates dispatch with else empty array', () => {
    const output = emitRubyValidators([kind9735]);
    assert.ok(output.includes('else []'));
  });
});

describe('validate_event', () => {
  it('contains validate_event function', () => {
    const output = emitRubyValidators([kindWithContent]);
    assert.ok(output.includes('def self.validate_event('));
  });

  it('validates base fields', () => {
    const output = emitRubyValidators([kindWithContent]);
    assert.ok(output.includes('check_hex_64'));
    assert.ok(output.includes('check_hex_128'));
  });

  it('validates content for constrained kinds', () => {
    const output = emitRubyValidators([kindWithContent]);
    assert.ok(output.includes('.length < 1'));
  });

  it('dispatches to validate_kind_tags', () => {
    const output = emitRubyValidators([kindWithContent]);
    assert.ok(output.includes('validate_kind_tags('));
  });

  it('includes hex128 helper', () => {
    const output = emitRubyValidators([kindWithContent]);
    assert.ok(output.includes('def self.check_hex_128'));
  });
});
