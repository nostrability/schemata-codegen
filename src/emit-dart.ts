/**
 * Dart validator emitter: ValidatorAction[] → .dart file
 *
 * Generates Dart code for validating Nostr event tags.
 * Tags are List<List<String>>, individual tags are List<String>.
 *
 * Dart is expression-oriented: uses `.any((t) => ...)` for search,
 * single-quoted strings, `final` for local variables.
 */

import type { KindShape } from './kind-types.js';
import {
  planKindValidator,
  type ValidatorAction,
  type TagMatcher,
  type ValueCheck,
  type PositionCheck,
} from './plan-validators.js';
import { type PatternCheck } from './classify-pattern.js';

// --- Pattern check helpers ---

function renderPatternCheckDart(check: PatternCheck, varExpr: string): { expr: string; helpers: Set<string> } {
  const helpers = new Set<string>();
  switch (check.op) {
    case 'hex': {
      const fn = check.case === 'lower' ? `_checkHex${check.len}` : `_checkHex${check.len}Mixed`;
      helpers.add(fn);
      return { expr: `${fn}(${varExpr})`, helpers };
    }
    case 'hex_range': {
      const fn = check.case === 'lower' ? '_checkHexRange' : '_checkHexRangeMixed';
      helpers.add(fn);
      return { expr: `${fn}(${varExpr}, ${check.min}, ${check.max})`, helpers };
    }
    case 'hex_prefixed': {
      helpers.add('_checkHexPrefixed');
      return { expr: `_checkHexPrefixed(${varExpr}, ${dartString(check.prefix)}, ${check.hexLen})`, helpers };
    }
    case 'all_digits': {
      const fn = check.allowNeg ? '_checkSignedInt' : '_checkDigits';
      helpers.add(fn);
      return { expr: `${fn}(${varExpr})`, helpers };
    }
    case 'starts_with_any': {
      const checks = check.prefixes.map(p => `${varExpr}.startsWith(${dartString(p)})`);
      return { expr: checks.length === 1 ? checks[0] : `(${checks.join(' || ')})`, helpers };
    }
    case 'chars_in': {
      if (check.min === 0 && check.max === 0) {
        return { expr: `${varExpr}.isEmpty`, helpers };
      }
      helpers.add('_checkCharsIn');
      return {
        expr: `_checkCharsIn(${varExpr}, ${dartString(check.charset)}, ${check.min ?? 0}, ${check.max ?? (1 << 30)})`,
        helpers,
      };
    }
    case 'regex': {
      return { expr: `RegExp(${dartString(check.pattern)}).hasMatch(${varExpr})`, helpers };
    }
    case 'compound': {
      const allHelpers = new Set<string>();
      const parts: string[] = [];
      for (const sub of check.checks) {
        const r = renderPatternCheckDart(sub, varExpr);
        parts.push(r.expr);
        for (const h of r.helpers) allHelpers.add(h);
      }
      return { expr: `(${parts.join(' && ')})`, helpers: allHelpers };
    }
  }
}

// --- Value check rendering ---

function renderValueCheckDart(
  check: ValueCheck,
  tagVar: string,
  index: number,
): { expr: string; helpers: Set<string> } {
  const helpers = new Set<string>();

  switch (check.type) {
    case 'const':
      return { expr: `${tagVar}.length > ${index} && ${tagVar}[${index}] == ${dartString(check.value)}`, helpers };
    case 'enum': {
      const vals = check.values.map(v => dartString(v));
      return {
        expr: `${tagVar}.length > ${index} && [${vals.join(', ')}].contains(${tagVar}[${index}])`,
        helpers,
      };
    }
    case 'pattern': {
      const r = renderPatternCheckDart(check.native, 'v');
      for (const h of r.helpers) helpers.add(h);
      return {
        expr: `${tagVar}.length > ${index} && (() { final v = ${tagVar}[${index}]; return ${r.expr}; }())`,
        helpers,
      };
    }
    case 'anyOf': {
      const parts: string[] = [];
      for (const alt of check.alternatives) {
        const r = renderValueCheckDart(alt, tagVar, index);
        parts.push(r.expr);
        for (const h of r.helpers) helpers.add(h);
      }
      return { expr: `(${parts.join(' || ')})`, helpers };
    }
  }
}

function describePositionConstraintDart(pc: PositionCheck, tagName: string): string {
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

// --- Tag matcher rendering ---

function renderTagMatcherDart(
  matcher: TagMatcher,
  tagVar: string,
  helpers: Set<string>,
): string {
  const checks: string[] = [];

  checks.push(`${tagVar}.isNotEmpty && ${tagVar}[0] == ${dartString(matcher.tagName)}`);
  checks.push(`${tagVar}.length >= ${matcher.minItems}`);
  if (matcher.maxItems !== undefined) {
    checks.push(`${tagVar}.length <= ${matcher.maxItems}`);
  }

  for (const pc of matcher.positionChecks) {
    const r = renderValueCheckDart(pc.check, tagVar, pc.index);
    for (const h of r.helpers) helpers.add(h);
    checks.push(r.expr);
  }

  return checks.join(' && ');
}

// --- Dart string helper ---

function dartString(s: string): string {
  const escaped = s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\$/g, '\\$')
    .replace(/\n/g, '\\n');
  return `'${escaped}'`;
}

