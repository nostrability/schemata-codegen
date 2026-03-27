import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planKindValidator, planTagValidator, planContentChecks, buildTagMatcher, buildValueCheck } from '../src/plan-validators.js';
import type { KindShape } from '../src/kind-types.js';
import type { TagShape } from '../src/patterns.js';

// --- Test fixtures ---

const bareKind: KindShape = {
  kindNumber: 1,
  nip: 'nip-01',
  requiredTags: [],
  perItemConditionals: [],
  arrayLevelConditionals: [],
  anyOfTagGroups: [],
  category: 'bare',
};

const simpleKind: KindShape = {
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

const multiKind: KindShape = {
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

const conditionalKind: KindShape = {
  kindNumber: 4,
  nip: 'nip-04',
  tagsMinItems: 1,
  requiredTags: [{
    tagName: 'p',
    positions: [
      { index: 0, required: true, constValue: 'p', type: 'string' },
      { index: 1, required: true, type: 'string', pattern: '^[a-f0-9]{64}$' },
    ],
    minItems: 2,
    maxItems: 3,
    additionalItems: false,
  }],
  perItemConditionals: [],
  arrayLevelConditionals: [{
    conditionTagName: 'e',
    requirement: {
      tagName: 'e',
      positions: [
        { index: 0, required: true, constValue: 'e', type: 'string' },
        { index: 1, required: true, type: 'string', pattern: '^[a-f0-9]{64}$' },
      ],
      minItems: 2,
      additionalItems: false,
    },
  }],
  anyOfTagGroups: [],
  category: 'conditional',
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

describe('planKindValidator', () => {
  it('returns undefined for bare kinds', () => {
    const result = planKindValidator(bareKind);
    assert.strictEqual(result, undefined);
  });

  it('plans simple-contains kind', () => {
    const actions = planKindValidator(simpleKind);
    assert.ok(actions);
    assert.ok(actions.length >= 1);

    // Should have require_tag for 'r'
    const reqTag = actions.find(a => a.type === 'require_tag');
    assert.ok(reqTag);
    assert.ok(reqTag.type === 'require_tag');
    assert.strictEqual(reqTag.matcher.tagName, 'r');
    assert.strictEqual(reqTag.matcher.minItems, 2);
    assert.strictEqual(reqTag.matcher.maxItems, 3);

    // Should have validate_optional_positions for position 2 enum
    const optPos = actions.find(a => a.type === 'validate_optional_positions');
    assert.ok(optPos);
    assert.ok(optPos.type === 'validate_optional_positions');
    assert.strictEqual(optPos.tagName, 'r');
    assert.strictEqual(optPos.checks.length, 1);
    assert.strictEqual(optPos.checks[0].index, 2);
    assert.ok(optPos.checks[0].check.type === 'enum');
  });

  it('plans multi-contains kind', () => {
    const actions = planKindValidator(multiKind);
    assert.ok(actions);

    const reqTags = actions.filter(a => a.type === 'require_tag');
    assert.strictEqual(reqTags.length, 2);
    assert.ok(reqTags[0].type === 'require_tag');
    assert.strictEqual(reqTags[0].matcher.tagName, 'p');
    assert.ok(reqTags[1].type === 'require_tag');
    assert.strictEqual(reqTags[1].matcher.tagName, 'bolt11');
  });

  it('plans conditional kind with check_min_tags', () => {
    const actions = planKindValidator(conditionalKind);
    assert.ok(actions);

    const minTags = actions.find(a => a.type === 'check_min_tags');
    assert.ok(minTags);
    assert.ok(minTags.type === 'check_min_tags');
    assert.strictEqual(minTags.min, 1);

    const arrayCond = actions.find(a => a.type === 'array_level_conditional');
    assert.ok(arrayCond);
    assert.ok(arrayCond.type === 'array_level_conditional');
    assert.strictEqual(arrayCond.condTag, 'e');
    assert.strictEqual(arrayCond.matcher.tagName, 'e');
  });

  it('plans any-of-group kind', () => {
    const actions = planKindValidator(anyOfKind);
    assert.ok(actions);

    const anyOf = actions.find(a => a.type === 'any_of_group');
    assert.ok(anyOf);
    assert.ok(anyOf.type === 'any_of_group');
    assert.strictEqual(anyOf.matchers.length, 2);
    assert.strictEqual(anyOf.matchers[0].tagName, 'k');
    assert.strictEqual(anyOf.matchers[1].tagName, 'authors');
  });
});

describe('buildTagMatcher', () => {
  it('builds matcher with required position checks only', () => {
    const req = simpleKind.requiredTags[0];
    const matcher = buildTagMatcher(req);

    assert.strictEqual(matcher.tagName, 'r');
    assert.strictEqual(matcher.minItems, 2);
    assert.strictEqual(matcher.maxItems, 3);
    // Position 1 is required and has pattern — should be in positionChecks
    assert.strictEqual(matcher.positionChecks.length, 1);
    assert.strictEqual(matcher.positionChecks[0].index, 1);
    assert.strictEqual(matcher.positionChecks[0].check.type, 'pattern');
  });

  it('skips optional positions in matcher', () => {
    const req = simpleKind.requiredTags[0];
    const matcher = buildTagMatcher(req);
    // Position 2 is optional — should NOT be in matcher
    assert.ok(!matcher.positionChecks.some(pc => pc.index === 2));
  });
});

describe('buildValueCheck', () => {
  it('builds const check', () => {
    const check = buildValueCheck({ index: 0, required: true, constValue: 'p', type: 'string' });
    assert.ok(check);
    assert.strictEqual(check.type, 'const');
    assert.ok(check.type === 'const');
    assert.strictEqual(check.value, 'p');
  });

  it('builds enum check', () => {
    const check = buildValueCheck({ index: 2, required: false, type: 'string', enumValues: ['read', 'write'] });
    assert.ok(check);
    assert.strictEqual(check.type, 'enum');
    assert.ok(check.type === 'enum');
    assert.deepStrictEqual(check.values, ['read', 'write']);
  });

  it('builds pattern check with native classification', () => {
    const check = buildValueCheck({ index: 1, required: true, type: 'string', pattern: '^[a-f0-9]{64}$' });
    assert.ok(check);
    assert.strictEqual(check.type, 'pattern');
    assert.ok(check.type === 'pattern');
    assert.strictEqual(check.regex, '^[a-f0-9]{64}$');
    assert.strictEqual(check.native.op, 'hex');
  });

  it('returns undefined for unconstrained position', () => {
    const check = buildValueCheck({ index: 1, required: true, type: 'string' });
    assert.strictEqual(check, undefined);
  });
});

describe('planTagValidator', () => {
  it('returns undefined for non-structured_metadata', () => {
    const shape: TagShape = {
      fileName: 'amount',
      tagName: 'amount',
      pattern: 'fixed_tuple',
      positions: [],
      minItems: 2,
      maxItems: 2,
      additionalItems: false,
    };
    assert.strictEqual(planTagValidator(shape), undefined);
  });

  it('plans structured_metadata with pattern contains', () => {
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
      containsPatterns: ['^url https?://\\S+$'],
    };

    const actions = planTagValidator(shape);
    assert.ok(actions);
    assert.ok(actions.length >= 3);

    assert.ok(actions.some(a => a.type === 'check_tag_name'));
    assert.ok(actions.some(a => a.type === 'check_min_items'));
    assert.ok(actions.some(a => a.type === 'check_pattern_contains'));
  });

  it('plans structured_metadata with const contains', () => {
    const shape: TagShape = {
      fileName: 'mls_ext',
      tagName: 'mls_extensions',
      pattern: 'structured_metadata',
      positions: [
        { index: 0, required: true, constValue: 'mls_extensions', type: 'string' },
      ],
      minItems: 2,
      additionalItems: true,
      containsConstants: ['0xf2ee'],
    };

    const actions = planTagValidator(shape);
    assert.ok(actions);
    assert.ok(actions.some(a => a.type === 'check_const_contains'));
  });
});

describe('planKindValidator check_max_tags', () => {
  it('emits check_max_tags when tagsMaxItems is set', () => {
    const sealKind: KindShape = {
      kindNumber: 13,
      nip: 'nip-59',
      requiredTags: [],
      perItemConditionals: [],
      arrayLevelConditionals: [],
      anyOfTagGroups: [],
      tagsMaxItems: 0,
      category: 'bare',
    };
    const actions = planKindValidator(sealKind);
    assert.ok(actions);
    const maxAction = actions.find(a => a.type === 'check_max_tags');
    assert.ok(maxAction);
    assert.ok(maxAction.type === 'check_max_tags');
    assert.strictEqual(maxAction.max, 0);
  });

  it('does not emit check_max_tags when tagsMaxItems is absent', () => {
    const actions = planKindValidator(conditionalKind);
    assert.ok(actions);
    assert.ok(!actions.some(a => a.type === 'check_max_tags'));
  });
});

describe('planContentChecks', () => {
  it('returns undefined when no content constraints', () => {
    assert.strictEqual(planContentChecks(bareKind), undefined);
  });

  it('plans minLength content check', () => {
    const shape: KindShape = {
      ...bareKind,
      contentConstraints: { minLength: 1 },
    };
    const actions = planContentChecks(shape);
    assert.ok(actions);
    assert.strictEqual(actions.length, 1);
    assert.strictEqual(actions[0].type, 'check_content_min_length');
    assert.ok(actions[0].type === 'check_content_min_length');
    assert.strictEqual(actions[0].min, 1);
  });

  it('plans maxLength content check', () => {
    const shape: KindShape = {
      ...bareKind,
      contentConstraints: { maxLength: 100 },
    };
    const actions = planContentChecks(shape);
    assert.ok(actions);
    assert.strictEqual(actions.length, 1);
    assert.strictEqual(actions[0].type, 'check_content_max_length');
    assert.ok(actions[0].type === 'check_content_max_length');
    assert.strictEqual(actions[0].max, 100);
  });

  it('plans pattern content check', () => {
    const shape: KindShape = {
      ...bareKind,
      contentConstraints: { pattern: '^[a-f0-9]{64}$' },
    };
    const actions = planContentChecks(shape);
    assert.ok(actions);
    assert.strictEqual(actions.length, 1);
    assert.strictEqual(actions[0].type, 'check_content_pattern');
    assert.ok(actions[0].type === 'check_content_pattern');
    assert.strictEqual(actions[0].regex, '^[a-f0-9]{64}$');
    assert.strictEqual(actions[0].native.op, 'hex');
  });

  it('plans enum content check', () => {
    const shape: KindShape = {
      ...bareKind,
      contentConstraints: { enumValues: ['', 'approve', 'reject'] },
    };
    const actions = planContentChecks(shape);
    assert.ok(actions);
    assert.strictEqual(actions.length, 1);
    assert.strictEqual(actions[0].type, 'check_content_enum');
    assert.ok(actions[0].type === 'check_content_enum');
    assert.deepStrictEqual(actions[0].values, ['', 'approve', 'reject']);
  });

  it('plans multiple content checks together', () => {
    const shape: KindShape = {
      ...bareKind,
      contentConstraints: { minLength: 1, maxLength: 500, pattern: '^.+$' },
    };
    const actions = planContentChecks(shape);
    assert.ok(actions);
    assert.strictEqual(actions.length, 3);
    assert.strictEqual(actions[0].type, 'check_content_min_length');
    assert.strictEqual(actions[1].type, 'check_content_max_length');
    assert.strictEqual(actions[2].type, 'check_content_pattern');
  });
});
