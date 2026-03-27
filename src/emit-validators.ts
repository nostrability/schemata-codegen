/**
 * Runtime validator emitter: TagShape + KindShape → validators.ts
 *
 * Generates executable TypeScript validator functions:
 *   - Tag-level: validates structured_metadata tags with contains constraints
 *   - Kind-level: validates events have required/conditional tags
 */

import type { TagShape, PositionType } from './patterns.js';
import type { KindShape, TagRequirement, PerItemConditional, ArrayLevelConditional } from './kind-types.js';

export interface ValidationError {
  path: string;
  message: string;
}

// --- Tag-level validators ---

/**
 * Emit a tag validator function for a structured_metadata tag.
 */
function emitTagValidator(shape: TagShape): string | undefined {
  const hasPatterns = shape.containsPatterns && shape.containsPatterns.length > 0;
  const hasConstants = shape.containsConstants && shape.containsConstants.length > 0;
  if (!hasPatterns && !hasConstants) return undefined;

  const fnName = `validate${pascalCase(shape.tagName)}Tag`;
  const lines: string[] = [];

  lines.push(`/** Validate a ${shape.tagName} tag's contains constraints */`);
  lines.push(`export function ${fnName}(tag: readonly string[]): ValidationError[] {`);
  lines.push('  const errors: ValidationError[] = [];');

  // Check tag name at position 0
  lines.push(`  if (tag[0] !== ${JSON.stringify(shape.tagName)}) {`);
  lines.push(`    errors.push({ path: "tag[0]", message: \`Expected tag name ${JSON.stringify(shape.tagName)}, got \${tag[0]}\` });`);
  lines.push('    return errors;');
  lines.push('  }');

  // Check minItems
  lines.push(`  if (tag.length < ${shape.minItems}) {`);
  lines.push(`    errors.push({ path: "tag", message: \`${shape.tagName} tag must have at least ${shape.minItems} items, got \${tag.length}\` });`);
  lines.push('  }');

  // Pattern contains: at least one element must match the regex
  if (hasPatterns) {
    for (const pattern of shape.containsPatterns!) {
      const escaped = JSON.stringify(pattern);
      lines.push(`  if (!tag.slice(1).some(v => new RegExp(${escaped}).test(v))) {`);
      lines.push(`    errors.push({ path: "tag", message: \`${shape.tagName} tag must contain an entry matching ${escaped}\` });`);
      lines.push('  }');
    }
  }

  // Const contains: at least one element must equal the const value
  if (hasConstants) {
    for (const constVal of shape.containsConstants!) {
      lines.push(`  if (!tag.slice(1).includes(${JSON.stringify(constVal)})) {`);
      lines.push(`    errors.push({ path: "tag", message: \`${shape.tagName} tag must contain ${JSON.stringify(constVal)}\` });`);
      lines.push('  }');
    }
  }

  lines.push('  return errors;');
  lines.push('}');
  return lines.join('\n');
}

// --- Kind-level validators ---

/**
 * Emit a single position constraint check as a boolean expression string.
 * Returns undefined if the position has no constraints.
 */
function emitSinglePositionCheck(
  pos: import('./patterns.js').PositionType,
  tagVar: string,
): string | undefined {
  const checks: string[] = [];

  if (pos.anyOf && pos.anyOf.length > 0) {
    const altChecks: string[] = [];
    for (const alt of pos.anyOf) {
      if (alt.constValue !== undefined) {
        altChecks.push(`${tagVar}[${pos.index}] === ${JSON.stringify(alt.constValue)}`);
      } else if (alt.enumValues && alt.enumValues.length > 0) {
        const vals = alt.enumValues.map(v => JSON.stringify(v)).join(', ');
        altChecks.push(`[${vals}].includes(${tagVar}[${pos.index}] ?? "")`);
      } else if (alt.pattern) {
        altChecks.push(`new RegExp(${JSON.stringify(alt.pattern)}).test(${tagVar}[${pos.index}] ?? "")`);
      }
    }
    if (altChecks.length > 0) return `(${altChecks.join(' || ')})`;
    return undefined;
  }

  if (pos.pattern) {
    checks.push(`new RegExp(${JSON.stringify(pos.pattern)}).test(${tagVar}[${pos.index}] ?? "")`);
  }
  if (pos.constValue !== undefined) {
    checks.push(`${tagVar}[${pos.index}] === ${JSON.stringify(pos.constValue)}`);
  }
  if (pos.enumValues && pos.enumValues.length > 0) {
    const vals = pos.enumValues.map(v => JSON.stringify(v)).join(', ');
    checks.push(`[${vals}].includes(${tagVar}[${pos.index}] ?? "")`);
  }

  return checks.length > 0 ? checks.join(' && ') : undefined;
}