// --- Main emitter ---

export function emitDartValidators(kindShapes: KindShape[]): string {
  const allHelpers = new Set<string>();
  const fnBodies: string[] = [];
  const constrainedKinds: { kindNumber: number; nip: string }[] = [];

  for (const shape of [...kindShapes].sort((a, b) => a.kindNumber - b.kindNumber)) {
    const actions = planKindValidator(shape);
    if (!actions) continue;

    constrainedKinds.push({ kindNumber: shape.kindNumber, nip: shape.nip });
    const { code, helpers } = emitKindFunctionDart(shape.kindNumber, shape.nip, actions);
    fnBodies.push(code);
    for (const h of helpers) allHelpers.add(h);
  }

  return emitDartFile(fnBodies, constrainedKinds, allHelpers);
}

function emitKindFunctionDart(
  kindNumber: number,
  nip: string,
  actions: ValidatorAction[],
): { code: string; helpers: Set<string> } {
  const helpers = new Set<string>();
  const lines: string[] = [];

  lines.push(`/// Validate tags for kind ${kindNumber} (${nip})`);
  lines.push(`List<ValidationError> validateKind${kindNumber}(List<List<String>> tags) {`);
  lines.push('  final errors = <ValidationError>[];');

  for (const action of actions) {
    switch (action.type) {
      case 'check_min_tags':
        lines.push(`  if (tags.length < ${action.min}) {`);
        lines.push(`    errors.add(ValidationError(path: 'tags', message: 'tags must have at least ${action.min} item(s)'));`);
        lines.push('  }');
        break;

      case 'require_tag': {
        const matcherExpr = renderTagMatcherDart(action.matcher, 't', helpers);
        lines.push(`  if (!tags.any((t) => ${matcherExpr})) {`);
        lines.push(`    errors.add(ValidationError(path: 'tags', message: ${dartString(action.errorMsg)}));`);
        lines.push('  }');
        break;
      }

      case 'validate_optional_positions': {
        lines.push('  for (final t in tags) {');
        lines.push(`    if (t.isNotEmpty && t[0] == ${dartString(action.tagName)}) {`);
        for (const pc of action.checks) {
          const r = renderValueCheckDart(pc.check, 't', pc.index);
          for (const h of r.helpers) helpers.add(h);
          const msg = describePositionConstraintDart(pc, action.tagName);
          lines.push(`      if (t.length > ${pc.index} && !(${r.expr})) {`);
          lines.push(`        errors.add(ValidationError(path: 'tags', message: ${dartString(msg)}));`);
          lines.push('      }');
        }
        lines.push('    }');
        lines.push('  }');
        break;
      }

      case 'per_item_conditional': {
        const matcherExpr = renderTagMatcherDart(action.matcher, 't', helpers);
        lines.push('  for (final t in tags) {');
        lines.push(`    if (t.isNotEmpty && t[0] == ${dartString(action.condTag)} && !(${matcherExpr})) {`);
        lines.push(`      errors.add(ValidationError(path: 'tags', message: ${dartString(action.errorMsg)}));`);
        lines.push('    }');
        if (action.optChecks.length > 0) {
          lines.push(`    if (t.isNotEmpty && t[0] == ${dartString(action.condTag)}) {`);
          for (const pc of action.optChecks) {
            const r = renderValueCheckDart(pc.check, 't', pc.index);
            for (const h of r.helpers) helpers.add(h);
            const msg = describePositionConstraintDart(pc, action.condTag);
            lines.push(`      if (t.length > ${pc.index} && !(${r.expr})) {`);
            lines.push(`        errors.add(ValidationError(path: 'tags', message: ${dartString(msg)}));`);
            lines.push('      }');
          }
          lines.push('    }');
        }
        lines.push('  }');
        break;
      }

      case 'array_level_conditional': {
        lines.push(`  if (tags.any((t) => t.isNotEmpty && t[0] == ${dartString(action.condTag)})) {`);
        const matcherExpr = renderTagMatcherDart(action.matcher, 't', helpers);
        lines.push(`    if (!tags.any((t) => ${matcherExpr})) {`);
        lines.push(`      errors.add(ValidationError(path: 'tags', message: ${dartString(action.errorMsg)}));`);
        lines.push('    }');
        if (action.optChecks.length > 0) {
          lines.push('    for (final t in tags) {');
          lines.push(`      if (t.isNotEmpty && t[0] == ${dartString(action.matcher.tagName)}) {`);
          for (const pc of action.optChecks) {
            const r = renderValueCheckDart(pc.check, 't', pc.index);
            for (const h of r.helpers) helpers.add(h);
            const msg = describePositionConstraintDart(pc, action.matcher.tagName);
            lines.push(`        if (t.length > ${pc.index} && !(${r.expr})) {`);
            lines.push(`          errors.add(ValidationError(path: 'tags', message: ${dartString(msg)}));`);
            lines.push('        }');
          }
          lines.push('      }');
          lines.push('    }');
        }
        lines.push('  }');
        break;
      }

      case 'any_of_group': {
        const matchers = action.matchers.map(m => {
          const expr = renderTagMatcherDart(m, 't', helpers);
          return `tags.any((t) => ${expr})`;
        });
        lines.push(`  if (!(${matchers.join(' || ')})) {`);
        lines.push(`    errors.add(ValidationError(path: 'tags', message: ${dartString(action.errorMsg)}));`);
        lines.push('  }');
        break;
      }
    }
  }

  lines.push('  return errors;');
  lines.push('}');

  return { code: lines.join('\n'), helpers };
}

