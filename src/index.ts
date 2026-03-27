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
import { emitCValidators, type CApi } from './emit-c.js';
import { emitRustValidators, type RustApi } from './emit-rust.js';
import { emitGoValidators } from './emit-go.js';
import { emitPythonValidators } from './emit-python.js';
import { emitKotlinValidators } from './emit-kotlin.js';
import { emitJavaValidators } from './emit-java.js';
import { emitSwiftValidators } from './emit-swift.js';
import { emitDartValidators } from './emit-dart.js';
import { emitPhpValidators } from './emit-php.js';
import { emitCSharpValidators } from './emit-csharp.js';
import { emitCppValidators } from './emit-cpp.js';
import { emitRubyValidators } from './emit-ruby.js';
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
  cValidatorsOut?: string;
  cApi: CApi;
  rustValidatorsOut?: string;
  rustApi: RustApi;
  goValidatorsOut?: string;
  pythonValidatorsOut?: string;
  kotlinValidatorsOut?: string;
  javaValidatorsOut?: string;
  swiftValidatorsOut?: string;
  dartValidatorsOut?: string;
  phpValidatorsOut?: string;
  csharpValidatorsOut?: string;
  cppValidatorsOut?: string;
  rubyValidatorsOut?: string;
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
  let cValidatorsOut: string | undefined;
  let cApi: CApi = 'generic';
  let rustValidatorsOut: string | undefined;
  let rustApi: RustApi = 'generic';
  let goValidatorsOut: string | undefined;
  let pythonValidatorsOut: string | undefined;
  let kotlinValidatorsOut: string | undefined;
  let javaValidatorsOut: string | undefined;
  let swiftValidatorsOut: string | undefined;
  let dartValidatorsOut: string | undefined;
  let phpValidatorsOut: string | undefined;
  let csharpValidatorsOut: string | undefined;
  let cppValidatorsOut: string | undefined;
  let rubyValidatorsOut: string | undefined;
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
    } else if (argv[i] === '--c-validators' && argv[i + 1]) {
      cValidatorsOut = argv[++i];
    } else if (argv[i] === '--c-api' && argv[i + 1]) {
      const val = argv[++i];
      if (val !== 'generic' && val !== 'nostrdb') {
        console.error(`Error: --c-api must be "generic" or "nostrdb", got "${val}"`);
        process.exit(1);
      }
      cApi = val;
    } else if (argv[i] === '--rust-validators' && argv[i + 1]) {
      rustValidatorsOut = argv[++i];
    } else if (argv[i] === '--rust-api' && argv[i + 1]) {
      const val = argv[++i];
      if (val !== 'generic' && val !== 'nostr' && val !== 'nostrdb') {
        console.error(`Error: --rust-api must be "generic", "nostr", or "nostrdb", got "${val}"`);
        process.exit(1);
      }
      rustApi = val;
    } else if (argv[i] === '--go-validators' && argv[i + 1]) {
      goValidatorsOut = argv[++i];
    } else if (argv[i] === '--python-validators' && argv[i + 1]) {
      pythonValidatorsOut = argv[++i];
    } else if (argv[i] === '--kotlin-validators' && argv[i + 1]) {
      kotlinValidatorsOut = argv[++i];
    } else if (argv[i] === '--java-validators' && argv[i + 1]) {
      javaValidatorsOut = argv[++i];
    } else if (argv[i] === '--swift-validators' && argv[i + 1]) {
      swiftValidatorsOut = argv[++i];
    } else if (argv[i] === '--dart-validators' && argv[i + 1]) {
      dartValidatorsOut = argv[++i];
    } else if (argv[i] === '--php-validators' && argv[i + 1]) {
      phpValidatorsOut = argv[++i];
    } else if (argv[i] === '--csharp-validators' && argv[i + 1]) {
      csharpValidatorsOut = argv[++i];
    } else if (argv[i] === '--cpp-validators' && argv[i + 1]) {
      cppValidatorsOut = argv[++i];
    } else if (argv[i] === '--ruby-validators' && argv[i + 1]) {
      rubyValidatorsOut = argv[++i];
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
      console.log('  --c-validators C validators output file (.c, generates .h too)');
      console.log('  --c-api        C tag API: generic (default) or nostrdb');
      console.log('  --rust-validators Rust validators output file (.rs)');
      console.log('  --rust-api     Rust tag API: generic (default), nostr, or nostrdb');
      console.log('  --go-validators   Go validators output file (.go)');
      console.log('  --python-validators Python validators output file (.py)');
      console.log('  --kotlin-validators Kotlin validators output file (.kt)');
      console.log('  --java-validators Java validators output file (.java)');
      console.log('  --swift-validators Swift validators output file (.swift)');
      console.log('  --dart-validators Dart validators output file (.dart)');
      console.log('  --php-validators PHP validators output file (.php)');
      console.log('  --csharp-validators C# validators output file (.cs)');
      console.log('  --cpp-validators C++ validators output file (.hpp)');
      console.log('  --ruby-validators Ruby validators output file (.rb)');
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

  return {
    schemasDir, tagsOut, kindsOut, validatorsOut, registryOut, errorsOut, ajvSchemasDir,
    cValidatorsOut, cApi, rustValidatorsOut, rustApi,
    goValidatorsOut, pythonValidatorsOut, kotlinValidatorsOut, javaValidatorsOut,
    swiftValidatorsOut, dartValidatorsOut, phpValidatorsOut, csharpValidatorsOut,
    cppValidatorsOut, rubyValidatorsOut, dumpPlan,
  };
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
  const needKinds = !!(args.kindsOut || args.validatorsOut || args.registryOut || args.errorsOut || args.ajvSchemasDir ||
    args.cValidatorsOut || args.rustValidatorsOut ||
    args.goValidatorsOut || args.pythonValidatorsOut || args.kotlinValidatorsOut || args.javaValidatorsOut ||
    args.swiftValidatorsOut || args.dartValidatorsOut || args.phpValidatorsOut || args.csharpValidatorsOut ||
    args.cppValidatorsOut || args.rubyValidatorsOut || args.dumpPlan);

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

  // --- C Validators ---
  if (args.cValidatorsOut) {
    const { header, source } = emitCValidators(kindShapes, args.cApi);
    writeFileSync(args.cValidatorsOut, source);
    const hPath = args.cValidatorsOut.endsWith('.c')
      ? args.cValidatorsOut.replace(/\.c$/, '.h')
      : args.cValidatorsOut + '.h';
    writeFileSync(hPath, header);

    const fnCount = (source.match(/int schemata_validate_kind_\d+\(/g) || []).length;
    console.log(`\nC validators: ${fnCount} functions → ${args.cValidatorsOut} + ${hPath}`);
  }

  // --- Rust Validators ---
  if (args.rustValidatorsOut) {
    const rustOutput = emitRustValidators(kindShapes, args.rustApi);
    writeFileSync(args.rustValidatorsOut, rustOutput);

    const fnCount = (rustOutput.match(/pub fn validate_kind_\d+/g) || []).length;
    console.log(`\nRust validators (${args.rustApi}): ${fnCount} functions → ${args.rustValidatorsOut}`);
  }

  // --- Go Validators ---
  if (args.goValidatorsOut) {
    const goOutput = emitGoValidators(kindShapes);
    writeFileSync(args.goValidatorsOut, goOutput);
    const fnCount = (goOutput.match(/func ValidateKind\d+/g) || []).length;
    console.log(`\nGo validators: ${fnCount} functions → ${args.goValidatorsOut}`);
  }

  // --- Python Validators ---
  if (args.pythonValidatorsOut) {
    const pyOutput = emitPythonValidators(kindShapes);
    writeFileSync(args.pythonValidatorsOut, pyOutput);
    const fnCount = (pyOutput.match(/def validate_kind_\d+/g) || []).length;
    console.log(`\nPython validators: ${fnCount} functions → ${args.pythonValidatorsOut}`);
  }

  // --- Kotlin Validators ---
  if (args.kotlinValidatorsOut) {
    const ktOutput = emitKotlinValidators(kindShapes);
    writeFileSync(args.kotlinValidatorsOut, ktOutput);
    const fnCount = (ktOutput.match(/fun validateKind\d+/g) || []).length;
    console.log(`\nKotlin validators: ${fnCount} functions → ${args.kotlinValidatorsOut}`);
  }

  // --- Java Validators ---
  if (args.javaValidatorsOut) {
    const javaOutput = emitJavaValidators(kindShapes);
    writeFileSync(args.javaValidatorsOut, javaOutput);
    const fnCount = (javaOutput.match(/public static List<ValidationError> validateKind\d+/g) || []).length;
    console.log(`\nJava validators: ${fnCount} functions → ${args.javaValidatorsOut}`);
  }

  // --- Swift Validators ---
  if (args.swiftValidatorsOut) {
    const swiftOutput = emitSwiftValidators(kindShapes);
    writeFileSync(args.swiftValidatorsOut, swiftOutput);
    const fnCount = (swiftOutput.match(/func validateKind\d+/g) || []).length;
    console.log(`\nSwift validators: ${fnCount} functions → ${args.swiftValidatorsOut}`);
  }

  // --- Dart Validators ---
  if (args.dartValidatorsOut) {
    const dartOutput = emitDartValidators(kindShapes);
    writeFileSync(args.dartValidatorsOut, dartOutput);
    const fnCount = (dartOutput.match(/List<ValidationError> validateKind\d+/g) || []).length;
    console.log(`\nDart validators: ${fnCount} functions → ${args.dartValidatorsOut}`);
  }

  // --- PHP Validators ---
  if (args.phpValidatorsOut) {
    const phpOutput = emitPhpValidators(kindShapes);
    writeFileSync(args.phpValidatorsOut, phpOutput);
    const fnCount = (phpOutput.match(/function schemata_validate_kind_\d+/g) || []).length;
    console.log(`\nPHP validators: ${fnCount} functions → ${args.phpValidatorsOut}`);
  }

  // --- C# Validators ---
  if (args.csharpValidatorsOut) {
    const csOutput = emitCSharpValidators(kindShapes);
    writeFileSync(args.csharpValidatorsOut, csOutput);
    const fnCount = (csOutput.match(/public static List<ValidationError> ValidateKind\d+/g) || []).length;
    console.log(`\nC# validators: ${fnCount} functions → ${args.csharpValidatorsOut}`);
  }

  // --- C++ Validators ---
  if (args.cppValidatorsOut) {
    const cppOutput = emitCppValidators(kindShapes);
    writeFileSync(args.cppValidatorsOut, cppOutput);
    const fnCount = (cppOutput.match(/validate_kind_\d+/g) || []).length;
    console.log(`\nC++ validators: ${fnCount} functions → ${args.cppValidatorsOut}`);
  }

  // --- Ruby Validators ---
  if (args.rubyValidatorsOut) {
    const rbOutput = emitRubyValidators(kindShapes);
    writeFileSync(args.rubyValidatorsOut, rbOutput);
    const fnCount = (rbOutput.match(/def self\.validate_kind_\d+/g) || []).length;
    console.log(`\nRuby validators: ${fnCount} functions → ${args.rubyValidatorsOut}`);
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
