import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  tagNameToTypePart,
  kindScopedTagTypeName,
  collectKindTags,
  emitKindTagType,
  emitKindTagsFile,
} from '../src/emit-kind-tags.js';
import type { KindShape, TagRequirement } from '../src/kind-types.js';
import type { KindTagEntry } from '../src/emit-kind-tags.js';

// --- Helpers to build test data ---

function makeReq(tagName: string, opts?: Partial<TagRequirement>): TagRequirement {
  return {
    tagName,
    positions: [
      { index: 0, required: true, constValue: tagName, type: 'string' },
      { index: 1, required: true, type: 'string' },
    ],
    minItems: 2,
    maxItems: 2,
    additionalItems: false,
    ...opts,
  };
}

function makeShape(kindNumber: number, overrides?: Partial<KindShape>): KindShape {
  return {
    kindNumber,
    nip: 'nip-01',
    requiredTags: [],
    perItemConditionals: [],
    arrayLevelConditionals: [],
    anyOfTagGroups: [],
    category: 'bare',
    ...overrides,
  };
}

// --- tagNameToTypePart ---

describe('tagNameToTypePart', () => {
  it('handles single character', () => {
    assert.equal(tagNameToTypePart('n'), 'N');
    assert.equal(tagNameToTypePart('e'), 'E');
    assert.equal(tagNameToTypePart('d'), 'D');
  });

  it('handles simple word', () => {
    assert.equal(tagNameToTypePart('amount'), 'Amount');
    assert.equal(tagNameToTypePart('relay'), 'Relay');
  });

  it('handles hyphenated names', () => {
    assert.equal(tagNameToTypePart('rtt-open'), 'RttOpen');
    assert.equal(tagNameToTypePart('content-warning'), 'ContentWarning');
  });

  it('handles underscored names', () => {
    assert.equal(tagNameToTypePart('published_at'), 'PublishedAt');
    assert.equal(tagNameToTypePart('some_tag_name'), 'SomeTagName');
  });

  it('handles single uppercase letter with prefix', () => {
    assert.equal(tagNameToTypePart('R'), 'Upper_R');
    assert.equal(tagNameToTypePart('P'), 'Upper_P');
    assert.equal(tagNameToTypePart('N'), 'Upper_N');
  });

  it('preserves case distinction between p and P', () => {
    assert.notEqual(tagNameToTypePart('p'), tagNameToTypePart('P'));
  });

  it('handles multi-char uppercase unchanged', () => {
    assert.equal(tagNameToTypePart('URL'), 'URL');
  });
});

// --- kindScopedTagTypeName ---

describe('kindScopedTagTypeName', () => {
  it('generates correct format for lowercase', () => {
    assert.equal(kindScopedTagTypeName(30166, 'n'), 'Kind30166_NTag');
    assert.equal(kindScopedTagTypeName(7, 'e'), 'Kind7_ETag');
    assert.equal(kindScopedTagTypeName(10002, 'r'), 'Kind10002_RTag');
  });

  it('distinguishes uppercase from lowercase', () => {
    assert.equal(kindScopedTagTypeName(30166, 'N'), 'Kind30166_Upper_NTag');
    assert.notEqual(
      kindScopedTagTypeName(30166, 'n'),
      kindScopedTagTypeName(30166, 'N'),
    );
  });

  it('handles hyphenated tag names', () => {
    assert.equal(kindScopedTagTypeName(30166, 'rtt-open'), 'Kind30166_RttOpenTag');
  });

  it('handles underscored tag names', () => {
    assert.equal(kindScopedTagTypeName(30023, 'published_at'), 'Kind30023_PublishedAtTag');
  });
});

// --- collectKindTags ---

