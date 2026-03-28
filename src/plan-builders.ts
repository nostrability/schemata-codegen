/**
 * Builder planner: KindShape → BuilderAction[]
 *
 * Language-independent layer that separates "what to build" from
 * "how to render". Each BuilderAction describes a tag to construct,
 * with typed positions that any language emitter can render.
 *
 * Pipeline: KindShape → planBuilder() → BuilderAction[] → emit-builders.ts → code
 */

import type { PositionType } from './patterns.js';
import type { KindShape } from './kind-types.js';
import { collectKindTags, type KindTagEntry } from './emit-kind-tags.js';

// --- Planner output types ---

/** How a single input value should be constrained */
export type FieldInputType =
  | { type: 'string' }
  | { type: 'enum'; values: string[] }
  | { type: 'pattern'; regex: string; description?: string }
  | { type: 'anyOf'; alternatives: FieldInputType[] };

/** A single position in the tag to construct */
export interface BuilderPosition {
  /** Index in the tag array */
  index: number;
  /** Whether this is a fixed literal or user input */
  source: 'literal' | 'input';
  /** For literal positions (e.g., tag name at position 0) */
  literalValue?: string;
  /** For input positions: what type of input is expected */
  inputType?: FieldInputType;
  /** Must the user provide this position? */
  required: boolean;
  /** Sub-field name (for multi-position tags rendered as object fields) */
  fieldName?: string;
  /** Description from schema for JSDoc */
  description?: string;
}

/** Describes how to construct a single tag */
export interface BuilderTag {
  /** The tag[0] value */
  tagName: string;
  /** camelCase JS field name */
  fieldName: string;
  /** How to construct each position */
  positions: BuilderPosition[];
  /** JSDoc from schema */
  description?: string;
}

/** A language-independent builder action */
export type BuilderAction =
  | { type: 'required_tag'; tag: BuilderTag }
  | { type: 'optional_tag'; tag: BuilderTag }
  | { type: 'dependent_tag'; tag: BuilderTag; dependsOn: string }   // tier 2
  | { type: 'any_of_group'; tags: BuilderTag[]; description?: string }; // tier 2

// --- Field naming ---

/**
 * Convert a tag name to a camelCase field name.
 * "d" → "d", "rtt-open" → "rttOpen", "published_at" → "publishedAt",
 * "bolt11" → "bolt11", "P" → "P"
 */
