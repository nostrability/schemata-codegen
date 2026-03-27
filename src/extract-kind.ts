/**
 * Kind schema extraction: compiled dist/ JSON → KindShape
 *
 * Kind schemas have a two-layer allOf structure:
 *   Layer 0: Base event schema (NIP-01 properties)
 *   Layer 1: Kind-specific constraints (kind const, tag validation, content)
 *
 * Tag constraint patterns:
 *   - contains: tags must include a specific tag type
 *   - allOf[].contains: multiple required tag types
 *   - items.allOf[].if/then: per-item conditional (tag validated by name)
 *   - tags.allOf[].if/then: array-level conditional (if tags contain X, then also Y)
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import type { SchemaNode } from './patterns.js';
import { extractPositions, unwrapTagSchema, extractPosition } from './patterns.js';
import type {
  KindShape,
  KindCategory,
  TagRequirement,
  PerItemConditional,
  ArrayLevelConditional,
} from './kind-types.js';

/**
 * Discover all kind schema files under a schemata dist/nips/ directory.
 * Returns array of { filePath, kindNumber, nip }.
 */
export function discoverKindSchemas(distDir: string): Array<{
  filePath: string;
  kindNumber: number;
  nip: string;
}> {
  const nipsDir = join(distDir, 'nips');
  const results: Array<{ filePath: string; kindNumber: number; nip: string }> = [];

  let nipDirs: string[];
  try {
    nipDirs = readdirSync(nipsDir);
  } catch {
    return results;
  }

  for (const nipDir of nipDirs) {
    const nipPath = join(nipsDir, nipDir);
    let kindDirs: string[];
    try {
      kindDirs = readdirSync(nipPath);
    } catch {
      continue;
    }

    for (const kindDir of kindDirs) {
      const match = kindDir.match(/^kind-(\d+)$/);
      if (!match) continue;

      const schemaPath = join(nipPath, kindDir, 'schema.json');
      if (!existsSync(schemaPath)) continue;
      results.push({
        filePath: schemaPath,
        kindNumber: parseInt(match[1], 10),
        nip: nipDir,
      });
    }
  }

  return results.sort((a, b) => a.kindNumber - b.kindNumber);
}

/**
 * Extract a KindShape from a compiled kind schema JSON file.
 */
export function extractKindFromFile(filePath: string): KindShape {
  const raw = readFileSync(filePath, 'utf-8');
  const schema: SchemaNode = JSON.parse(raw);

  // Derive nip and kind number from file path
  const kindDir = basename(dirname(filePath));
  const nipDir = basename(dirname(dirname(filePath)));
  const kindMatch = kindDir.match(/^kind-(\d+)$/);
  const kindNumber = kindMatch ? parseInt(kindMatch[1], 10) : 0;

  return extractKind(schema, kindNumber, nipDir);
}

/**
 * Extract a KindShape from a parsed kind schema object.
 */