describe('collectKindTags', () => {
  it('returns empty for bare kinds', () => {
    const shape = makeShape(1);
    assert.deepEqual(collectKindTags(shape), []);
  });

  it('collects from requiredTags', () => {
    const shape = makeShape(10002, {
      requiredTags: [makeReq('r')],
      category: 'simple-contains',
    });
    const entries = collectKindTags(shape);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].tagName, 'r');
    assert.equal(entries[0].source, 'required');
  });

  it('collects from perItemConditionals', () => {
    const shape = makeShape(30023, {
      perItemConditionals: [{
        conditionTagName: 'd',
        requirement: makeReq('d'),
      }],
      category: 'conditional',
    });
    const entries = collectKindTags(shape);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].tagName, 'd');
    assert.equal(entries[0].source, 'perItem');
  });

  it('collects from arrayLevelConditionals', () => {
    const shape = makeShape(9735, {
      arrayLevelConditionals: [{
        conditionTagName: 'p',
        requirement: makeReq('P'),
      }],
      category: 'conditional',
    });
    const entries = collectKindTags(shape);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].tagName, 'P');
    assert.equal(entries[0].source, 'arrayLevel');
  });

  it('collects from anyOfTagGroups', () => {
    const shape = makeShape(7, {
      anyOfTagGroups: [{
        requirements: [makeReq('e'), makeReq('a')],
      }],
      category: 'conditional',
    });
    const entries = collectKindTags(shape);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].tagName, 'a');
    assert.equal(entries[1].tagName, 'e');
  });

  it('deduplicates by tagName keeping more constrained', () => {
    const lessConstrained = makeReq('d', {
      positions: [
        { index: 0, required: true, constValue: 'd', type: 'string' },
        { index: 1, required: true, type: 'string' },
      ],
    });
    const moreConstrained = makeReq('d', {
      positions: [
        { index: 0, required: true, constValue: 'd', type: 'string' },
        { index: 1, required: true, type: 'string', pattern: '^[a-z0-9-]+$' },
      ],
    });
    const shape = makeShape(30023, {
      requiredTags: [lessConstrained],
      perItemConditionals: [{
        conditionTagName: 'd',
        requirement: moreConstrained,
      }],
      category: 'conditional',
    });
    const entries = collectKindTags(shape);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].source, 'perItem');
  });

  it('sorts entries by tag name', () => {
    const shape = makeShape(30023, {
      requiredTags: [makeReq('t'), makeReq('d'), makeReq('a')],
      category: 'multi-contains',
    });
    const entries = collectKindTags(shape);
    assert.deepEqual(entries.map(e => e.tagName), ['a', 'd', 't']);
  });
});

// --- emitKindTagType ---

describe('emitKindTagType', () => {
  it('emits fixed tuple', () => {
    const entry: KindTagEntry = {
      tagName: 'e',
      requirement: makeReq('e'),
      source: 'required',
    };
    const output = emitKindTagType(7, entry);
    assert.equal(output, 'export type Kind7_ETag = readonly ["e", string];');
  });

  it('emits optional trailing as union', () => {
    const entry: KindTagEntry = {
      tagName: 'r',
      requirement: makeReq('r', {
        positions: [
          { index: 0, required: true, constValue: 'r', type: 'string' },
          { index: 1, required: true, type: 'string' },
          { index: 2, required: false, type: 'string', enumValues: ['read', 'write'] },
        ],
        minItems: 2,
        maxItems: 3,
        additionalItems: false,
      }),
      source: 'required',
    };
    const output = emitKindTagType(10002, entry);
    assert.ok(output !== undefined);
    assert.ok(output!.includes('Kind10002_RTag'));
    assert.ok(output!.includes('readonly ["r", string]'));
    assert.ok(output!.includes('readonly ["r", string, "read" | "write"]'));
  });

  it('emits open tail with rest element', () => {
    const entry: KindTagEntry = {
      tagName: 'e',
      requirement: makeReq('e', {
        positions: [
          { index: 0, required: true, constValue: 'e', type: 'string' },
          { index: 1, required: true, type: 'string' },
        ],
        minItems: 2,
        additionalItems: true,
      }),
      source: 'required',
    };
    const output = emitKindTagType(7, entry);
    assert.equal(output, 'export type Kind7_ETag = readonly ["e", string, ...string[]];');
  });

  it('returns undefined when minItems > positions.length', () => {
    const entry: KindTagEntry = {
      tagName: 'authors',
      requirement: makeReq('authors', {
        positions: [
          { index: 0, required: true, constValue: 'authors', type: 'string' },
        ],
        minItems: 2,
        maxItems: undefined,
        additionalItems: false,
      }),
      source: 'anyOf',
    };
    const output = emitKindTagType(777, entry);
    assert.equal(output, undefined);
  });

  it('returns undefined for empty positions', () => {
    const entry: KindTagEntry = {
      tagName: 'x',
      requirement: makeReq('x', { positions: [], minItems: 1 }),
      source: 'required',
    };
    assert.equal(emitKindTagType(1, entry), undefined);
  });

  it('emits const/enum positions correctly', () => {
    const entry: KindTagEntry = {
      tagName: 'n',
      requirement: makeReq('n', {
        positions: [
          { index: 0, required: true, constValue: 'n', type: 'string' },
          { index: 1, required: true, type: 'string', enumValues: ['clearnet', 'tor', 'i2p', 'loki'] },
        ],
        minItems: 2,
        maxItems: 2,
      }),
      source: 'required',
    };
    const output = emitKindTagType(30166, entry);
    assert.ok(output !== undefined);
    assert.ok(output!.includes('"clearnet" | "tor" | "i2p" | "loki"'));
  });
});

