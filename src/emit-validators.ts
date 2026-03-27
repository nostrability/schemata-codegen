/**
 * Runtime validator emitter: TagShape + KindShape → validators.ts
 *
 * Generates executable TypeScript validator functions:
 *   - Tag-level: validates structured_metadata tags with contains constraints
 *   - Kind-level: validates events have required/conditional tags
 *
 * Internally uses the plan layer (plan-validators.ts) to produce
 * language-independent ValidatorAction[], then renders to TypeScript.
 */

import type { TagShape } from './patterns.js';
import type { KindShape } from './kind-types.js';
import {
  planKindValidator,
  planTagValidator,
  planContentChecks,
  type ValidatorAction,
  type ContentAction,
  type TagMatcher,
  type ValueCheck,
  type PositionCheck,
  type TagValidatorAction,
} from './plan-validators.js';

export interface ValidationError {
  path: string;
  message: string;
}

// --- Tag-level validators ---

/**
 * Emit a tag validator function for a structured_metadata tag.
 */
function emitTagValidator(shape: TagShape): string | undefined {
  const actions = planTagValidator(shape);
  if (!actions) return undefined;

  const fnName = `validate${pascalCase(shape.tagName)}Tag`;
  const lines: string[] = [];

  lines.push(`/** Validate a ${shape.tagName} tag's contains constraints */`);
  lines.push(`export function ${fnName}(tag: readonly string[]): ValidationError[] {`);
  lines.push('  const errors: ValidationError[] = [];');

  for (const action of actions) {
    switch (action.type) {
      case 'check_tag_name':
        lines.push(`  if (tag[0] !== ${JSON.stringify(action.tagName)}) {`);
        lines.push(`    errors.push({ path: "tag[0]", message: \`Expected tag name ${JSON.stringify(action.tagName)}, got \${tag[0]}\` });`);
        lines.push('    return errors;');
        lines.push('  }');
        break;

      case 'check_min_items':
        lines.push(`  if (tag.length < ${action.min}) {`);
        lines.push(`    errors.push({ path: "tag", message: \`${action.tagName} tag must have at least ${action.min} items, got \${tag.length}\` });`);
        lines.push('  }');
        break;

      case 'check_pattern_contains': {
        const escaped = JSON.stringify(action.pattern);
        lines.push(`  if (!tag.slice(1).some(v => new RegExp(${escaped}).test(v))) {`);
        lines.push(`    errors.push({ path: "tag", message: \`${action.tagName} tag must contain an entry matching ${escaped}\` });`);
        lines.push('  }');
        break;
      }

      case 'check_const_contains':
        lines.push(`  if (!tag.slice(1).includes(${JSON.stringify(action.value)})) {`);
        lines.push(`    errors.push({ path: "tag", message: \`${action.tagName} tag must contain ${JSON.stringify(action.value)}\` });`);
        lines.push('  }');
        break;
    }
  }

  lines.push('  return errors;');
  lines.push('}');
  return lines.join('\n');
}

// --- Kind-level validators (from ValidatorAction[]) ---

/**
 * Render a ValueCheck as a TypeScript boolean expression.
 */
function renderValueCheck(check: ValueCheck, tagVar: string, index: number): string {
  switch (check.type) {
    case 'const':
      return `${tagVar}[${index}] === ${JSON.stringify(check.value)}`;
    case 'enum': {
      const vals = check.values.map(v => JSON.stringify(v)).join(', ');
      return `[${vals}].includes(${tagVar}[${index}] ?? "")`;
    }
    case 'pattern':
      return `new RegExp(${JSON.stringify(check.regex)}).test(${tagVar}[${index}] ?? "")`;
    case 'anyOf': {
      const altChecks = check.alternatives.map(alt => renderValueCheck(alt, tagVar, index));
      return `(${altChecks.join(' || ')})`;
    }
  }
}

/**
 * Render a single position check as a boolean expression.
 * Used for optional position validation.
 */
