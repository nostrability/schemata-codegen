/**
 * AJV-ready schema emitter: raw kind schemas → pre-processed JSON files
 *
 * Schemata schemas contain nested $schema, $id, and errorMessage fields that
 * cause AJV compilation failures or require the ajv-errors plugin. Every AJV
 * consumer (sherlock, nostr-watch, nostria) independently wrote runtime
 * stripping code to work around this.
 *
 * This emitter does the stripping at build time, producing JSON files that
 * can be passed directly to ajv.compile() with no preprocessing.
 *
 * Output is not committed — consumers run `--ajv-schemas <dir>` to generate
 * locally, or use `--all` which includes it.
 */

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Strip nested $schema and $id fields from a schema object.
 * Keeps root-level $schema intact (AJV uses it for draft detection).
 */
function stripNestedMetaFields(obj: unknown, isRoot = true): void {
  if (typeof obj !== 'object' || obj === null) return;
  if (Array.isArray(obj)) {
    for (const item of obj) stripNestedMetaFields(item, false);
    return;
  }
  const record = obj as Record<string, unknown>;
  if (!isRoot) {
    delete record['$schema'];
    delete record['$id'];
  }
  for (const value of Object.values(record)) {
    stripNestedMetaFields(value, false);
  }
}

/**
 * Strip all errorMessage fields from a schema object.
 * These require the ajv-errors plugin which most consumers don't use.
 */
function stripErrorMessages(obj: unknown): void {
  if (typeof obj !== 'object' || obj === null) return;
  if (Array.isArray(obj)) {
    for (const item of obj) stripErrorMessages(item);
    return;
  }
  const record = obj as Record<string, unknown>;
  delete record['errorMessage'];
  for (const value of Object.values(record)) {
    stripErrorMessages(value);
  }
}

/**
 * Process a single schema file: strip nested meta fields and errorMessages.
 * Returns the processed schema object.
 */
export function processSchemaForAjv(filePath: string): unknown {
  const raw = readFileSync(filePath, 'utf-8');
  const schema = JSON.parse(raw);
  stripNestedMetaFields(schema);
  stripErrorMessages(schema);
  return schema;
}

/**
 * Write AJV-ready schemas to an output directory.
 * Creates one JSON file per kind: ajv-schemas/kind-N.json
 */
export function writeAjvSchemas(
  kindSchemas: Array<{ filePath: string; kindNumber: number }>,
  outDir: string,
): number {
  mkdirSync(outDir, { recursive: true });

  let count = 0;
  for (const { filePath, kindNumber } of kindSchemas) {
    const processed = processSchemaForAjv(filePath);
    const outFile = join(outDir, `kind-${kindNumber}.json`);
    writeFileSync(outFile, JSON.stringify(processed, null, 2) + '\n');
    count++;
  }

  // Write an index file listing all available schemas
  const index: Record<string, string> = {};
  for (const { kindNumber } of [...kindSchemas].sort((a, b) => a.kindNumber - b.kindNumber)) {
    index[`kind${kindNumber}Schema`] = `kind-${kindNumber}.json`;
  }
  writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 2) + '\n');

  return count;
}
