import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Navigate to project root — works from both tests/ and dist-tests/tests/
const projectRoot = __dirname.includes('dist-tests')
  ? join(__dirname, '..', '..')
  : join(__dirname, '..');
const schemasDir = join(projectRoot, '..', 'schemata', 'dist');
const schemasAvailable = existsSync(join(schemasDir, '@', 'tag'));

describe('compile-check: tags', () => {
  it('generates tags.d.ts from real schemas', () => {
    const outFile = join(projectRoot, 'tags.d.ts');
    if (!schemasAvailable) { console.log('Skipping: schemata dist/ not found'); return; }

    execSync(
      `node ${join(projectRoot, 'dist', 'index.js')} --schemas ${schemasDir} --out ${outFile}`,
      { cwd: projectRoot, encoding: 'utf-8' }
    );

    assert.ok(existsSync(outFile), 'tags.d.ts should be created');
  });

  it('generated tags.d.ts compiles with tsc --strict', () => {
    const outFile = join(projectRoot, 'tags.d.ts');
    if (!existsSync(outFile)) { console.log('Skipping: tags.d.ts not found'); return; }

    execSync(
      `npx tsc --strict --noEmit --target ES2022 --module Node16 --moduleResolution Node16 ${outFile}`,
      { cwd: projectRoot, encoding: 'utf-8', stdio: 'pipe' }
    );
  });

  it('generated tags.d.ts has no string[] fallbacks', () => {
    const outFile = join(projectRoot, 'tags.d.ts');
    if (!existsSync(outFile)) { console.log('Skipping: tags.d.ts not found'); return; }

    const content = readFileSync(outFile, 'utf-8');
    const lines = content.split('\n');
    for (const line of lines) {
      if (line.startsWith('//')) continue;
      const bareStringArray = /(?<!\.\.\.)string\[\]/.test(line);
      assert.ok(!bareStringArray, `Found bare string[] in: ${line.trim()}`);
    }
  });

  it('generates types for all 155+ tags (100% coverage)', () => {
    const outFile = join(projectRoot, 'tags.d.ts');
    if (!existsSync(outFile)) { console.log('Skipping: tags.d.ts not found'); return; }

    const content = readFileSync(outFile, 'utf-8');
    const typeCount = (content.match(/^export type \w+Tag /gm) || []).length;
    assert.ok(typeCount >= 155, `Expected >=155 type exports, got ${typeCount}`);
  });
});

