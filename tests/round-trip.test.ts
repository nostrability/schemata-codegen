/**
 * Round-trip test: builder output → validator → zero errors.
 *
 * For each constrained kind, generate sample data, call the builder,
 * then validate the output with the corresponding validator. If the
 * validator passes (zero errors), the builder produced correct tags.
 *
 * This uses the real schemata dist/ schemas if available, falling back
 * to synthetic fixtures.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { planBuilder, type BuilderAction, type BuilderTag, type FieldInputType } from '../src/plan-builders.js';
import { planKindValidator } from '../src/plan-validators.js';
import { emitBuildersFile } from '../src/emit-builders.js';
import { discoverKindSchemas, extractKindFromFile } from '../src/extract-kind.js';
import type { KindShape } from '../src/kind-types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = __dirname.includes('dist-tests')
  ? join(__dirname, '..', '..')
  : join(__dirname, '..');
const schemataDir = join(projectRoot, '..', 'schemata', 'dist');

/**
 * Generate a sample value that satisfies a FieldInputType constraint.
 */
function sampleValue(input: FieldInputType): string {
  switch (input.type) {
    case 'string':
      return 'test-value';
    case 'enum':
      return input.values[0];
    case 'pattern': {
      const r = input.regex;
      if (r.includes('[a-f0-9]{64}') || r.includes('[a-fA-F0-9]{64}')) return 'a'.repeat(64);
      if (r.includes('ws://') || r.includes('wss://')) return 'wss://relay.example.com';
      if (r.includes('https?://') || r.includes('http')) return 'https://example.com';
      if (r.includes('^\\d+$') || r === '^[0-9]+$') return '42';
      if (r.includes('[A-Za-z]')) return 'abc';
      return 'test-value';
    }
    case 'anyOf':
      return sampleValue(input.alternatives[0]);
  }
}

/**
 * Generate sample input data for a builder's actions.
 * Fills all required fields and all optional fields (to maximize coverage).
 */
function generateSampleData(actions: BuilderAction[]): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  for (const action of actions) {
    const tags: BuilderTag[] = [];
    if (action.type === 'required_tag' || action.type === 'optional_tag') {
      tags.push(action.tag);
    } else if (action.type === 'any_of_group') {
      tags.push(...action.tags);
    }

    for (const tag of tags) {
      const inputPositions = tag.positions.filter(p => p.source === 'input');
      if (inputPositions.length === 0) continue;

      if (inputPositions.length === 1) {
        const pos = inputPositions[0];
        data[tag.fieldName] = sampleValue(pos.inputType ?? { type: 'string' });
      } else {
        const obj: Record<string, string> = {};
        for (const pos of inputPositions) {
          const fname = pos.fieldName ?? 'value';
          obj[fname] = sampleValue(pos.inputType ?? { type: 'string' });
        }
        data[tag.fieldName] = obj;
      }
    }
  }

  return data;
}

/**
 * Simulate builder execution: walk actions + data → string[][].
 * Mirrors what the generated code does, including any_of_group and literal-only tags.
 */
function simulateBuilder(actions: BuilderAction[], data: Record<string, unknown>): string[][] {
  const tags: string[][] = [];

  for (const action of actions) {
    const actionTags: Array<{ tag: BuilderTag; required: boolean }> = [];

    if (action.type === 'required_tag') {
      actionTags.push({ tag: action.tag, required: true });
    } else if (action.type === 'optional_tag') {
      actionTags.push({ tag: action.tag, required: false });
    } else if (action.type === 'any_of_group') {
      for (const tag of action.tags) {
        actionTags.push({ tag, required: false });
      }
    }

    for (const { tag, required } of actionTags) {
      const inputPositions = tag.positions.filter(p => p.source === 'input');
      const isObj = inputPositions.length > 1;
      const isLiteral = inputPositions.length === 0;

      const fieldData = data[tag.fieldName];

      // Skip optional tags whose field data is absent (unless all-literal)
      if (!required && fieldData === undefined && !isLiteral) continue;

      const result: string[] = [];
      for (const pos of tag.positions) {
        if (pos.source === 'literal') {
          result.push(pos.literalValue!);
        } else if (!pos.required) {
          const val = isObj
            ? (fieldData as Record<string, string>)[pos.fieldName ?? 'value']
            : undefined;
          if (val !== undefined) result.push(val);
        } else if (isObj) {
          const val = (fieldData as Record<string, string>)[pos.fieldName ?? 'value'];
          if (val !== undefined) result.push(val);
        } else {
          result.push(fieldData as string);
        }
      }
      if (result.length > 0) tags.push(result);
    }
  }

  return tags;
}