export function extractKind(
  schema: SchemaNode,
  kindNumber: number,
  nip: string,
): KindShape {
  const title = schema.title;
  const description = schema.description;

  // Find the kind-specific layer (second element of root allOf)
  const kindLayer = findKindLayer(schema);

  if (!kindLayer) {
    return {
      kindNumber,
      nip,
      title,
      description,
      requiredTags: [],
      perItemConditionals: [],
      arrayLevelConditionals: [],
      category: 'bare',
    };
  }

  // Extract tag constraints
  const tagsNode = kindLayer.properties?.tags;
  const requiredTags: TagRequirement[] = [];
  const perItemConditionals: PerItemConditional[] = [];
  const arrayLevelConditionals: ArrayLevelConditional[] = [];
  let tagsMinItems: number | undefined;

  if (tagsNode) {
    tagsMinItems = tagsNode.minItems;

    // Direct contains on tags
    if (tagsNode.contains) {
      const req = extractTagRequirementFromContains(tagsNode.contains, tagsNode.errorMessage?.contains);
      if (req) requiredTags.push(req);
    }

    // allOf on tags — contains blocks and if/then blocks
    if (tagsNode.allOf) {
      for (const entry of tagsNode.allOf) {
        // Direct contains in allOf entry
        if (entry.contains) {
          const req = extractTagRequirementFromContains(entry.contains, entry.errorMessage?.contains);
          if (req) requiredTags.push(req);
        }

        // Array-level if/then: if tags.contains X, then tags.contains Y
        if (entry.if && entry.then) {
          const cond = extractArrayLevelConditional(entry);
          if (cond) arrayLevelConditionals.push(cond);
        }
      }
    }

    // Per-item conditionals: items.allOf[].if/then
    if (tagsNode.items) {
      const itemsNode = Array.isArray(tagsNode.items) ? undefined : tagsNode.items;
      if (itemsNode?.allOf) {
        for (const entry of itemsNode.allOf) {
          if (entry.if && entry.then) {
            const cond = extractPerItemConditional(entry);
            if (cond) perItemConditionals.push(cond);
          }
        }
      }
    }
  }

  // Extract content constraints
  const contentNode = kindLayer.properties?.content;
  let contentConstraints: KindShape['contentConstraints'];
  if (contentNode && (contentNode.minLength || contentNode.pattern || contentNode.enum)) {
    contentConstraints = {
      minLength: contentNode.minLength,
      pattern: contentNode.pattern,
      description: contentNode.description,
      enumValues: contentNode.enum?.map(String),
    };
  }

  // Categorize
  const hasConditionals = perItemConditionals.length > 0 || arrayLevelConditionals.length > 0;
  let category: KindCategory;
  if (hasConditionals) {
    category = 'conditional';
  } else if (requiredTags.length === 0) {
    category = 'bare';
  } else if (requiredTags.length === 1) {
    category = 'simple-contains';
  } else {
    category = 'multi-contains';
  }

  return {
    kindNumber,
    nip,
    title,
    description,
    requiredTags,
    perItemConditionals,
    arrayLevelConditionals,
    tagsMinItems,
    contentConstraints,
    category,
  };
}

/**
 * Find the kind-specific layer in a kind schema.
 * This is the second allOf element that has properties.kind.const.
 */
function findKindLayer(schema: SchemaNode): SchemaNode | undefined {
  if (!schema.allOf) return undefined;

  for (const layer of schema.allOf) {
    // The kind-specific layer has properties.kind.const
    if (layer.properties?.kind?.const !== undefined) {
      return layer;
    }
    // Also check nested allOf (some schemas have extra wrapping)
    if (layer.allOf) {
      for (const inner of layer.allOf) {
        if (inner.properties?.kind?.const !== undefined) {
          return inner;
        }
      }
    }
  }

  return undefined;
}

/**
 * Extract a TagRequirement from a contains body.
 * Contains bodies wrap full tag schemas (base + structural) in allOf chains.
 */
function extractTagRequirementFromContains(
  containsNode: SchemaNode,
  errorMessage?: string,
): TagRequirement | undefined {
  try {
    // Try to unwrap as a tag schema (handles the allOf chain)
    const { structural } = unwrapTagSchema(containsNode);

    const items = Array.isArray(structural.items) ? structural.items : [];
    if (items.length === 0) return undefined;

    const minItems = structural.minItems ?? items.length;
    const positions = extractPositions(items, minItems);
    const tagName = positions[0]?.constValue;

    if (!tagName) return undefined;

    return {
      tagName,
      positions,
      minItems,
      maxItems: structural.maxItems,
      additionalItems: structural.additionalItems === true ||
        (typeof structural.additionalItems === 'object' && structural.additionalItems !== null),
      errorMessage,
    };
  } catch {
    // Some contains are simpler (e.g., anyOf with multiple tag types)
    // Try direct extraction
    return extractSimpleContains(containsNode, errorMessage);
  }
}

/**
 * Fallback extraction for simpler contains that don't follow standard tag wrapping.
 */
