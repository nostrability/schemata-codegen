import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { emitValidatorsFile } from '../src/emit-validators.js';
import type { TagShape } from '../src/patterns.js';
import type { KindShape } from '../src/kind-types.js';

const imetaShape: TagShape = {
  fileName: 'imeta',
  tagName: 'imeta',
  pattern: 'structured_metadata',
  positions: [
    { index: 0, required: true, constValue: 'imeta', type: 'string' },
    { index: 1, required: true, type: 'string' },
  ],
  minItems: 2,
  additionalItems: true,
  containsPatterns: ['^url https?://\\S+$', '^m (image/(apng|avif|gif|jpeg|png|webp))$'],
};

const mlsExtShape: TagShape = {
  fileName: 'mls_extensions',
  tagName: 'mls_extensions',
  pattern: 'structured_metadata',
  positions: [
    { index: 0, required: true, constValue: 'mls_extensions', type: 'string' },
    { index: 1, required: true, type: 'string', pattern: '^0x[0-9a-f]{4}$' },
  ],
  minItems: 3,
  additionalItems: true,
  containsConstants: ['0xf2ee', '0x000a'],
};

const kind9735: KindShape = {
  kindNumber: 9735,
  nip: 'nip-57',
  title: 'kind9735',
  description: 'Zap Receipt',
  requiredTags: [
    {
      tagName: 'p',
      positions: [
        { index: 0, required: true, constValue: 'p', type: 'string' },
        { index: 1, required: true, type: 'string', pattern: '^[a-f0-9]{64}$' },
      ],
      minItems: 2,
      additionalItems: false,
      errorMessage: 'tags must include a p tag for the zap recipient',
    },
    {
      tagName: 'bolt11',
      positions: [
        { index: 0, required: true, constValue: 'bolt11', type: 'string' },
        { index: 1, required: true, type: 'string' },
      ],
      minItems: 2,
      additionalItems: false,
      errorMessage: 'tags must include a bolt11 tag with the invoice',
    },
    {
      tagName: 'description',
      positions: [
        { index: 0, required: true, constValue: 'description', type: 'string' },
        { index: 1, required: true, type: 'string' },
      ],
      minItems: 2,
      additionalItems: false,
      errorMessage: 'tags must include a description tag (JSON-encoded zap request)',
    },
  ],
  perItemConditionals: [],
  arrayLevelConditionals: [],
  category: 'multi-contains',
};

const bareKind: KindShape = {
  kindNumber: 1,
  nip: 'nip-01',
  requiredTags: [],
  perItemConditionals: [],
  arrayLevelConditionals: [],
  category: 'bare',
};

describe('emitValidatorsFile', () => {
  it('emits ValidationError interface', () => {
    const output = emitValidatorsFile([], []);
    assert.ok(output.includes('export interface ValidationError'));
    assert.ok(output.includes('path: string'));
    assert.ok(output.includes('message: string'));
  });

  it('emits tag-level validators for structured_metadata', () => {
    const output = emitValidatorsFile([imetaShape], []);
    assert.ok(output.includes('export function validateImetaTag'));
    assert.ok(output.includes('RegExp'));
    assert.ok(output.includes('^url https?://\\\\S+$'));
  });

  it('emits tag validator with const contains', () => {
    const output = emitValidatorsFile([mlsExtShape], []);
    assert.ok(output.includes('export function validateMlsExtensionsTag'));
    assert.ok(output.includes('"0xf2ee"'));
    assert.ok(output.includes('"0x000a"'));
    assert.ok(output.includes('tag.slice(1).includes'));
  });

  it('skips tag validators for non-structured_metadata', () => {
    const amountShape: TagShape = {
      fileName: 'amount',
      tagName: 'amount',
      pattern: 'fixed_tuple',
      positions: [
        { index: 0, required: true, constValue: 'amount', type: 'string' },
        { index: 1, required: true, type: 'string' },
      ],
      minItems: 2,
      maxItems: 2,
      additionalItems: false,
    };
    const output = emitValidatorsFile([amountShape], []);
    assert.ok(!output.includes('validateAmountTag'));
  });

  it('emits kind-level validators for constrained kinds', () => {
    const output = emitValidatorsFile([], [kind9735]);
    assert.ok(output.includes('export function validateKind9735Tags'));
    assert.ok(output.includes('t[0] === "p"'));
    assert.ok(output.includes('t[0] === "bolt11"'));
    assert.ok(output.includes('t[0] === "description"'));
  });

  it('skips kind validators for bare kinds', () => {
    const output = emitValidatorsFile([], [bareKind]);
    assert.ok(!output.includes('validateKind1Tags'));
  });

  it('emits dispatch function', () => {
    const output = emitValidatorsFile([], [kind9735, bareKind]);
    assert.ok(output.includes('export function validateKindTags'));
    assert.ok(output.includes('case 9735:'));
    assert.ok(!output.includes('case 1:'));
  });

  it('emits both tag and kind validators together', () => {
    const output = emitValidatorsFile([imetaShape, mlsExtShape], [kind9735]);
    assert.ok(output.includes('validateImetaTag'));
    assert.ok(output.includes('validateMlsExtensionsTag'));
    assert.ok(output.includes('validateKind9735Tags'));
    assert.ok(output.includes('validateKindTags'));
  });
});
