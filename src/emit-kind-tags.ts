/**
 * Kind-scoped tag type emitter: KindShape[] → kind-tags.d.ts content.
 *
 * Produces TypeScript readonly tuple type aliases scoped to each kind,
 * so developers get correct autocomplete for tags that share a letter
 * across NIPs (e.g., "n" means different things in NIP-01 vs NIP-66).
 */

import type { KindShape, TagRequirement } from './kind-types.js';
import { emitPositionType, emitTupleType } from './emit-typescript.js';

// --- Kind-scoped tag type helpers ---

/** Entry collected from kind shape: a tag with its constraint */
export interface KindTagEntry {
  tagName: string;
  requirement: TagRequirement;
  source: 'required' | 'perItem' | 'arrayLevel' | 'anyOf';
}

/**
 * PascalCase a tag name for use in a type name, preserving case distinction.
 * "n" → "N", "N" → "Upper_N", "published_at" → "PublishedAt", "rtt-open" → "RttOpen"
 *
 * Single uppercase letters get an "Upper_" prefix to avoid collisions
 * with their lowercase counterparts (e.g., "p" vs "P" both map to "P"
 * without this).
 */
export function tagNameToTypePart(tagName: string): string {
  // Single uppercase letter: prefix to distinguish from lowercase
  if (tagName.length === 1 && tagName === tagName.toUpperCase() && tagName !== tagName.toLowerCase()) {
    return `Upper_${tagName}`;
  }
  return tagName
    .split(/[-_]/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/**
 * Generate a kind-scoped tag type name.
 * e.g., Kind30166_NTag, Kind7_ETag
 */
export function kindScopedTagTypeName(kindNumber: number, tagName: string): string {
  return `Kind${kindNumber}_${tagNameToTypePart(tagName)}Tag`;
}

/**
 * Count constrained positions in a TagRequirement (positions with const, enum, or pattern).
 */
function constraintScore(req: TagRequirement): number {
  return req.positions.filter(p =>
    p.constValue !== undefined || (p.enumValues && p.enumValues.length > 0) || p.pattern
  ).length;
}

/**
 * Collect all tag entries from a KindShape, deduplicating by tagName.
 * When the same tagName appears in multiple sources, keep the more constrained version.
 */
export function collectKindTags(shape: KindShape): KindTagEntry[] {
  const byTag = new Map<string, KindTagEntry>();

  function addEntry(entry: KindTagEntry): void {
    const existing = byTag.get(entry.tagName);
    if (!existing) {
      byTag.set(entry.tagName, entry);
      return;
    }
    // Keep the more constrained version
    if (constraintScore(entry.requirement) > constraintScore(existing.requirement)) {
      byTag.set(entry.tagName, entry);
    }
  }

  for (const req of shape.requiredTags) {
    addEntry({ tagName: req.tagName, requirement: req, source: 'required' });
  }

  for (const cond of shape.perItemConditionals) {
    addEntry({ tagName: cond.requirement.tagName, requirement: cond.requirement, source: 'perItem' });
  }

  for (const cond of shape.arrayLevelConditionals) {
    addEntry({ tagName: cond.requirement.tagName, requirement: cond.requirement, source: 'arrayLevel' });
  }

  for (const group of shape.anyOfTagGroups) {
    for (const req of group.requirements) {
      addEntry({ tagName: req.tagName, requirement: req, source: 'anyOf' });
    }
  }

  // Sort by tag name for stable output
  return [...byTag.values()].sort((a, b) => a.tagName.localeCompare(b.tagName));
}

/**
 * Emit a type alias for a single kind-scoped tag.
 *
 * Classifies TagRequirement into one of:
 *   - fixed: minItems === maxItems → single tuple
 *   - optional_trailing: minItems < maxItems, no additionalItems → union of lengths
 *   - open_tail: additionalItems allowed → tuple with rest element
 */
export function emitKindTagType(kindNumber: number, entry: KindTagEntry): string | undefined {
  const name = kindScopedTagTypeName(kindNumber, entry.tagName);
  const { requirement: req } = entry;

  // Skip entries with no usable positions (e.g., minItems > positions.length)
  if (req.positions.length === 0) return undefined;

  // Determine effective maxItems, clamped to available positions
  const effectiveMax = Math.min(
    req.maxItems ?? req.positions.length,
    req.positions.length,
  );

  // Skip when minItems exceeds available positions and no additionalItems
  if (req.minItems > effectiveMax && !req.additionalItems) return undefined;

  if (req.additionalItems) {
    // Open tail: readonly ["tag", string, ...string[]]
    const tuple = emitTupleType(req.positions, '...string[]');
    return `export type ${name} = ${tuple};`;
  }

  if (req.minItems === effectiveMax) {
    // Fixed: all positions required at exact length
    const subset = req.positions.slice(0, effectiveMax);
    const tuple = emitTupleType(subset);
    return `export type ${name} = ${tuple};`;
  }

  // Optional trailing: union of lengths from minItems to maxItems
  // Floor at 1 so the shortest variant always includes the tag name (position 0)
  const variants: string[] = [];
  for (let len = Math.max(req.minItems, 1); len <= effectiveMax; len++) {
    const subset = req.positions.slice(0, len);
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
 * Emit a complete kind-tags.d.ts file from KindShape[].
 * Skips bare kinds (no tag constraints).
 */
export function emitKindTagsFile(shapes: KindShape[]): string {
  const sections: string[] = [];
  let tagTypeCount = 0;

  for (const shape of shapes) {
    const entries = collectKindTags(shape);
    if (entries.length === 0) continue;

    const kindHeader = `// --- Kind ${shape.kindNumber} (${shape.nip}) ---`;
    const types: string[] = [];
    for (const entry of entries) {
      const line = emitKindTagType(shape.kindNumber, entry);
      if (line !== undefined) {
        tagTypeCount++;
        types.push(line);
      }
    }
    if (types.length === 0) continue;

    sections.push([kindHeader, ...types].join('\n'));
  }

  const header = [
    '// Auto-generated by @nostrability/schemata-codegen',
    '// Do not edit manually.',
    '//',
    `// Kind-scoped tag types from ${shapes.length} kind schemas (${tagTypeCount} types)`,
    '',
  ].join('\n');

  return header + sections.join('\n\n') + '\n';
}