function renderPositionCheck(pc: PositionCheck, tagVar: string): string {
  return renderValueCheck(pc.check, tagVar, pc.index);
}

/**
 * Describe a position constraint for an error message.
 */
function describePositionConstraint(pc: PositionCheck, tagName: string): string {
  switch (pc.check.type) {
    case 'enum':
      return `${tagName} tag position ${pc.index} must be one of: ${pc.check.values.join(', ')}`;
    case 'pattern':
      return `${tagName} tag position ${pc.index} must match pattern ${pc.check.regex}`;
    case 'const':
      return `${tagName} tag position ${pc.index} must be "${pc.check.value}"`;
    case 'anyOf':
      return `${tagName} tag position ${pc.index} does not match any allowed alternative`;
  }
}

/**
 * Render a TagMatcher as a TypeScript boolean expression.
 */
function renderTagMatcher(matcher: TagMatcher, tagVar: string): string {
  const checks: string[] = [];
  checks.push(`${tagVar}[0] === ${JSON.stringify(matcher.tagName)}`);
  checks.push(`${tagVar}.length >= ${matcher.minItems}`);
  if (matcher.maxItems !== undefined) {
    checks.push(`${tagVar}.length <= ${matcher.maxItems}`);
  }

  for (const pc of matcher.positionChecks) {
    checks.push(renderValueCheck(pc.check, tagVar, pc.index));
  }

  return checks.join(' && ');
}

/**
 * Emit a kind validator function from ValidatorAction[].
 */
function emitKindValidatorFromActions(
  kindNumber: number,
  nip: string,
  actions: ValidatorAction[],
): string {
  const fnName = `validateKind${kindNumber}Tags`;
  const lines: string[] = [];

  lines.push(`/** Validate tags for kind ${kindNumber} (${nip}) */`);
  lines.push(`export function ${fnName}(tags: ReadonlyArray<readonly string[]>): ValidationError[] {`);
  lines.push('  const errors: ValidationError[] = [];');

  for (const action of actions) {
    switch (action.type) {
      case 'check_min_tags':
        lines.push(`  if (tags.length < ${action.min}) {`);
        lines.push(`    errors.push({ path: "tags", message: "tags must have at least ${action.min} item(s)" });`);
        lines.push('  }');
        break;

      case 'check_max_tags':
        lines.push(`  if (tags.length > ${action.max}) {`);
        lines.push(`    errors.push({ path: "tags", message: "tags must have at most ${action.max} item(s)" });`);
        lines.push('  }');
        break;

      case 'require_tag': {
        const matcher = renderTagMatcher(action.matcher, 't');
        lines.push(`  if (!tags.some(t => ${matcher})) {`);
        lines.push(`    errors.push({ path: "tags", message: ${JSON.stringify(action.errorMsg)} });`);
        lines.push('  }');
        break;
      }

      case 'validate_optional_positions': {
        lines.push(`  for (const t of tags) {`);
        lines.push(`    if (t[0] === ${JSON.stringify(action.tagName)}) {`);
        for (const pc of action.checks) {
          const check = renderPositionCheck(pc, 't');
          const msg = describePositionConstraint(pc, action.tagName);
          lines.push(`      if (t.length > ${pc.index} && !(${check})) {`);
          lines.push(`        errors.push({ path: "tags", message: ${JSON.stringify(msg)} });`);
          lines.push('      }');
        }
        lines.push('    }');
        lines.push('  }');
        break;
      }

      case 'per_item_conditional': {
        const condCheck = `t[0] === ${JSON.stringify(action.condTag)}`;
        const reqMatcher = renderTagMatcher(action.matcher, 't');
        lines.push(`  for (const t of tags) {`);
        lines.push(`    if (${condCheck} && !(${reqMatcher})) {`);
        lines.push(`      errors.push({ path: "tags", message: ${JSON.stringify(action.errorMsg)} });`);
        lines.push('    }');
        if (action.optChecks.length > 0) {
          lines.push(`    if (${condCheck}) {`);
          for (const pc of action.optChecks) {
            const check = renderPositionCheck(pc, 't');
            const msg = describePositionConstraint(pc, action.condTag);
            lines.push(`      if (t.length > ${pc.index} && !(${check})) {`);
            lines.push(`        errors.push({ path: "tags", message: ${JSON.stringify(msg)} });`);
            lines.push('      }');
          }
          lines.push('    }');
        }
        lines.push('  }');
        break;
      }

      case 'array_level_conditional': {
        const condCheck = `tags.some(t => t[0] === ${JSON.stringify(action.condTag)})`;
        const reqMatcher = renderTagMatcher(action.matcher, 't');
        lines.push(`  if (${condCheck}) {`);
        lines.push(`    if (!tags.some(t => ${reqMatcher})) {`);
        lines.push(`      errors.push({ path: "tags", message: ${JSON.stringify(action.errorMsg)} });`);
        lines.push('    }');
        if (action.optChecks.length > 0) {
          lines.push(`    for (const t of tags) {`);
          lines.push(`      if (t[0] === ${JSON.stringify(action.matcher.tagName)}) {`);
          for (const pc of action.optChecks) {
            const check = renderPositionCheck(pc, 't');
            const msg = describePositionConstraint(pc, action.matcher.tagName);
            lines.push(`        if (t.length > ${pc.index} && !(${check})) {`);
            lines.push(`          errors.push({ path: "tags", message: ${JSON.stringify(msg)} });`);
            lines.push('        }');
          }
          lines.push('      }');
          lines.push('    }');
        }
        lines.push('  }');
        break;
      }

      case 'any_of_group': {
        const matchers = action.matchers.map(m => `tags.some(t => ${renderTagMatcher(m, 't')})`);
        lines.push(`  if (!(${matchers.join(' || ')})) {`);
        lines.push(`    errors.push({ path: "tags", message: ${JSON.stringify(action.errorMsg)} });`);
        lines.push('  }');
        break;
      }
    }
  }

  lines.push('  return errors;');
  lines.push('}');
  return lines.join('\n');
}