export function tagNameToFieldName(tagName: string): string {
  if (!tagName.includes('-') && !tagName.includes('_')) return tagName;
  return tagName
    .split(/[-_]/)
    .map((part, i) => i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/**
 * Derive a sub-field name for a position in a multi-position tag.
 * Uses PositionType.title if available, else positional fallback.
 */
function positionFieldName(pos: PositionType, inputIndex: number): string {
  if (pos.title) {
    return tagNameToFieldName(pos.title.toLowerCase().replace(/\s+/g, '_'));
  }
  if (pos.description) {
    // Use first word of description as a simple heuristic
    const firstWord = pos.description.replace(/[^a-zA-Z0-9_]/g, '_').split('_').filter(Boolean)[0];
    if (firstWord && firstWord.length > 1 && firstWord.length < 20) {
      return firstWord.toLowerCase();
    }
  }
  return inputIndex === 1 ? 'value' : `value${inputIndex}`;
}

// --- Input type derivation ---

/**
 * Derive a FieldInputType from a PositionType.
 */
function deriveInputType(pos: PositionType): FieldInputType {
  if (pos.anyOf && pos.anyOf.length > 0) {
    const alternatives = pos.anyOf.map(deriveInputType);
    return { type: 'anyOf', alternatives };
  }
  if (pos.enumValues && pos.enumValues.length > 0) {
    return { type: 'enum', values: pos.enumValues };
  }
  if (pos.pattern) {
    return { type: 'pattern', regex: pos.pattern, description: pos.description };
  }
  return { type: 'string' };
}

// --- Planner ---

/**
 * Plan builder actions for a kind.
 * Returns undefined for bare kinds (no tag constraints worth building).
 */
export function planBuilder(shape: KindShape): BuilderAction[] | undefined {
  const entries = collectKindTags(shape);
  if (entries.length === 0) return undefined;

  const actions: BuilderAction[] = [];

  // Collect all tag names that belong to anyOf groups
  const anyOfTagNames = new Set<string>();
  for (const group of shape.anyOfTagGroups) {
    for (const req of group.requirements) {
      anyOfTagNames.add(req.tagName);
    }
  }

  // Build a lookup from collectKindTags entries (has the more constrained version)
  const entryByTag = new Map<string, KindTagEntry>();
  for (const entry of entries) {
    entryByTag.set(entry.tagName, entry);
  }

  // Track required tag names (auto-satisfy anyOf group constraints)
  const requiredTagNames = new Set<string>();

  // Phase 1: Emit non-anyOf tags
  for (const entry of entries) {
    // If this tag belongs to an anyOf group AND wasn't promoted to required,
    // defer to group handling in phase 2
    if (anyOfTagNames.has(entry.tagName) && entry.source !== 'required') continue;

    const tag = buildBuilderTag(entry);
    if (!tag) continue;

    if (entry.source === 'required') {
      actions.push({ type: 'required_tag', tag });
      requiredTagNames.add(entry.tagName);
    } else {
      actions.push({ type: 'optional_tag', tag });
    }
  }

  // Phase 2: Emit anyOf groups
  for (const group of shape.anyOfTagGroups) {
    // If any tag in the group is already required, the group is auto-satisfied
    const autoSatisfied = group.requirements.some(r => requiredTagNames.has(r.tagName));

    if (autoSatisfied) {
      // Emit remaining non-required tags as individual optionals
      for (const req of group.requirements) {
        if (requiredTagNames.has(req.tagName)) continue;
        const entry = entryByTag.get(req.tagName) ??
          { tagName: req.tagName, requirement: req, source: 'anyOf' as const };
        const tag = buildBuilderTag(entry);
        if (tag) actions.push({ type: 'optional_tag', tag });
      }
    } else {
      // Emit as any_of_group with runtime enforcement
      const groupTags: BuilderTag[] = [];
      for (const req of group.requirements) {
        const entry = entryByTag.get(req.tagName) ??
          { tagName: req.tagName, requirement: req, source: 'anyOf' as const };
        const tag = buildBuilderTag(entry);
        if (tag) groupTags.push(tag);
      }
      if (groupTags.length > 0) {
        actions.push({ type: 'any_of_group', tags: groupTags, description: group.errorMessage });
      }
    }
  }

  return actions.length > 0 ? actions : undefined;
}

/**
 * Build a BuilderTag from a KindTagEntry.
 * Handles all-literal tags (e.g., ["z", "order"]) which have no user input.
 */
function buildBuilderTag(entry: KindTagEntry): BuilderTag | undefined {
  const { tagName, requirement: req } = entry;
  const positions: BuilderPosition[] = [];

  // Determine how many total positions we need (schema may imply more via minItems)
  const impliedCount = Math.max(req.positions.length, req.minItems);

  // Count non-literal positions after index 0 to determine naming strategy
  const explicitInputCount = req.positions.filter((p, i) => i > 0 && p.constValue === undefined).length;
  const impliedInputCount = impliedCount - req.positions.length;
  const totalInputCount = explicitInputCount + impliedInputCount;
  const useObjectField = totalInputCount > 1;
  let inputIndex = 0;

  for (const pos of req.positions) {
    if (pos.index === 0) {
      // Position 0 is always the tag name literal
      positions.push({
        index: 0,
        source: 'literal',
        literalValue: pos.constValue ?? tagName,
        required: true,
      });
      continue;
    }

    // Check if this position has a const value (it's a literal, not user input)
    if (pos.constValue !== undefined) {
      positions.push({
        index: pos.index,
        source: 'literal',
        literalValue: pos.constValue,
        required: pos.required,
      });
      continue;
    }

    inputIndex++;
    const inputType = deriveInputType(pos);
    const fieldName = useObjectField ? positionFieldName(pos, inputIndex) : undefined;

    positions.push({
      index: pos.index,
      source: 'input',
      inputType,
      required: pos.required,
      fieldName,
      description: pos.description,
    });
  }

  // Add implied unconstrained positions when minItems > explicit positions
  for (let i = req.positions.length; i < impliedCount; i++) {
    inputIndex++;
    const fieldName = useObjectField ? (inputIndex === 1 ? 'value' : `value${inputIndex}`) : undefined;
    positions.push({
      index: i,
      source: 'input',
      inputType: { type: 'string' },
      required: i < req.minItems,
      fieldName,
    });
  }

  // Deduplicate sub-field names: if two positions resolve to the same name,
  // append a numeric suffix to disambiguate.
  if (useObjectField) {
    const inputPos = positions.filter(p => p.source === 'input' && p.fieldName);
    const nameCount = new Map<string, number>();
    for (const p of inputPos) {
      nameCount.set(p.fieldName!, (nameCount.get(p.fieldName!) ?? 0) + 1);
    }
    for (const [name, count] of nameCount) {
      if (count <= 1) continue;
      let suffix = 1;
      for (const p of inputPos) {
        if (p.fieldName === name) {
          p.fieldName = suffix === 1 ? name : `${name}${suffix}`;
          suffix++;
        }
      }
    }
  }

  return {
    tagName,
    fieldName: tagNameToFieldName(tagName),
    positions,
    description: req.errorMessage,
  };
}