/**
 * Describe a position constraint for an error message.
 */
function describePositionConstraint(
  pos: import('./patterns.js').PositionType,
  tagName: string,
): string {
  if (pos.enumValues && pos.enumValues.length > 0) {
    return `${tagName} tag position ${pos.index} must be one of: ${pos.enumValues.join(', ')}`;
  }
  if (pos.pattern) {
    return `${tagName} tag position ${pos.index} must match pattern ${pos.pattern}`;
  }
  if (pos.constValue !== undefined) {
    return `${tagName} tag position ${pos.index} must be "${pos.constValue}"`;
  }
  if (pos.anyOf && pos.anyOf.length > 0) {
    return `${tagName} tag position ${pos.index} does not match any allowed alternative`;
  }
  return `${tagName} tag position ${pos.index} is invalid`;
}

/**
 * Emit a tag-matching check for a TagRequirement.
 * Returns a condition string that checks if a tag matches the requirement.
 */
function emitTagMatcher(req: TagRequirement, tagVar: string): string {
  const checks: string[] = [];
  checks.push(`${tagVar}[0] === ${JSON.stringify(req.tagName)}`);
  checks.push(`${tagVar}.length >= ${req.minItems}`);
  if (req.maxItems !== undefined) {
    checks.push(`${tagVar}.length <= ${req.maxItems}`);
  }

  // Check positional constraints for required positions only (index < minItems)
  for (const pos of req.positions.slice(1)) {
    if (!pos.required) continue; // Skip optional positions in match condition

    // Handle anyOf alternatives: combine per-alternative checks with OR
    if (pos.anyOf && pos.anyOf.length > 0) {
      const altChecks: string[] = [];
      for (const alt of pos.anyOf) {
        if (alt.constValue !== undefined) {
          altChecks.push(`${tagVar}[${pos.index}] === ${JSON.stringify(alt.constValue)}`);
        } else if (alt.enumValues && alt.enumValues.length > 0) {
          const vals = alt.enumValues.map(v => JSON.stringify(v)).join(', ');
          altChecks.push(`[${vals}].includes(${tagVar}[${pos.index}] ?? "")`);
        } else if (alt.pattern) {
          altChecks.push(`new RegExp(${JSON.stringify(alt.pattern)}).test(${tagVar}[${pos.index}] ?? "")`);
        }
      }
      if (altChecks.length > 0) {
        checks.push(`(${altChecks.join(' || ')})`);
      }
      continue;
    }

    if (pos.pattern) {
      checks.push(`new RegExp(${JSON.stringify(pos.pattern)}).test(${tagVar}[${pos.index}] ?? "")`);
    }
    if (pos.constValue !== undefined) {
      checks.push(`${tagVar}[${pos.index}] === ${JSON.stringify(pos.constValue)}`);
    }
    if (pos.enumValues && pos.enumValues.length > 0) {
      const vals = pos.enumValues.map(v => JSON.stringify(v)).join(', ');
      checks.push(`[${vals}].includes(${tagVar}[${pos.index}] ?? "")`);
    }
  }

  return checks.join(' && ');
}

/**
 * Emit a kind validator function.
 */