// --- Content validation ---

/**
 * Render content validation checks as TypeScript statement lines.
 * Assumes a `content` variable of type `string` is in scope.
 */
function renderContentActions(actions: ContentAction[]): string[] {
  const lines: string[] = [];
  for (const action of actions) {
    switch (action.type) {
      case 'check_content_min_length':
        lines.push(`    if (content.length < ${action.min}) {`);
        lines.push(`      errors.push({ path: "content", message: "content must be at least ${action.min} character(s)" });`);
        lines.push('    }');
        break;
      case 'check_content_max_length':
        lines.push(`    if (content.length > ${action.max}) {`);
        lines.push(`      errors.push({ path: "content", message: "content must be at most ${action.max} character(s)" });`);
        lines.push('    }');
        break;
      case 'check_content_pattern':
        lines.push(`    if (!new RegExp(${JSON.stringify(action.regex)}).test(content)) {`);
        lines.push(`      errors.push({ path: "content", message: "content must match pattern " + ${JSON.stringify(action.regex)} });`);
        lines.push('    }');
        break;
      case 'check_content_enum': {
        const vals = action.values.map(v => JSON.stringify(v)).join(', ');
        const valsMsg = action.values.map(v => JSON.stringify(v)).join(', ');
        lines.push(`    if (![${vals}].includes(content)) {`);
        lines.push(`      errors.push({ path: "content", message: "content must be one of: " + ${JSON.stringify(valsMsg)} });`);
        lines.push('    }');
        break;
      }
    }
  }
  return lines;
}

/**
 * Emit the validateEvent dispatch function.
 * Validates content constraints and delegates tag validation to per-kind validators.
 */
