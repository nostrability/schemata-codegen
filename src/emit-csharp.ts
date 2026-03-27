/**
 * C# validator emitter: ValidatorAction[] → .cs file
 *
 * Generates C# code using expression-oriented LINQ patterns.
 * Tags are IReadOnlyList<IReadOnlyList<string>>.
 *
 * Tag search uses `.Any(t => ...)` for existence checks.
 * Pattern helpers use hand-coded C# (no regex dependency for the
 * majority of patterns). Regex.IsMatch is used only when needed.
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

function renderPatternCheckCSharp(check: PatternCheck, varExpr: string): { expr: string; helpers: Set<string> } {
  const helpers = new Set<string>();
  switch (check.op) {
    case 'hex': {
      const fn = check.case === 'lower' ? `CheckHex${check.len}` : `CheckHex${check.len}Mixed`;
      helpers.add(fn);
      return { expr: `${fn}(${varExpr})`, helpers };
    }
    case 'hex_range': {
      const fn = check.case === 'lower' ? 'CheckHexRange' : 'CheckHexRangeMixed';
      helpers.add(fn);
      return { expr: `${fn}(${varExpr}, ${check.min}, ${check.max})`, helpers };
    }
    case 'hex_prefixed': {
      helpers.add('CheckHexPrefixed');
      return { expr: `CheckHexPrefixed(${varExpr}, ${JSON.stringify(check.prefix)}, ${check.hexLen})`, helpers };
    }
    case 'all_digits': {
      const fn = check.allowNeg ? 'CheckSignedInt' : 'CheckDigits';
      helpers.add(fn);
      return { expr: `${fn}(${varExpr})`, helpers };
    }
    case 'starts_with_any': {
      const checks = check.prefixes.map(p => `${varExpr}.StartsWith(${JSON.stringify(p)}, StringComparison.Ordinal)`);
      return { expr: checks.length === 1 ? checks[0] : `(${checks.join(' || ')})`, helpers };
    }
    case 'chars_in': {
      if (check.min === 0 && check.max === 0) {
        return { expr: `${varExpr}.Length == 0`, helpers };
      }
      helpers.add('CheckCharsIn');
      const max = check.max ?? 'int.MaxValue';
      return {
        expr: `CheckCharsIn(${varExpr}, ${JSON.stringify(check.charset)}, ${check.min ?? 0}, ${max})`,
        helpers,
      };
    }
    case 'regex': {
      helpers.add('regex');
      return { expr: `Regex.IsMatch(${varExpr}, ${JSON.stringify(check.pattern)})`, helpers };
    }
    case 'compound': {
      const allHelpers = new Set<string>();
      const parts: string[] = [];
      for (const sub of check.checks) {
        const r = renderPatternCheckCSharp(sub, varExpr);
        parts.push(r.expr);
        for (const h of r.helpers) allHelpers.add(h);
      }
      return { expr: `(${parts.join(' && ')})`, helpers: allHelpers };
    }
  }
}

function renderValueCheckCSharp(
  check: ValueCheck,
  tagVar: string,
  index: number,
): { expr: string; helpers: Set<string> } {
  const helpers = new Set<string>();
  const countCheck = `${tagVar}.Count > ${index}`;
  const access = `${tagVar}[${index}]`;

  switch (check.type) {
    case 'const':
      return { expr: `${countCheck} && ${access} == ${JSON.stringify(check.value)}`, helpers };
    case 'enum': {
      const vals = check.values.map(v => `${access} == ${JSON.stringify(v)}`);
      return {
        expr: `${countCheck} && (${vals.join(' || ')})`,
        helpers,
      };
    }
    case 'pattern': {
      const r = renderPatternCheckCSharp(check.native, access);
      for (const h of r.helpers) helpers.add(h);
      return {
        expr: `${countCheck} && ${r.expr}`,
        helpers,
      };
    }
    case 'anyOf': {
      const parts: string[] = [];
      for (const alt of check.alternatives) {
        const r = renderValueCheckCSharp(alt, tagVar, index);
        parts.push(r.expr);
        for (const h of r.helpers) helpers.add(h);
      }
      return { expr: `(${parts.join(' || ')})`, helpers };
    }
  }
}

function describePositionConstraintCSharp(pc: PositionCheck, tagName: string): string {
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

function renderTagMatcherCSharp(
  matcher: TagMatcher,
  tagVar: string,
  helpers: Set<string>,
): string {
  const checks: string[] = [];

  checks.push(`${tagVar}.Count > 0 && ${tagVar}[0] == ${JSON.stringify(matcher.tagName)}`);
  checks.push(`${tagVar}.Count >= ${matcher.minItems}`);
  if (matcher.maxItems !== undefined) {
    checks.push(`${tagVar}.Count <= ${matcher.maxItems}`);
  }

  for (const pc of matcher.positionChecks) {
    const r = renderValueCheckCSharp(pc.check, tagVar, pc.index);
    for (const h of r.helpers) helpers.add(h);
    checks.push(r.expr);
  }

  return checks.join(' && ');
}

// --- Main emitter ---

export function emitCSharpValidators(kindShapes: KindShape[]): string {
  const allHelpers = new Set<string>();
  const fnBodies: string[] = [];
  const constrainedKinds: { kindNumber: number; nip: string }[] = [];

  for (const shape of [...kindShapes].sort((a, b) => a.kindNumber - b.kindNumber)) {
    const actions = planKindValidator(shape);
    if (!actions) continue;

    constrainedKinds.push({ kindNumber: shape.kindNumber, nip: shape.nip });
    const { code, helpers } = emitKindFunctionCSharp(shape.kindNumber, shape.nip, actions);
    fnBodies.push(code);
    for (const h of helpers) allHelpers.add(h);
  }

  return emitCSharpFile(fnBodies, constrainedKinds, allHelpers);
}

function emitKindFunctionCSharp(
  kindNumber: number,
  nip: string,
  actions: ValidatorAction[],
): { code: string; helpers: Set<string> } {
  const helpers = new Set<string>();
  const lines: string[] = [];

  lines.push(`        /// <summary>Validate tags for kind ${kindNumber} (${nip})</summary>`);
  lines.push(`        public static List<ValidationError> ValidateKind${kindNumber}(IReadOnlyList<IReadOnlyList<string>> tags)`);
  lines.push('        {');
  lines.push('            var errors = new List<ValidationError>();');

  for (const action of actions) {
    switch (action.type) {
      case 'check_min_tags':
        lines.push(`            if (tags.Count < ${action.min})`);
        lines.push(`                errors.Add(new ValidationError("tags", "tags must have at least ${action.min} item(s)"));`);
        break;

      case 'require_tag': {
        const matcherExpr = renderTagMatcherCSharp(action.matcher, 't', helpers);
        lines.push(`            if (!tags.Any(t => ${matcherExpr}))`);
        lines.push(`                errors.Add(new ValidationError("tags", ${JSON.stringify(action.errorMsg)}));`);
        break;
      }

      case 'validate_optional_positions': {
        lines.push('            foreach (var t in tags)');
        lines.push('            {');
        lines.push(`                if (t.Count > 0 && t[0] == ${JSON.stringify(action.tagName)})`);
        lines.push('                {');
        for (const pc of action.checks) {
          const r = renderValueCheckCSharp(pc.check, 't', pc.index);
          for (const h of r.helpers) helpers.add(h);
          const msg = describePositionConstraintCSharp(pc, action.tagName);
          lines.push(`                    if (t.Count > ${pc.index} && !(${r.expr}))`);
          lines.push(`                        errors.Add(new ValidationError("tags", ${JSON.stringify(msg)}));`);
        }
        lines.push('                }');
        lines.push('            }');
        break;
      }

      case 'per_item_conditional': {
        const matcherExpr = renderTagMatcherCSharp(action.matcher, 't', helpers);
        lines.push('            foreach (var t in tags)');
        lines.push('            {');
        lines.push(`                if (t.Count > 0 && t[0] == ${JSON.stringify(action.condTag)} && !(${matcherExpr}))`);
        lines.push(`                    errors.Add(new ValidationError("tags", ${JSON.stringify(action.errorMsg)}));`);
        if (action.optChecks.length > 0) {
          lines.push(`                if (t.Count > 0 && t[0] == ${JSON.stringify(action.condTag)})`);
          lines.push('                {');
          for (const pc of action.optChecks) {
            const r = renderValueCheckCSharp(pc.check, 't', pc.index);
            for (const h of r.helpers) helpers.add(h);
            const msg = describePositionConstraintCSharp(pc, action.condTag);
            lines.push(`                    if (t.Count > ${pc.index} && !(${r.expr}))`);
            lines.push(`                        errors.Add(new ValidationError("tags", ${JSON.stringify(msg)}));`);
          }
          lines.push('                }');
        }
        lines.push('            }');
        break;
      }

      case 'array_level_conditional': {
        lines.push(`            if (tags.Any(t => t.Count > 0 && t[0] == ${JSON.stringify(action.condTag)}))`);
        lines.push('            {');
        const matcherExpr = renderTagMatcherCSharp(action.matcher, 't', helpers);
        lines.push(`                if (!tags.Any(t => ${matcherExpr}))`);
        lines.push(`                    errors.Add(new ValidationError("tags", ${JSON.stringify(action.errorMsg)}));`);
        if (action.optChecks.length > 0) {
          lines.push('                foreach (var t in tags)');
          lines.push('                {');
          lines.push(`                    if (t.Count > 0 && t[0] == ${JSON.stringify(action.matcher.tagName)})`);
          lines.push('                    {');
          for (const pc of action.optChecks) {
            const r = renderValueCheckCSharp(pc.check, 't', pc.index);
            for (const h of r.helpers) helpers.add(h);
            const msg = describePositionConstraintCSharp(pc, action.matcher.tagName);
            lines.push(`                        if (t.Count > ${pc.index} && !(${r.expr}))`);
            lines.push(`                            errors.Add(new ValidationError("tags", ${JSON.stringify(msg)}));`);
          }
          lines.push('                    }');
          lines.push('                }');
        }
        lines.push('            }');
        break;
      }

      case 'any_of_group': {
        const matchers = action.matchers.map(m => {
          const expr = renderTagMatcherCSharp(m, 't', helpers);
          return `tags.Any(t => ${expr})`;
        });
        lines.push(`            if (!(${matchers.join(' || ')}))`);
        lines.push(`                errors.Add(new ValidationError("tags", ${JSON.stringify(action.errorMsg)}));`);
        break;
      }
    }
  }

  lines.push('            return errors;');
  lines.push('        }');

  return { code: lines.join('\n'), helpers };
}

// --- File generation ---

function emitCSharpFile(
  fnBodies: string[],
  constrainedKinds: { kindNumber: number; nip: string }[],
  helpers: Set<string>,
): string {
  const needsRegex = helpers.has('regex');

  const lines: string[] = [
    '// Auto-generated by @nostrability/schemata-codegen',
    '// Do not edit manually.',
    '//',
    '// Runtime validators for Nostr event tag constraints',
    '',
    'using System.Collections.Generic;',
    'using System.Linq;',
  ];

  if (needsRegex) {
    lines.push('using System.Text.RegularExpressions;');
  }

  lines.push('');
  lines.push('namespace Schemata');
  lines.push('{');
  lines.push('    public record ValidationError(string Path, string Message);');
  lines.push('');
  lines.push('    public static class SchemataValidators');
  lines.push('    {');

  // Helpers
  const helperCode = emitCSharpHelpers(helpers);
  if (helperCode) {
    lines.push(helperCode);
  }

  // Per-kind functions
  for (const fn of fnBodies) {
    lines.push(fn);
    lines.push('');
  }

  // Dispatch
  lines.push('        /// <summary>Validate tags for a given kind number.</summary>');
  lines.push('        /// <remarks>Returns empty list if kind has no constraints or is unknown.</remarks>');
  lines.push('        public static List<ValidationError> ValidateKindTags(int kind, IReadOnlyList<IReadOnlyList<string>> tags)');
  lines.push('        {');
  lines.push('            return kind switch');
  lines.push('            {');
  for (const k of constrainedKinds) {
    lines.push(`                ${k.kindNumber} => ValidateKind${k.kindNumber}(tags),`);
  }
  lines.push('                _ => new List<ValidationError>(),');
  lines.push('            };');
  lines.push('        }');

  lines.push('    }');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

function emitCSharpHelpers(helpers: Set<string>): string {
  const lines: string[] = [];

  // Collect hex lengths
  const hexLengths = new Set<number>();
  const hexMixedLengths = new Set<number>();
  for (const h of helpers) {
    const m = h.match(/^CheckHex(\d+)$/);
    if (m) hexLengths.add(parseInt(m[1], 10));
    const mm = h.match(/^CheckHex(\d+)Mixed$/);
    if (mm) hexMixedLengths.add(parseInt(mm[1], 10));
  }

  for (const len of [...hexLengths].sort((a, b) => a - b)) {
    lines.push(`        private static bool CheckHex${len}(string s)`);
    lines.push(`            => s != null && s.Length == ${len} && s.All(c => (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'));`);
    lines.push('');
  }

  for (const len of [...hexMixedLengths].sort((a, b) => a - b)) {
    lines.push(`        private static bool CheckHex${len}Mixed(string s)`);
    lines.push(`            => s != null && s.Length == ${len} && s.All(c => (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'));`);
    lines.push('');
  }

  if (helpers.has('CheckHexRange')) {
    lines.push('        private static bool CheckHexRange(string s, int min, int max)');
    lines.push("            => s != null && s.Length >= min && s.Length <= max && s.All(c => (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'));");
    lines.push('');
  }

  if (helpers.has('CheckHexRangeMixed')) {
    lines.push('        private static bool CheckHexRangeMixed(string s, int min, int max)');
    lines.push("            => s != null && s.Length >= min && s.Length <= max && s.All(c => (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'));");
    lines.push('');
  }

  if (helpers.has('CheckHexPrefixed')) {
    lines.push('        private static bool CheckHexPrefixed(string s, string prefix, int hexLen)');
    lines.push("            => s != null && s.StartsWith(prefix, StringComparison.Ordinal) && s.Length == prefix.Length + hexLen && s.Substring(prefix.Length).All(c => (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'));");
    lines.push('');
  }

  if (helpers.has('CheckDigits')) {
    lines.push('        private static bool CheckDigits(string s)');
    lines.push("            => s != null && s.Length > 0 && s.All(c => c >= '0' && c <= '9');");
    lines.push('');
  }

  if (helpers.has('CheckSignedInt')) {
    lines.push('        private static bool CheckSignedInt(string s)');
    lines.push('        {');
    lines.push('            if (s == null || s.Length == 0) return false;');
    lines.push("            var digits = s.StartsWith(\"-\", StringComparison.Ordinal) ? s.Substring(1) : s;");
    lines.push("            return digits.Length > 0 && digits.All(c => c >= '0' && c <= '9');");
    lines.push('        }');
    lines.push('');
  }

  if (helpers.has('CheckCharsIn')) {
    lines.push('        private static bool CheckCharsIn(string s, string charset, int min, int max)');
    lines.push('            => s != null && s.Length >= min && s.Length <= max && s.All(c => charset.Contains(c));');
    lines.push('');
  }

  return lines.join('\n');
}
