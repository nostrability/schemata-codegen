/**
 * TypeScript builder emitter: BuilderAction[] → builders.ts
 *
 * Generates typed builder functions that construct correct tag arrays.
 * Each constrained kind gets an interface + function. A dispatch function
 * routes by kind number.
 *
 * Pipeline: KindShape → planBuilder() → BuilderAction[] → emitBuildersFile() → code
 */

import type { KindShape } from './kind-types.js';
import {
  planBuilder,
  type BuilderAction,
  type BuilderTag,
  type BuilderPosition,
  type FieldInputType,
} from './plan-builders.js';

// --- TypeScript type emission ---

/**
 * Emit a TypeScript type for a FieldInputType.
 */
function emitFieldType(input: FieldInputType): string {
  switch (input.type) {
    case 'string':
      return 'string';
    case 'enum':
      return input.values.map(v => JSON.stringify(v)).join(' | ');
    case 'pattern':
      return 'string';
    case 'anyOf': {
      const types = input.alternatives.map(emitFieldType);
      const unique = [...new Set(types)];
      return unique.length === 1 ? unique[0] : unique.join(' | ');
    }
  }
}

/**
 * Check if a tag has any user-input positions.
 */
function hasInputPositions(tag: BuilderTag): boolean {
  return tag.positions.some(p => p.source === 'input');
}

/**
 * Check if a tag uses an object field (multiple input positions).
 */
function isObjectField(tag: BuilderTag): boolean {
  const inputPositions = tag.positions.filter(p => p.source === 'input');
  return inputPositions.length > 1;
}

/**
 * Emit a TypeScript interface field for a builder tag.
 */
function emitInterfaceField(tag: BuilderTag, required: boolean): string {
  const lines: string[] = [];
  const inputPositions = tag.positions.filter(p => p.source === 'input');
  const opt = required ? '' : '?';

  if (isObjectField(tag)) {
    // Object field for multi-position tags
    lines.push(`  /** ${tag.tagName} tag */`);
    lines.push(`  ${tag.fieldName}${opt}: {`);
    for (const pos of inputPositions) {
      const fname = pos.fieldName ?? 'value';
      const ftype = emitFieldType(pos.inputType ?? { type: 'string' });
      const posOpt = pos.required ? '' : '?';
      lines.push(`    ${fname}${posOpt}: ${ftype};`);
    }
    lines.push('  };');
  } else {
    // Simple field for single-input tags
    const pos = inputPositions[0];
    const ftype = emitFieldType(pos.inputType ?? { type: 'string' });
    lines.push(`  /** ${tag.tagName} tag */`);
    lines.push(`  ${tag.fieldName}${opt}: ${ftype};`);
  }

  return lines.join('\n');
}

/**
 * Emit the tag construction body for a builder tag.
 * Returns lines to add inside the function body.
 * tagIndex is used to generate unique variable names when multiple tags
 * need incremental construction in the same function.
 */
function emitTagConstruction(tag: BuilderTag, required: boolean, tagIndex: number): string[] {
  const lines: string[] = [];
  const inputPositions = tag.positions.filter(p => p.source === 'input');
  const isObj = isObjectField(tag);
  const dataRef = `data.${tag.fieldName}`;

  if (!required) {
    lines.push(`  if (${dataRef} !== undefined) {`);
  }

  const indent = required ? '  ' : '    ';

  // Check if all positions are required (simple push case)
  const allRequired = tag.positions.every(p => p.required || p.source === 'literal');
  const optionalInputs = inputPositions.filter(p => !p.required);

  if (allRequired || optionalInputs.length === 0) {
    // All positions present: single push
    const parts = tag.positions.map(p => {
      if (p.source === 'literal') return JSON.stringify(p.literalValue);
      if (isObj) return `${dataRef}.${p.fieldName ?? 'value'}`;
      return dataRef;
    });
    lines.push(`${indent}tags.push([${parts.join(', ')}]);`);
  } else {
    // Has optional trailing positions: build incrementally
    // Use unique variable name to avoid collisions when multiple tags have optional trailing
    const varName = `t${tagIndex}`;
    const requiredParts = tag.positions.filter(p => p.required || p.source === 'literal').map(p => {
      if (p.source === 'literal') return JSON.stringify(p.literalValue);
      if (isObj) return `${dataRef}.${p.fieldName ?? 'value'}`;
      return dataRef;
    });
    lines.push(`${indent}const ${varName}: string[] = [${requiredParts.join(', ')}];`);

    // Add optional positions sequentially
    for (const pos of optionalInputs) {
      const valRef = isObj ? `${dataRef}.${pos.fieldName ?? 'value'}` : dataRef;
      lines.push(`${indent}if (${valRef} !== undefined) ${varName}.push(${valRef});`);
    }

    lines.push(`${indent}tags.push(${varName});`);
  }

  if (!required) {
    lines.push('  }');
  }

  return lines;
}

/**
 * Emit construction + runtime check for an any_of_group.
 * Each tag is emitted with an if guard; a final check ensures at least one was provided.
 */
