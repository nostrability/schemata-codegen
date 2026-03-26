/**
 * Tag schema extraction: compiled dist/ JSON → TagShape
 *
 * Reads a single tag schema file, navigates its allOf chain,
 * classifies the pattern, and extracts typed position information.
 */

import { readFileSync } from 'node:fs';
import {
  type SchemaNode,
  type TagShape,
  type TagVariant,
  type PositionType,
  unwrapTagSchema,
  extractPositions,
  extractPosition,
  classifyPattern,
} from './patterns.js';

/**
 * Extract a TagShape from a compiled tag schema JSON file.
 */
export function extractTagFromFile(filePath: string, fileName: string): TagShape {
  const raw = readFileSync(filePath, 'utf-8');
  const schema: SchemaNode = JSON.parse(raw);
  return extractTag(schema, fileName, filePath);
}

/**
 * Extract a TagShape from a parsed schema object.
 */
export function extractTag(schema: SchemaNode, fileName: string, filePath?: string): TagShape {
  const { structural, oneOf, title, description, extraAllOf } = unwrapTagSchema(schema);
  const pattern = classifyPattern(structural, oneOf, extraAllOf);

  switch (pattern) {
    case 'fixed_tuple':
    case 'open_tail':
      return extractSimpleTuple(structural, fileName, pattern, title, description);

    case 'optional_trailing':
      return extractOptionalTrailing(structural, fileName, title, description);

    case 'discriminated_union':
      return extractDiscriminatedUnion(structural, oneOf!, fileName, title, description);

    case 'structured_metadata':
      return extractStructuredMetadata(structural, extraAllOf, fileName, title, description);

    default:
      throw new Error(`Unhandled pattern: ${pattern} in ${filePath ?? fileName}`);
  }
}

/**
 * Extract fixed_tuple or open_tail: straightforward positional items.
 */
function extractSimpleTuple(
  structural: SchemaNode,
  fileName: string,
  pattern: 'fixed_tuple' | 'open_tail',
  title?: string,
  description?: string,
): TagShape {
  const items = Array.isArray(structural.items) ? structural.items : [];
  const minItems = structural.minItems ?? items.length;
  const maxItems = pattern === 'fixed_tuple'
    ? (structural.maxItems ?? items.length)
    : undefined;

  const positions = extractPositions(items, minItems);
  const tagName = positions[0]?.constValue;

  if (!tagName) {
    throw new Error(`No const tag name found at position 0 in ${fileName}`);
  }

  return {
    fileName,
    tagName,
    pattern,
    title,
    description: description ?? structural.description,
    positions,
    minItems,
    maxItems,
    additionalItems: structural.additionalItems === true ||
      (structural.additionalItems === undefined && pattern === 'open_tail'),
  };
}

/**
 * Extract optional_trailing: items with some positions beyond minItems.
 */
function extractOptionalTrailing(
  structural: SchemaNode,
  fileName: string,
  title?: string,
  description?: string,
): TagShape {
  const items = Array.isArray(structural.items) ? structural.items : [];
  const minItems = structural.minItems ?? 2;
  const maxItems = structural.maxItems ?? items.length;

  const positions = extractPositions(items, minItems);
  const tagName = positions[0]?.constValue;

  if (!tagName) {
    throw new Error(`No const tag name found at position 0 in ${fileName}`);
  }

  return {
    fileName,
    tagName,
    pattern: 'optional_trailing',
    title,
    description: description ?? structural.description,
    positions,
    minItems,
    maxItems,
    additionalItems: false,
  };
}

/**
 * Extract discriminated_union: oneOf with multiple array variants.
 */
function extractDiscriminatedUnion(
  structural: SchemaNode,
  oneOf: SchemaNode[],
  fileName: string,
  title?: string,
  description?: string,
): TagShape {
  const variants: TagVariant[] = oneOf.map((variant, vi) => {
    const items = Array.isArray(variant.items) ? variant.items : [];
    const minItems = variant.minItems ?? items.length;
    const maxItems = variant.maxItems;

    const positions = extractPositions(items, minItems);

    return {
      minItems,
      maxItems,
      positions,
      additionalItems: variant.additionalItems === true,
    };
  });

  // Tag name from first variant's position 0
  const tagName = variants[0]?.positions[0]?.constValue;
  if (!tagName) {
    throw new Error(`No const tag name in union variant 0 for ${fileName}`);
  }

  // Global minItems is the minimum across variants
  const globalMin = Math.min(...variants.map(v => v.minItems));

  return {
    fileName,
    tagName,
    pattern: 'discriminated_union',
    title,
    description,
    positions: [], // positions live in variants
    minItems: globalMin,
    additionalItems: false,
    variants,
  };
}

/**
 * Extract structured_metadata: contains constraints + typed additionalItems.
 */
function extractStructuredMetadata(
  structural: SchemaNode,
  extraAllOf: SchemaNode[] | undefined,
  fileName: string,
  title?: string,
  description?: string,
): TagShape {
  const items = Array.isArray(structural.items) ? structural.items : [];
  const minItems = structural.minItems ?? 2;
  const positions = extractPositions(items, minItems);
  const tagName = positions[0]?.constValue;

  if (!tagName) {
    throw new Error(`No const tag name found at position 0 in ${fileName}`);
  }

  // Extract contains patterns
  const containsPatterns: string[] = [];
  if (extraAllOf) {
    for (const entry of extraAllOf) {
      if (entry.contains?.pattern) {
        containsPatterns.push(entry.contains.pattern);
      }
    }
  }
  // Also check structural.allOf for contains
  if (structural.allOf) {
    for (const entry of structural.allOf) {
      if (entry.contains?.pattern) {
        containsPatterns.push(entry.contains.pattern);
      }
    }
  }

  // Get additionalItems schema if typed
  const additionalItemsSchema =
    typeof structural.additionalItems === 'object' ? structural.additionalItems : undefined;

  return {
    fileName,
    tagName,
    pattern: 'structured_metadata',
    title,
    description: description ?? structural.description,
    positions,
    minItems,
    additionalItems: true,
    containsPatterns,
    additionalItemsSchema,
  };
}
