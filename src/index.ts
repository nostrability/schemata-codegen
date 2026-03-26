#!/usr/bin/env node
/**
 * schemata-codegen CLI
 *
 * Usage: schemata-codegen --schemas ../schemata/dist [--out tags.d.ts]
 */

import { readdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { extractTagFromFile } from './extract-tag.js';
import { emitTagsFile } from './emit-typescript.js';
import type { TagShape } from './patterns.js';

interface CliArgs {
  schemasDir: string;
  outFile: string;
}

function parseArgs(argv: string[]): CliArgs {
  let schemasDir = '';
  let outFile = 'tags.d.ts';

  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--schemas' && argv[i + 1]) {
      schemasDir = argv[++i];
    } else if (argv[i] === '--out' && argv[i + 1]) {
      outFile = argv[++i];
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('Usage: schemata-codegen --schemas <dist-path> [--out <file>]');
      console.log('');
      console.log('Options:');
      console.log('  --schemas  Path to schemata dist/ directory (required)');
      console.log('  --out      Output file path (default: tags.d.ts)');
      process.exit(0);
    }
  }

  if (!schemasDir) {
    console.error('Error: --schemas <path> is required');
    process.exit(1);
  }

  return { schemasDir, outFile };
}

interface Result {
  shape: TagShape;
  fileName: string;
}

interface Failure {
  fileName: string;
  error: string;
}

function main(): void {
  const args = parseArgs(process.argv);
  const tagDir = join(args.schemasDir, '@', 'tag');

  let files: string[] = [];
  try {
    files = readdirSync(tagDir)
      .filter((f: string) => f.endsWith('.json'))
      .sort();
  } catch (err) {
    console.error(`Error reading tag directory: ${tagDir}`);
    console.error(err);
    process.exit(1);
  }

  console.log(`Found ${files.length} tag schemas in ${tagDir}`);

  const results: Result[] = [];
  const failures: Failure[] = [];

  for (const file of files) {
    const fileName = basename(file, '.json');
    const filePath = join(tagDir, file);

    try {
      const shape = extractTagFromFile(filePath, fileName);
      results.push({ shape, fileName });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ fileName, error: message });
    }
  }

  // Sort results by tag name for stable output
  results.sort((a, b) => a.shape.tagName.localeCompare(b.shape.tagName));

  const shapes = results.map(r => r.shape);
  const output = emitTagsFile(shapes);

  writeFileSync(args.outFile, output);

  // Report
  console.log('');
  console.log(`Results:`);
  console.log(`  Success: ${results.length}/${files.length} (${Math.round(100 * results.length / files.length)}%)`);
  console.log(`  Failed:  ${failures.length}/${files.length}`);
  console.log(`  Output:  ${args.outFile}`);

  // Pattern breakdown
  const patternCounts = new Map<string, number>();
  for (const r of results) {
    const count = patternCounts.get(r.shape.pattern) ?? 0;
    patternCounts.set(r.shape.pattern, count + 1);
  }
  console.log('');
  console.log('Pattern breakdown:');
  for (const [pattern, count] of [...patternCounts.entries()].sort()) {
    console.log(`  ${pattern}: ${count}`);
  }

  if (failures.length > 0) {
    console.log('');
    console.log('Failures:');
    for (const f of failures) {
      console.log(`  ${f.fileName}: ${f.error}`);
    }
  }
}

main();
