import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkClassifierCoverage } from '../scripts/check-classifier-coverage.js';

// Tests compile to dist-tests/tests/ so we need to go up 3 levels to reach the repo root's parent
const SCHEMATA_DIST = resolve(import.meta.dirname ?? '.', '../../../schemata/dist');
const ALLOWLIST_PATH = resolve(import.meta.dirname ?? '.', '../../scripts/classifier-allowlist.json');

describe('classifier coverage', () => {
  it('all schemata patterns classified into native ops', () => {
    if (!existsSync(SCHEMATA_DIST)) {
      console.log(`  [skipped] schemata dist not found at ${SCHEMATA_DIST}`);
      return;
    }

    let allowlist: { pattern: string; reason: string }[] = [];
    if (existsSync(ALLOWLIST_PATH)) {
      try {
        allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf-8'));
      } catch (err) {
        assert.fail(`Failed to parse allowlist at ${ALLOWLIST_PATH}: ${err}`);
      }
    }

    const result = checkClassifierCoverage(SCHEMATA_DIST, allowlist);

    if (result.regexFallbacks.length > 0) {
      const details = result.regexFallbacks.map((p) => `  - ${p}`).join('\n');
      assert.fail(
        `${result.regexFallbacks.length} patterns fell back to regex:\n${details}\n\n` +
        `Either add native ops in classify-pattern.ts or add to scripts/classifier-allowlist.json`,
      );
    }

    console.log(`  PASS: All ${result.totalPatterns} patterns classified into native ops`);
  });

  it('allowlist entries are still needed', () => {
    if (!existsSync(SCHEMATA_DIST)) {
      console.log(`  [skipped] schemata dist not found at ${SCHEMATA_DIST}`);
      return;
    }

    if (!existsSync(ALLOWLIST_PATH)) {
      return; // No allowlist file, nothing to check
    }

    let allowlist: { pattern: string; reason: string }[];
    try {
      allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf-8'));
    } catch (err) {
      assert.fail(`Failed to parse allowlist at ${ALLOWLIST_PATH}: ${err}`);
    }

    if (allowlist.length === 0) {
      return; // Empty allowlist, nothing to check
    }

    const result = checkClassifierCoverage(SCHEMATA_DIST, allowlist);

    // Check that every allowlisted pattern is actually still falling back to regex.
    // If a pattern was allowlisted but now classifies natively, the allowlist entry
    // is stale and should be removed.
    // A pattern is stale if it exists in the dist but now classifies natively
    // (no longer needs the allowlist). Patterns absent from the dist are not
    // stale — they may be version-specific (e.g. v0.3.0 only). See #32.
    const patternsInDist = new Set(result.allPatterns);
    const stale = allowlist.filter((entry) =>
      patternsInDist.has(entry.pattern) && !result.allowlisted.includes(entry.pattern)
    );
    if (stale.length > 0) {
      const details = stale.map((e) => `  - ${e.pattern} (${e.reason})`).join('\n');
      assert.fail(
        `${stale.length} allowlist entries are stale (patterns now classify natively):\n${details}\n\n` +
        `Remove these from scripts/classifier-allowlist.json`,
      );
    }
  });
});
