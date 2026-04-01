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
    case 'bech32': {
      helpers.add('CheckBech32');
      if (check.dataLen !== undefined) {
        return { expr: `CheckBech32(${varExpr}, ${JSON.stringify(check.hrp + '1')}, ${check.dataLen})`, helpers };
      }
      return { expr: `CheckBech32(${varExpr}, ${JSON.stringify(check.hrp + '1')})`, helpers };
    }
    case 'regex': {
      helpers.add('regex');
      return { expr: `Regex.IsMatch(${varExpr}, ${JSON.stringify(check.pattern)})`, helpers };
    }
    case 'relay_url': {
      helpers.add('CheckRelayUrl');
      return { expr: `CheckRelayUrl(${varExpr})`, helpers };
    }
    case 'a_tag': {
      helpers.add('CheckATag');
      if (check.kinds && check.kinds.length > 0) {
        const arr = check.kinds.map(k => JSON.stringify(k)).join(', ');
        return { expr: `CheckATag(${varExpr}, new string[]{${arr}})`, helpers };
      }
      return { expr: `CheckATag(${varExpr}, System.Array.Empty<string>())`, helpers };
    }
    case 'date_iso': {
      helpers.add('CheckDateIso');
      return { expr: `CheckDateIso(${varExpr})`, helpers };
    }
    case 'datetime_iso': {
      helpers.add('CheckDatetimeIso');
      return { expr: `CheckDatetimeIso(${varExpr})`, helpers };
    }
    case 'decimal': {
      helpers.add('CheckDecimal');
      return { expr: `CheckDecimal(${varExpr})`, helpers };
    }
    case 'exact_values': {
      const checks = check.values.map(v => `${varExpr} == ${JSON.stringify(v)}`);
      return { expr: checks.length === 1 ? checks[0] : `(${checks.join(' || ')})`, helpers };
    }
    case 'prefix_nonempty': {
      helpers.add('CheckDotTail');
      return {
        expr: `${varExpr} != null && ${varExpr}.StartsWith(${JSON.stringify(check.prefix)}, StringComparison.Ordinal) && CheckDotTail(${varExpr}, ${check.prefix.length})`,
        helpers,
      };
    }
    case 'wrapped': {
      helpers.add('CheckWrapped');
      return { expr: `CheckWrapped(${varExpr}, ${JSON.stringify(check.prefix)}, ${JSON.stringify(check.suffix)})`, helpers };
    }
    case 'csv_list': {
      helpers.add('CheckCsvList');
      return { expr: `CheckCsvList(${varExpr}, ${JSON.stringify(check.itemCharset)})`, helpers };
    }
    case 'ln_invoice': {
      helpers.add('CheckLnInvoice');
      helpers.add('IsBech32Char');
      return { expr: `CheckLnInvoice(${varExpr}, ${JSON.stringify(check.prefix)}, ${check.minHrpLen})`, helpers };
    }
    case 'mime_type': {
      helpers.add('CheckMimeType');
      return { expr: `CheckMimeType(${varExpr})`, helpers };
    }
    case 'http_origin': {
      helpers.add('CheckHttpOrigin');
      return { expr: `CheckHttpOrigin(${varExpr})`, helpers };
    }
    case 'email_like': {
      helpers.add('CheckEmailLike');
      helpers.add('IsEcmaWs');
      return { expr: `CheckEmailLike(${varExpr})`, helpers };
    }
    case 'git_clone_url': {
      helpers.add('CheckGitCloneUrl');
      helpers.add('IsEcmaWs');
      return { expr: `CheckGitCloneUrl(${varExpr})`, helpers };
    }
    case 'content_type': {
      helpers.add('CheckContentType');
      helpers.add('IsEcmaWs');
      return { expr: `CheckContentType(${varExpr})`, helpers };
    }
    case 'doi': {
      helpers.add('CheckDoi');
      helpers.add('CheckDotTail');
      return { expr: `CheckDoi(${varExpr})`, helpers };
    }
    case 'annotate_user': {
      helpers.add('CheckAnnotateUser');
      return { expr: `CheckAnnotateUser(${varExpr})`, helpers };
    }
    case 'prefix_no_whitespace': {
      helpers.add('CheckNoWsTail');
      helpers.add('IsEcmaWs');
      const checks = check.prefixes.map(p =>
        `(${varExpr} != null && ${varExpr}.StartsWith(${JSON.stringify(p)}, StringComparison.Ordinal) && CheckNoWsTail(${varExpr}, ${p.length}))`
      );
      return { expr: checks.length === 1 ? checks[0] : `(${checks.join(' || ')})`, helpers };
    }
    case 'external_identity': {
      helpers.add('CheckExternalIdentity');
      return { expr: `CheckExternalIdentity(${varExpr})`, helpers };
    }
    case 'package_id': {
      helpers.add('CheckPackageId');
      return { expr: `CheckPackageId(${varExpr})`, helpers };
    }
    case 'imeta_dim': {
      helpers.add('CheckImetaDim');
      return { expr: `CheckImetaDim(${varExpr})`, helpers };
    }
    case 'dim': {
      helpers.add('CheckDim');
      return { expr: `CheckDim(${varExpr})`, helpers };
    }
    case 'no_uppercase': {
      helpers.add('CheckNoUppercase');
      return { expr: `CheckNoUppercase(${varExpr})`, helpers };
    }
    case 'dotted_digits': {
      helpers.add('CheckDottedDigits');
      return { expr: `CheckDottedDigits(${varExpr})`, helpers };
    }
    case 'slash_segments': {
      helpers.add('CheckSlashSegments');
      return { expr: `CheckSlashSegments(${varExpr}, ${JSON.stringify(check.charset)})`, helpers };
    }
    case 'space_separated_tokens': {
      helpers.add('CheckSpaceSeparatedTokens');
      helpers.add('IsEcmaWs');
      return { expr: `CheckSpaceSeparatedTokens(${varExpr})`, helpers };
    }
    case 'starts_with_charset': {
      helpers.add('CheckStartsWithCharset');
      return { expr: `CheckStartsWithCharset(${varExpr}, ${JSON.stringify(check.charset)})`, helpers };
    }
    case 'base64': {
      helpers.add('CheckBase64');
      helpers.add('IsB64Char');
      return { expr: `CheckBase64(${varExpr})`, helpers };
    }
    case 'hex_alternation': {
      const fns = check.lengths.map(len => {
        const fn = check.case === 'lower' ? `CheckHex${len}` : `CheckHex${len}Mixed`;
        helpers.add(fn);
        return `${fn}(${varExpr})`;
      });
      return { expr: `(${fns.join(' || ')})`, helpers };
    }
    case 'base64_2pad': {
      helpers.add('CheckBase642Pad');
      helpers.add('IsB64Char');
      return { expr: `CheckBase642Pad(${varExpr})`, helpers };
    }
    case 'nostr_uri': {
      helpers.add('CheckNostrUri');
      helpers.add('IsBech32Char');
      return { expr: `CheckNostrUri(${varExpr})`, helpers };
    }
    case 'nip04_encrypted': {
      helpers.add('CheckNip04Encrypted');
      helpers.add('IsB64Char');
      return { expr: `CheckNip04Encrypted(${varExpr})`, helpers };
    }
    case 'nip05_identifier': {
      helpers.add('CheckNip05Identifier');
      return { expr: `CheckNip05Identifier(${varExpr})`, helpers };
    }
    case 'mime_type_strict': {
      helpers.add('CheckMimeTypeStrict');
      return { expr: `CheckMimeTypeStrict(${varExpr})`, helpers };
    }
    case 'prefix_delim_rest': {
      helpers.add('CheckPrefixDelimRest');
      return { expr: `CheckPrefixDelimRest(${varExpr}, ${JSON.stringify(check.charset)}, ${JSON.stringify(check.delimiter)})`, helpers };
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
    default: {
      const _exhaustive: never = check;
      throw new Error(`Unhandled PatternCheck op: ${(_exhaustive as any).op}`);
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
    'using System;',
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

  if (helpers.has('CheckDateIso')) {
    lines.push('        private static bool CheckDateIso(string s)');
    lines.push('        {');
    lines.push("            if (s == null || s.Length != 10 || s[4] != '-' || s[7] != '-') return false;");
    lines.push('            for (int i = 0; i < 10; i++)');
    lines.push('            {');
    lines.push('                if (i == 4 || i == 7) continue;');
    lines.push("                if (s[i] < '0' || s[i] > '9') return false;");
    lines.push('            }');
    lines.push('            return true;');
    lines.push('        }');
    lines.push('');
  }

  if (helpers.has('CheckDatetimeIso')) {
    lines.push('        private static bool CheckDatetimeIso(string s)');
    lines.push('        {');
    lines.push('            if (s == null || s.Length < 10) return false;');
    lines.push("            for (int i = 0; i < 4; i++) if (s[i] < '0' || s[i] > '9') return false;");
    lines.push("            if (s[4] != '-') return false;");
    lines.push("            for (int i = 5; i < 7; i++) if (s[i] < '0' || s[i] > '9') return false;");
    lines.push("            if (s[7] != '-') return false;");
    lines.push("            for (int i = 8; i < 10; i++) if (s[i] < '0' || s[i] > '9') return false;");
    lines.push('            if (s.Length == 10) return true;');
    lines.push("            if (s[10] != 'T' || s.Length < 16) return false;");
    lines.push("            for (int i = 11; i < 13; i++) if (s[i] < '0' || s[i] > '9') return false;");
    lines.push("            if (s[13] != ':') return false;");
    lines.push("            for (int i = 14; i < 16; i++) if (s[i] < '0' || s[i] > '9') return false;");
    lines.push('            int pos = 16;');
    lines.push('            if (pos == s.Length) return true;');
    lines.push("            if (s[pos] == ':') {");
    lines.push('                if (pos + 3 > s.Length) return false;');
    lines.push("                if (s[pos+1] < '0' || s[pos+1] > '9' || s[pos+2] < '0' || s[pos+2] > '9') return false;");
    lines.push('                pos += 3;');
    lines.push('            }');
    lines.push('            if (pos == s.Length) return true;');
    lines.push("            if (s[pos] == '.') {");
    lines.push('                pos++;');
    lines.push("                if (pos >= s.Length || s[pos] < '0' || s[pos] > '9') return false;");
    lines.push("                while (pos < s.Length && s[pos] >= '0' && s[pos] <= '9') pos++;");
    lines.push('            }');
    lines.push('            if (pos == s.Length) return true;');
    lines.push("            if (s[pos] == 'Z') return pos + 1 == s.Length;");
    lines.push("            if (s[pos] == '+' || s[pos] == '-') {");
    lines.push('                if (pos + 6 != s.Length) return false;');
    lines.push("                if (s[pos+1] < '0' || s[pos+1] > '9' || s[pos+2] < '0' || s[pos+2] > '9') return false;");
    lines.push("                if (s[pos+3] != ':') return false;");
    lines.push("                return s[pos+4] >= '0' && s[pos+4] <= '9' && s[pos+5] >= '0' && s[pos+5] <= '9';");
    lines.push('            }');
    lines.push('            return false;');
    lines.push('        }');
    lines.push('');
  }

  if (helpers.has('CheckDecimal')) {
    lines.push('        private static bool CheckDecimal(string s)');
    lines.push('        {');
    lines.push('            if (string.IsNullOrEmpty(s)) return false;');
    lines.push('            int i = 0;');
    lines.push("            while (i < s.Length && s[i] >= '0' && s[i] <= '9') i++;");
    lines.push("            if (i == 0) return false;");
    lines.push("            if (i < s.Length && s[i] == '.')");
    lines.push('            {');
    lines.push('                i++;');
    lines.push("                if (i >= s.Length || s[i] < '0' || s[i] > '9') return false;");
    lines.push("                while (i < s.Length && s[i] >= '0' && s[i] <= '9') i++;");
    lines.push('            }');
    lines.push('            return i == s.Length;');
    lines.push('        }');
    lines.push('');
  }

  if (helpers.has('CheckRelayUrl') || helpers.has('CheckATag') || helpers.has('CheckDotTail')) {
    lines.push('        private static bool CheckDotTail(string s, int pos)');
    lines.push('        {');
    lines.push('            if (pos >= s.Length) return false;');
    lines.push('            for (int j = pos; j < s.Length; j++) {');
    lines.push("                if (s[j] == '\\n') return false;");
    lines.push('            }');
    lines.push('            return true;');
    lines.push('        }');
    lines.push('');
  }

  if (helpers.has('CheckRelayUrl')) {
    lines.push('        private static bool CheckRelayUrl(string s)');
    lines.push('        {');
    lines.push('            if (s == null) return false;');
    lines.push('            int pos;');
    lines.push('            if (s.StartsWith("wss://", StringComparison.Ordinal)) { pos = 6; }');
    lines.push('            else if (s.StartsWith("ws://", StringComparison.Ordinal)) { pos = 5; }');
    lines.push('            else { return false; }');
    lines.push('            int hostStart = pos;');
    lines.push('            while (pos < s.Length)');
    lines.push('            {');
    lines.push('                char c = s[pos];');
    lines.push("                if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '-') { pos++; }");
    lines.push('                else { break; }');
    lines.push('            }');
    lines.push('            if (pos == hostStart) return false;');
    lines.push("            if (pos < s.Length && s[pos] == ':')");
    lines.push('            {');
    lines.push('                pos++;');
    lines.push('                int portStart = pos;');
    lines.push("                while (pos < s.Length && s[pos] >= '0' && s[pos] <= '9') pos++;");
    lines.push('                if (pos == portStart) return false;');
    lines.push('            }');
    lines.push("            if (pos < s.Length && s[pos] == '/') {");
    lines.push('                return CheckDotTail(s, pos + 1) || pos + 1 == s.Length;');
    lines.push('            }');
    lines.push('            return pos == s.Length;');
    lines.push('        }');
    lines.push('');
  }

  if (helpers.has('CheckATag')) {
    lines.push('        private static bool CheckATag(string s, string[] kinds)');
    lines.push('        {');
    lines.push('            if (s == null || s.Length < 68) return false;');
    lines.push('            int pos = 0;');
    lines.push("            if (s[pos] < '0' || s[pos] > '9') return false;");
    lines.push("            int kindStart = pos;");
    lines.push("            while (pos < s.Length && s[pos] >= '0' && s[pos] <= '9') pos++;");
    lines.push("            if (pos >= s.Length || s[pos] != ':') return false;");
    lines.push("            var kindStr = s.Substring(kindStart, pos - kindStart);");
    lines.push("            if (kinds != null && System.Array.IndexOf(kinds, kindStr) < 0) return false;");
    lines.push('            pos++;');
    lines.push('            if (pos + 64 >= s.Length) return false;');
    lines.push('            for (int i = 0; i < 64; i++) {');
    lines.push('                char c = s[pos + i];');
    lines.push("                if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;");
    lines.push('            }');
    lines.push('            pos += 64;');
    lines.push("            if (pos >= s.Length || s[pos] != ':') return false;");
    lines.push('            pos++;');
    lines.push('            return CheckDotTail(s, pos);');
    lines.push('        }');
    lines.push('');
  }

  if (helpers.has('CheckBech32') || helpers.has('IsBech32Char')) {
    lines.push('        private static bool IsBech32Char(char c)');
    lines.push("            => (c >= '0' && c <= '9' && c != '1') || (c >= 'a' && c <= 'z' && c != 'b' && c != 'i' && c != 'o');");
    lines.push('');
  }

  if (helpers.has('CheckBech32')) {
    lines.push('        private static bool CheckBech32(string s, string prefix, int dataLen = -1)');
    lines.push('        {');
    lines.push('            if (s == null || !s.StartsWith(prefix, StringComparison.Ordinal)) return false;');
    lines.push('            var data = s.Substring(prefix.Length);');
    lines.push('            if (data.Length == 0 || !data.All(IsBech32Char)) return false;');
    lines.push('            if (dataLen >= 0) return data.Length == dataLen;');
    lines.push('            return true;');
    lines.push('        }');
    lines.push('');
  }

  if (helpers.has('CheckWrapped')) {
    lines.push('        private static bool CheckWrapped(string s, string prefix, string suffix)');
    lines.push('        {');
    lines.push('            if (s == null) return false;');
    lines.push('            return s.Length >= prefix.Length + suffix.Length && s.StartsWith(prefix, StringComparison.Ordinal) && s.EndsWith(suffix, StringComparison.Ordinal);');
    lines.push('        }');
    lines.push('');
  }

  if (helpers.has('CheckCsvList')) {
    lines.push('        private static bool CheckCsvList(string s, string charset)');
    lines.push('        {');
    lines.push('            if (string.IsNullOrEmpty(s)) return false;');
    lines.push('            int i = 0;');
    lines.push('            while (true)');
    lines.push('            {');
    lines.push('                int start = i;');
    lines.push('                while (i < s.Length && charset.Contains(s[i])) i++;');
    lines.push('                if (i == start) return false;');
    lines.push('                if (i == s.Length) return true;');
    lines.push("                if (s[i] != ',') return false;");
    lines.push('                i++;');
    lines.push('            }');
    lines.push('        }');
    lines.push('');
  }

  if (helpers.has('CheckLnInvoice')) {
    lines.push('        private static bool CheckLnInvoice(string s, string prefix, int minHrpLen)');
    lines.push('        {');
    lines.push('            if (s == null || !s.StartsWith(prefix, StringComparison.Ordinal)) return false;');
    lines.push("            int sep = s.LastIndexOf('1');");
    lines.push('            if (sep < 0) return false;');
    lines.push('            var hrp = s.Substring(0, sep);');
    lines.push('            if (hrp.Length < minHrpLen) return false;');
    lines.push("            if (!hrp.All(c => (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'))) return false;");
    lines.push('            var data = s.Substring(sep + 1);');
    lines.push('            if (data.Length == 0) return false;');
    lines.push('            return data.All(IsBech32Char);');
    lines.push('        }');
    lines.push('');
  }

  if (helpers.has('CheckMimeType')) {
    lines.push('        private static bool CheckMimeType(string s)');
    lines.push('        {');
    lines.push('            if (string.IsNullOrEmpty(s)) return false;');
    lines.push('            int i = 0;');
    lines.push('            int start = i;');
    lines.push("            while (i < s.Length && s[i] >= 'a' && s[i] <= 'z') i++;");
    lines.push('            if (i == start) return false;');
    lines.push("            if (i >= s.Length || s[i] != '/') return false;");
    lines.push('            i++;');
    lines.push('            int subStart = i;');
    lines.push('            while (i < s.Length) {');
    lines.push('                char c = s[i];');
    lines.push("                if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '+' || c == '-') i++;");
    lines.push('                else break;');
    lines.push('            }');
    lines.push('            if (i == subStart) return false;');
    lines.push('            return i == s.Length;');
    lines.push('        }');
    lines.push('');
  }

  if (helpers.has('CheckHttpOrigin')) {
    lines.push('        private static bool CheckHttpOrigin(string s)');
    lines.push('        {');
    lines.push('            if (s == null) return false;');
    lines.push('            int i;');
    lines.push('            if (s.StartsWith("https://", StringComparison.Ordinal)) { i = 8; }');
    lines.push('            else if (s.StartsWith("http://", StringComparison.Ordinal)) { i = 7; }');
    lines.push('            else { return false; }');
    lines.push('            int start = i;');
    lines.push("            while (i < s.Length && s[i] != '/') i++;");
    lines.push('            if (i == start) return false;');
    lines.push("            if (i < s.Length && s[i] == '/') i++;");
    lines.push('            return i == s.Length;');
    lines.push('        }');
    lines.push('');
  }

  if (helpers.has('IsEcmaWs')) {
    lines.push('        private static bool IsEcmaWs(char c)');
    lines.push("            => c == '\\t' || c == '\\n' || c == '\\u000B' || c == '\\f' || c == '\\r' || c == ' '");
    lines.push("            || c == '\\u00A0' || c == '\\u1680'");
    lines.push("            || (c >= '\\u2000' && c <= '\\u200A')");
    lines.push("            || c == '\\u2028' || c == '\\u2029' || c == '\\u202F' || c == '\\u205F'");
    lines.push("            || c == '\\u3000' || c == '\\uFEFF';");
    lines.push('');
  }

  if (helpers.has('CheckEmailLike')) {
    lines.push('        private static bool CheckEmailLike(string s)');
    lines.push('        {');
    lines.push('            if (string.IsNullOrEmpty(s)) return false;');
    lines.push('            int i = 0;');
    lines.push('            int start = i;');
    lines.push("            while (i < s.Length && !IsEcmaWs(s[i]) && s[i] != '@') i++;");
    lines.push('            if (i == start) return false;');
    lines.push("            if (i >= s.Length || s[i] != '@') return false;");
    lines.push('            i++;');
    lines.push('            int domStart = i;');
    lines.push("            while (i < s.Length && !IsEcmaWs(s[i]) && s[i] != '@') i++;");
    lines.push('            if (i == domStart) return false;');
    lines.push('            return i == s.Length;');
    lines.push('        }');
    lines.push('');
  }

  if (helpers.has('CheckGitCloneUrl')) {
    lines.push('        private static bool CheckGitCloneUrl(string s)');
    lines.push('        {');
    lines.push('            if (string.IsNullOrEmpty(s)) return false;');
    lines.push('            int i;');
    lines.push('            if (s.StartsWith("git@", StringComparison.Ordinal)) {');
    lines.push('                i = 4;');
    lines.push('            } else {');
    lines.push("                if (!(s[0] >= 'a' && s[0] <= 'z')) return false;");
    lines.push('                i = 1;');
    lines.push('                while (i < s.Length) {');
    lines.push('                    char c = s[i];');
    lines.push("                    if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '+' || c == '.' || c == '-') i++;");
    lines.push('                    else break;');
    lines.push('                }');
    lines.push("                if (i + 3 > s.Length || s[i] != ':' || s[i+1] != '/' || s[i+2] != '/') return false;");
    lines.push('                i += 3;');
    lines.push('            }');
    lines.push('            if (i >= s.Length) return false;');
    lines.push('            while (i < s.Length) {');
    lines.push('                if (IsEcmaWs(s[i])) return false;');
    lines.push('                i++;');
    lines.push('            }');
    lines.push('            return true;');
    lines.push('        }');
    lines.push('');
  }

  if (helpers.has('CheckContentType')) {
    lines.push('        private static bool IsTypeChar(char c)');
    lines.push("            => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '!' || c == '#' || c == '$' || c == '&' || c == '^' || c == '_' || c == '-';");
    lines.push('');
    lines.push('        private static bool IsSubtypeChar(char c)');
    lines.push("            => IsTypeChar(c) || c == '.' || c == '+';");
    lines.push('');
    lines.push('        private static bool CheckContentType(string s)');
    lines.push('        {');
    lines.push('            if (string.IsNullOrEmpty(s)) return false;');
    lines.push('            int i = 0;');
    lines.push("            if (!((s[i] >= 'a' && s[i] <= 'z') || (s[i] >= 'A' && s[i] <= 'Z'))) return false;");
    lines.push('            i++;');
    lines.push('            while (i < s.Length && IsTypeChar(s[i])) i++;');
    lines.push("            if (i >= s.Length || s[i] != '/') return false;");
    lines.push('            i++;');
    lines.push('            if (i >= s.Length) return false;');
    lines.push('            char sc = s[i];');
    lines.push("            if (!((sc >= 'a' && sc <= 'z') || (sc >= 'A' && sc <= 'Z') || (sc >= '0' && sc <= '9') || sc == '*')) return false;");
    lines.push('            i++;');
    lines.push('            while (i < s.Length && IsSubtypeChar(s[i])) i++;');
    lines.push('            while (i < s.Length) {');
    lines.push("                while (i < s.Length && IsEcmaWs(s[i])) i++;");
    lines.push('                if (i >= s.Length) return false;');
    lines.push("                if (s[i] != ';') return false;");
    lines.push('                i++;');
    lines.push("                while (i < s.Length && IsEcmaWs(s[i])) i++;");
    lines.push('                int nameStart = i;');
    lines.push('                while (i < s.Length && IsSubtypeChar(s[i])) i++;');
    lines.push('                if (i == nameStart) return false;');
    lines.push("                if (i >= s.Length || s[i] != '=') return false;");
    lines.push('                i++;');
    lines.push('                int valStart = i;');
    lines.push('                while (i < s.Length && IsSubtypeChar(s[i])) i++;');
    lines.push('                if (i == valStart) return false;');
    lines.push('            }');
    lines.push('            return i == s.Length;');
    lines.push('        }');
    lines.push('');
  }

  if (helpers.has('CheckDoi')) {
    lines.push('        private static bool CheckDoi(string s)');
    lines.push('        {');
    lines.push('            if (s == null || s.Length < 8) return false;');
    lines.push('            if (!s.StartsWith("10.", StringComparison.Ordinal)) return false;');
    lines.push('            int i = 3;');
    lines.push('            int dStart = i;');
    lines.push("            while (i < s.Length && s[i] >= '0' && s[i] <= '9') i++;");
    lines.push('            int dCount = i - dStart;');
    lines.push('            if (dCount < 4 || dCount > 9) return false;');
    lines.push("            if (i >= s.Length || s[i] != '/') return false;");
    lines.push('            i++;');
    lines.push('            return CheckDotTail(s, i);');
    lines.push('        }');
    lines.push('');
  }

  if (helpers.has('CheckAnnotateUser')) {
    lines.push('        private static bool CheckAnnotateUser(string s)');
    lines.push('        {');
    lines.push('            if (s == null || s.Length < 82) return false;');
    lines.push('            if (!s.StartsWith("annotate-user ", StringComparison.Ordinal)) return false;');
    lines.push('            int i = 14;');
    lines.push('            if (i + 64 > s.Length) return false;');
    lines.push('            for (int j = 0; j < 64; j++) {');
    lines.push('                char c = s[i + j];');
    lines.push("                if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;");
    lines.push('            }');
    lines.push('            i += 64;');
    lines.push('            for (int round = 0; round < 2; round++) {');
    lines.push("                if (i >= s.Length || s[i] != ':') return false;");
    lines.push('                i++;');
    lines.push('                int start = i;');
    lines.push("                while (i < s.Length && s[i] >= '0' && s[i] <= '9') i++;");
    lines.push('                if (i == start) return false;');
    lines.push("                if (i < s.Length && s[i] == '.') {");
    lines.push('                    i++;');
    lines.push('                    int fStart = i;');
    lines.push("                    while (i < s.Length && s[i] >= '0' && s[i] <= '9') i++;");
    lines.push('                    if (i == fStart) return false;');
    lines.push('                }');
    lines.push('            }');
    lines.push('            return i == s.Length;');
    lines.push('        }');
    lines.push('');
  }

  if (helpers.has('CheckNoWsTail')) {
    lines.push('        private static bool CheckNoWsTail(string s, int offset)');
    lines.push('        {');
    lines.push('            if (s == null || offset >= s.Length) return false;');
    lines.push('            for (int i = offset; i < s.Length; i++) {');
    lines.push('                if (IsEcmaWs(s[i])) return false;');
    lines.push('            }');
    lines.push('            return true;');
    lines.push('        }');
    lines.push('');
  }

  if (helpers.has('CheckExternalIdentity')) {
    lines.push('        private static bool CheckExternalIdentity(string s)');
    lines.push('        {');
    lines.push('            if (string.IsNullOrEmpty(s)) return false;');
    lines.push('            int i = 0;');
    lines.push('            while (i < s.Length) {');
    lines.push('                char c = s[i];');
    lines.push("                if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '-' || c == '/') i++;");
    lines.push('                else break;');
    lines.push('            }');
    lines.push('            if (i == 0) return false;');
    lines.push("            if (i >= s.Length || s[i] != ':') return false;");
    lines.push('            i++;');
    lines.push('            if (i >= s.Length) return false;');
    lines.push("            for (int j = i; j < s.Length; j++) if (s[j] == '\\n') return false;");
    lines.push('            return true;');
    lines.push('        }');
    lines.push('');
  }

  if (helpers.has('CheckPackageId')) {
    lines.push('        private static bool IsPkgChar(char c)');
    lines.push("            => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '+' || c == '-';");
    lines.push('');
    lines.push('        private static bool CheckPackageId(string s)');
    lines.push('        {');
    lines.push('            if (string.IsNullOrEmpty(s)) return false;');
    lines.push("            if (s.Length == 1 && s[0] == '#') return true;");
    lines.push('            int i = 0;');
    lines.push("            if (!((s[i] >= 'a' && s[i] <= 'z') || (s[i] >= 'A' && s[i] <= 'Z') || (s[i] >= '0' && s[i] <= '9'))) return false;");
    lines.push('            i++;');
    lines.push('            while (i < s.Length && IsPkgChar(s[i])) i++;');
    lines.push("            while (i < s.Length && s[i] == ':') {");
    lines.push('                i++;');
    lines.push('                if (i >= s.Length) return false;');
    lines.push("                if (!((s[i] >= 'a' && s[i] <= 'z') || (s[i] >= 'A' && s[i] <= 'Z') || (s[i] >= '0' && s[i] <= '9'))) return false;");
    lines.push('                i++;');
    lines.push('                while (i < s.Length && IsPkgChar(s[i])) i++;');
    lines.push('            }');
    lines.push('            return i == s.Length;');
    lines.push('        }');
    lines.push('');
  }

  if (helpers.has('CheckImetaDim')) {
    lines.push('        private static bool CheckImetaDim(string s) {');
    lines.push('            if (s == null || s.Length < 7) return false;');
    lines.push('            if (!s.StartsWith("dim ", StringComparison.Ordinal)) return false;');
    lines.push('            int i = 4;');
    lines.push('            int dc = 0;');
    lines.push('            while (i < s.Length && s[i] >= \'0\' && s[i] <= \'9\') { i++; dc++; }');
    lines.push('            if (dc < 1 || dc > 5) return false;');
    lines.push('            if (i >= s.Length || s[i] != \'x\') return false;');
    lines.push('            i++; dc = 0;');
    lines.push('            while (i < s.Length && s[i] >= \'0\' && s[i] <= \'9\') { i++; dc++; }');
    lines.push('            if (dc < 1 || dc > 5) return false;');
    lines.push('            return i == s.Length;');
    lines.push('        }');
    lines.push('');
  }

  if (helpers.has('CheckDim')) {
    lines.push('        /* ^[0-9]+x[0-9]+$ */');
    lines.push('        private static bool CheckDim(string s)');
    lines.push('        {');
    lines.push('            if (string.IsNullOrEmpty(s)) return false;');
    lines.push('            int i = 0;');
    lines.push("            if (s[i] < '0' || s[i] > '9') return false;");
    lines.push("            while (i < s.Length && s[i] >= '0' && s[i] <= '9') i++;");
    lines.push("            if (i >= s.Length || s[i] != 'x') return false;");
    lines.push('            i++;');
    lines.push("            if (i >= s.Length || s[i] < '0' || s[i] > '9') return false;");
    lines.push("            while (i < s.Length && s[i] >= '0' && s[i] <= '9') i++;");
    lines.push('            return i == s.Length;');
    lines.push('        }');
    lines.push('');
  }

  if (helpers.has('CheckNoUppercase')) {
    lines.push('        /* ^[^A-Z]+$ */');
    lines.push('        private static bool CheckNoUppercase(string s)');
    lines.push("            => s != null && s.Length > 0 && s.All(c => c < 'A' || c > 'Z');");
    lines.push('');
  }

  if (helpers.has('CheckDottedDigits')) {
    lines.push('        /* ^[0-9]+(\\.[0-9]+)*$ */');
    lines.push('        private static bool CheckDottedDigits(string s)');
    lines.push('        {');
    lines.push('            if (string.IsNullOrEmpty(s)) return false;');
    lines.push('            int i = 0;');
    lines.push("            if (s[i] < '0' || s[i] > '9') return false;");
    lines.push("            while (i < s.Length && s[i] >= '0' && s[i] <= '9') i++;");
    lines.push("            while (i < s.Length && s[i] == '.') {");
    lines.push('                i++;');
    lines.push("                if (i >= s.Length || s[i] < '0' || s[i] > '9') return false;");
    lines.push("                while (i < s.Length && s[i] >= '0' && s[i] <= '9') i++;");
    lines.push('            }');
    lines.push('            return i == s.Length;');
    lines.push('        }');
    lines.push('');
  }

  if (helpers.has('CheckSlashSegments')) {
    lines.push('        /* ^[charset]+(/[charset]+)*$ */');
    lines.push('        private static bool CheckSlashSegments(string s, string charset)');
    lines.push('        {');
    lines.push('            if (string.IsNullOrEmpty(s)) return false;');
    lines.push('            int i = 0;');
    lines.push('            if (charset.IndexOf(s[i]) < 0) return false;');
    lines.push('            while (i < s.Length && charset.IndexOf(s[i]) >= 0) i++;');
    lines.push("            while (i < s.Length && s[i] == '/') {");
    lines.push('                i++;');
    lines.push('                if (i >= s.Length || charset.IndexOf(s[i]) < 0) return false;');
    lines.push('                while (i < s.Length && charset.IndexOf(s[i]) >= 0) i++;');
    lines.push('            }');
    lines.push('            return i == s.Length;');
    lines.push('        }');
    lines.push('');
  }

  if (helpers.has('CheckSpaceSeparatedTokens')) {
    lines.push('        /* ^\\S+( \\S+)*$ */');
    lines.push('        private static bool CheckSpaceSeparatedTokens(string s)');
    lines.push('        {');
    lines.push('            if (string.IsNullOrEmpty(s)) return false;');
    lines.push('            int i = 0;');
    lines.push('            /* first token: 1+ non-whitespace chars */');
    lines.push('            if (IsEcmaWs(s[i])) return false;');
    lines.push('            while (i < s.Length && !IsEcmaWs(s[i])) i++;');
    lines.push("            while (i < s.Length && s[i] == ' ') {");
    lines.push('                i++;');
    lines.push('                if (i >= s.Length || IsEcmaWs(s[i])) return false;');
    lines.push('                while (i < s.Length && !IsEcmaWs(s[i])) i++;');
    lines.push('            }');
    lines.push('            return i == s.Length;');
    lines.push('        }');
    lines.push('');
  }

  if (helpers.has('CheckStartsWithCharset')) {
    lines.push('        /* ^[charset]+ (no end anchor) */');
    lines.push('        private static bool CheckStartsWithCharset(string s, string charset)');
    lines.push('            => s != null && s.Length > 0 && charset.IndexOf(s[0]) >= 0;');
    lines.push('');
  }

  if (helpers.has('CheckBase64') || helpers.has('IsB64Char')) {
    lines.push('        private static bool IsB64Char(char c)');
    lines.push("            => (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '+' || c == '/';");
    lines.push('');
  }

  if (helpers.has('CheckBase64')) {
    lines.push('        /* ^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$ */');
    lines.push('        private static bool CheckBase64(string s)');
    lines.push('        {');
    lines.push('            if (s == null) return false;');
    lines.push('            if (s.Length == 0) return true;');
    lines.push('            if (s.Length % 4 != 0) return false;');
    lines.push('            int i = 0;');
    lines.push("            while (i < s.Length && s[i] != '=') {");
    lines.push('                if (!IsB64Char(s[i])) return false;');
    lines.push('                i++;');
    lines.push('            }');
    lines.push('            int dataLen = i;');
    lines.push('            int padLen = s.Length - dataLen;');
    lines.push('            if (padLen > 2) return false;');
    lines.push('            if (padLen == 1 && dataLen % 4 != 3) return false;');
    lines.push('            if (padLen == 2 && dataLen % 4 != 2) return false;');
    lines.push("            while (i < s.Length) { if (s[i] != '=') return false; i++; }");
    lines.push('            return true;');
    lines.push('        }');
    lines.push('');
  }

  if (helpers.has('CheckBase642Pad')) {
    lines.push('        /* strict base64 with mandatory 2-char padding */');
    lines.push('        private static bool CheckBase642Pad(string s)');
    lines.push('        {');
    lines.push('            if (s == null) return false;');
    lines.push('            int len = s.Length;');
    lines.push('            if (len < 4 || len % 4 != 0) return false;');
    lines.push("            if (s[len - 1] != '=' || s[len - 2] != '=') return false;");
    lines.push('            for (int i = 0; i < len - 2; i++)');
    lines.push('            {');
    lines.push('                if (!IsB64Char(s[i])) return false;');
    lines.push('            }');
    lines.push('            return true;');
    lines.push('        }');
    lines.push('');
  }

  if (helpers.has('CheckNostrUri')) {
    lines.push('        /* ^nostr:((npub|note)1[bech32]{58}|(nprofile|nevent|naddr)1[bech32]+)$ */');
    lines.push('        private static bool CheckNostrUri(string s)');
    lines.push('        {');
    lines.push('            if (s == null || !s.StartsWith("nostr:", StringComparison.Ordinal)) return false;');
    lines.push('            var p = s.Substring(6);');
    lines.push('            /* npub1 or note1 + exactly 58 data chars */');
    lines.push('            if (p.Length == 63 && (p.StartsWith("npub1", StringComparison.Ordinal) || p.StartsWith("note1", StringComparison.Ordinal))) {');
    lines.push('                for (int i = 5; i < 63; i++) if (!IsBech32Char(p[i])) return false;');
    lines.push('                return true;');
    lines.push('            }');
    lines.push('            /* nprofile1, nevent1, naddr1 + 1+ data chars */');
    lines.push('            int prefixLen;');
    lines.push('            if (p.StartsWith("nprofile1", StringComparison.Ordinal)) prefixLen = 9;');
    lines.push('            else if (p.StartsWith("nevent1", StringComparison.Ordinal)) prefixLen = 7;');
    lines.push('            else if (p.StartsWith("naddr1", StringComparison.Ordinal)) prefixLen = 6;');
    lines.push('            else return false;');
    lines.push('            if (p.Length <= prefixLen) return false;');
    lines.push('            for (int i = prefixLen; i < p.Length; i++) if (!IsBech32Char(p[i])) return false;');
    lines.push('            return true;');
    lines.push('        }');
    lines.push('');
  }

  if (helpers.has('CheckNip04Encrypted')) {
    lines.push('        /* ^[A-Za-z0-9+/]+={0,2}\\?iv=[A-Za-z0-9+/]+={0,2}$ */');
    lines.push('        private static bool CheckNip04Encrypted(string s)');
    lines.push('        {');
    lines.push('            if (string.IsNullOrEmpty(s)) return false;');
    lines.push('            int sep = s.IndexOf("?iv=", StringComparison.Ordinal);');
    lines.push('            if (sep <= 0) return false;');
    lines.push('            int rightStart = sep + 4;');
    lines.push('            if (rightStart >= s.Length) return false;');
    lines.push('            /* check left half: 1+ b64 chars + 0-2 = */');
    lines.push('            int i = 0;');
    lines.push('            while (i < sep && IsB64Char(s[i])) i++;');
    lines.push('            if (i == 0) return false;');
    lines.push('            int eq = 0;');
    lines.push("            while (i < sep && s[i] == '=') { i++; eq++; }");
    lines.push('            if (i != sep || eq > 2) return false;');
    lines.push('            /* check right half */');
    lines.push('            i = rightStart;');
    lines.push('            int dataStart = i;');
    lines.push('            while (i < s.Length && IsB64Char(s[i])) i++;');
    lines.push('            if (i == dataStart) return false;');
    lines.push('            eq = 0;');
    lines.push("            while (i < s.Length && s[i] == '=') { i++; eq++; }");
    lines.push('            return i == s.Length && eq <= 2;');
    lines.push('        }');
    lines.push('');
  }

  if (helpers.has('CheckNip05Identifier')) {
    lines.push('        private static bool IsNip05LocalChar(char c)');
    lines.push("            => c == '_' || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '-';");
    lines.push('');
    lines.push('        private static bool IsDomainChar(char c)');
    lines.push("            => (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-';");
    lines.push('');
    lines.push('        private static bool IsAlnum(char c)');
    lines.push("            => (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');");
    lines.push('');
    lines.push('        /* NIP-05: local@domain.tld */');
    lines.push('        private static bool CheckNip05Identifier(string s)');
    lines.push('        {');
    lines.push('            if (string.IsNullOrEmpty(s)) return false;');
    lines.push("            int at = s.LastIndexOf('@');");
    lines.push('            if (at <= 0) return false;');
    lines.push('            /* local part */');
    lines.push('            for (int i = 0; i < at; i++) {');
    lines.push('                if (!IsNip05LocalChar(s[i])) return false;');
    lines.push('            }');
    lines.push('            /* domain: 2+ dot-separated labels */');
    lines.push('            var d = s.Substring(at + 1);');
    lines.push('            if (d.Length == 0) return false;');
    lines.push('            int dotCount = 0;');
    lines.push('            int di = 0;');
    lines.push('            while (di < d.Length) {');
    lines.push('                if (!IsAlnum(d[di])) return false;');
    lines.push('                while (di < d.Length && IsDomainChar(d[di])) di++;');
    lines.push('                if (di > 0 && !IsAlnum(d[di - 1])) return false;');
    lines.push("                if (di < d.Length && d[di] == '.') { dotCount++; di++; }");
    lines.push('                else if (di < d.Length) return false;');
    lines.push('            }');
    lines.push('            return dotCount >= 1 && IsAlnum(d[d.Length - 1]);');
    lines.push('        }');
    lines.push('');
  }

  if (helpers.has('CheckMimeTypeStrict')) {
    lines.push('        private static bool IsMimeStrictChar(char c)');
    lines.push("            => (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '!' || c == '#' || c == '$' || c == '&' || c == '^' || c == '_' || c == '.' || c == '+' || c == '-';");
    lines.push('');
    lines.push('        /* ^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$ */');
    lines.push('        private static bool CheckMimeTypeStrict(string s)');
    lines.push('        {');
    lines.push('            if (string.IsNullOrEmpty(s)) return false;');
    lines.push('            int i = 0;');
    lines.push("            if (!((s[i] >= 'A' && s[i] <= 'Z') || (s[i] >= 'a' && s[i] <= 'z') || (s[i] >= '0' && s[i] <= '9'))) return false;");
    lines.push('            i++;');
    lines.push('            while (i < s.Length && IsMimeStrictChar(s[i])) i++;');
    lines.push("            if (i >= s.Length || s[i] != '/') return false;");
    lines.push('            i++;');
    lines.push("            if (i >= s.Length || !((s[i] >= 'A' && s[i] <= 'Z') || (s[i] >= 'a' && s[i] <= 'z') || (s[i] >= '0' && s[i] <= '9'))) return false;");
    lines.push('            i++;');
    lines.push('            while (i < s.Length && IsMimeStrictChar(s[i])) i++;');
    lines.push('            return i == s.Length;');
    lines.push('        }');
    lines.push('');
  }

  if (helpers.has('CheckPrefixDelimRest')) {
    lines.push('        /* ^[charset]+<delim>.+ (no end anchor) */');
    lines.push('        private static bool CheckPrefixDelimRest(string s, string charset, string delimiter)');
    lines.push('        {');
    lines.push('            if (string.IsNullOrEmpty(s)) return false;');
    lines.push('            int i = 0;');
    lines.push('            if (charset.IndexOf(s[i]) < 0) return false;');
    lines.push('            while (i < s.Length && charset.IndexOf(s[i]) >= 0) i++;');
    lines.push('            if (i + delimiter.Length >= s.Length) return false;');
    lines.push('            if (s.Substring(i, delimiter.Length) != delimiter) return false;');
    lines.push('            i += delimiter.Length;');
    lines.push('            if (i >= s.Length) return false;');
    lines.push('            /* .+ first char must not be a line terminator (C# Regex . excludes \\n only) */');
    lines.push("            return s[i] != '\\n';");
    lines.push('        }');
    lines.push('');
  }

  return lines.join('\n');
}
