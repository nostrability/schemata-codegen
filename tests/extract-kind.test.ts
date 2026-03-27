import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractKindFromFile, discoverKindSchemas, extractKind } from '../src/extract-kind.js';
import type { SchemaNode } from '../src/patterns.js';
import type { KindCategory } from '../src/kind-types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = __dirname.includes('dist-tests')
  ? join(__dirname, '..', '..')
  : join(__dirname, '..');
const schemasDir = join(projectRoot, '..', 'schemata', 'dist');

describe('extractKind', () => {
  it('extracts bare kind (kind-0, no tag constraints)', () => {
    const filePath = join(schemasDir, 'nips', 'nip-01', 'kind-0', 'schema.json');
    if (!existsSync(filePath)) { console.log('Skipping: schemata not found'); return; }

    const shape = extractKindFromFile(filePath);
    assert.equal(shape.kindNumber, 0);
    assert.equal(shape.nip, 'nip-01');
    assert.equal(shape.category, 'bare');
    assert.equal(shape.requiredTags.length, 0);
  });

  it('extracts simple-contains kind (kind-10002, r tag)', () => {
    const filePath = join(schemasDir, 'nips', 'nip-65', 'kind-10002', 'schema.json');
    if (!existsSync(filePath)) { console.log('Skipping: schemata not found'); return; }

    const shape = extractKindFromFile(filePath);
    assert.equal(shape.kindNumber, 10002);
    assert.equal(shape.nip, 'nip-65');
    assert.equal(shape.category, 'simple-contains');
    assert.equal(shape.requiredTags.length, 1);
    assert.equal(shape.requiredTags[0].tagName, 'r');
    assert.ok(shape.requiredTags[0].positions.length >= 2);
  });

  it('extracts multi-contains kind (kind-9735, p + bolt11 + description)', () => {
    const filePath = join(schemasDir, 'nips', 'nip-57', 'kind-9735', 'schema.json');
    if (!existsSync(filePath)) { console.log('Skipping: schemata not found'); return; }

    const shape = extractKindFromFile(filePath);
    assert.equal(shape.kindNumber, 9735);
    assert.equal(shape.category, 'multi-contains');
    assert.ok(shape.requiredTags.length >= 3);

    const tagNames = shape.requiredTags.map(t => t.tagName).sort();
    assert.ok(tagNames.includes('p'), 'should require p tag');
    assert.ok(tagNames.includes('bolt11'), 'should require bolt11 tag');
    assert.ok(tagNames.includes('description'), 'should require description tag');
  });

  it('extracts conditional kind (kind-7, per-item + array-level)', () => {
    const filePath = join(schemasDir, 'nips', 'nip-25', 'kind-7', 'schema.json');
    if (!existsSync(filePath)) { console.log('Skipping: schemata not found'); return; }

    const shape = extractKindFromFile(filePath);
    assert.equal(shape.kindNumber, 7);
    assert.equal(shape.category, 'conditional');
    // kind-7 has at least one required tag (e tag via direct contains)
    assert.ok(shape.requiredTags.length >= 1, 'should have required e tag');
    // kind-7 has per-item conditionals (emoji if/then) and/or array-level conditionals
    const totalConditionals = shape.perItemConditionals.length + shape.arrayLevelConditionals.length;
    assert.ok(totalConditionals >= 1, `should have conditionals, got ${totalConditionals}`);
  });

  it('extracts kind with content constraints (kind-23194)', () => {
    const filePath = join(schemasDir, 'nips', 'nip-47', 'kind-23194', 'schema.json');
    if (!existsSync(filePath)) { console.log('Skipping: schemata not found'); return; }

    const shape = extractKindFromFile(filePath);
    assert.equal(shape.kindNumber, 23194);
    assert.ok(shape.contentConstraints, 'should have content constraints');
    assert.equal(shape.contentConstraints!.minLength, 1);
  });

  it('extracts kind-20 with nested imeta contains', () => {
    const filePath = join(schemasDir, 'nips', 'nip-68', 'kind-20', 'schema.json');
    if (!existsSync(filePath)) { console.log('Skipping: schemata not found'); return; }

    const shape = extractKindFromFile(filePath);
    assert.equal(shape.kindNumber, 20);
    assert.ok(shape.requiredTags.length >= 2, 'should require title + imeta tags');
    const tagNames = shape.requiredTags.map(t => t.tagName);
    assert.ok(tagNames.includes('title'), 'should require title tag');
    assert.ok(tagNames.includes('imeta'), 'should require imeta tag');
  });
});

describe('categorization pass (all 177 schemas)', () => {
  it('extracts all kind schemas without failure', () => {
    if (!existsSync(join(schemasDir, 'nips'))) {
      console.log('Skipping: schemata not found');
      return;
    }

    const schemas = discoverKindSchemas(schemasDir);
    assert.ok(schemas.length >= 170, `Expected >=170 kind schemas, got ${schemas.length}`);

    const categories = new Map<KindCategory, number>();
    const failures: Array<{ kind: number; error: string }> = [];

    for (const { filePath, kindNumber } of schemas) {
      try {
        const shape = extractKindFromFile(filePath);
        const count = categories.get(shape.category) ?? 0;
        categories.set(shape.category, count + 1);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failures.push({ kind: kindNumber, error: msg });
      }
    }

    // Report
    console.log(`\n  Categorization (${schemas.length} schemas):`);
    for (const [cat, count] of [...categories.entries()].sort()) {
      console.log(`    ${cat}: ${count}`);
    }
    if (failures.length > 0) {
      console.log(`    failed: ${failures.length}`);
      for (const f of failures) {
        console.log(`      kind-${f.kind}: ${f.error}`);
      }
    }

    // Target: 0 failures
    assert.equal(failures.length, 0, `${failures.length} schemas failed extraction: ${failures.map(f => `kind-${f.kind}`).join(', ')}`);
  });
});