// --- File generation ---

function emitDartFile(
  fnBodies: string[],
  constrainedKinds: { kindNumber: number; nip: string }[],
  helpers: Set<string>,
): string {
  const lines: string[] = [
    '// Auto-generated by @nostrability/schemata-codegen',
    '// Do not edit manually.',
    '//',
    '// Runtime validators for Nostr event tag constraints',
    '',
    'class ValidationError {',
    '  final String path;',
    '  final String message;',
    '  const ValidationError({required this.path, required this.message});',
    '}',
    '',
  ];

  lines.push(emitDartHelpers(helpers));

  for (const fn of fnBodies) {
    lines.push(fn);
    lines.push('');
  }

  lines.push('/// Validate tags for a given kind number.');
  lines.push('/// Returns empty list if kind has no constraints or is unknown.');
  lines.push('List<ValidationError> validateKindTags(int kind, List<List<String>> tags) {');
  lines.push('  switch (kind) {');
  for (const k of constrainedKinds) {
    lines.push(`    case ${k.kindNumber}: return validateKind${k.kindNumber}(tags);`);
  }
  lines.push('    default: return [];');
  lines.push('  }');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

function emitDartHelpers(helpers: Set<string>): string {
  const lines: string[] = [];

  const hexLengths = new Set<number>();
  const hexMixedLengths = new Set<number>();
  for (const h of helpers) {
    const m = h.match(/^_checkHex(\d+)$/);
    if (m) hexLengths.add(parseInt(m[1], 10));
    const mm = h.match(/^_checkHex(\d+)Mixed$/);
    if (mm) hexMixedLengths.add(parseInt(mm[1], 10));
  }

  for (const len of [...hexLengths].sort((a, b) => a - b)) {
    lines.push(`bool _checkHex${len}(String s) {`);
    lines.push(`  return s.length == ${len} && s.codeUnits.every((c) => (c >= 48 && c <= 57) || (c >= 97 && c <= 102));`);
    lines.push('}');
    lines.push('');
  }

  for (const len of [...hexMixedLengths].sort((a, b) => a - b)) {
    lines.push(`bool _checkHex${len}Mixed(String s) {`);
    lines.push(`  return s.length == ${len} && s.codeUnits.every((c) => (c >= 48 && c <= 57) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70));`);
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkHexRange')) {
    lines.push('bool _checkHexRange(String s, int min, int max) {');
    lines.push('  final len = s.length;');
    lines.push('  return len >= min && len <= max && s.codeUnits.every((c) => (c >= 48 && c <= 57) || (c >= 97 && c <= 102));');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkHexRangeMixed')) {
    lines.push('bool _checkHexRangeMixed(String s, int min, int max) {');
    lines.push('  final len = s.length;');
    lines.push('  return len >= min && len <= max && s.codeUnits.every((c) => (c >= 48 && c <= 57) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70));');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkHexPrefixed')) {
    lines.push('bool _checkHexPrefixed(String s, String prefix, int hexLen) {');
    lines.push('  if (!s.startsWith(prefix)) return false;');
    lines.push('  final hex = s.substring(prefix.length);');
    lines.push('  return hex.length == hexLen && hex.codeUnits.every((c) => (c >= 48 && c <= 57) || (c >= 97 && c <= 102));');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkDigits')) {
    lines.push('bool _checkDigits(String s) {');
    lines.push('  return s.isNotEmpty && s.codeUnits.every((c) => c >= 48 && c <= 57);');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkSignedInt')) {
    lines.push('bool _checkSignedInt(String s) {');
    lines.push("  final v = s.startsWith('-') ? s.substring(1) : s;");
    lines.push('  return v.isNotEmpty && v.codeUnits.every((c) => c >= 48 && c <= 57);');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkCharsIn')) {
    lines.push('bool _checkCharsIn(String s, String charset, int min, int max) {');
    lines.push('  final len = s.length;');
    lines.push('  return len >= min && len <= max && s.runes.every((r) => charset.contains(String.fromCharCode(r)));');
    lines.push('}');
    lines.push('');
  }

  return lines.join('\n');
}
