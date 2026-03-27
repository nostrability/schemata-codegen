/**
 * Pattern classification for schemata tag schemas.
 *
 * Schemata compiles tag schemas into a consistent allOf chain:
 *   { allOf: [{ allOf: [{ allOf: [base_tag] }, structural_part] }] }
 *
 * The structural_part varies by pattern:
 *   - fixed_tuple:         minItems, maxItems, items[], additionalItems: false
 *   - optional_trailing:   minItems < maxItems, items[], additionalItems: false
 *   - open_tail:           minItems, items[], additionalItems: true (or absent maxItems)
 *   - discriminated_union: oneOf[] at the schema level (sibling to allOf)
 *   - structured_metadata: contains[] or additionalItems with anyOf patterns
 */

// --- Schema JSON types (minimal, just what we need) ---

export interface SchemaNode {
  $schema?: string;
  $id?: string;
  type?: string | string[];
  const?: string | number;
  enum?: (string | number)[];
  pattern?: string;
  description?: string;
  title?: string;
  minLength?: number;
  minItems?: number;
  maxItems?: number;
  items?: SchemaNode | SchemaNode[];
  additionalItems?: boolean | SchemaNode;
  allOf?: SchemaNode[];
  oneOf?: SchemaNode[];
  anyOf?: SchemaNode[];
  contains?: SchemaNode;
  uniqueItems?: boolean;
  errorMessage?: Record<string, string>;
  definitions?: Record<string, SchemaNode>;
  format?: string;
  properties?: Record<string, SchemaNode>;
  required?: string[];
  additionalProperties?: boolean | SchemaNode;
  not?: SchemaNode;
  if?: SchemaNode;
  then?: SchemaNode;
}

// --- Tag pattern types ---

export type TagPattern =
  | 'fixed_tuple'
  | 'optional_trailing'
  | 'open_tail'
  | 'discriminated_union'
  | 'structured_metadata';

/** A single position in a tag tuple */
export interface PositionType {
  /** Position index (0-based) */
  index: number;
  /** Whether this position is required (index < minItems) */
  required: boolean;
  /** Constant value (e.g., tag name at position 0) */
  constValue?: string;
  /** Enum of allowed values */
  enumValues?: string[];
  /** Regex pattern constraint */
  pattern?: string;
  /** Base type (always "string" for tags) */
  type: string;
  /** Description from schema */
  description?: string;
  /** Title from schema */
  title?: string;
  /** anyOf alternatives (for complex positions) */
  anyOf?: PositionType[];
}

/** A variant in a discriminated union */
export interface TagVariant {
  minItems: number;
  maxItems?: number;
  positions: PositionType[];
  additionalItems: boolean;
}

/** Extracted shape of a tag schema */
export interface TagShape {
  /** File name (without .json) */
  fileName: string;
  /** The tag name (const at position 0) */
  tagName: string;
  /** Classified pattern */
  pattern: TagPattern;
  /** Top-level description */
  description?: string;
  /** Top-level title */
  title?: string;
  /** Positions (for non-union patterns) */
  positions: PositionType[];
  /** Min required items */
  minItems: number;
  /** Max items (undefined = unbounded) */
  maxItems?: number;
  /** Whether additional items are allowed */
  additionalItems: boolean;
  /** Variants (for discriminated_union pattern only) */
  variants?: TagVariant[];
  /** Contains pattern constraints (for structured_metadata) */
  containsPatterns?: string[];
  /** Contains const constraints (for structured_metadata, e.g. mls_extensions) */
  containsConstants?: string[];
  /** Additional items schema (for structured_metadata with typed additionalItems) */
  additionalItemsSchema?: SchemaNode;
}

/**
 * Check if a node is the base tag definition: { type: "array", items: { type: "string" } }
 */
function isBaseTag(node: SchemaNode): boolean {
  return node.type === 'array' &&
    !Array.isArray(node.items) &&
    node.items?.type === 'string' &&
    node.minItems === undefined;
}

/**
 * Check if a node is a structural tag definition (has items-as-array with positions).
 */
function isStructuralTag(node: SchemaNode): boolean {
  return Array.isArray(node.items) && node.minItems !== undefined;
}

/**
 * Navigate the allOf chain to find the structural part of a tag schema.
 *
 * Schemata dist/ schemas have varying nesting depths:
 *   Standard:  { allOf: [{ allOf: [{ allOf: [base] }, structural], oneOf? }] }
 *   Alias:     { allOf: [{ allOf: [{ allOf: [{ allOf: [base], structural }] }, extra] }] }
 *   Flat:      { $schema, allOf: [base, structural] }
 *
 * Strategy: recursively descend allOf chains collecting metadata, stop when we
 * find the node with items-as-array (the structural part).
 */