function emitKindValidator(shape: KindShape): string | undefined {
  const hasRequiredTags = shape.requiredTags.length > 0;
  const hasPerItem = shape.perItemConditionals.length > 0;
  const hasArrayLevel = shape.arrayLevelConditionals.length > 0;
  const hasAnyOfGroups = shape.anyOfTagGroups.length > 0;

  if (!hasRequiredTags && !hasPerItem && !hasArrayLevel && !hasAnyOfGroups) return undefined;

  const fnName = `validateKind${shape.kindNumber}Tags`;
  const lines: string[] = [];

  lines.push(`/** Validate tags for kind ${shape.kindNumber} (${shape.nip}) */`);
  lines.push(`export function ${fnName}(tags: ReadonlyArray<readonly string[]>): ValidationError[] {`);
  lines.push('  const errors: ValidationError[] = [];');

  // Check tagsMinItems
  if (shape.tagsMinItems) {
    lines.push(`  if (tags.length < ${shape.tagsMinItems}) {`);
    lines.push(`    errors.push({ path: "tags", message: "tags must have at least ${shape.tagsMinItems} item(s)" });`);
    lines.push('  }');
  }

  // Required tags (contains constraints)
  for (const req of shape.requiredTags) {
    const matcher = emitTagMatcher(req, 't');
    const errMsg = req.errorMessage ?? `tags must include a ${req.tagName} tag`;
    lines.push(`  if (!tags.some(t => ${matcher})) {`);
    lines.push(`    errors.push({ path: "tags", message: ${JSON.stringify(errMsg)} });`);
    lines.push('  }');
  }

  // Optional position validation: for tags that matched by name, validate constrained optional positions
  for (const req of shape.requiredTags) {
    const optionalChecks = req.positions.slice(1).filter(pos =>
      !pos.required && (
        (pos.enumValues && pos.enumValues.length > 0) ||
        pos.pattern ||
        pos.constValue !== undefined ||
        (pos.anyOf && pos.anyOf.length > 0)
      )
    );
    if (optionalChecks.length === 0) continue;

    lines.push(`  for (const t of tags) {`);
    lines.push(`    if (t[0] === ${JSON.stringify(req.tagName)}) {`);
    for (const pos of optionalChecks) {
      const check = emitSinglePositionCheck(pos, 't');
      if (check) {
        const msg = describePositionConstraint(pos, req.tagName);
        lines.push(`      if (t.length > ${pos.index} && !(${check})) {`);
        lines.push(`        errors.push({ path: "tags", message: ${JSON.stringify(msg)} });`);
        lines.push('      }');
      }
    }
    lines.push('    }');
    lines.push('  }');
  }

  // Per-item conditionals
  for (const cond of shape.perItemConditionals) {
    const condCheck = `t[0] === ${JSON.stringify(cond.conditionTagName)}`;
    const reqMatcher = emitTagMatcher(cond.requirement, 't');
    const errMsg = cond.errorMessage ?? `${cond.conditionTagName} tag does not match required schema`;

    // Collect optional constrained positions for this conditional's requirement
    const optChecks = cond.requirement.positions.slice(1).filter(pos =>
      !pos.required && (
        (pos.enumValues && pos.enumValues.length > 0) ||
        pos.pattern ||
        pos.constValue !== undefined ||
        (pos.anyOf && pos.anyOf.length > 0)
      )
    );

    lines.push(`  for (const t of tags) {`);
    lines.push(`    if (${condCheck} && !(${reqMatcher})) {`);
    lines.push(`      errors.push({ path: "tags", message: ${JSON.stringify(errMsg)} });`);
    lines.push('    }');
    // Validate optional constrained positions on matching tags
    if (optChecks.length > 0) {
      lines.push(`    if (${condCheck}) {`);
      for (const pos of optChecks) {
        const check = emitSinglePositionCheck(pos, 't');
        if (check) {
          const msg = describePositionConstraint(pos, cond.conditionTagName);
          lines.push(`      if (t.length > ${pos.index} && !(${check})) {`);
          lines.push(`        errors.push({ path: "tags", message: ${JSON.stringify(msg)} });`);
          lines.push('      }');
        }
      }
      lines.push('    }');
    }
    lines.push('  }');
  }

  // Array-level conditionals
  for (const cond of shape.arrayLevelConditionals) {
    const condCheck = `tags.some(t => t[0] === ${JSON.stringify(cond.conditionTagName)})`;
    const reqMatcher = emitTagMatcher(cond.requirement, 't');
    const errMsg = cond.errorMessage ?? `tags must include a valid ${cond.requirement.tagName} tag when ${cond.conditionTagName} tags are present`;
    lines.push(`  if (${condCheck}) {`);
    lines.push(`    if (!tags.some(t => ${reqMatcher})) {`);
    lines.push(`      errors.push({ path: "tags", message: ${JSON.stringify(errMsg)} });`);
    lines.push('    }');
    lines.push('  }');

    // Validate optional constrained positions on matching tags for array-level conditionals
    const optChecks = cond.requirement.positions.slice(1).filter(pos =>
      !pos.required && (
        (pos.enumValues && pos.enumValues.length > 0) ||
        pos.pattern ||
        pos.constValue !== undefined ||
        (pos.anyOf && pos.anyOf.length > 0)
      )
    );
    if (optChecks.length > 0) {
      lines.push(`  for (const t of tags) {`);
      lines.push(`    if (t[0] === ${JSON.stringify(cond.requirement.tagName)}) {`);
      for (const pos of optChecks) {
        const check = emitSinglePositionCheck(pos, 't');
        if (check) {
          const msg = describePositionConstraint(pos, cond.requirement.tagName);
          lines.push(`      if (t.length > ${pos.index} && !(${check})) {`);
          lines.push(`        errors.push({ path: "tags", message: ${JSON.stringify(msg)} });`);
          lines.push('      }');
        }
      }
      lines.push('    }');
      lines.push('  }');
    }
  }

  // anyOf tag groups: at least one tag from each group must be present
  for (const group of shape.anyOfTagGroups) {
    const matchers = group.requirements.map(req => `tags.some(t => ${emitTagMatcher(req, 't')})`);
    const tagNames = group.requirements.map(r => r.tagName).join(', ');
    const errMsg = group.errorMessage ?? `tags must include at least one of: ${tagNames}`;
    lines.push(`  if (!(${matchers.join(' || ')})) {`);
    lines.push(`    errors.push({ path: "tags", message: ${JSON.stringify(errMsg)} });`);
    lines.push('  }');
  }

  lines.push('  return errors;');
  lines.push('}');
  return lines.join('\n');
}

