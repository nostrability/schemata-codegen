import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractTag } from '../src/extract-tag.js';
import type { SchemaNode } from '../src/patterns.js';

// --- Test schemas matching real schemata dist/ structure ---

const BASE_TAG: SchemaNode = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'array',
  items: { type: 'string' },
  uniqueItems: false,
};

function wrapTag(structural: SchemaNode, meta?: { title?: string; description?: string; oneOf?: SchemaNode[] }): SchemaNode {
  return {
    allOf: [{
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: meta?.title,
      description: meta?.description,
      allOf: [
        { allOf: [BASE_TAG] },
        structural,
      ],
      oneOf: meta?.oneOf,
    }],
  };
}

// 1. Fixed-length tuple: amount tag
const amountSchema = wrapTag({
  type: 'array',
  minItems: 2,
  items: [
    { const: 'amount' },
    { type: 'string', pattern: '^[0-9]+$', description: 'Amount in millisats' },
  ],
  additionalItems: false,
});

// 2. Optional trailing: r tag
const rSchema = wrapTag({
  type: 'array',
  minItems: 2,
  maxItems: 3,
  items: [
    { const: 'r' },
    { type: 'string', pattern: '^(ws://|wss://).+$', description: 'Relay URL' },
    { type: 'string', enum: ['read', 'write'], description: 'Optional read/write marker' },
  ],
  additionalItems: false,
});

// 3. Open-tail: t tag
const tSchema = wrapTag({
  type: 'array',
  minItems: 2,
  items: [
    { const: 't' },
    { type: 'string' },
  ],
  additionalItems: true,
});

// 4. Discriminated union: e tag
const eSchema: SchemaNode = {
  allOf: [{
    $schema: 'http://json-schema.org/draft-07/schema#',
    allOf: [
      { allOf: [BASE_TAG] },
    ],
    oneOf: [
      {
        type: 'array',
        minItems: 4,
        maxItems: 5,
        items: [
          { const: 'e' },
          { type: 'string', pattern: '^[a-f0-9]{64}$' },
          { anyOf: [
            { type: 'string', pattern: '^(ws://|wss://).+$' },
            { type: 'string', const: '' },
          ]},
          { type: 'string', enum: ['reply', 'root'] },
          { allOf: [{ type: 'string', pattern: '^[a-f0-9]{64}$' }] },
        ],
        additionalItems: false,
      },
      {
        type: 'array',
        minItems: 2,
        maxItems: 3,
        items: [
          { const: 'e' },
          { type: 'string', pattern: '^[a-f0-9]{64}$' },
          { type: 'string', pattern: '^(ws://|wss://).+$' },
        ],
        additionalItems: false,
      },
    ],
  }],
};

// 5. Structured metadata: imeta tag
const imetaSchema: SchemaNode = {
  allOf: [{
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'imeta tag',
    description: 'NIP-68 metadata describing an image attachment',
    allOf: [
      { allOf: [BASE_TAG] },
      {
        type: 'array',
        minItems: 2,
        items: [
          { const: 'imeta' },
          { anyOf: [
            { type: 'string', pattern: '^url https?://\\S+$' },
            { type: 'string', pattern: '^m (image/(apng|avif|gif|jpeg|png|webp))$' },
          ]},
        ],
        additionalItems: {
          anyOf: [
            { type: 'string', pattern: '^url https?://\\S+$' },
            { type: 'string', pattern: '^m (image/(apng|avif|gif|jpeg|png|webp))$' },
          ],
        },
        allOf: [
          { contains: { type: 'string', pattern: '^url https?://\\S+$' } },
          { contains: { type: 'string', pattern: '^m (image/(apng|avif|gif|jpeg|png|webp))$' } },
        ],
      },
    ],
  }],
};