function emitAnyOfGroupConstruction(tags: BuilderTag[], tagIndexStart: number): string[] {
  const lines: string[] = [];
  const inputTags = tags.filter(hasInputPositions);
  const literalTags = tags.filter(t => !hasInputPositions(t));

  // Emit literal-only tags unconditionally
  let idx = tagIndexStart;
  for (const tag of literalTags) {
    lines.push(...emitTagConstruction(tag, true, idx++));
  }

  // Emit input tags with if guards
  for (const tag of inputTags) {
    lines.push(...emitTagConstruction(tag, false, idx++));
  }

  // Runtime check: at least one input tag must be provided
  if (inputTags.length > 0) {
    const checks = inputTags.map(t => `data.${t.fieldName} !== undefined`).join(' || ');
    const names = inputTags.map(t => t.tagName).join(', ');
    lines.push(`  if (!(${checks})) throw new Error("At least one of ${names} is required");`);
  }

  return lines;
}

// --- Per-kind generation ---

/**
 * Emit interface + function for a single kind.
 */
function emitKindBuilder(kindNumber: number, nip: string, actions: BuilderAction[]): string {
  const interfaceName = `Kind${kindNumber}TagsInput`;
  const fnName = `buildKind${kindNumber}Tags`;

  // Emit interface
  const interfaceLines: string[] = [];
  interfaceLines.push(`export interface ${interfaceName} {`);
  for (const action of actions) {
    if (action.type === 'required_tag' && hasInputPositions(action.tag)) {
      interfaceLines.push(emitInterfaceField(action.tag, true));
    } else if (action.type === 'optional_tag' && hasInputPositions(action.tag)) {
      interfaceLines.push(emitInterfaceField(action.tag, false));
    } else if (action.type === 'any_of_group') {
      // All tags in an anyOf group are individually optional
      const groupNames = action.tags.filter(hasInputPositions).map(t => t.tagName).join(', ');
      if (groupNames) {
        interfaceLines.push(`  /** At least one required: ${groupNames} */`);
      }
      for (const tag of action.tags) {
        if (hasInputPositions(tag)) {
          interfaceLines.push(emitInterfaceField(tag, false));
        }
      }
    }
  }
  interfaceLines.push('}');

  // Emit function
  const fnLines: string[] = [];
  fnLines.push(`export function ${fnName}(data: ${interfaceName}): string[][] {`);
  fnLines.push('  const tags: string[][] = [];');
  let tagIndex = 0;
  for (const action of actions) {
    if (action.type === 'required_tag') {
      fnLines.push(...emitTagConstruction(action.tag, true, tagIndex++));
    } else if (action.type === 'optional_tag') {
      if (hasInputPositions(action.tag)) {
        fnLines.push(...emitTagConstruction(action.tag, false, tagIndex++));
      } else {
        // All-literal optional tag — emit unconditionally
        fnLines.push(...emitTagConstruction(action.tag, true, tagIndex++));
      }
    } else if (action.type === 'any_of_group') {
      fnLines.push(...emitAnyOfGroupConstruction(action.tags, tagIndex));
      tagIndex += action.tags.length;
    }
  }
  fnLines.push('  return tags;');
  fnLines.push('}');

  return interfaceLines.join('\n') + '\n\n' + fnLines.join('\n');
}

// --- File assembly ---

/**
 * Emit the complete builders.ts file.
 */
export function emitBuildersFile(shapes: KindShape[]): string {
  const header = [
    '// Auto-generated by @nostrability/schemata-codegen',
    '// Do not edit manually.',
    '//',
    '// Tag builder functions for Nostr event construction',
    '',
  ].join('\n');

  const parts: string[] = [header];
  const constrainedKinds: Array<{ kindNumber: number; nip: string }> = [];

  const sorted = [...shapes].sort((a, b) => a.kindNumber - b.kindNumber);

  for (const shape of sorted) {
    const actions = planBuilder(shape);
    if (!actions) continue;

    constrainedKinds.push({ kindNumber: shape.kindNumber, nip: shape.nip });
    parts.push(emitKindBuilder(shape.kindNumber, shape.nip, actions));
    parts.push('');
  }

  if (constrainedKinds.length === 0) {
    return header;
  }

  // Dispatch function
  const dispatchLines: string[] = [];
  dispatchLines.push('/** Build tags for a given kind number. Throws if kind has no builder. */');
  dispatchLines.push('export function buildKindTags(kind: number, data: Record<string, unknown>): string[][] {');
  dispatchLines.push('  switch (kind) {');
  for (const { kindNumber } of constrainedKinds) {
    dispatchLines.push(`    case ${kindNumber}: return buildKind${kindNumber}Tags(data as unknown as Kind${kindNumber}TagsInput);`);
  }
  dispatchLines.push('    default: throw new Error(`No builder for kind ${kind}`);');
  dispatchLines.push('  }');
  dispatchLines.push('}');
  parts.push(dispatchLines.join('\n'));
  parts.push('');

  // BUILDER_KINDS export
  const kindNumbers = constrainedKinds.map(k => k.kindNumber);
  parts.push(`/** All kind numbers that have tag builders. */`);
  parts.push(`export const BUILDER_KINDS: readonly number[] = [${kindNumbers.join(', ')}] as const;`);
  parts.push('');

  return parts.join('\n');
}
