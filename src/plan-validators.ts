/**
 * Validator planner: KindShape/TagShape → ValidatorAction[]
 *
 * Language-independent layer that separates "what to check" from
 * "how to render". Each ValidatorAction describes a single validation
 * check that any language emitter can render.
 *
 * Pipeline: KindShape[] → planKindValidator() → ValidatorAction[] → emit-{lang}.ts → code
 */

import type { PositionType, TagShape } from './patterns.js';
import type { KindShape, TagRequirement } from './kind-types.js';
import { classifyRegex, type PatternCheck } from './classify-pattern.js';

// --- Planner output types ---

/** A check on a single position within a tag tuple */
export interface PositionCheck {
  index: number;
  required: boolean;
  check: ValueCheck;
}

/** How to validate a single value */
export type ValueCheck =
  | { type: 'const'; value: string }
  | { type: 'enum'; values: string[] }
  | { type: 'pattern'; regex: string; native: PatternCheck }
  | { type: 'anyOf'; alternatives: ValueCheck[] };

/** Describes a tag-matching condition */
export interface TagMatcher {
  tagName: string;
  minItems: number;
  maxItems?: number;
  positionChecks: PositionCheck[];
}

/** A language-independent validation action */
export type ValidatorAction =
  | { type: 'check_min_tags'; min: number }
  | { type: 'require_tag'; matcher: TagMatcher; errorMsg: string }
  | { type: 'validate_optional_positions'; tagName: string; checks: PositionCheck[] }
  | { type: 'per_item_conditional'; condTag: string; matcher: TagMatcher; errorMsg: string; optChecks: PositionCheck[] }
  | { type: 'array_level_conditional'; condTag: string; matcher: TagMatcher; errorMsg: string; optChecks: PositionCheck[] }
  | { type: 'any_of_group'; matchers: TagMatcher[]; errorMsg: string };

// --- Tag-level validator actions ---

/** A tag-level validation action for structured_metadata tags */
export type TagValidatorAction =
  | { type: 'check_tag_name'; tagName: string }
  | { type: 'check_min_items'; min: number; tagName: string }
  | { type: 'check_pattern_contains'; pattern: string; tagName: string }
  | { type: 'check_const_contains'; value: string; tagName: string };

/**
 * Plan validation actions for a structured_metadata tag.
 */
export function planTagValidator(shape: TagShape): TagValidatorAction[] | undefined {
  const hasPatterns = shape.containsPatterns && shape.containsPatterns.length > 0;
  const hasConstants = shape.containsConstants && shape.containsConstants.length > 0;
  if (!hasPatterns && !hasConstants) return undefined;
  if (shape.pattern !== 'structured_metadata') return undefined;

  const actions: TagValidatorAction[] = [];

  actions.push({ type: 'check_tag_name', tagName: shape.tagName });
  actions.push({ type: 'check_min_items', min: shape.minItems, tagName: shape.tagName });

  if (hasPatterns) {
    for (const pattern of shape.containsPatterns!) {
      actions.push({ type: 'check_pattern_contains', pattern, tagName: shape.tagName });
    }
  }

  if (hasConstants) {
    for (const constVal of shape.containsConstants!) {
      actions.push({ type: 'check_const_contains', value: constVal, tagName: shape.tagName });
    }
  }

  return actions;
}

// --- Kind-level validator planning ---

/**
 * Plan validation actions for a kind.
 * Returns undefined for bare kinds (no constraints).
 */