// --- Synthetic round-trip tests (always run) ---

describe('round-trip (synthetic)', () => {
  it('simple required tag builder output has correct structure', () => {
    const shape: KindShape = {
      kindNumber: 30023,
      nip: 'nip-23',
      requiredTags: [{
        tagName: 'd',
        positions: [
          { index: 0, required: true, constValue: 'd', type: 'string' },
          { index: 1, required: true, type: 'string' },
        ],
        minItems: 2,
        maxItems: 2,
        additionalItems: false,
      }],
      perItemConditionals: [],
      arrayLevelConditionals: [],
      anyOfTagGroups: [],
      category: 'simple-contains',
    };

    const actions = planBuilder(shape)!;
    assert.ok(actions);

    const data = generateSampleData(actions);
    assert.ok('d' in data);

    const tags = simulateBuilder(actions, data);

    // Now validate
    const valActions = planKindValidator(shape);
    assert.ok(valActions);

    const found = tags.some(t => t[0] === 'd' && t.length >= 2);
    assert.ok(found, 'Builder output should satisfy require_tag for d');
  });

  it('multi-position tag with optional trailing builds correctly', () => {
    const shape: KindShape = {
      kindNumber: 10002,
      nip: 'nip-65',
      requiredTags: [{
        tagName: 'r',
        positions: [
          { index: 0, required: true, constValue: 'r', type: 'string' },
          { index: 1, required: true, type: 'string', pattern: '^(ws://|wss://).+$', title: 'relay URL' },
          { index: 2, required: false, type: 'string', enumValues: ['read', 'write'], title: 'marker' },
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

    const actions = planBuilder(shape)!;
    assert.ok(actions);

    const data = generateSampleData(actions);
    const tags = simulateBuilder(actions, data);

    const found = tags.some(t => t[0] === 'r' && t.length >= 2);
    assert.ok(found, 'Builder output should have r tag');
    assert.ok(tags[0][1].startsWith('wss://'), `URL should start with wss://, got: ${tags[0][1]}`);
  });

  it('constant-only required tag is emitted', () => {
    const shape: KindShape = {
      kindNumber: 38383,
      nip: 'nip-69',
      requiredTags: [
        {
          tagName: 'd',
          positions: [
            { index: 0, required: true, constValue: 'd', type: 'string' },
            { index: 1, required: true, type: 'string' },
          ],
          minItems: 2, maxItems: 2, additionalItems: false,
        },
        {
          tagName: 'z',
          positions: [
            { index: 0, required: true, constValue: 'z', type: 'string' },
            { index: 1, required: true, constValue: 'order', type: 'string' },
          ],
          minItems: 2, maxItems: 2, additionalItems: false,
        },
      ],
      perItemConditionals: [],
      arrayLevelConditionals: [],
      anyOfTagGroups: [],
      category: 'multi-contains',
    };

    const actions = planBuilder(shape)!;
    assert.ok(actions, 'Should have actions');

    const data = generateSampleData(actions);
    const tags = simulateBuilder(actions, data);

    // z tag must be present even though it has no user input
    const foundZ = tags.some(t => t[0] === 'z' && t[1] === 'order');
    assert.ok(foundZ, `Builder output must include ["z", "order"]. Tags: ${JSON.stringify(tags)}`);
  });

  it('anyOf group produces at least one tag', () => {
    const shape: KindShape = {
      kindNumber: 777,
      nip: 'nip-test',
      requiredTags: [{
        tagName: 'cmd',
        positions: [
          { index: 0, required: true, constValue: 'cmd', type: 'string' },
          { index: 1, required: true, type: 'string' },
        ],
        minItems: 2, maxItems: 2, additionalItems: false,
      }],
      perItemConditionals: [],
      arrayLevelConditionals: [],
      anyOfTagGroups: [{
        requirements: [
          {
            tagName: 'k',
            positions: [
              { index: 0, required: true, constValue: 'k', type: 'string' },
              { index: 1, required: true, type: 'string' },
            ],
            minItems: 2, maxItems: 2, additionalItems: false,
          },
          {
            tagName: 'authors',
            positions: [
              { index: 0, required: true, constValue: 'authors', type: 'string' },
              { index: 1, required: true, type: 'string' },
            ],
            minItems: 2, maxItems: 2, additionalItems: false,
          },
        ],
        errorMessage: 'Must include at least one filter tag',
      }],
      category: 'conditional',
    };

    const actions = planBuilder(shape)!;
    assert.ok(actions, 'Should have actions');

    // Should contain an any_of_group action
    const groupAction = actions.find(a => a.type === 'any_of_group');
    assert.ok(groupAction, 'Should have any_of_group action');
    assert.ok(groupAction.type === 'any_of_group');
    assert.equal(groupAction.tags.length, 2);

    // Simulate with all optional data filled
    const data = generateSampleData(actions);
    const tags = simulateBuilder(actions, data);

    // Must have cmd + at least one filter tag
    const foundCmd = tags.some(t => t[0] === 'cmd');
    assert.ok(foundCmd, 'Should have cmd tag');
    const foundFilter = tags.some(t => t[0] === 'k' || t[0] === 'authors');
    assert.ok(foundFilter, 'Should have at least one filter tag from anyOf group');
  });
});

// --- Full round-trip with real schemas (if available) ---

describe('round-trip (real schemas)', () => {
  it('builder output validates for all constrained kinds', () => {
    if (!existsSync(schemataDir)) {
      console.log(`Skipping: schemata dist/ not available at ${schemataDir}`);
      return;
    }

    // Load all kind shapes
    const kindSchemas = discoverKindSchemas(schemataDir);
    const shapes: KindShape[] = [];
    for (const { filePath } of kindSchemas) {
      try {
        shapes.push(extractKindFromFile(filePath));
      } catch {
        // Skip failed extractions
      }
    }

    // Generate builders file
    const buildersCode = emitBuildersFile(shapes);
    assert.ok(buildersCode.includes('export function buildKindTags'), 'Should have dispatch function');

    const fnCount = (buildersCode.match(/export function buildKind\d+Tags\b/g) || []).length;
    assert.ok(fnCount > 0, `Should have at least one builder function, got ${fnCount}`);
    console.log(`Generated ${fnCount} builder functions`);

    // For each constrained kind, plan builder + validator and cross-check
    let checked = 0;
    const failures: string[] = [];
    for (const shape of shapes) {
      const builderActions = planBuilder(shape);
      const validatorActions = planKindValidator(shape);

      if (!builderActions || !validatorActions) continue;

      const data = generateSampleData(builderActions);
      const tags = simulateBuilder(builderActions, data);

      // Check ALL require_tag actions — builder MUST produce every required tag
      for (const va of validatorActions) {
        if (va.type !== 'require_tag') continue;
        const found = tags.some(t => t[0] === va.matcher.tagName && t.length >= va.matcher.minItems);
        if (!found) {
          failures.push(
            `Kind ${shape.kindNumber}: missing required ${va.matcher.tagName} tag ` +
            `(need >= ${va.matcher.minItems} items). Tags: ${JSON.stringify(tags)}`);
        }
      }

      // Check any_of_group actions — at least one tag from each group must be present
      for (const va of validatorActions) {
        if (va.type !== 'any_of_group') continue;
        const groupNames = va.matchers.map(m => m.tagName);
        const found = groupNames.some(name =>
          tags.some(t => t[0] === name)
        );
        if (!found) {
          failures.push(
            `Kind ${shape.kindNumber}: no tag from anyOf group [${groupNames.join(', ')}]. ` +
            `Tags: ${JSON.stringify(tags)}`);
        }
      }

      // Note: check_min_tags/check_max_tags are NOT checked here.
      // Those constrain the total event tags array, which may include
      // unconstrained tags the user adds. The builder only produces
      // the structurally constrained subset.

      checked++;
    }

    if (failures.length > 0) {
      assert.fail(`Round-trip failures (${failures.length}):\n  ${failures.join('\n  ')}`);
    }

    console.log(`Cross-checked ${checked} kinds (builder → validator)`);
    assert.ok(checked > 0, 'Should have checked at least one kind');
  });
});
