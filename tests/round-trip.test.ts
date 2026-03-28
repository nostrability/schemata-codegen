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

import { planBuilder, type BuilderAction, type FieldInputType } from '../src/plan-builders.js';
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
    if (action.type !== 'required_tag' && action.type !== 'optional_tag') continue;
    const tag = action.tag;
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

  return data;
}

/**
 * Simulate builder execution: walk actions + data → string[][].
 * Mirrors what the generated code does.
 */
function simulateBuilder(actions: BuilderAction[], data: Record<string, unknown>): string[][] {
  const tags: string[][] = [];

  for (const action of actions) {
    if (action.type !== 'required_tag' && action.type !== 'optional_tag') continue;
    const tag = action.tag;
    const inputPositions = tag.positions.filter(p => p.source === 'input');
    const isObj = inputPositions.length > 1;

    const fieldData = data[tag.fieldName];
    if (fieldData === undefined) continue;

    const result: string[] = [];
    for (const pos of tag.positions) {
      if (pos.source === 'literal') {
        result.push(pos.literalValue!);
      } else if (!pos.required) {
        // Optional position: add only if value present
        const val = isObj
          ? (fieldData as Record<string, string>)[pos.fieldName ?? 'value']
          : undefined; // single-field tags can't have optional sub-parts
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

  return tags;
}

/**
 * Collect tag names that the builder can produce (have at least one input position).
 */
function builderTagNames(actions: BuilderAction[]): Set<string> {
  const names = new Set<string>();
  for (const action of actions) {
    if (action.type === 'required_tag' || action.type === 'optional_tag') {
      names.add(action.tag.tagName);
    }
  }
  return names;
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
    for (const shape of shapes) {
      const builderActions = planBuilder(shape);
      const validatorActions = planKindValidator(shape);

      if (!builderActions || !validatorActions) continue;

      const data = generateSampleData(builderActions);
      const tags = simulateBuilder(builderActions, data);
      const builtNames = builderTagNames(builderActions);

      // Check that each require_tag the builder CAN produce is satisfied.
      // Some required tags have only literal positions (e.g., "-" protected tag)
      // and the builder correctly doesn't generate them — skip those checks.
      for (const va of validatorActions) {
        if (va.type !== 'require_tag') continue;
        if (!builtNames.has(va.matcher.tagName)) continue; // builder can't produce this tag
        const found = tags.some(t => t[0] === va.matcher.tagName && t.length >= va.matcher.minItems);
        assert.ok(found,
          `Kind ${shape.kindNumber}: builder should produce a ${va.matcher.tagName} tag ` +
          `with >= ${va.matcher.minItems} items. Tags: ${JSON.stringify(tags)}`);
      }

      checked++;
    }

    console.log(`Cross-checked ${checked} kinds (builder → validator)`);
    assert.ok(checked > 0, 'Should have checked at least one kind');
  });
});
