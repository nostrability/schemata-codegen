import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  planBuilder,
  tagNameToFieldName,
  type BuilderAction,
  type BuilderTag,
} from '../src/plan-builders.js';
import type { KindShape, TagRequirement } from '../src/kind-types.js';

// --- Helpers ---

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

// --- tagNameToFieldName ---

describe('tagNameToFieldName', () => {
  it('preserves single character names', () => {
    assert.equal(tagNameToFieldName('d'), 'd');
    assert.equal(tagNameToFieldName('e'), 'e');
    assert.equal(tagNameToFieldName('P'), 'P');
  });

  it('preserves simple names', () => {
    assert.equal(tagNameToFieldName('bolt11'), 'bolt11');
    assert.equal(tagNameToFieldName('amount'), 'amount');
  });

  it('converts hyphenated to camelCase', () => {
    assert.equal(tagNameToFieldName('rtt-open'), 'rttOpen');
    assert.equal(tagNameToFieldName('content-warning'), 'contentWarning');
  });

  it('converts underscored to camelCase', () => {
    assert.equal(tagNameToFieldName('published_at'), 'publishedAt');
    assert.equal(tagNameToFieldName('some_tag_name'), 'someTagName');
  });
});

// --- planBuilder ---

describe('planBuilder', () => {
  it('returns undefined for bare kinds', () => {
    const shape = makeShape(1);
    assert.strictEqual(planBuilder(shape), undefined);
  });

  it('returns undefined for kinds with only min/max tag counts', () => {
    const shape = makeShape(13, { tagsMaxItems: 0 });
    assert.strictEqual(planBuilder(shape), undefined);
  });

  it('plans simple required tag', () => {
    const shape = makeShape(10002, {
      requiredTags: [makeReq('r')],
      category: 'simple-contains',
    });
    const actions = planBuilder(shape);
    assert.ok(actions);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].type, 'required_tag');
    assert.ok(actions[0].type === 'required_tag');
    assert.equal(actions[0].tag.tagName, 'r');
    assert.equal(actions[0].tag.fieldName, 'r');
  });

  it('plans multiple required tags', () => {
    const shape = makeShape(9735, {
      requiredTags: [
        makeReq('p', {
          positions: [
            { index: 0, required: true, constValue: 'p', type: 'string' },
            { index: 1, required: true, type: 'string', pattern: '^[a-f0-9]{64}$' },
          ],
        }),
        makeReq('bolt11'),
      ],
      category: 'multi-contains',
    });
    const actions = planBuilder(shape);
    assert.ok(actions);
    assert.equal(actions.length, 2);
    const tagNames = actions.map(a => {
      if (a.type === 'required_tag' || a.type === 'optional_tag') return a.tag.tagName;
      return '';
    });
    assert.ok(tagNames.includes('bolt11'));
    assert.ok(tagNames.includes('p'));
  });

  it('classifies perItem source as optional', () => {
    const shape = makeShape(30023, {
      perItemConditionals: [{
        conditionTagName: 'd',
        requirement: makeReq('d'),
      }],
      category: 'conditional',
    });
    const actions = planBuilder(shape);
    assert.ok(actions);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].type, 'optional_tag');
  });

  it('classifies arrayLevel source as optional', () => {
    const shape = makeShape(4, {
      arrayLevelConditionals: [{
        conditionTagName: 'p',
        requirement: makeReq('e', {
          positions: [
            { index: 0, required: true, constValue: 'e', type: 'string' },
            { index: 1, required: true, type: 'string', pattern: '^[a-f0-9]{64}$' },
          ],
        }),
      }],
      category: 'conditional',
    });
    const actions = planBuilder(shape);
    assert.ok(actions);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].type, 'optional_tag');
  });

  it('classifies anyOf source as optional', () => {
    const shape = makeShape(7, {
      anyOfTagGroups: [{
        requirements: [makeReq('e'), makeReq('a')],
      }],
      category: 'conditional',
    });
    const actions = planBuilder(shape);
    assert.ok(actions);
    // Both entries are from anyOf → optional
    for (const action of actions) {
      assert.equal(action.type, 'optional_tag');
    }
  });

  it('handles position 0 as literal', () => {
    const shape = makeShape(10002, {
      requiredTags: [makeReq('r')],
      category: 'simple-contains',
    });
    const actions = planBuilder(shape)!;
    const tag = (actions[0] as { type: 'required_tag'; tag: BuilderTag }).tag;
    assert.equal(tag.positions[0].source, 'literal');
    assert.equal(tag.positions[0].literalValue, 'r');
  });

  it('derives input type for pattern positions', () => {
    const shape = makeShape(10002, {
      requiredTags: [makeReq('r', {
        positions: [
          { index: 0, required: true, constValue: 'r', type: 'string' },
          { index: 1, required: true, type: 'string', pattern: '^(ws://|wss://).+$' },
        ],
      })],
      category: 'simple-contains',
    });
    const actions = planBuilder(shape)!;
    const tag = (actions[0] as { type: 'required_tag'; tag: BuilderTag }).tag;
    const inputPos = tag.positions.find(p => p.source === 'input')!;
    assert.ok(inputPos.inputType);
    assert.equal(inputPos.inputType.type, 'pattern');
  });

  it('derives input type for enum positions', () => {
    const shape = makeShape(100, {
      requiredTags: [makeReq('status', {
        positions: [
          { index: 0, required: true, constValue: 'status', type: 'string' },
          { index: 1, required: true, type: 'string', enumValues: ['active', 'inactive'] },
        ],
      })],
      category: 'simple-contains',
    });
    const actions = planBuilder(shape)!;
    const tag = (actions[0] as { type: 'required_tag'; tag: BuilderTag }).tag;
    const inputPos = tag.positions.find(p => p.source === 'input')!;
    assert.ok(inputPos.inputType);
    assert.equal(inputPos.inputType.type, 'enum');
    assert.ok(inputPos.inputType.type === 'enum');
    assert.deepEqual(inputPos.inputType.values, ['active', 'inactive']);
  });

  it('creates object fields for multi-position tags', () => {
    const shape = makeShape(10002, {
      requiredTags: [makeReq('r', {
        positions: [
          { index: 0, required: true, constValue: 'r', type: 'string' },
          { index: 1, required: true, type: 'string', title: 'relay URL' },
          { index: 2, required: false, type: 'string', enumValues: ['read', 'write'], title: 'marker' },
        ],
        minItems: 2,
        maxItems: 3,
        additionalItems: false,
      })],
      category: 'simple-contains',
    });
    const actions = planBuilder(shape)!;
    const tag = (actions[0] as { type: 'required_tag'; tag: BuilderTag }).tag;
    const inputPositions = tag.positions.filter(p => p.source === 'input');
    assert.equal(inputPositions.length, 2);
    // Each should have a fieldName since there are multiple inputs
    assert.ok(inputPositions[0].fieldName);
    assert.ok(inputPositions[1].fieldName);
  });

  it('uses positional fallback names when no title', () => {
    const shape = makeShape(999, {
      requiredTags: [makeReq('x', {
        positions: [
          { index: 0, required: true, constValue: 'x', type: 'string' },
          { index: 1, required: true, type: 'string' },
          { index: 2, required: true, type: 'string' },
        ],
        minItems: 3,
        maxItems: 3,
      })],
      category: 'simple-contains',
    });
    const actions = planBuilder(shape)!;
    const tag = (actions[0] as { type: 'required_tag'; tag: BuilderTag }).tag;
    const inputPositions = tag.positions.filter(p => p.source === 'input');
    assert.equal(inputPositions[0].fieldName, 'value');
    assert.equal(inputPositions[1].fieldName, 'value2');
  });

  it('field name uses title when available', () => {
    const shape = makeShape(9735, {
      requiredTags: [makeReq('e', {
        positions: [
          { index: 0, required: true, constValue: 'e', type: 'string' },
          { index: 1, required: true, type: 'string', pattern: '^[a-f0-9]{64}$', title: 'event id' },
          { index: 2, required: false, type: 'string', title: 'relay URL' },
        ],
        minItems: 2,
        maxItems: 3,
      })],
      category: 'multi-contains',
    });
    const actions = planBuilder(shape)!;
    const tag = (actions[0] as { type: 'required_tag'; tag: BuilderTag }).tag;
    const inputPositions = tag.positions.filter(p => p.source === 'input');
    assert.equal(inputPositions[0].fieldName, 'eventId');
    assert.equal(inputPositions[1].fieldName, 'relayUrl');
  });
});
