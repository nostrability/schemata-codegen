#!/usr/bin/env node
/**
 * schemata-codegen CLI
 *
 * Usage: schemata-codegen --schemas ../schemata/dist [--out tags.d.ts] [--kinds kinds.d.ts] [--validators validators.ts] [--all]
 */

import { readdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { extractTagFromFile } from './extract-tag.js';
import { extractKindFromFile, discoverKindSchemas } from './extract-kind.js';
import { emitTagsFile } from './emit-typescript.js';
import { emitKindsFile } from './emit-kind.js';
import { emitValidatorsFile } from './emit-validators.js';
import { emitRegistryFile } from './emit-registry.js';
import { extractErrorMessages, emitErrorMessagesFile } from './emit-errors.js';
import { writeAjvSchemas } from './emit-ajv.js';
import { planKindValidator } from './plan-validators.js';

import type { TagShape } from './patterns.js';
import type { KindShape } from './kind-types.js';

interface CliArgs {
  schemasDir: string;
  tagsOut: string;
  kindsOut?: string;
  validatorsOut?: string;
  registryOut?: string;
  errorsOut?: string;
  ajvSchemasDir?: string;
  dumpPlan?: string;
}

function parseArgs(argv: string[]): CliArgs {
  let schemasDir = '';
  let tagsOut = 'tags.d.ts';
  let kindsOut: string | undefined;
  let validatorsOut: string | undefined;
  let registryOut: string | undefined;
  let errorsOut: string | undefined;
  let ajvSchemasDir: string | undefined;
  let dumpPlan: string | undefined;
  let all = false;

  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--schemas' && argv[i + 1]) {
      schemasDir = argv[++i];
    } else if (argv[i] === '--out' && argv[i + 1]) {
      tagsOut = argv[++i];
    } else if (argv[i] === '--kinds' && argv[i + 1]) {
      kindsOut = argv[++i];
    } else if (argv[i] === '--validators' && argv[i + 1]) {
      validatorsOut = argv[++i];
    } else if (argv[i] === '--registry' && argv[i + 1]) {
      registryOut = argv[++i];
    } else if (argv[i] === '--errors' && argv[i + 1]) {
      errorsOut = argv[++i];
    } else if (argv[i] === '--ajv-schemas' && argv[i + 1]) {
      ajvSchemasDir = argv[++i];
    } else if (argv[i] === '--dump-plan' && argv[i + 1]) {
      dumpPlan = argv[++i];
    } else if (argv[i] === '--all') {
      all = true;
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('Usage: schemata-codegen --schemas <dist-path> [options]');
      console.log('');
      console.log('Options:');
      console.log('  --schemas      Path to schemata dist/ directory (required)');
      console.log('  --out          Tag types output file (default: tags.d.ts)');
      console.log('  --kinds        Kind interfaces output file');
      console.log('  --validators   Runtime validators output file');
      console.log('  --registry     Kind metadata registry output file');
      console.log('  --errors       Error message map output file');
      console.log('  --ajv-schemas  AJV-ready schemas output directory');
      console.log('  --dump-plan    Dump ValidatorAction[] plan as JSON');
      console.log('  --all          Generate all output files');
      process.exit(0);
    }
  }

  if (!schemasDir) {
    console.error('Error: --schemas <path> is required');
    process.exit(1);
  }

  if (all) {
    kindsOut = kindsOut ?? 'kinds.d.ts';
    validatorsOut = validatorsOut ?? 'validators.ts';
    registryOut = registryOut ?? 'kind-registry.ts';
    errorsOut = errorsOut ?? 'error-messages.ts';
    ajvSchemasDir = ajvSchemasDir ?? 'ajv-schemas';
  }

  return { schemasDir, tagsOut, kindsOut, validatorsOut, registryOut, errorsOut, ajvSchemasDir, dumpPlan };
}

interface Result<T> {
  shape: T;
  name: string;
}

interface Failure {
  name: string;
  error: string;
}