export function planKindValidator(shape: KindShape): ValidatorAction[] | undefined {
  const hasRequiredTags = shape.requiredTags.length > 0;
  const hasPerItem = shape.perItemConditionals.length > 0;
  const hasArrayLevel = shape.arrayLevelConditionals.length > 0;
  const hasAnyOfGroups = shape.anyOfTagGroups.length > 0;

  if (!hasRequiredTags && !hasPerItem && !hasArrayLevel && !hasAnyOfGroups) return undefined;

  const actions: ValidatorAction[] = [];

  // Check tagsMinItems
  if (shape.tagsMinItems) {
    actions.push({ type: 'check_min_tags', min: shape.tagsMinItems });
  }

  // Required tags (contains constraints)
  for (const req of shape.requiredTags) {
    const matcher = buildTagMatcher(req);
    const errorMsg = req.errorMessage ?? `tags must include a ${req.tagName} tag`;
    actions.push({ type: 'require_tag', matcher, errorMsg });
  }

  // Optional position validation for required tags
  for (const req of shape.requiredTags) {
    const optChecks = getOptionalPositionChecks(req);
    if (optChecks.length > 0) {
      actions.push({
        type: 'validate_optional_positions',
        tagName: req.tagName,
        checks: optChecks,
      });
    }
  }

  // Per-item conditionals
  for (const cond of shape.perItemConditionals) {
    const matcher = buildTagMatcher(cond.requirement);
    const errorMsg = cond.errorMessage ?? `${cond.conditionTagName} tag does not match required schema`;
    const optChecks = getOptionalPositionChecks(cond.requirement);
    actions.push({
      type: 'per_item_conditional',
      condTag: cond.conditionTagName,
      matcher,
      errorMsg,
      optChecks,
    });
  }

  // Array-level conditionals
  for (const cond of shape.arrayLevelConditionals) {
    const matcher = buildTagMatcher(cond.requirement);
    const errorMsg = cond.errorMessage ?? `tags must include a valid ${cond.requirement.tagName} tag when ${cond.conditionTagName} tags are present`;
    const optChecks = getOptionalPositionChecks(cond.requirement);
    actions.push({
      type: 'array_level_conditional',
      condTag: cond.conditionTagName,
      matcher,
      errorMsg,
      optChecks,
    });
  }

  // anyOf tag groups
  for (const group of shape.anyOfTagGroups) {
    const matchers = group.requirements.map(buildTagMatcher);
    const tagNames = group.requirements.map(r => r.tagName).join(', ');
    const errorMsg = group.errorMessage ?? `tags must include at least one of: ${tagNames}`;
    actions.push({ type: 'any_of_group', matchers, errorMsg });
  }

  return actions;
}

/**
 * Build a TagMatcher from a TagRequirement.
 * Only includes required position checks (for existence/match testing).
 */
export function buildTagMatcher(req: TagRequirement): TagMatcher {
  const positionChecks: PositionCheck[] = [];

  for (const pos of req.positions.slice(1)) {
    if (!pos.required) continue; // Skip optional positions in match condition
    const check = buildValueCheck(pos);
    if (check) {
      positionChecks.push({ index: pos.index, required: true, check });
    }
  }

  return {
    tagName: req.tagName,
    minItems: req.minItems,
    maxItems: req.maxItems,
    positionChecks,
  };
}

/**
 * Build a ValueCheck from a PositionType.
 * Returns undefined if the position has no constraints.
 */
export function buildValueCheck(pos: PositionType): ValueCheck | undefined {
  // Handle anyOf alternatives
  if (pos.anyOf && pos.anyOf.length > 0) {
    const alternatives: ValueCheck[] = [];
    for (const alt of pos.anyOf) {
      const check = buildValueCheck(alt);
      if (check) alternatives.push(check);
    }
    if (alternatives.length > 0) return { type: 'anyOf', alternatives };
    return undefined;
  }

  if (pos.constValue !== undefined) {
    return { type: 'const', value: pos.constValue };
  }
  if (pos.enumValues && pos.enumValues.length > 0) {
    return { type: 'enum', values: pos.enumValues };
  }
  if (pos.pattern) {
    return { type: 'pattern', regex: pos.pattern, native: classifyRegex(pos.pattern) };
  }

  return undefined;
}

/**
 * Get optional position checks for a TagRequirement.
 * These are positions that are not required but have constraints
 * (enum, pattern, const, anyOf) that should be validated when present.
 */
function getOptionalPositionChecks(req: TagRequirement): PositionCheck[] {
  const checks: PositionCheck[] = [];

  for (const pos of req.positions.slice(1)) {
    if (pos.required) continue;

    const hasConstraint =
      (pos.enumValues && pos.enumValues.length > 0) ||
      pos.pattern !== undefined ||
      pos.constValue !== undefined ||
      (pos.anyOf && pos.anyOf.length > 0);

    if (!hasConstraint) continue;

    const check = buildValueCheck(pos);
    if (check) {
      checks.push({ index: pos.index, required: false, check });
    }
  }

  return checks;
}