describe('compile-check: kinds', () => {
  it('generates all files with --all', () => {
    if (!schemasAvailable) { console.log('Skipping: schemata dist/ not found'); return; }

    execSync(
      `node ${join(projectRoot, 'dist', 'index.js')} --schemas ${schemasDir} --all`,
      { cwd: projectRoot, encoding: 'utf-8' }
    );

    assert.ok(existsSync(join(projectRoot, 'kinds.d.ts')), 'kinds.d.ts should be created');
    assert.ok(existsSync(join(projectRoot, 'validators.ts')), 'validators.ts should be created');
    assert.ok(existsSync(join(projectRoot, 'kind-registry.ts')), 'kind-registry.ts should be created');
    assert.ok(existsSync(join(projectRoot, 'error-messages.ts')), 'error-messages.ts should be created');
    assert.ok(existsSync(join(projectRoot, 'ajv-schemas', 'index.json')), 'ajv-schemas/index.json should be created');
    assert.ok(existsSync(join(projectRoot, 'kind-tags.d.ts')), 'kind-tags.d.ts should be created');
  });

  it('generated kinds.d.ts compiles with tsc --strict', () => {
    const outFile = join(projectRoot, 'kinds.d.ts');
    if (!existsSync(outFile)) { console.log('Skipping: kinds.d.ts not found'); return; }

    execSync(
      `npx tsc --strict --noEmit --target ES2022 --module Node16 --moduleResolution Node16 ${outFile}`,
      { cwd: projectRoot, encoding: 'utf-8', stdio: 'pipe' }
    );
  });

  it('generates at least 177 kind interfaces', () => {
    const outFile = join(projectRoot, 'kinds.d.ts');
    if (!existsSync(outFile)) { console.log('Skipping: kinds.d.ts not found'); return; }

    const content = readFileSync(outFile, 'utf-8');
    const interfaceCount = (content.match(/^export interface Kind\d+Event \{/gm) || []).length;
    assert.ok(interfaceCount >= 177, `Expected at least 177 kind interfaces, got ${interfaceCount}`);
  });

  it('kind-10002 has kind: 10002 literal', () => {
    const outFile = join(projectRoot, 'kinds.d.ts');
    if (!existsSync(outFile)) { console.log('Skipping: kinds.d.ts not found'); return; }

    const content = readFileSync(outFile, 'utf-8');
    assert.ok(content.includes('export interface Kind10002Event'));
    assert.ok(content.includes('readonly kind: 10002;'));
  });

  it('emits NostrEvent union type', () => {
    const outFile = join(projectRoot, 'kinds.d.ts');
    if (!existsSync(outFile)) { console.log('Skipping: kinds.d.ts not found'); return; }

    const content = readFileSync(outFile, 'utf-8');
    assert.ok(content.includes('export type NostrEvent ='));
    assert.ok(content.includes('Kind0Event'));
    assert.ok(content.includes('Kind10002Event'));
  });

  it('emits KNOWN_KINDS mapping', () => {
    const outFile = join(projectRoot, 'kinds.d.ts');
    if (!existsSync(outFile)) { console.log('Skipping: kinds.d.ts not found'); return; }

    const content = readFileSync(outFile, 'utf-8');
    assert.ok(content.includes('export declare const KNOWN_KINDS'));
  });
});

describe('compile-check: validators', () => {
  it('generated validators.ts compiles with tsc --strict', () => {
    const outFile = join(projectRoot, 'validators.ts');
    if (!existsSync(outFile)) { console.log('Skipping: validators.ts not found'); return; }

    execSync(
      `npx tsc --strict --noEmit --target ES2022 --module Node16 --moduleResolution Node16 ${outFile}`,
      { cwd: projectRoot, encoding: 'utf-8', stdio: 'pipe' }
    );
  });

  it('has tag-level validators', () => {
    const outFile = join(projectRoot, 'validators.ts');
    if (!existsSync(outFile)) { console.log('Skipping: validators.ts not found'); return; }

    const content = readFileSync(outFile, 'utf-8');
    assert.ok(content.includes('export function validateImetaTag'));
    assert.ok(content.includes('export function validateMlsExtensionsTag'));
    assert.ok(content.includes('export function validateMlsProposalsTag'));
  });

  it('has kind-level validators for constrained kinds', () => {
    const outFile = join(projectRoot, 'validators.ts');
    if (!existsSync(outFile)) { console.log('Skipping: validators.ts not found'); return; }

    const content = readFileSync(outFile, 'utf-8');
    assert.ok(content.includes('export function validateKind9735Tags'));
    assert.ok(content.includes('export function validateKind10002Tags'));
    assert.ok(content.includes('export function validateKind7Tags'));
  });

  it('has dispatch function', () => {
    const outFile = join(projectRoot, 'validators.ts');
    if (!existsSync(outFile)) { console.log('Skipping: validators.ts not found'); return; }

    const content = readFileSync(outFile, 'utf-8');
    assert.ok(content.includes('export function validateKindTags'));
    assert.ok(content.includes('switch (kind)'));
  });

  it('does not emit validators for bare kinds', () => {
    const outFile = join(projectRoot, 'validators.ts');
    if (!existsSync(outFile)) { console.log('Skipping: validators.ts not found'); return; }

    const content = readFileSync(outFile, 'utf-8');
    // Kind 0 and 1 are bare — should not have validators
    assert.ok(!content.includes('validateKind0Tags'));
    assert.ok(!content.includes('validateKind1Tags'));
  });

  it('has kind validators for all constrained kinds', () => {
    const outFile = join(projectRoot, 'validators.ts');
    const kindsFile = join(projectRoot, 'kinds.d.ts');
    if (!existsSync(outFile) || !existsSync(kindsFile)) { console.log('Skipping: output files not found'); return; }

    const validatorsContent = readFileSync(outFile, 'utf-8');
    const kindsContent = readFileSync(kindsFile, 'utf-8');

    const kindValidatorCount = (validatorsContent.match(/^export function validateKind\d+Tags\b/gm) || []).length;
    const totalKinds = (kindsContent.match(/^export interface Kind\d+Event \{/gm) || []).length;

    // Bare kinds have no validators; constrained kinds do
    // Validator count + bare count should equal total kinds
    assert.ok(kindValidatorCount > 0, 'Should have at least some kind validators');
    assert.ok(kindValidatorCount <= totalKinds, `More validators (${kindValidatorCount}) than kinds (${totalKinds})`);
    assert.ok(kindValidatorCount >= 130, `Expected at least 130 kind validators, got ${kindValidatorCount}`);
  });
});

describe('compile-check: kind-registry', () => {
  it('generated kind-registry.ts compiles with tsc --strict', () => {
    const outFile = join(projectRoot, 'kind-registry.ts');
    if (!existsSync(outFile)) { console.log('Skipping: kind-registry.ts not found'); return; }

    execSync(
      `npx tsc --strict --noEmit --target ES2022 --module Node16 --moduleResolution Node16 ${outFile}`,
      { cwd: projectRoot, encoding: 'utf-8', stdio: 'pipe' }
    );
  });

  it('exports KIND_REGISTRY with all kinds', () => {
    const outFile = join(projectRoot, 'kind-registry.ts');
    if (!existsSync(outFile)) { console.log('Skipping: kind-registry.ts not found'); return; }

    const content = readFileSync(outFile, 'utf-8');
    assert.ok(content.includes('export const KIND_REGISTRY'));
    assert.ok(content.includes('export const KIND_NAMES'));
    assert.ok(content.includes('export const KNOWN_KIND_NUMBERS'));

    // Check specific kinds exist
    assert.ok(content.includes('kind: 0,'));
    assert.ok(content.includes('kind: 9735,'));
    assert.ok(content.includes('kind: 10002,'));
  });

  it('has human-readable names (not just "kindN")', () => {
    const outFile = join(projectRoot, 'kind-registry.ts');
    if (!existsSync(outFile)) { console.log('Skipping: kind-registry.ts not found'); return; }

    const content = readFileSync(outFile, 'utf-8');
    // kind-4 should have a descriptive name from description field
    assert.ok(content.includes('Encrypted Direct Message'));
    // kind-9735 should have zap-related name
    assert.ok(content.includes('Zap Receipt'));
  });
});

describe('compile-check: error-messages', () => {
  it('generated error-messages.ts compiles with tsc --strict', () => {
    const outFile = join(projectRoot, 'error-messages.ts');
    if (!existsSync(outFile)) { console.log('Skipping: error-messages.ts not found'); return; }

    execSync(
      `npx tsc --strict --noEmit --target ES2022 --module Node16 --moduleResolution Node16 ${outFile}`,
      { cwd: projectRoot, encoding: 'utf-8', stdio: 'pipe' }
    );
  });

  it('exports BASE_ERROR_MESSAGES and KIND_ERROR_MESSAGES', () => {
    const outFile = join(projectRoot, 'error-messages.ts');
    if (!existsSync(outFile)) { console.log('Skipping: error-messages.ts not found'); return; }

    const content = readFileSync(outFile, 'utf-8');
    assert.ok(content.includes('export const BASE_ERROR_MESSAGES'));
    assert.ok(content.includes('export const KIND_ERROR_MESSAGES'));
    // Base messages should include standard event field validations
    assert.ok(content.includes('id must be a valid hash'));
    assert.ok(content.includes('pubkey must be a secp256k1 public key'));
  });

  it('has kind-specific error messages', () => {
    const outFile = join(projectRoot, 'error-messages.ts');
    if (!existsSync(outFile)) { console.log('Skipping: error-messages.ts not found'); return; }

    const content = readFileSync(outFile, 'utf-8');
    // Kind-7 has reaction-specific messages
    assert.ok(content.includes('tags must include an e tag referencing the reacted event'));
    // Kind-9735 has zap-specific messages
    assert.ok(content.includes('9735: ['));
  });
});

describe('compile-check: kind-tags', () => {
  it('generated kind-tags.d.ts compiles with tsc --strict', () => {
    const outFile = join(projectRoot, 'kind-tags.d.ts');
    if (!existsSync(outFile)) { console.log('Skipping: kind-tags.d.ts not found'); return; }

    execSync(
      `npx tsc --strict --noEmit --target ES2022 --module Node16 --moduleResolution Node16 ${outFile}`,
      { cwd: projectRoot, encoding: 'utf-8', stdio: 'pipe' }
    );
  });

  it('generates at least 300 kind-scoped tag types', () => {
    const outFile = join(projectRoot, 'kind-tags.d.ts');
    if (!existsSync(outFile)) { console.log('Skipping: kind-tags.d.ts not found'); return; }

    const content = readFileSync(outFile, 'utf-8');
    const typeCount = (content.match(/^export type Kind\d+_\w+Tag /gm) || []).length;
    assert.ok(typeCount >= 300, `Expected >= 300 kind-scoped tag types, got ${typeCount}`);
  });

  it('has no duplicate type names', () => {
    const outFile = join(projectRoot, 'kind-tags.d.ts');
    if (!existsSync(outFile)) { console.log('Skipping: kind-tags.d.ts not found'); return; }

    const content = readFileSync(outFile, 'utf-8');
    const matches = content.match(/^export type (\S+)/gm) || [];
    const names = matches.map(m => m.replace('export type ', ''));
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    assert.equal(dupes.length, 0, `Duplicate type names: ${[...new Set(dupes)].join(', ')}`);
  });

  it('has no empty type aliases (missing RHS)', () => {
    const outFile = join(projectRoot, 'kind-tags.d.ts');
    if (!existsSync(outFile)) { console.log('Skipping: kind-tags.d.ts not found'); return; }

    const content = readFileSync(outFile, 'utf-8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('export type ') && line.trimEnd().endsWith('=')) {
        // Multiline union: next line should start with '  |'
        const next = lines[i + 1] ?? '';
        assert.ok(next.startsWith('  |'), `Empty type alias at line ${i + 1}: ${line.trim()}`);
      }
    }
  });
});

describe('compile-check: ajv-schemas', () => {
  it('generates one JSON file per kind plus index', () => {
    const ajvDir = join(projectRoot, 'ajv-schemas');
    if (!existsSync(ajvDir)) { console.log('Skipping: ajv-schemas/ not found'); return; }

    const indexFile = join(ajvDir, 'index.json');
    assert.ok(existsSync(indexFile), 'index.json should exist');

    const index = JSON.parse(readFileSync(indexFile, 'utf-8'));
    const keys = Object.keys(index);
    assert.ok(keys.length >= 177, `Expected >= 177 entries in index, got ${keys.length}`);
    assert.ok('kind7Schema' in index);
    assert.ok('kind9735Schema' in index);
  });

  it('AJV schemas have no nested $schema/$id/errorMessage', () => {
    const schemaFile = join(projectRoot, 'ajv-schemas', 'kind-7.json');
    if (!existsSync(schemaFile)) { console.log('Skipping'); return; }

    const content = readFileSync(schemaFile, 'utf-8');
    const schema = JSON.parse(content);

    // Root $schema should be preserved
    assert.ok(schema.$schema, 'Root $schema should exist');

    // Check nested objects are clean
    function checkNested(obj: unknown, path: string, isRoot: boolean): void {
      if (typeof obj !== 'object' || obj === null) return;
      if (Array.isArray(obj)) {
        obj.forEach((item, i) => checkNested(item, `${path}[${i}]`, false));
        return;
      }
      const record = obj as Record<string, unknown>;
      if (!isRoot) {
        assert.ok(!('$schema' in record), `Nested $schema at ${path}`);
        assert.ok(!('$id' in record), `Nested $id at ${path}`);
      }
      assert.ok(!('errorMessage' in record), `errorMessage at ${path}`);
      for (const [k, v] of Object.entries(record)) {
        checkNested(v, `${path}.${k}`, false);
      }
    }
    checkNested(schema, 'root', true);
  });
});


