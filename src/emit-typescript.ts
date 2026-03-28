/**
 * TypeScript emitter: TagShape → TypeScript readonly tuple type alias string.
 *
 * Produces .d.ts content with readonly tuple types for each tag pattern.
 */

import type { TagShape, TagVariant, PositionType } from './patterns.js';

/**
 * Convert a file name to a PascalCase type name.
 * e.g., "amount" → "Amount", "content-warning" → "ContentWarning",
 *       "_A" → "UpperA", "e" → "E", "a-live" → "ALive"
 */
export function fileNameToTypeName(fileName: string): string {
  // Handle underscore-prefixed aliases: _A → UpperA, _E → UpperE
  if (fileName.startsWith('_') && fileName.length > 1) {
    const letter = fileName.slice(1);
    return 'Upper' + letter.charAt(0).toUpperCase() + letter.slice(1);
  }

  // Split on hyphens and PascalCase
  return fileName
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/**
 * Generate the full type name for a tag.
 * e.g., "amount" → "AmountTag", "e" → "ETag", "r" → "RTag"
 */
export function tagTypeName(fileName: string): string {
  return fileNameToTypeName(fileName) + 'Tag';
}

/**
 * Emit a TypeScript type string for a single position.
 */
export function emitPositionType(pos: PositionType): string {
  if (pos.constValue !== undefined) {
    return JSON.stringify(pos.constValue);
  }
  if (pos.enumValues && pos.enumValues.length > 0) {
    return pos.enumValues.map(v => JSON.stringify(v)).join(' | ');
  }
  if (pos.anyOf && pos.anyOf.length > 0) {
    const types = pos.anyOf.map(alt => emitPositionType(alt));
    // Deduplicate
    const unique = [...new Set(types)];
    return unique.length === 1 ? unique[0] : unique.join(' | ');
  }
  // Plain string (with or without pattern)
  return 'string';
}

/**
 * Emit a comment with pattern info for a position.
 */
function positionComment(pos: PositionType): string {
  const parts: string[] = [];
  if (pos.pattern) parts.push(`pattern: ${pos.pattern}`);
  if (pos.description) parts.push(pos.description);
  if (pos.title) parts.push(pos.title);
  if (pos.anyOf) {
    for (const alt of pos.anyOf) {
      if (alt.pattern) parts.push(`pattern: ${alt.pattern}`);
      if (alt.constValue !== undefined) parts.push(`or: ${JSON.stringify(alt.constValue)}`);
    }
  }
  return parts.length > 0 ? ` /* ${parts.join('; ')} */` : '';
}

/**
 * Emit a JSDoc comment block.
 */
function emitJSDoc(shape: TagShape): string {
  const lines: string[] = [];
  if (shape.title || shape.description) {
    lines.push('/**');
    if (shape.title) lines.push(` * ${shape.title}`);
    if (shape.description && shape.description !== shape.title) {
      if (shape.title) lines.push(' *');
      lines.push(` * ${shape.description}`);
    }
    lines.push(' */');
  }
  return lines.join('\n');
}

/**
 * Emit a single readonly tuple type for a list of positions.
 */
export function emitTupleType(positions: PositionType[], rest?: string): string {
  const parts = positions.map(p => emitPositionType(p));
  const tuple = parts.join(', ');
  if (rest) {
    return `readonly [${tuple}, ${rest}]`;
  }
  return `readonly [${tuple}]`;
}

// --- Pattern-specific emitters ---

/**
 * Emit a fixed-length tuple.
 * e.g., export type AmountTag = readonly ["amount", string];
 */
function emitFixedTuple(shape: TagShape): string {
  const name = tagTypeName(shape.fileName);
  const doc = emitJSDoc(shape);
  const tuple = emitTupleType(shape.positions);
  const lines: string[] = [];
  if (doc) lines.push(doc);
  lines.push(`export type ${name} = ${tuple};`);
  return lines.join('\n');
}

/**
 * Emit optional trailing as a union of tuple lengths.
 * e.g., export type RTag = readonly ["r", string] | readonly ["r", string, "read" | "write"];
 */
function emitOptionalTrailing(shape: TagShape): string {
  const name = tagTypeName(shape.fileName);
  const doc = emitJSDoc(shape);
  const lines: string[] = [];
  if (doc) lines.push(doc);

  const maxLen = shape.maxItems ?? shape.positions.length;
  const variants: string[] = [];

  // Generate one variant per valid length: minItems .. maxItems
  for (let len = shape.minItems; len <= maxLen; len++) {
    const subset = shape.positions.slice(0, len);
    variants.push(emitTupleType(subset));
  }

  if (variants.length === 1) {
    lines.push(`export type ${name} = ${variants[0]};`);
  } else {
    lines.push(`export type ${name} =`);
    variants.forEach((v, i) => {
      const sep = i < variants.length - 1 ? '' : ';';
      lines.push(`  | ${v}${sep}`);
    });
  }
  return lines.join('\n');
}

/**
 * Emit open-tail tuple with rest element.
 * e.g., export type TTag = readonly ["t", string, ...string[]];
 */
function emitOpenTail(shape: TagShape): string {
  const name = tagTypeName(shape.fileName);
  const doc = emitJSDoc(shape);
  const lines: string[] = [];
  if (doc) lines.push(doc);

  // All defined positions are required up to items.length,
  // then ...string[] for the rest
  const tuple = emitTupleType(shape.positions, '...string[]');
  lines.push(`export type ${name} = ${tuple};`);
  return lines.join('\n');
}

/**
 * Emit discriminated union with named variant types.
 */
function emitDiscriminatedUnion(shape: TagShape): string {
  const baseName = tagTypeName(shape.fileName);
  const doc = emitJSDoc(shape);
  const lines: string[] = [];
  if (doc) lines.push(doc);

  if (!shape.variants || shape.variants.length === 0) {
    throw new Error(`No variants for discriminated union ${shape.fileName}`);
  }

  if (shape.variants.length === 1) {
    // Single variant — just emit directly
    const v = shape.variants[0];
    const tuple = emitVariantTupleType(v);
    lines.push(`export type ${baseName} = ${tuple};`);
    return lines.join('\n');
  }

  // Multiple variants — emit named sub-types
  const variantNames: string[] = [];
  for (let i = 0; i < shape.variants.length; i++) {
    const v = shape.variants[i];
    const variantName = `${baseName}Variant${i + 1}`;
    variantNames.push(variantName);

    const variantType = emitVariantType(v, variantName);
    lines.push(variantType);
  }

  // Union type
  lines.push(`export type ${baseName} = ${variantNames.join(' | ')};`);
  return lines.join('\n');
}

/**
 * Emit a single variant type (may itself be a union if optional trailing).
 */
function emitVariantType(variant: TagVariant, name: string): string {
  const maxLen = variant.maxItems ?? variant.positions.length;
  const minLen = variant.minItems;

  if (minLen === maxLen || minLen >= variant.positions.length) {
    // Fixed-length variant
    const tuple = emitTupleType(variant.positions.slice(0, maxLen));
    return `export type ${name} = ${tuple};`;
  }

  // Optional trailing within variant
  const variants: string[] = [];
  for (let len = minLen; len <= maxLen; len++) {
    const subset = variant.positions.slice(0, len);
    variants.push(emitTupleType(subset));
  }

  if (variants.length === 1) {
    return `export type ${name} = ${variants[0]};`;
  }

  const lines = [`export type ${name} =`];
  variants.forEach((v, i) => {
    const sep = i < variants.length - 1 ? '' : ';';
    lines.push(`  | ${v}${sep}`);
  });
  return lines.join('\n');
}

/**
 * Emit tuple type string for a variant (without type declaration).
 */
function emitVariantTupleType(variant: TagVariant): string {
  if (variant.additionalItems) {
    return emitTupleType(variant.positions, '...string[]');
  }
  return emitTupleType(variant.positions);
}

/**
 * Emit structured metadata (open-tail with typed entries).
 * e.g., export type ImetaTag = readonly ["imeta", ...string[]];
 */
function emitStructuredMetadata(shape: TagShape): string {
  const name = tagTypeName(shape.fileName);
  const doc = emitJSDoc(shape);
  const lines: string[] = [];
  if (doc) lines.push(doc);

  // Structured metadata tags are open-tail with string entries
  // The contains constraints are runtime-only (can't express in TS types)
  // We emit a rest tuple with a comment about the required entries
  const tuple = emitTupleType(shape.positions, '...string[]');
  lines.push(`export type ${name} = ${tuple};`);

  if (shape.containsPatterns && shape.containsPatterns.length > 0) {
    lines.push(`// Runtime: must contain entries matching: ${shape.containsPatterns.join(', ')}`);
  }

  return lines.join('\n');
}

// --- Main emit function ---

/**
 * Emit TypeScript for a single TagShape.
 */
export function emitTagType(shape: TagShape): string {
  switch (shape.pattern) {
    case 'fixed_tuple':
      return emitFixedTuple(shape);
    case 'optional_trailing':
      return emitOptionalTrailing(shape);
    case 'open_tail':
      return emitOpenTail(shape);
    case 'discriminated_union':
      return emitDiscriminatedUnion(shape);
    case 'structured_metadata':
      return emitStructuredMetadata(shape);
  }
}

/**
 * Emit a complete tags.d.ts file from multiple TagShapes.
 */
export function emitTagsFile(shapes: TagShape[]): string {
  const header = [
    '// Auto-generated by @nostrability/schemata-codegen',
    '// Do not edit manually.',
    '//',
    `// Generated from ${shapes.length} tag schemas`,
    '',
  ].join('\n');

  const types = shapes.map(s => emitTagType(s)).join('\n\n');

  return header + types + '\n';
}