// --- emitKindTagsFile ---

describe('emitKindTagsFile', () => {
  it('emits header with counts', () => {
    const shapes = [makeShape(1)];
    const output = emitKindTagsFile(shapes);
    assert.ok(output.startsWith('// Auto-generated by @nostrability/schemata-codegen'));
    assert.ok(output.includes('Kind-scoped tag types from 1 kind schemas'));
  });

  it('skips bare kinds', () => {
    const shapes = [
      makeShape(1),
      makeShape(7, {
        requiredTags: [makeReq('e')],
        category: 'simple-contains',
      }),
    ];
    const output = emitKindTagsFile(shapes);
    assert.ok(!output.includes('Kind 1'));
    assert.ok(output.includes('Kind 7'));
  });

  it('groups types by kind with section headers', () => {
    const shapes = [
      makeShape(7, {
        nip: 'nip-25',
        requiredTags: [makeReq('e')],
        category: 'simple-contains',
      }),
      makeShape(10002, {
        nip: 'nip-65',
        requiredTags: [makeReq('r')],
        category: 'simple-contains',
      }),
    ];
    const output = emitKindTagsFile(shapes);
    assert.ok(output.includes('// --- Kind 7 (nip-25) ---'));
    assert.ok(output.includes('// --- Kind 10002 (nip-65) ---'));
    assert.ok(output.includes('Kind7_ETag'));
    assert.ok(output.includes('Kind10002_RTag'));
  });

  it('counts types correctly in header', () => {
    const shapes = [
      makeShape(30023, {
        requiredTags: [makeReq('d'), makeReq('t')],
        category: 'multi-contains',
      }),
    ];
    const output = emitKindTagsFile(shapes);
    assert.ok(output.includes('(2 types)'));
  });

  it('skips entries with insufficient positions', () => {
    const shapes = [
      makeShape(777, {
        nip: 'nipless',
        anyOfTagGroups: [{
          requirements: [
            makeReq('cmd', {
              positions: [
                { index: 0, required: true, constValue: 'cmd', type: 'string' },
                { index: 1, required: true, type: 'string', enumValues: ['REQ', 'COUNT'] },
              ],
              minItems: 2,
              maxItems: 2,
            }),
            makeReq('authors', {
              positions: [
                { index: 0, required: true, constValue: 'authors', type: 'string' },
              ],
              minItems: 2,
              additionalItems: false,
            }),
          ],
        }],
        category: 'conditional',
      }),
    ];
    const output = emitKindTagsFile(shapes);
    assert.ok(output.includes('Kind777_CmdTag'));
    assert.ok(!output.includes('Kind777_AuthorsTag'));
  });

  it('emits distinct types for case-different tag names (p vs P)', () => {
    const shapes = [
      makeShape(1619, {
        nip: 'nip-34',
        requiredTags: [makeReq('p'), makeReq('P')],
        category: 'multi-contains',
      }),
    ];
    const output = emitKindTagsFile(shapes);
    assert.ok(output.includes('Kind1619_PTag'));
    assert.ok(output.includes('Kind1619_Upper_PTag'));
    // No duplicate type names
    const exports = output.match(/^export type (\S+)/gm)!;
    const names = exports.map(e => e.replace('export type ', ''));
    assert.equal(names.length, new Set(names).size, `Duplicate type names found: ${names}`);
  });

  it('handles mixed bare and constrained kinds', () => {
    const shapes = [
      makeShape(0),  // bare — profile metadata
      makeShape(1),  // bare — note
      makeShape(7, {
        nip: 'nip-25',
        anyOfTagGroups: [{ requirements: [makeReq('e'), makeReq('a')] }],
        category: 'conditional',
      }),
    ];
    const output = emitKindTagsFile(shapes);
    // Only kind 7 should appear
    assert.ok(!output.includes('Kind 0'));
    assert.ok(!output.includes('Kind 1'));
    assert.ok(output.includes('Kind 7'));
    assert.ok(output.includes('Kind7_ATag'));
    assert.ok(output.includes('Kind7_ETag'));
  });
});
