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

  it('emits any_of_group for anyOf tags', () => {
    const shape = makeShape(7, {
      anyOfTagGroups: [{
        requirements: [makeReq('e'), makeReq('a')],
      }],
      category: 'conditional',
    });
    const actions = planBuilder(shape);
    assert.ok(actions);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].type, 'any_of_group');
    assert.ok(actions[0].type === 'any_of_group');
    assert.equal(actions[0].tags.length, 2);
    const names = actions[0].tags.map(t => t.tagName).sort();
    assert.deepEqual(names, ['a', 'e']);
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

  it('includes constant-only required tags', () => {
    const shape = makeShape(38383, {
      requiredTags: [
        makeReq('d'),
        makeReq('z', {
          positions: [
            { index: 0, required: true, constValue: 'z', type: 'string' },
            { index: 1, required: true, constValue: 'order', type: 'string' },
          ],
        }),
      ],
      category: 'multi-contains',
    });
    const actions = planBuilder(shape)!;
    assert.ok(actions);
    // Both d and z should be required
    const zAction = actions.find(a => a.type === 'required_tag' && a.tag.tagName === 'z');
    assert.ok(zAction, 'z tag should be present as required_tag');
    assert.ok(zAction.type === 'required_tag');
    // z has no input positions — all literal
    const inputPos = zAction.tag.positions.filter(p => p.source === 'input');
    assert.equal(inputPos.length, 0, 'z tag should have zero input positions');
    const litPos = zAction.tag.positions.filter(p => p.source === 'literal');
    assert.equal(litPos.length, 2);
  });

  it('adds implied positions when minItems > positions.length', () => {
    const shape = makeShape(777, {
      anyOfTagGroups: [{
        requirements: [{
          tagName: 'k',
          positions: [{ index: 0, required: true, constValue: 'k', type: 'string' }],
          minItems: 2,
          maxItems: 2,
          additionalItems: false,
        }],
      }],
      category: 'conditional',
    });
    const actions = planBuilder(shape)!;
    assert.ok(actions);
    const groupAction = actions.find(a => a.type === 'any_of_group');
    assert.ok(groupAction && groupAction.type === 'any_of_group');
    const kTag = groupAction.tags[0];
    // Should have 2 positions: literal "k" + implied input
    assert.equal(kTag.positions.length, 2);
    assert.equal(kTag.positions[0].source, 'literal');
    assert.equal(kTag.positions[1].source, 'input');
    assert.equal(kTag.positions[1].inputType?.type, 'string');
  });

  it('auto-satisfies anyOf group when tag is also required', () => {
    const shape = makeShape(999, {
      requiredTags: [makeReq('e')],
      anyOfTagGroups: [{
        requirements: [makeReq('e'), makeReq('a')],
      }],
      category: 'conditional',
    });
    const actions = planBuilder(shape)!;
    assert.ok(actions);
    // e should be required_tag (from required), a should be optional_tag (group auto-satisfied)
    const eAction = actions.find(a => a.type === 'required_tag' && a.tag.tagName === 'e');
    assert.ok(eAction, 'e should be required');
    const aAction = actions.find(a => a.type === 'optional_tag' && a.tag.tagName === 'a');
    assert.ok(aAction, 'a should be optional (group auto-satisfied by required e)');
    // No any_of_group action
    assert.ok(!actions.some(a => a.type === 'any_of_group'), 'No any_of_group when auto-satisfied');
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
