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

describe('compile-check', () => {
  it('generates tags.d.ts from real schemas', () => {
    const schemasDir = join(projectRoot, '..', 'schemata', 'dist');
    const outFile = join(projectRoot, 'tags.d.ts');

    // Skip if schemata dist not available
    if (!existsSync(join(schemasDir, '@', 'tag'))) {
      console.log('Skipping: schemata dist/ not found');
      return;
    }

    execSync(
      `node ${join(projectRoot, 'dist', 'index.js')} --schemas ${schemasDir} --out ${outFile}`,
      { cwd: projectRoot, encoding: 'utf-8' }
    );

    assert.ok(existsSync(outFile), 'tags.d.ts should be created');
  });

  it('generated tags.d.ts compiles with tsc --strict', () => {
    const outFile = join(projectRoot, 'tags.d.ts');
    if (!existsSync(outFile)) {
      console.log('Skipping: tags.d.ts not found');
      return;
    }

    // tsc --noEmit on the generated file
    const result = execSync(
      `npx tsc --strict --noEmit --target ES2022 --module Node16 --moduleResolution Node16 ${outFile}`,
      { cwd: projectRoot, encoding: 'utf-8', stdio: 'pipe' }
    );
    // If it throws, the test fails
  });

  it('generated tags.d.ts has no string[] fallbacks', () => {
    const outFile = join(projectRoot, 'tags.d.ts');
    if (!existsSync(outFile)) {
      console.log('Skipping: tags.d.ts not found');
      return;
    }

    const content = readFileSync(outFile, 'utf-8');

    // Check no bare string[] appears (only ...string[] is allowed in rest positions)
    const lines = content.split('\n');
    for (const line of lines) {
      if (line.startsWith('//')) continue;  // skip comments
      // Match string[] not preceded by ... (which would be a rest element)
      const bareStringArray = /(?<!\.\.\.)string\[\]/.test(line);
      assert.ok(!bareStringArray, `Found bare string[] in: ${line.trim()}`);
    }
  });

  it('generates types for all 155 tags (100% coverage)', () => {
    const outFile = join(projectRoot, 'tags.d.ts');
    if (!existsSync(outFile)) {
      console.log('Skipping: tags.d.ts not found');
      return;
    }

    const content = readFileSync(outFile, 'utf-8');
    const typeCount = (content.match(/^export type \w+Tag /gm) || []).length;

    // We expect at least 155 types (some union variants add extra type declarations)
    assert.ok(typeCount >= 155, `Expected >=155 type exports, got ${typeCount}`);
  });
});