// 6. Structured metadata with contains.const: mls_extensions tag
const mlsExtensionsSchema: SchemaNode = {
  allOf: [{
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'MLS Extensions',
    allOf: [
      { allOf: [BASE_TAG] },
      {
        type: 'array',
        minItems: 3,
        uniqueItems: true,
        items: [
          { const: 'mls_extensions' },
          { type: 'string', pattern: '^0x[0-9a-f]{4}$', description: 'MLS extension identifier' },
        ],
        additionalItems: { type: 'string', pattern: '^0x[0-9a-f]{4}$' },
        allOf: [
          { contains: { const: '0xf2ee' }, errorMessage: { contains: 'must include 0xf2ee' } },
          { contains: { const: '0x000a' }, errorMessage: { contains: 'must include 0x000a' } },
        ],
      },
    ],
  }],
};

describe('extractTag', () => {
  it('extracts fixed-length tuple (amount)', () => {
    const shape = extractTag(amountSchema, 'amount');
    assert.equal(shape.pattern, 'fixed_tuple');
    assert.equal(shape.tagName, 'amount');
    assert.equal(shape.positions.length, 2);
    assert.equal(shape.positions[0].constValue, 'amount');
    assert.equal(shape.positions[1].pattern, '^[0-9]+$');
    assert.equal(shape.additionalItems, false);
    assert.equal(shape.minItems, 2);
  });

  it('extracts optional trailing (r tag)', () => {
    const shape = extractTag(rSchema, 'r');
    assert.equal(shape.pattern, 'optional_trailing');
    assert.equal(shape.tagName, 'r');
    assert.equal(shape.positions.length, 3);
    assert.equal(shape.positions[0].constValue, 'r');
    assert.equal(shape.positions[1].pattern, '^(ws://|wss://).+$');
    assert.deepEqual(shape.positions[2].enumValues, ['read', 'write']);
    assert.equal(shape.positions[2].required, false); // index 2 >= minItems 2
    assert.equal(shape.minItems, 2);
    assert.equal(shape.maxItems, 3);
  });

  it('extracts open-tail (t tag)', () => {
    const shape = extractTag(tSchema, 't');
    assert.equal(shape.pattern, 'open_tail');
    assert.equal(shape.tagName, 't');
    assert.equal(shape.positions.length, 2);
    assert.equal(shape.positions[0].constValue, 't');
    assert.equal(shape.additionalItems, true);
  });

  it('extracts discriminated union (e tag)', () => {
    const shape = extractTag(eSchema, 'e');
    assert.equal(shape.pattern, 'discriminated_union');
    assert.equal(shape.tagName, 'e');
    assert.ok(shape.variants);
    assert.equal(shape.variants!.length, 2);

    // Variant 1: 4-5 items (marked)
    const v1 = shape.variants![0];
    assert.equal(v1.minItems, 4);
    assert.equal(v1.maxItems, 5);
    assert.equal(v1.positions[0].constValue, 'e');
    assert.deepEqual(v1.positions[3].enumValues, ['reply', 'root']);

    // Variant 2: 2-3 items (positional)
    const v2 = shape.variants![1];
    assert.equal(v2.minItems, 2);
    assert.equal(v2.maxItems, 3);
  });

  it('extracts structured metadata (imeta tag)', () => {
    const shape = extractTag(imetaSchema, 'imeta');
    assert.equal(shape.pattern, 'structured_metadata');
    assert.equal(shape.tagName, 'imeta');
    assert.equal(shape.additionalItems, true);
    assert.ok(shape.containsPatterns);
    assert.ok(shape.containsPatterns!.length >= 2);
  });

  it('extracts containsConstants for mls_extensions', () => {
    const shape = extractTag(mlsExtensionsSchema, 'mls_extensions');
    assert.equal(shape.pattern, 'structured_metadata');
    assert.equal(shape.tagName, 'mls_extensions');
    assert.ok(shape.containsConstants);
    assert.deepEqual(shape.containsConstants, ['0xf2ee', '0x000a']);
    // Should not have containsPatterns (no pattern in contains)
    assert.equal(shape.containsPatterns!.length, 0);
  });
});