function main(): void {
  const args = parseArgs(process.argv);

  // Determine if we need kind extraction for any output
  const needKinds = !!(args.kindsOut || args.validatorsOut || args.registryOut || args.errorsOut || args.ajvSchemasDir || args.dumpPlan);

  // --- Tag extraction (always runs) ---
  const tagDir = join(args.schemasDir, '@', 'tag');
  let tagFiles: string[] = [];
  try {
    tagFiles = readdirSync(tagDir)
      .filter((f: string) => f.endsWith('.json'))
      .sort();
  } catch (err) {
    console.error(`Error reading tag directory: ${tagDir}`);
    console.error(err);
    process.exit(1);
  }

  console.log(`Found ${tagFiles.length} tag schemas in ${tagDir}`);

  const tagResults: Result<TagShape>[] = [];
  const tagFailures: Failure[] = [];

  for (const file of tagFiles) {
    const fileName = basename(file, '.json');
    const filePath = join(tagDir, file);
    try {
      const shape = extractTagFromFile(filePath, fileName);
      tagResults.push({ shape, name: fileName });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      tagFailures.push({ name: fileName, error: message });
    }
  }

  tagResults.sort((a, b) => a.shape.tagName.localeCompare(b.shape.tagName));
  const tagShapes = tagResults.map(r => r.shape);

  // Write tags.d.ts
  const tagsOutput = emitTagsFile(tagShapes);
  writeFileSync(args.tagsOut, tagsOutput);

  // Report tags
  console.log('');
  console.log('Tags:');
  console.log(`  Success: ${tagResults.length}/${tagFiles.length} (${Math.round(100 * tagResults.length / tagFiles.length)}%)`);
  console.log(`  Failed:  ${tagFailures.length}/${tagFiles.length}`);
  console.log(`  Output:  ${args.tagsOut}`);

  const patternCounts = new Map<string, number>();
  for (const r of tagResults) {
    const count = patternCounts.get(r.shape.pattern) ?? 0;
    patternCounts.set(r.shape.pattern, count + 1);
  }
  console.log('  Patterns:');
  for (const [pattern, count] of [...patternCounts.entries()].sort()) {
    console.log(`    ${pattern}: ${count}`);
  }

  if (tagFailures.length > 0) {
    console.log('  Failures:');
    for (const f of tagFailures) {
      console.log(`    ${f.name}: ${f.error}`);
    }
  }

  // --- Kind extraction (if any kind-dependent output is requested) ---
  let kindShapes: KindShape[] = [];
  let kindSchemas: Array<{ filePath: string; kindNumber: number; nip: string }> = [];

  if (needKinds) {
    kindSchemas = discoverKindSchemas(args.schemasDir);
    console.log(`\nFound ${kindSchemas.length} kind schemas`);

    const kindResults: Result<KindShape>[] = [];
    const kindFailures: Failure[] = [];

    for (const { filePath, kindNumber } of kindSchemas) {
      try {
        const shape = extractKindFromFile(filePath);
        kindResults.push({ shape, name: `kind-${kindNumber}` });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        kindFailures.push({ name: `kind-${kindNumber}`, error: message });
      }
    }

    kindResults.sort((a, b) => a.shape.kindNumber - b.shape.kindNumber);
    kindShapes = kindResults.map(r => r.shape);

    // Category breakdown
    const categoryCounts = new Map<string, number>();
    for (const r of kindResults) {
      const count = categoryCounts.get(r.shape.category) ?? 0;
      categoryCounts.set(r.shape.category, count + 1);
    }

    console.log('Kinds:');
    console.log(`  Success: ${kindResults.length}/${kindSchemas.length} (${Math.round(100 * kindResults.length / kindSchemas.length)}%)`);
    console.log(`  Failed:  ${kindFailures.length}/${kindSchemas.length}`);
    console.log('  Categories:');
    for (const [cat, count] of [...categoryCounts.entries()].sort()) {
      console.log(`    ${cat}: ${count}`);
    }

    if (kindFailures.length > 0) {
      console.log('  Failures:');
      for (const f of kindFailures) {
        console.log(`    ${f.name}: ${f.error}`);
      }
    }

    // Write kinds.d.ts
    if (args.kindsOut) {
      const kindsOutput = emitKindsFile(kindShapes);
      writeFileSync(args.kindsOut, kindsOutput);
      console.log(`  Output:  ${args.kindsOut} (${kindShapes.length} interfaces)`);
    }
  }

  // --- Validators ---
  if (args.validatorsOut) {
    const validatorsOutput = emitValidatorsFile(tagShapes, kindShapes);
    writeFileSync(args.validatorsOut, validatorsOutput);

    const tagValidatorCount = (validatorsOutput.match(/export function validate\w+Tag\b/g) || []).length;
    const kindValidatorCount = (validatorsOutput.match(/export function validateKind\d+Tags\b/g) || []).length;

    console.log(`\nValidators:`);
    console.log(`  Tag validators:  ${tagValidatorCount}`);
    console.log(`  Kind validators: ${kindValidatorCount}`);
    console.log(`  Output:  ${args.validatorsOut}`);
  }

  // --- Kind Registry ---
  if (args.registryOut) {
    const registryOutput = emitRegistryFile(kindShapes);
    writeFileSync(args.registryOut, registryOutput);
    console.log(`\nRegistry: ${kindShapes.length} kinds → ${args.registryOut}`);
  }

  // --- Error Messages ---
  if (args.errorsOut) {
    const kindMessages = new Map<number, Array<{ keyword: string; message: string }>>();
    for (const { filePath, kindNumber } of kindSchemas) {
      const msgs = extractErrorMessages(filePath);
      if (msgs.length > 0) {
        kindMessages.set(kindNumber, msgs);
      }
    }
    const errorsOutput = emitErrorMessagesFile(kindMessages);
    writeFileSync(args.errorsOut, errorsOutput);
    console.log(`Errors:   ${kindMessages.size} kinds with messages → ${args.errorsOut}`);
  }

  // --- AJV-Ready Schemas ---
  if (args.ajvSchemasDir) {
    const count = writeAjvSchemas(kindSchemas, args.ajvSchemasDir);
    console.log(`AJV:      ${count} schemas → ${args.ajvSchemasDir}/`);
  }

  // --- Dump Plan ---
  if (args.dumpPlan) {
    const plans: Record<number, unknown> = {};
    for (const shape of kindShapes) {
      const actions = planKindValidator(shape);
      if (actions) {
        plans[shape.kindNumber] = actions;
      }
    }
    writeFileSync(args.dumpPlan, JSON.stringify(plans, null, 2) + '\n');
    console.log(`\nPlan: ${Object.keys(plans).length} kinds → ${args.dumpPlan}`);
  }

}

main();