export function unwrapTagSchema(root: SchemaNode): {
  structural: SchemaNode;
  oneOf?: SchemaNode[];
  title?: string;
  description?: string;
  extraAllOf?: SchemaNode[];
} {
  let title: string | undefined;
  let description: string | undefined;
  let oneOf: SchemaNode[] | undefined;
  let structural: SchemaNode | undefined;
  let extraAllOf: SchemaNode[] | undefined;

  function collectMetadata(node: SchemaNode): void {
    if (node.title && !title) title = node.title;
    if (node.description && !description) description = node.description;
    if (node.oneOf && !oneOf) oneOf = node.oneOf;
  }

  function findStructural(node: SchemaNode): boolean {
    collectMetadata(node);

    // Direct structural match
    if (isStructuralTag(node)) {
      structural = node;
      return true;
    }

    // Descend allOf
    if (node.allOf) {
      const extras: SchemaNode[] = [];
      for (const child of node.allOf) {
        collectMetadata(child);

        if (isStructuralTag(child)) {
          structural = child;
          // Remaining allOf siblings after structural are extras (contains blocks, etc.)
          continue;
        }

        if (isBaseTag(child)) continue;

        // If child has oneOf at its level, capture it
        if (child.oneOf && !oneOf) oneOf = child.oneOf;

        // Recurse into nested allOf wrappers
        if (child.allOf) {
          if (findStructural(child)) {
            // Found it deeper — any remaining siblings are extras
            continue;
          }
        }

        // Non-base, non-structural siblings are extras (e.g., description-only entries)
        if (!isBaseTag(child) && !structural) {
          extras.push(child);
        } else if (structural) {
          extras.push(child);
        }
      }

      if (extras.length > 0 && !extraAllOf) {
        extraAllOf = extras;
      }

      return structural !== undefined;
    }

    return false;
  }

  findStructural(root);

  // For discriminated unions where structural is empty but oneOf exists
  if (!structural && oneOf) {
    return { structural: {}, oneOf, title, description, extraAllOf };
  }

  if (!structural) {
    throw new Error(
      'Could not find structural part (items-as-array with minItems) in schema'
    );
  }

  // Check structural's own allOf for contains blocks
  if (structural.allOf) {
    const structExtras = structural.allOf.filter(e => e.contains);
    if (structExtras.length > 0) {
      extraAllOf = [...(extraAllOf ?? []), ...structExtras];
    }
  }

  return { structural, oneOf, title, description, extraAllOf };
}

/**
 * Extract position types from an items array.
 */
export function extractPositions(
  items: SchemaNode[],
  minItems: number
): PositionType[] {
  return items.map((item, index) => extractPosition(item, index, index < minItems));
}

/**
 * Extract a single position type from a schema node.
 */
export function extractPosition(
  item: SchemaNode,
  index: number,
  required: boolean
): PositionType {
  // Handle allOf wrapper (e.g., pubkey refs)
  const resolved = resolveAllOf(item);

  // Handle anyOf (e.g., relay URL or empty string)
  if (resolved.anyOf) {
    return {
      index,
      required,
      type: 'string',
      description: resolved.description,
      title: resolved.title,
      anyOf: resolved.anyOf.map((alt, i) => extractPosition(alt, index, required)),
    };
  }

  return {
    index,
    required,
    constValue: typeof resolved.const === 'string' ? resolved.const : undefined,
    enumValues: resolved.enum?.map(String),
    pattern: resolved.pattern,
    type: (typeof resolved.type === 'string' ? resolved.type : 'string'),
    description: resolved.description,
    title: resolved.title,
  };
}

/**
 * Flatten simple allOf wrappers (e.g., { allOf: [{ type: "string", pattern: "..." }] })
 */
function resolveAllOf(node: SchemaNode): SchemaNode {
  if (node.allOf && node.allOf.length === 1) {
    return resolveAllOf(node.allOf[0]);
  }
  return node;
}

/**
 * Classify a tag schema into one of the 5 patterns.
 */
export function classifyPattern(
  structural: SchemaNode,
  oneOf?: SchemaNode[],
  extraAllOf?: SchemaNode[]
): TagPattern {
  // Pattern 4: Discriminated union — has oneOf with multiple array variants
  if (oneOf && oneOf.length > 1) {
    return 'discriminated_union';
  }

  // Pattern 5: Structured metadata — has contains constraints or typed additionalItems with anyOf
  if (extraAllOf?.some(e => e.contains)) {
    return 'structured_metadata';
  }
  if (
    structural.additionalItems &&
    typeof structural.additionalItems === 'object' &&
    structural.additionalItems.anyOf
  ) {
    return 'structured_metadata';
  }

  const { minItems, maxItems } = structural;
  const items = Array.isArray(structural.items) ? structural.items : [];
  const additionalItems = structural.additionalItems;

  // Pattern 1: Fixed-length tuple — minItems == maxItems (regardless of additionalItems)
  // When min == max, the length is pinned, so additional items are irrelevant.
  if (
    minItems !== undefined &&
    maxItems !== undefined &&
    minItems === maxItems
  ) {
    return 'fixed_tuple';
  }

  // Also fixed if minItems == items.length and additionalItems: false (no maxItems)
  if (
    minItems !== undefined &&
    items.length > 0 &&
    minItems === items.length &&
    additionalItems === false
  ) {
    return 'fixed_tuple';
  }

  // Pattern 2: Optional trailing — minItems < maxItems, additionalItems: false
  if (
    minItems !== undefined &&
    maxItems !== undefined &&
    minItems < maxItems &&
    additionalItems === false
  ) {
    return 'optional_trailing';
  }

  // Also optional trailing if minItems < items.length and additionalItems: false
  if (
    minItems !== undefined &&
    items.length > 0 &&
    minItems < items.length &&
    additionalItems === false
  ) {
    return 'optional_trailing';
  }

  // Pattern 3: Open-tail — additionalItems is true, undefined, or a typed schema object
  // A typed additionalItems (object) means "additional items allowed but must match schema"
  // This is still an open-tail tuple in TypeScript (we emit ...string[])
  if (
    additionalItems === true ||
    additionalItems === undefined ||
    (typeof additionalItems === 'object' && additionalItems !== null)
  ) {
    return 'open_tail';
  }

  // Fallback: if we have items and additionalItems is false with minItems < items
  // This is a safety net
  if (items.length > 0 && additionalItems === false) {
    if (minItems !== undefined && minItems < items.length) {
      return 'optional_trailing';
    }
    return 'fixed_tuple';
  }

  throw new Error(
    `Unrecognized pattern: minItems=${minItems}, maxItems=${maxItems}, ` +
    `items.length=${items.length}, additionalItems=${JSON.stringify(additionalItems)}`
  );
}
