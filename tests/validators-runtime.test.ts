/**
 * Runtime tests for generated validators.
 *
 * These tests dynamically import the generated validators.ts file and
 * execute the generated functions to verify they work at runtime.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = __dirname.includes('dist-tests')
  ? join(__dirname, '..', '..')
  : join(__dirname, '..');

// Compile validators.ts to JS for runtime import
import { execSync } from 'node:child_process';

function compileValidators(): string | undefined {
  const srcFile = join(projectRoot, 'validators.ts');
  if (!existsSync(srcFile)) return undefined;

  const outDir = join(projectRoot, 'dist-validators');
  try {
    execSync(
      `npx tsc --strict --target ES2022 --module Node16 --moduleResolution Node16 --outDir ${outDir} ${srcFile}`,
      { cwd: projectRoot, encoding: 'utf-8', stdio: 'pipe' }
    );
    return join(outDir, 'validators.js');
  } catch (err: unknown) {
    const msg = err instanceof Error ? (err as Error & { stderr?: string }).stderr ?? err.message : String(err);
    throw new Error(`validators.ts failed to compile:\n${msg}`);
  }
}

describe('validators runtime', () => {
  let validators: Record<string, (...args: unknown[]) => unknown[]>;

  it('compiles and loads generated validators', async () => {
    const jsFile = compileValidators();
    if (!jsFile || !existsSync(jsFile)) {
      console.log('Skipping: validators.ts not available');
      return;
    }

    validators = await import(pathToFileURL(jsFile).href);
    assert.ok(validators, 'validators module should load');
    assert.strictEqual(typeof validators.validateKindTags, 'function', 'missing validateKindTags');
    assert.strictEqual(typeof validators.validateKind9735Tags, 'function', 'missing validateKind9735Tags');
    assert.strictEqual(typeof validators.validateKind10002Tags, 'function', 'missing validateKind10002Tags');
    assert.strictEqual(typeof validators.validateImetaTag, 'function', 'missing validateImetaTag');
    assert.strictEqual(typeof validators.validateMlsExtensionsTag, 'function', 'missing validateMlsExtensionsTag');
    assert.strictEqual(typeof validators.validateMlsProposalsTag, 'function', 'missing validateMlsProposalsTag');
  });

  it('validateKind9735Tags catches missing p tag', () => {
    if (!validators?.validateKind9735Tags) { console.log('Skipping'); return; }

    const errors = validators.validateKind9735Tags([
      ['bolt11', 'lnbc1...'],
      ['description', '{"content":"test"}'],
    ]) as Array<{ path: string; message: string }>;

    assert.ok(errors.length >= 1, 'Should report missing p tag');
    assert.ok(errors.some(e => e.message.includes('p tag')));
  });

  it('validateKind9735Tags catches missing bolt11 tag', () => {
    if (!validators?.validateKind9735Tags) { console.log('Skipping'); return; }

    const errors = validators.validateKind9735Tags([
      ['p', 'a'.repeat(64)],
      ['description', '{"content":"test"}'],
    ]) as Array<{ path: string; message: string }>;

    assert.ok(errors.length >= 1, 'Should report missing bolt11 tag');
    assert.ok(errors.some(e => e.message.includes('bolt11')));
  });

  it('validateKind9735Tags passes with all required tags', () => {
    if (!validators?.validateKind9735Tags) { console.log('Skipping'); return; }

    const errors = validators.validateKind9735Tags([
      ['p', 'a'.repeat(64)],
      ['bolt11', 'lnbc1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygshp58yjmdan79s6qqdhdzgynm4zwqd5d7xmw5fk98klysy043l2ahrqs9qypqsq5k'],
      ['description', '{"content":"test"}'],
    ]) as Array<{ path: string; message: string }>;

    assert.equal(errors.length, 0, `Should pass, got: ${JSON.stringify(errors)}`);
  });

  it('validateKind10002Tags catches missing r tag', () => {
    if (!validators?.validateKind10002Tags) { console.log('Skipping'); return; }

    const errors = validators.validateKind10002Tags([
      ['p', 'a'.repeat(64)],
    ]) as Array<{ path: string; message: string }>;

    assert.ok(errors.length >= 1, 'Should report missing r tag');
  });

  it('validateKind10002Tags passes with r tag', () => {
    if (!validators?.validateKind10002Tags) { console.log('Skipping'); return; }

    const errors = validators.validateKind10002Tags([
      ['r', 'wss://relay.example.com'],
    ]) as Array<{ path: string; message: string }>;

    assert.equal(errors.length, 0, `Should pass, got: ${JSON.stringify(errors)}`);
  });

  it('validateKindTags dispatches correctly', () => {
    if (!validators?.validateKindTags) { console.log('Skipping'); return; }

    // Unknown kind returns empty
    const unknownErrors = validators.validateKindTags(99999, []) as unknown[];
    assert.equal(unknownErrors.length, 0);

    // Bare kind returns empty
    const bareErrors = validators.validateKindTags(1, []) as unknown[];
    assert.equal(bareErrors.length, 0);

    // Constrained kind with missing tags returns errors
    const zapErrors = validators.validateKindTags(9735, []) as unknown[];
    assert.ok(zapErrors.length >= 1, 'Should catch missing tags for kind 9735');
  });

  it('validateImetaTag validates pattern contains', () => {
    if (!validators?.validateImetaTag) { console.log('Skipping'); return; }

    // Missing URL entry
    const errors = validators.validateImetaTag([
      'imeta',
      'm image/jpeg',
    ]) as Array<{ path: string; message: string }>;

    assert.ok(errors.length >= 1, 'Should catch missing URL entry');

    // Valid tag
    const okErrors = validators.validateImetaTag([
      'imeta',
      'url https://example.com/photo.jpg',
      'm image/jpeg',
    ]) as Array<{ path: string; message: string }>;

    assert.equal(okErrors.length, 0, `Should pass, got: ${JSON.stringify(okErrors)}`);
  });

  it('validateMlsExtensionsTag validates const contains', () => {
    if (!validators?.validateMlsExtensionsTag) { console.log('Skipping'); return; }

    // Missing required constants
    const errors = validators.validateMlsExtensionsTag([
      'mls_extensions',
      '0x0001',
    ]) as Array<{ path: string; message: string }>;

    assert.ok(errors.length >= 1, 'Should catch missing 0xf2ee');

    // Valid tag
    const okErrors = validators.validateMlsExtensionsTag([
      'mls_extensions',
      '0xf2ee',
      '0x000a',
    ]) as Array<{ path: string; message: string }>;

    assert.equal(okErrors.length, 0, `Should pass, got: ${JSON.stringify(okErrors)}`);
  });

  // --- P1a regression: additionalItems:false must cap tag length ---

  it('rejects overlong p tag on kind 4 (additionalItems:false)', () => {
    if (!validators?.validateKind4Tags) { console.log('Skipping'); return; }

    // kind 4 p tag schema: items = [const "p", hex64, petname], additionalItems: false
    // So max length should be 3. A 4-element p tag should fail.
    const errors = validators.validateKind4Tags([
      ['p', 'a'.repeat(64), 'petname', 'extra-element'],
    ]) as Array<{ path: string; message: string }>;

    assert.ok(errors.length > 0, 'should reject 4-element p tag when additionalItems:false');
  });

  it('accepts valid 2-element p tag on kind 4', () => {
    if (!validators?.validateKind4Tags) { console.log('Skipping'); return; }

    const errors = validators.validateKind4Tags([
      ['p', 'a'.repeat(64)],
    ]) as Array<{ path: string; message: string }>;

    assert.deepStrictEqual(errors, [], `should accept valid p tag, got: ${JSON.stringify(errors)}`);
  });

  it('accepts valid 4-element p tag on kind 4 (relay URL + petname)', () => {
    if (!validators?.validateKind4Tags) { console.log('Skipping'); return; }

    const errors = validators.validateKind4Tags([
      ['p', 'a'.repeat(64), 'wss://relay.example.com', 'alice'],
    ]) as Array<{ path: string; message: string }>;

    assert.deepStrictEqual(errors, [], `should accept valid p tag with relay URL and petname, got: ${JSON.stringify(errors)}`);
  });

  // --- P1b regression: optional positions with enum constraints must be validated ---

  it('rejects invalid r tag marker on kind 10002', () => {
    if (!validators?.validateKind10002Tags) { console.log('Skipping'); return; }

    // kind 10002 r tag: items[2] has enum ["read", "write"], optional (minItems=2)
    // "bogus" is not in the enum and should fail
    const errors = validators.validateKind10002Tags([
      ['r', 'wss://relay.example.com', 'bogus'],
    ]) as Array<{ path: string; message: string }>;

    assert.ok(errors.length > 0, 'should reject r tag with invalid 3rd item');
  });

  it('accepts valid r tag with read marker on kind 10002', () => {
    if (!validators?.validateKind10002Tags) { console.log('Skipping'); return; }

    const errors = validators.validateKind10002Tags([
      ['r', 'wss://relay.example.com', 'read'],
    ]) as Array<{ path: string; message: string }>;

    assert.deepStrictEqual(errors, [], `should accept valid r tag with read marker, got: ${JSON.stringify(errors)}`);
  });

  it('accepts valid r tag with write marker on kind 10002', () => {
    if (!validators?.validateKind10002Tags) { console.log('Skipping'); return; }

    const errors = validators.validateKind10002Tags([
      ['r', 'wss://relay.example.com', 'write'],
    ]) as Array<{ path: string; message: string }>;

    assert.deepStrictEqual(errors, [], `should accept valid r tag with write marker, got: ${JSON.stringify(errors)}`);
  });

  // --- P1b extended: optional position validation in per-item conditionals ---

  it('rejects invalid optional position in conditional price tag on kind 30402', () => {
    if (!validators?.validateKind30402Tags) { console.log('Skipping'); return; }

    // price tag: items[3] is optional with pattern ^[A-Za-z]{3,}$
    // "bad-unit!" contains non-alpha chars and should fail
    const errors = validators.validateKind30402Tags([
      ['d', 'listing-id'],
      ['price', '12.00', 'USD', 'bad-unit!'],
    ]) as Array<{ path: string; message: string }>;

    assert.ok(errors.length > 0, 'should reject price tag with invalid optional 4th item');
  });

  it('accepts valid price tag with optional 4th item on kind 30402', () => {
    if (!validators?.validateKind30402Tags) { console.log('Skipping'); return; }

    const errors = validators.validateKind30402Tags([
      ['d', 'listing-id'],
      ['price', '12.00', 'USD', 'BTC'],
    ]) as Array<{ path: string; message: string }>;

    assert.deepStrictEqual(errors, [], `should accept valid price tag, got: ${JSON.stringify(errors)}`);
  });

  it('accepts price tag without optional 4th item on kind 30402', () => {
    if (!validators?.validateKind30402Tags) { console.log('Skipping'); return; }

    const errors = validators.validateKind30402Tags([
      ['d', 'listing-id'],
      ['price', '12.00', 'USD'],
    ]) as Array<{ path: string; message: string }>;

    assert.deepStrictEqual(errors, [], `should accept 3-element price tag, got: ${JSON.stringify(errors)}`);
  });

  // --- P2 regression: anyOf patterns in tags.allOf ---

  it('rejects malformed e tag on kind 4 when present (optional-but-constrained)', () => {
    if (!validators?.validateKind4Tags) { console.log('Skipping'); return; }

    // kind 4 has anyOf: [not contains "e", contains valid "e" tag]
    // So if an "e" tag IS present, it must have at least 2 items with hex64 event id
    const errors = validators.validateKind4Tags([
      ['p', 'a'.repeat(64)],
      ['e'],  // malformed — missing event_id
    ]) as Array<{ path: string; message: string }>;

    assert.ok(errors.length > 0, 'should reject e tag with only 1 element when 2 required');
  });

  it('accepts kind 4 without e tag (optional tag absent)', () => {
    if (!validators?.validateKind4Tags) { console.log('Skipping'); return; }

    const errors = validators.validateKind4Tags([
      ['p', 'a'.repeat(64)],
    ]) as Array<{ path: string; message: string }>;

    assert.deepStrictEqual(errors, [], `should accept kind 4 without e tag, got: ${JSON.stringify(errors)}`);
  });

  it('accepts kind 4 with valid e tag', () => {
    if (!validators?.validateKind4Tags) { console.log('Skipping'); return; }

    const errors = validators.validateKind4Tags([
      ['p', 'a'.repeat(64)],
      ['e', 'b'.repeat(64)],
    ]) as Array<{ path: string; message: string }>;

    assert.deepStrictEqual(errors, [], `should accept kind 4 with valid e tag, got: ${JSON.stringify(errors)}`);
  });

  it('rejects kind 777 without any filter tag (any-of-group)', () => {
    if (!validators?.validateKind777Tags) { console.log('Skipping'); return; }

    // kind 777 requires at least one of: k, authors, ids, tag, limit, since, until, search
    // Having cmd + a random non-filter tag should satisfy minItems but fail the anyOf check
    const errors = validators.validateKind777Tags([
      ['cmd', 'REQ'],
      ['x', 'something'],
    ]) as Array<{ path: string; message: string }>;

    assert.ok(errors.length > 0, 'should reject kind 777 without any filter tag');
    assert.ok(errors.some(e => e.message.includes('at least one')),
      `should mention "at least one", got: ${JSON.stringify(errors)}`);
  });

  it('accepts kind 777 with a filter tag', () => {
    if (!validators?.validateKind777Tags) { console.log('Skipping'); return; }

    const errors = validators.validateKind777Tags([
      ['cmd', 'REQ'],
      ['k', '1'],
    ]) as Array<{ path: string; message: string }>;

    assert.deepStrictEqual(errors, [], `should accept kind 777 with k filter tag, got: ${JSON.stringify(errors)}`);
  });
});