// --- Main dispatch ---

/**
 * Emit a dispatch function that routes to kind-specific validators.
 */
function emitDispatch(constrainedKinds: KindShape[]): string {
  const sorted = [...constrainedKinds].sort((a, b) => a.kindNumber - b.kindNumber);

  const lines: string[] = [];
  lines.push('/** Validate tags for a given kind number. Returns empty array if kind has no constraints or is unknown. */');
  lines.push('export function validateKindTags(kind: number, tags: ReadonlyArray<readonly string[]>): ValidationError[] {');
  lines.push('  switch (kind) {');
  for (const shape of sorted) {
    lines.push(`    case ${shape.kindNumber}: return validateKind${shape.kindNumber}Tags(tags);`);
  }
  lines.push('    default: return [];');
  lines.push('  }');
  lines.push('}');
  return lines.join('\n');
}

// --- File assembly ---

/**
 * Emit the complete validators.ts file.
 */
export function emitValidatorsFile(
  tagShapes: TagShape[],
  kindShapes: KindShape[],
): string {
  const header = [
    '// Auto-generated by @nostrability/schemata-codegen',
    '// Do not edit manually.',
    '//',
    '// Runtime validators for Nostr tag and event constraints',
    '',
    'export interface ValidationError {',
    '  path: string;',
    '  message: string;',
    '}',
    '',
  ].join('\n');

  const parts: string[] = [header];

  // Tag-level validators
  const tagValidators: string[] = [];
  for (const shape of tagShapes) {
    if (shape.pattern !== 'structured_metadata') continue;
    const validator = emitTagValidator(shape);
    if (validator) tagValidators.push(validator);
  }

  if (tagValidators.length > 0) {
    parts.push('// === Tag-level validators ===\n');
    parts.push(tagValidators.join('\n\n'));
    parts.push('');
  }

  // Kind-level validators
  const kindValidators: string[] = [];
  const constrainedKinds: KindShape[] = [];
  for (const shape of [...kindShapes].sort((a, b) => a.kindNumber - b.kindNumber)) {
    const validator = emitKindValidator(shape);
    if (validator) {
      kindValidators.push(validator);
      constrainedKinds.push(shape);
    }
  }

  if (kindValidators.length > 0) {
    parts.push('\n// === Kind-level validators ===\n');
    parts.push(kindValidators.join('\n\n'));
    parts.push('');
  }

  // Dispatch function
  if (constrainedKinds.length > 0) {
    parts.push('\n// === Dispatch ===\n');
    parts.push(emitDispatch(constrainedKinds));
    parts.push('');
  }

  return parts.join('\n');
}

// --- Helpers ---

function pascalCase(s: string): string {
  return s.replace(/(^|[-_])(\w)/g, (_, __, c) => c.toUpperCase());
}
