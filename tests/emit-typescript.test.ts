import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { emitTagType, tagTypeName, fileNameToTypeName } from '../src/emit-typescript.js';
import type { TagShape } from '../src/patterns.js';

describe('fileNameToTypeName', () => {
  it('handles simple names', () => {
    assert.equal(fileNameToTypeName('amount'), 'Amount');
    assert.equal(fileNameToTypeName('e'), 'E');
    assert.equal(fileNameToTypeName('t'), 'T');
  });

  it('handles hyphenated names', () => {
    assert.equal(fileNameToTypeName('content-warning'), 'ContentWarning');
    assert.equal(fileNameToTypeName('a-live'), 'ALive');
    assert.equal(fileNameToTypeName('commit-pgp-sig'), 'CommitPgpSig');
  });

  it('handles underscore aliases', () => {
    assert.equal(fileNameToTypeName('_A'), 'UpperA');
    assert.equal(fileNameToTypeName('_E'), 'UpperE');
    assert.equal(fileNameToTypeName('_K'), 'UpperK');
  });
});

describe('tagTypeName', () => {
  it('appends Tag suffix', () => {
    assert.equal(tagTypeName('amount'), 'AmountTag');
    assert.equal(tagTypeName('e'), 'ETag');
    assert.equal(tagTypeName('_A'), 'UpperATag');
  });
});

describe('emitTagType', () => {
  it('emits fixed-length tuple', () => {
    const shape: TagShape = {
      fileName: 'amount',
      tagName: 'amount',
      pattern: 'fixed_tuple',
      positions: [
        { index: 0, required: true, constValue: 'amount', type: 'string' },
        { index: 1, required: true, type: 'string', pattern: '^[0-9]+$' },
      ],
      minItems: 2,
      maxItems: 2,
      additionalItems: false,
    };
    const output = emitTagType(shape);
    assert.ok(output.includes('export type AmountTag = readonly ["amount", string];'));
  });

  it('emits optional trailing as union', () => {
    const shape: TagShape = {
      fileName: 'r',
      tagName: 'r',
      pattern: 'optional_trailing',
      positions: [
        { index: 0, required: true, constValue: 'r', type: 'string' },
        { index: 1, required: true, type: 'string', pattern: '^(ws://|wss://).+$' },
        { index: 2, required: false, type: 'string', enumValues: ['read', 'write'] },
      ],
      minItems: 2,
      maxItems: 3,
      additionalItems: false,
    };
    const output = emitTagType(shape);
    assert.ok(output.includes('readonly ["r", string]'));
    assert.ok(output.includes('readonly ["r", string, "read" | "write"]'));
  });

  it('emits open-tail with rest', () => {
    const shape: TagShape = {
      fileName: 't',
      tagName: 't',
      pattern: 'open_tail',
      positions: [
        { index: 0, required: true, constValue: 't', type: 'string' },
        { index: 1, required: true, type: 'string' },
      ],
      minItems: 2,
      additionalItems: true,
    };
    const output = emitTagType(shape);
    assert.ok(output.includes('readonly ["t", string, ...string[]]'));
  });

  it('emits discriminated union with variants', () => {
    const shape: TagShape = {
      fileName: 'e',
      tagName: 'e',
      pattern: 'discriminated_union',
      positions: [],
      minItems: 2,
      additionalItems: false,
      variants: [
        {
          minItems: 4,
          maxItems: 5,
          positions: [
            { index: 0, required: true, constValue: 'e', type: 'string' },
            { index: 1, required: true, type: 'string', pattern: '^[a-f0-9]{64}$' },
            { index: 2, required: true, type: 'string' },
            { index: 3, required: true, type: 'string', enumValues: ['reply', 'root'] },
            { index: 4, required: false, type: 'string' },
          ],
          additionalItems: false,
        },
        {
          minItems: 2,
          maxItems: 3,
          positions: [
            { index: 0, required: true, constValue: 'e', type: 'string' },
            { index: 1, required: true, type: 'string', pattern: '^[a-f0-9]{64}$' },
            { index: 2, required: false, type: 'string' },
          ],
          additionalItems: false,
        },
      ],
    };
    const output = emitTagType(shape);
    assert.ok(output.includes('ETagVariant1'));
    assert.ok(output.includes('ETagVariant2'));
    assert.ok(output.includes('export type ETag = ETagVariant1 | ETagVariant2'));
  });

  it('emits structured metadata with contains comment', () => {
    const shape: TagShape = {
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
    const output = emitTagType(shape);
    assert.ok(output.includes('readonly ["imeta", string, ...string[]]'));
    assert.ok(output.includes('// Runtime: must contain entries matching:'));
  });

  it('does not produce string[] anywhere', () => {
    // Verify no fallback to untyped string[] in the amount tag
    const shape: TagShape = {
      fileName: 'bolt11',
      tagName: 'bolt11',
      pattern: 'fixed_tuple',
      positions: [
        { index: 0, required: true, constValue: 'bolt11', type: 'string' },
        { index: 1, required: true, type: 'string', pattern: '^ln[a-z0-9]+' },
      ],
      minItems: 2,
      maxItems: 2,
      additionalItems: false,
    };
    const output = emitTagType(shape);
    assert.ok(!output.includes('string[]'), 'Should not contain string[]');
    assert.ok(output.includes('readonly ['));
  });
});
