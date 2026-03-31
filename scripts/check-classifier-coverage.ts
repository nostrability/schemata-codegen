#!/usr/bin/env node
/**
 * check-classifier-coverage.ts
 *
 * Walks all JSON schema files in a schemata dist directory, extracts every
 * "pattern" field value, deduplicates them, runs each through classifyRegex(),
 * and reports which patterns (if any) fall back to the generic 'regex' op.
 *
 * Usage:
 *   npx tsx scripts/check-classifier-coverage.ts ../schemata/dist
 *   npx tsx scripts/check-classifier-coverage.ts ../schemata/dist --allowlist scripts/classifier-allowlist.json
 *
 * Exit codes:
 *   0  All patterns classified into native ops (or allowlisted)
 *   1  One or more patterns fell back to regex
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { classifyRegex, type PatternCheck } from '../src/classify-pattern.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AllowlistEntry {
  pattern: string;
  reason: string;
}

interface CoverageResult {
  totalPatterns: number;
  opCounts: Record<string, number>;
  regexFallbacks: string[];
  allowlisted: string[];
}

// ---------------------------------------------------------------------------
// Schema walking
// ---------------------------------------------------------------------------

/**
 * Recursively extract all "pattern" string values from a JSON value.
 * Skips "errorMessage" objects — these use "pattern" as a key to hold
 * human-readable error strings, not regex patterns.
 */
function extractPatterns(value: unknown): string[] {
  const patterns: string[] = [];

  if (value === null || value === undefined) return patterns;

  if (Array.isArray(value)) {
    for (const item of value) {
      patterns.push(...extractPatterns(item));
    }
    return patterns;
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const [key, val] of Object.entries(obj)) {
      // Skip errorMessage objects — they reuse JSON Schema keyword names
      // (like "pattern") as keys, but the values are error message strings
      if (key === 'errorMessage') continue;

      if (key === 'pattern' && typeof val === 'string') {
        patterns.push(val);
      } else {
        patterns.push(...extractPatterns(val));
      }
    }
  }

  return patterns;
}

/** Recursively find all .json files under a directory. */
function findJsonFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...findJsonFiles(full));
    } else if (entry.endsWith('.json')) {
      files.push(full);
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

export function checkClassifierCoverage(
  distDir: string,
  allowlist: AllowlistEntry[] = [],
): CoverageResult {
  const allowedPatterns = new Set(allowlist.map((e) => e.pattern));
  const allPatterns = new Set<string>();

  // Walk all JSON schema files and extract patterns
  const jsonFiles = findJsonFiles(distDir);
  for (const file of jsonFiles) {
    try {
      const raw = readFileSync(file, 'utf-8');
      const schema = JSON.parse(raw);
      for (const p of extractPatterns(schema)) {
        allPatterns.add(p);
      }
    } catch {
      // Skip files that can't be parsed
    }
  }

  // Classify each unique pattern
  const opCounts: Record<string, number> = {};
  const regexFallbacks: string[] = [];
  const allowlisted: string[] = [];

  for (const pattern of allPatterns) {
    const check: PatternCheck = classifyRegex(pattern);
    const op = check.op;
    opCounts[op] = (opCounts[op] ?? 0) + 1;

    if (op === 'regex') {
      if (allowedPatterns.has(pattern)) {
        allowlisted.push(pattern);
      } else {
        regexFallbacks.push(pattern);
      }
    }
  }

  return {
    totalPatterns: allPatterns.size,
    opCounts,
    regexFallbacks,
    allowlisted,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printReport(result: CoverageResult): void {
  console.log(`\nClassifier Coverage Report`);
  console.log(`=========================`);
  console.log(`Total unique patterns: ${result.totalPatterns}`);
  console.log(`\nBreakdown by op:`);

  const sorted = Object.entries(result.opCounts).sort((a, b) => b[1] - a[1]);
  for (const [op, count] of sorted) {
    console.log(`  ${op}: ${count}`);
  }

  if (result.allowlisted.length > 0) {
    console.log(`\nAllowlisted regex patterns: ${result.allowlisted.length}`);
    for (const p of result.allowlisted) {
      console.log(`  - ${p}`);
    }
  }

  if (result.regexFallbacks.length === 0) {
    console.log(`\nPASS: All ${result.totalPatterns} patterns classified into native ops`);
  } else {
    console.log(`\nFAIL: ${result.regexFallbacks.length} patterns fell back to regex:`);
    for (const p of result.regexFallbacks) {
      console.log(`  - ${p}`);
    }
  }
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: check-classifier-coverage.ts <schemata-dist-dir> [--allowlist <path>]');
    process.exit(1);
  }

  const distDir = resolve(args[0]);
  if (!existsSync(distDir)) {
    console.error(`Error: dist directory not found: ${distDir}`);
    process.exit(1);
  }

  // Parse optional --allowlist flag
  let allowlist: AllowlistEntry[] = [];
  const alIdx = args.indexOf('--allowlist');
  if (alIdx !== -1 && alIdx + 1 < args.length) {
    const alPath = resolve(args[alIdx + 1]);
    if (existsSync(alPath)) {
      try {
        allowlist = JSON.parse(readFileSync(alPath, 'utf-8'));
      } catch {
        console.error(`Warning: could not parse allowlist at ${alPath}`);
      }
    } else {
      console.error(`Warning: allowlist file not found: ${alPath}`);
    }
  } else {
    // Try default location
    const defaultAlPath = resolve(import.meta.dirname ?? '.', 'classifier-allowlist.json');
    if (existsSync(defaultAlPath)) {
      try {
        allowlist = JSON.parse(readFileSync(defaultAlPath, 'utf-8'));
      } catch {
        // Ignore
      }
    }
  }

  const result = checkClassifierCoverage(distDir, allowlist);
  printReport(result);

  if (result.regexFallbacks.length > 0) {
    process.exit(1);
  }
}

// Only run main() when executed directly (not when imported as a module)
const isDirectRun = process.argv[1] &&
  (import.meta.url === `file://${process.argv[1]}` ||
   import.meta.url === new URL(`file://${process.argv[1]}`).href);
if (isDirectRun) {
  main();
}