function extractSimpleContains(
  node: SchemaNode,
  errorMessage?: string,
): TagRequirement | undefined {
  // Handle direct items array
  if (Array.isArray(node.items) && node.minItems !== undefined) {
    const positions = extractPositions(node.items, node.minItems);
    const tagName = positions[0]?.constValue;
    if (!tagName) return undefined;
    return {
      tagName,
      positions,
      minItems: node.minItems,
      maxItems: node.maxItems,
      additionalItems: node.additionalItems === true ||
        (typeof node.additionalItems === 'object' && node.additionalItems !== null),
      errorMessage,
    };
  }

  // Handle anyOf wrapping multiple tag types
  if (node.anyOf) {
    for (const alt of node.anyOf) {
      const result = extractSimpleContains(alt, errorMessage);
      if (result) return result;
    }
  }

  // Handle allOf wrapping
  if (node.allOf) {
    for (const entry of node.allOf) {
      const result = extractSimpleContains(entry, errorMessage);
      if (result) return result;
    }
  }

  return undefined;
}

/**
 * Extract a per-item conditional: if tag[0] === name, then validate tag shape.
 */
function extractPerItemConditional(
  entry: SchemaNode,
): PerItemConditional | undefined {
  if (!entry.if || !entry.then) return undefined;

  // Condition: if items[0].const === tagName
  const condTagName = extractConditionTagName(entry.if);
  if (!condTagName) return undefined;

  // Then: validate as specific tag schema
  const req = extractRequirementFromThen(entry.then, condTagName);
  if (!req) return undefined;

  return {
    conditionTagName: condTagName,
    requirement: req,
    errorMessage: entry.errorMessage?.contains,
  };
}

/**
 * Extract an array-level conditional: if tags.contains X, then tags.contains Y.
 */
function extractArrayLevelConditional(
  entry: SchemaNode,
): ArrayLevelConditional | undefined {
  if (!entry.if || !entry.then) return undefined;

  // Condition: if.contains.items[0].const === tagName
  const condContains = entry.if.contains;
  if (!condContains) return undefined;

  const condTagName = extractConditionTagName(condContains);
  if (!condTagName) return undefined;

  // Then: then.contains must be valid tag
  const thenContains = entry.then.contains;
  if (!thenContains) return undefined;

  const req = extractTagRequirementFromContains(
    thenContains,
    entry.errorMessage?.contains,
  );
  if (!req) return undefined;

  return {
    conditionTagName: condTagName,
    requirement: req,
    errorMessage: entry.errorMessage?.contains,
  };
}

/**
 * Extract the tag name from an if-condition.
 * Handles: { items: [{ const: "name" }] } and { type: "array", items: [{ const: "name" }] }
 */
function extractConditionTagName(condNode: SchemaNode): string | undefined {
  // Direct items[0].const
  if (Array.isArray(condNode.items) && condNode.items.length > 0) {
    const first = condNode.items[0];
    if (typeof first.const === 'string') return first.const;
  }

  // allOf wrapping
  if (condNode.allOf) {
    for (const entry of condNode.allOf) {
      const name = extractConditionTagName(entry);
      if (name) return name;
    }
  }

  return undefined;
}

/**
 * Extract a TagRequirement from a then-clause body.
 */
function extractRequirementFromThen(
  thenNode: SchemaNode,
  fallbackTagName: string,
): TagRequirement | undefined {
  // Try unwrap as tag schema
  try {
    const { structural } = unwrapTagSchema(thenNode);
    const items = Array.isArray(structural.items) ? structural.items : [];
    if (items.length === 0) return undefined;

    const minItems = structural.minItems ?? items.length;
    const positions = extractPositions(items, minItems);
    const tagName = positions[0]?.constValue ?? fallbackTagName;

    return {
      tagName,
      positions,
      minItems,
      maxItems: structural.maxItems,
      additionalItems: structural.additionalItems === true ||
        (typeof structural.additionalItems === 'object' && structural.additionalItems !== null),
    };
  } catch {
    // Try direct extraction
    return extractSimpleContains(thenNode, undefined);
  }
}