function emitEventDispatch(
  constrainedKinds: KindShape[],
  contentPlans: Map<number, ContentAction[]>,
): string {
  const sorted = [...constrainedKinds].sort((a, b) => a.kindNumber - b.kindNumber);
  const contentKinds = [...contentPlans.entries()].sort((a, b) => a[0] - b[0]);

  const lines: string[] = [];
  lines.push('/** Validate an event\'s content constraints and tag structure. */');
  lines.push('export function validateEvent(event: Record<string, unknown>): ValidationError[] {');
  lines.push('  if (event == null || typeof event !== "object") {');
  lines.push('    return [{ path: "event", message: "event must be a non-null object" }];');
  lines.push('  }');
  lines.push('  const errors: ValidationError[] = [];');
  lines.push('  const kind = event.kind;');
  lines.push('  if (typeof kind !== "number") {');
  lines.push('    errors.push({ path: "kind", message: "kind must be a number" });');
  lines.push('    return errors;');
  lines.push('  }');

  // Content validation
  if (contentKinds.length > 0) {
    lines.push('  if (typeof event.content === "string") {');
    lines.push('    const content = event.content;');
    lines.push('    switch (kind) {');
    for (const [kindNumber, actions] of contentKinds) {
      lines.push(`      case ${kindNumber}: {`);
      lines.push(...renderContentActions(actions));
      lines.push('        break;');
      lines.push('      }');
    }
    lines.push('    }');
    lines.push('  } else if (event.content !== undefined && typeof event.content !== "string") {');
    lines.push('    errors.push({ path: "content", message: "content must be a string" });');
    lines.push('  }');
  }

  // Tag dispatch — validate tag element types, then dispatch
  if (sorted.length > 0) {
    lines.push('  if (Array.isArray(event.tags)) {');
    lines.push('    const tags: string[][] = [];');
    lines.push('    for (let i = 0; i < event.tags.length; i++) {');
    lines.push('      const t = event.tags[i];');
    lines.push('      if (!Array.isArray(t) || !t.every(v => typeof v === "string")) {');
    lines.push('        errors.push({ path: `tags[${i}]`, message: `tags[${i}] must be an array of strings` });');
    lines.push('      } else {');
    lines.push('        tags.push(t as string[]);');
    lines.push('      }');
    lines.push('    }');
    lines.push('    errors.push(...validateKindTags(kind, tags));');
    lines.push('  } else if (event.tags !== undefined && !Array.isArray(event.tags)) {');
    lines.push('    errors.push({ path: "tags", message: "tags must be an array" });');
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

  // Kind-level validators (now via plan layer)
  const kindValidators: string[] = [];
  const constrainedKinds: KindShape[] = [];
  for (const shape of [...kindShapes].sort((a, b) => a.kindNumber - b.kindNumber)) {
    const actions = planKindValidator(shape);
    if (actions) {
      kindValidators.push(emitKindValidatorFromActions(shape.kindNumber, shape.nip, actions));
      constrainedKinds.push(shape);
    }
  }

  if (kindValidators.length > 0) {
    parts.push('\n// === Kind-level validators ===\n');
    parts.push(kindValidators.join('\n\n'));
    parts.push('');
  }

  // Build content plans
  const contentPlans = new Map<number, ContentAction[]>();
  for (const shape of kindShapes) {
    const contentActions = planContentChecks(shape);
    if (contentActions) {
      contentPlans.set(shape.kindNumber, contentActions);
    }
  }

  // Dispatch function
  if (constrainedKinds.length > 0) {
    parts.push('\n// === Dispatch ===\n');
    parts.push(emitDispatch(constrainedKinds));
    parts.push('');
  }

  // Event dispatch (content + tag validation)
  if (constrainedKinds.length > 0 || contentPlans.size > 0) {
    parts.push('\n// === Event validation ===\n');
    parts.push(emitEventDispatch(constrainedKinds, contentPlans));
    parts.push('');
  }

  return parts.join('\n');
}

// --- Helpers ---

function pascalCase(s: string): string {
  return s.replace(/(^|[-_])(\w)/g, (_, __, c) => c.toUpperCase());
}
