/**
 * Python validator emitter: ValidatorAction[] → .py file
 *
 * Generates idiomatic Python using:
 *   - `any()` generator expressions for tag search
 *   - `list[list[str]]` for tags
 *   - `@dataclass` for ValidationError
 *   - Private helper functions (_check_hex_64, etc.)
 *   - 4-space indentation
 *
 * No external dependencies (uses only builtins + `re` when regex fallback needed).
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

function renderPatternCheckPython(check: PatternCheck, varExpr: string): { expr: string; helpers: Set<string> } {
  const helpers = new Set<string>();
  switch (check.op) {
    case 'hex': {
      const fn = check.case === 'lower' ? `_check_hex_${check.len}` : `_check_hex_${check.len}_mixed`;
      helpers.add(fn);
      return { expr: `${fn}(${varExpr})`, helpers };
    }
    case 'hex_range': {
      const fn = check.case === 'lower' ? '_check_hex_range' : '_check_hex_range_mixed';
      helpers.add(fn);
      return { expr: `${fn}(${varExpr}, ${check.min}, ${check.max})`, helpers };
    }
    case 'hex_prefixed': {
      helpers.add('_check_hex_prefixed');
      return { expr: `_check_hex_prefixed(${varExpr}, ${JSON.stringify(check.prefix)}, ${check.hexLen})`, helpers };
    }
    case 'all_digits': {
      const fn = check.allowNeg ? '_check_signed_int' : '_check_digits';
      helpers.add(fn);
      return { expr: `${fn}(${varExpr})`, helpers };
    }
    case 'starts_with_any': {
      const prefixTuple = check.prefixes.map(p => JSON.stringify(p)).join(', ');
      // Use tuple for startswith — single element needs trailing comma
      const tupleStr = check.prefixes.length === 1 ? `(${prefixTuple},)` : `(${prefixTuple})`;
      return { expr: `${varExpr}.startswith(${tupleStr})`, helpers };
    }
    case 'chars_in': {
      if (check.min === 0 && check.max === 0) {
        return { expr: `${varExpr} == ""`, helpers };
      }
      helpers.add('_check_chars_in');
      return {
        expr: `_check_chars_in(${varExpr}, ${JSON.stringify(check.charset)}, ${check.min ?? 0}, ${check.max ?? -1})`,
        helpers,
      };
    }
    case 'bech32': {
      helpers.add('_check_bech32');
      if (check.dataLen !== undefined) {
        return { expr: `_check_bech32(${varExpr}, ${JSON.stringify(check.hrp + '1')}, ${check.dataLen})`, helpers };
      }
      return { expr: `_check_bech32(${varExpr}, ${JSON.stringify(check.hrp + '1')})`, helpers };
    }
    case 'regex': {
      helpers.add('_regex');
      return { expr: `bool(re.match(${JSON.stringify(check.pattern)}, ${varExpr}))`, helpers };
    }
    case 'relay_url': {
      helpers.add('_check_relay_url');
      return { expr: `_check_relay_url(${varExpr})`, helpers };
    }
    case 'a_tag': {
      helpers.add('_check_a_tag');
      if (check.kinds && check.kinds.length > 0) {
        return { expr: `_check_a_tag(${varExpr}, [${check.kinds.map(k => JSON.stringify(k)).join(', ')}])`, helpers };
      }
      return { expr: `_check_a_tag(${varExpr})`, helpers };
    }
    case 'date_iso': {
      helpers.add('_check_date_iso');
      return { expr: `_check_date_iso(${varExpr})`, helpers };
    }
    case 'datetime_iso': {
      helpers.add('_check_datetime_iso');
      return { expr: `_check_datetime_iso(${varExpr})`, helpers };
    }
    case 'decimal': {
      helpers.add('_check_decimal');
      return { expr: `_check_decimal(${varExpr})`, helpers };
    }
    case 'exact_values': {
      const vals = check.values.map(v => JSON.stringify(v)).join(', ');
      return { expr: `${varExpr} in (${vals}${check.values.length === 1 ? ',' : ''})`, helpers };
    }
    case 'prefix_nonempty': {
      helpers.add('_check_dot_tail');
      return {
        expr: `(${varExpr}.startswith(${JSON.stringify(check.prefix)}) and _check_dot_tail(${varExpr}, ${check.prefix.length}))`,
        helpers,
      };
    }
    case 'wrapped': {
      helpers.add('_check_wrapped');
      return { expr: `_check_wrapped(${varExpr}, ${JSON.stringify(check.prefix)}, ${JSON.stringify(check.suffix)})`, helpers };
    }
    case 'csv_list': {
      helpers.add('_check_csv_list');
      return { expr: `_check_csv_list(${varExpr}, ${JSON.stringify(check.itemCharset)})`, helpers };
    }
    case 'ln_invoice': {
      helpers.add('_check_ln_invoice');
      return { expr: `_check_ln_invoice(${varExpr}, ${JSON.stringify(check.prefix)}, ${check.minHrpLen})`, helpers };
    }
    case 'mime_type': {
      helpers.add('_check_mime_type');
      return { expr: `_check_mime_type(${varExpr})`, helpers };
    }
    case 'http_origin': {
      helpers.add('_check_http_origin');
      return { expr: `_check_http_origin(${varExpr})`, helpers };
    }
    case 'email_like': {
      helpers.add('_check_email_like');
      helpers.add('_is_ecma_ws');
      return { expr: `_check_email_like(${varExpr})`, helpers };
    }
    case 'git_clone_url': {
      helpers.add('_check_git_clone_url');
      helpers.add('_is_ecma_ws');
      return { expr: `_check_git_clone_url(${varExpr})`, helpers };
    }
    case 'content_type': {
      helpers.add('_check_content_type');
      helpers.add('_is_ecma_ws');
      return { expr: `_check_content_type(${varExpr})`, helpers };
    }
    case 'doi': {
      helpers.add('_check_doi');
      return { expr: `_check_doi(${varExpr})`, helpers };
    }
    case 'annotate_user': {
      helpers.add('_check_annotate_user');
      return { expr: `_check_annotate_user(${varExpr})`, helpers };
    }
    case 'prefix_no_whitespace': {
      helpers.add('_check_no_ws_tail');
      helpers.add('_is_ecma_ws');
      const checks = check.prefixes.map(p =>
        `(${varExpr}.startswith(${JSON.stringify(p)}) and _check_no_ws_tail(${varExpr}, ${p.length}))`
      );
      return { expr: checks.length === 1 ? checks[0] : `(${checks.join(' or ')})`, helpers };
    }
    case 'external_identity': {
      helpers.add('_check_external_identity');
      return { expr: `_check_external_identity(${varExpr})`, helpers };
    }
    case 'package_id': {
      helpers.add('_check_package_id');
      return { expr: `_check_package_id(${varExpr})`, helpers };
    }
    case 'imeta_dim': {
      helpers.add('_check_imeta_dim');
      return { expr: `_check_imeta_dim(${varExpr})`, helpers };
    }
    case 'dim': {
      helpers.add('_check_dim');
      return { expr: `_check_dim(${varExpr})`, helpers };
    }
    case 'no_uppercase': {
      helpers.add('_check_no_uppercase');
      return { expr: `_check_no_uppercase(${varExpr})`, helpers };
    }
    case 'dotted_digits': {
      helpers.add('_check_dotted_digits');
      return { expr: `_check_dotted_digits(${varExpr})`, helpers };
    }
    case 'slash_segments': {
      helpers.add('_check_slash_segments');
      return { expr: `_check_slash_segments(${varExpr}, ${JSON.stringify(check.charset)})`, helpers };
    }
    case 'space_separated_tokens': {
      helpers.add('_check_space_separated_tokens');
      helpers.add('_is_ecma_ws');
      return { expr: `_check_space_separated_tokens(${varExpr})`, helpers };
    }
    case 'starts_with_charset': {
      helpers.add('_check_starts_with_charset');
      return { expr: `_check_starts_with_charset(${varExpr}, ${JSON.stringify(check.charset)})`, helpers };
    }
    case 'base64': {
      helpers.add('_check_base64');
      return { expr: `_check_base64(${varExpr})`, helpers };
    }
    case 'hex_alternation': {
      const fns = check.lengths.map(len => {
        const fn = check.case === 'lower' ? `_check_hex${len}` : `_check_hex${len}_mixed`;
        helpers.add(fn);
        return `${fn}(${varExpr})`;
      });
      return { expr: `(${fns.join(' or ')})`, helpers };
    }
    case 'base64_2pad': {
      helpers.add('_check_base64_2pad');
      helpers.add('_check_base64'); // for _is_b64_char
      return { expr: `_check_base64_2pad(${varExpr})`, helpers };
    }
    case 'nostr_uri': {
      helpers.add('_check_nostr_uri');
      return { expr: `_check_nostr_uri(${varExpr})`, helpers };
    }
    case 'nip04_encrypted': {
      helpers.add('_check_nip04_encrypted');
      helpers.add('_check_base64');  // for _is_b64_char
      return { expr: `_check_nip04_encrypted(${varExpr})`, helpers };
    }
    case 'nip05_identifier': {
      helpers.add('_check_nip05_identifier');
      return { expr: `_check_nip05_identifier(${varExpr})`, helpers };
    }
    case 'mime_type_strict': {
      helpers.add('_check_mime_type_strict');
      return { expr: `_check_mime_type_strict(${varExpr})`, helpers };
    }
    case 'prefix_delim_rest': {
      helpers.add('_check_prefix_delim_rest');
      return { expr: `_check_prefix_delim_rest(${varExpr}, ${JSON.stringify(check.charset)}, ${JSON.stringify(check.delimiter)})`, helpers };
    }
    case 'compound': {
      const allHelpers = new Set<string>();
      const parts: string[] = [];
      for (const sub of check.checks) {
        const r = renderPatternCheckPython(sub, varExpr);
        parts.push(r.expr);
        for (const h of r.helpers) allHelpers.add(h);
      }
      return { expr: `(${parts.join(' and ')})`, helpers: allHelpers };
    }
    default: {
      const _exhaustive: never = check;
      throw new Error(`Unhandled PatternCheck op: ${(_exhaustive as any).op}`);
    }
  }
}

function renderValueCheckPython(
  check: ValueCheck,
  tagVar: string,
  index: number,
): { expr: string; helpers: Set<string> } {
  const helpers = new Set<string>();
  const lenGuard = `len(${tagVar}) > ${index}`;
  const access = `${tagVar}[${index}]`;

  switch (check.type) {
    case 'const':
      return { expr: `${lenGuard} and ${access} == ${JSON.stringify(check.value)}`, helpers };
    case 'enum': {
      const vals = check.values.map(v => JSON.stringify(v));
      return {
        expr: `${lenGuard} and ${access} in [${vals.join(', ')}]`,
        helpers,
      };
    }
    case 'pattern': {
      const r = renderPatternCheckPython(check.native, access);
      for (const h of r.helpers) helpers.add(h);
      return {
        expr: `${lenGuard} and ${r.expr}`,
        helpers,
      };
    }
    case 'anyOf': {
      const parts: string[] = [];
      for (const alt of check.alternatives) {
        const r = renderValueCheckPython(alt, tagVar, index);
        parts.push(`(${r.expr})`);
        for (const h of r.helpers) helpers.add(h);
      }
      return { expr: `(${parts.join(' or ')})`, helpers };
    }
  }
}

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

// --- Tag matcher rendering ---

function renderTagMatcherPython(
  matcher: TagMatcher,
  tagVar: string,
  helpers: Set<string>,
): string {
  const checks: string[] = [];

  checks.push(`len(${tagVar}) > 0 and ${tagVar}[0] == ${JSON.stringify(matcher.tagName)}`);
  checks.push(`len(${tagVar}) >= ${matcher.minItems}`);
  if (matcher.maxItems !== undefined) {
    checks.push(`len(${tagVar}) <= ${matcher.maxItems}`);
  }

  for (const pc of matcher.positionChecks) {
    const r = renderValueCheckPython(pc.check, tagVar, pc.index);
    for (const h of r.helpers) helpers.add(h);
    checks.push(r.expr);
  }

  return checks.join(' and ');
}

// --- Main emitter ---

export function emitPythonValidators(kindShapes: KindShape[]): string {
  const allHelpers = new Set<string>();
  const fnBodies: string[] = [];
  const constrainedKinds: { kindNumber: number; nip: string }[] = [];

  for (const shape of [...kindShapes].sort((a, b) => a.kindNumber - b.kindNumber)) {
    const actions = planKindValidator(shape);
    if (!actions) continue;

    constrainedKinds.push({ kindNumber: shape.kindNumber, nip: shape.nip });
    const { code, helpers } = emitKindFunctionPython(shape.kindNumber, shape.nip, actions);
    fnBodies.push(code);
    for (const h of helpers) allHelpers.add(h);
  }

  return emitPythonFile(fnBodies, constrainedKinds, allHelpers);
}

function emitKindFunctionPython(
  kindNumber: number,
  nip: string,
  actions: ValidatorAction[],
): { code: string; helpers: Set<string> } {
  const helpers = new Set<string>();
  const lines: string[] = [];

  lines.push('');
  lines.push(`def validate_kind_${kindNumber}(tags: list[list[str]]) -> list[ValidationError]:`);
  lines.push(`    """Validate tags for kind ${kindNumber} (${nip})."""`);
  lines.push('    errors: list[ValidationError] = []');

  for (const action of actions) {
    switch (action.type) {
      case 'check_min_tags':
        lines.push(`    if len(tags) < ${action.min}:`);
        lines.push(`        errors.append(ValidationError(path="tags", message="tags must have at least ${action.min} item(s)"))`);
        break;

      case 'require_tag': {
        const matcherExpr = renderTagMatcherPython(action.matcher, 't', helpers);
        lines.push(`    if not any(${matcherExpr} for t in tags):`);
        lines.push(`        errors.append(ValidationError(path="tags", message=${JSON.stringify(action.errorMsg)}))`);
        break;
      }

      case 'validate_optional_positions': {
        lines.push('    for t in tags:');
        lines.push(`        if len(t) > 0 and t[0] == ${JSON.stringify(action.tagName)}:`);
        for (const pc of action.checks) {
          const r = renderValueCheckPython(pc.check, 't', pc.index);
          for (const h of r.helpers) helpers.add(h);
          const msg = describePositionConstraint(pc, action.tagName);
          lines.push(`            if len(t) > ${pc.index} and not (${r.expr}):`);
          lines.push(`                errors.append(ValidationError(path="tags", message=${JSON.stringify(msg)}))`);
        }
        break;
      }

      case 'per_item_conditional': {
        const matcherExpr = renderTagMatcherPython(action.matcher, 't', helpers);
        lines.push('    for t in tags:');
        lines.push(`        if len(t) > 0 and t[0] == ${JSON.stringify(action.condTag)} and not (${matcherExpr}):`);
        lines.push(`            errors.append(ValidationError(path="tags", message=${JSON.stringify(action.errorMsg)}))`);
        if (action.optChecks.length > 0) {
          lines.push(`        if len(t) > 0 and t[0] == ${JSON.stringify(action.condTag)}:`);
          for (const pc of action.optChecks) {
            const r = renderValueCheckPython(pc.check, 't', pc.index);
            for (const h of r.helpers) helpers.add(h);
            const msg = describePositionConstraint(pc, action.condTag);
            lines.push(`            if len(t) > ${pc.index} and not (${r.expr}):`);
            lines.push(`                errors.append(ValidationError(path="tags", message=${JSON.stringify(msg)}))`);
          }
        }
        break;
      }

      case 'array_level_conditional': {
        lines.push(`    if any(len(t) > 0 and t[0] == ${JSON.stringify(action.condTag)} for t in tags):`);
        const matcherExpr = renderTagMatcherPython(action.matcher, 't', helpers);
        lines.push(`        if not any(${matcherExpr} for t in tags):`);
        lines.push(`            errors.append(ValidationError(path="tags", message=${JSON.stringify(action.errorMsg)}))`);
        if (action.optChecks.length > 0) {
          lines.push('        for t in tags:');
          lines.push(`            if len(t) > 0 and t[0] == ${JSON.stringify(action.matcher.tagName)}:`);
          for (const pc of action.optChecks) {
            const r = renderValueCheckPython(pc.check, 't', pc.index);
            for (const h of r.helpers) helpers.add(h);
            const msg = describePositionConstraint(pc, action.matcher.tagName);
            lines.push(`                if len(t) > ${pc.index} and not (${r.expr}):`);
            lines.push(`                    errors.append(ValidationError(path="tags", message=${JSON.stringify(msg)}))`);
          }
        }
        break;
      }

      case 'any_of_group': {
        const matchers = action.matchers.map(m => {
          const expr = renderTagMatcherPython(m, 't', helpers);
          return `any(${expr} for t in tags)`;
        });
        lines.push(`    if not (${matchers.join(' or ')}):`);
        lines.push(`        errors.append(ValidationError(path="tags", message=${JSON.stringify(action.errorMsg)}))`);
        break;
      }
    }
  }

  lines.push('    return errors');

  return { code: lines.join('\n'), helpers };
}

// --- File generation ---

function emitPythonFile(
  fnBodies: string[],
  constrainedKinds: { kindNumber: number; nip: string }[],
  helpers: Set<string>,
): string {
  const needsRegex = helpers.has('_regex');
  const lines: string[] = [
    '# Auto-generated by @nostrability/schemata-codegen',
    '# Do not edit manually.',
    '#',
    '# Runtime validators for Nostr event tag constraints',
    '',
    'from __future__ import annotations',
    '',
    'from dataclasses import dataclass',
  ];

  if (needsRegex) {
    lines.push('import re');
  }

  lines.push('');
  lines.push('');
  lines.push('@dataclass');
  lines.push('class ValidationError:');
  lines.push('    path: str');
  lines.push('    message: str');

  // Emit helpers
  const helperCode = emitPythonHelpers(helpers);
  if (helperCode) {
    lines.push('');
    lines.push('');
    lines.push(helperCode);
  }

  // Emit kind functions
  for (const fn of fnBodies) {
    lines.push('');
    lines.push(fn);
  }

  // Emit dispatch function
  lines.push('');
  lines.push('');
  lines.push('def validate_kind_tags(kind: int, tags: list[list[str]]) -> list[ValidationError]:');
  lines.push('    """Validate tags for a given kind number.');
  lines.push('');
  lines.push('    Returns empty list if kind has no constraints or is unknown.');
  lines.push('    """');

  if (constrainedKinds.length === 0) {
    lines.push('    return []');
  } else {
    // Use dict dispatch for clean Python
    lines.push('    _dispatch: dict[int, object] = {');
    for (const k of constrainedKinds) {
      lines.push(`        ${k.kindNumber}: validate_kind_${k.kindNumber},`);
    }
    lines.push('    }');
    lines.push('    validator = _dispatch.get(kind)');
    lines.push('    if validator is not None:');
    lines.push('        return validator(tags)  # type: ignore[operator]');
    lines.push('    return []');
  }
  lines.push('');

  return lines.join('\n');
}

function emitPythonHelpers(helpers: Set<string>): string {
  const lines: string[] = [];

  // Collect hex lengths needed
  const hexLengths = new Set<number>();
  const hexMixedLengths = new Set<number>();
  for (const h of helpers) {
    const m = h.match(/^_check_hex_(\d+)$/);
    if (m) hexLengths.add(parseInt(m[1], 10));
    const mm = h.match(/^_check_hex_(\d+)_mixed$/);
    if (mm) hexMixedLengths.add(parseInt(mm[1], 10));
  }

  for (const len of [...hexLengths].sort((a, b) => a - b)) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push(`def _check_hex_${len}(s: str) -> bool:`);
    lines.push(`    return len(s) == ${len} and all(c in "0123456789abcdef" for c in s)`);
  }

  for (const len of [...hexMixedLengths].sort((a, b) => a - b)) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push(`def _check_hex_${len}_mixed(s: str) -> bool:`);
    lines.push(`    return len(s) == ${len} and all(c in "0123456789abcdefABCDEF" for c in s)`);
  }

  if (helpers.has('_check_hex_range')) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push('def _check_hex_range(s: str, min_len: int, max_len: int) -> bool:');
    lines.push('    return min_len <= len(s) <= max_len and all(c in "0123456789abcdef" for c in s)');
  }

  if (helpers.has('_check_hex_range_mixed')) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push('def _check_hex_range_mixed(s: str, min_len: int, max_len: int) -> bool:');
    lines.push('    return min_len <= len(s) <= max_len and all(c in "0123456789abcdefABCDEF" for c in s)');
  }

  if (helpers.has('_check_hex_prefixed')) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push('def _check_hex_prefixed(s: str, prefix: str, hex_len: int) -> bool:');
    lines.push('    if not s.startswith(prefix):');
    lines.push('        return False');
    lines.push('    rest = s[len(prefix):]');
    lines.push('    return len(rest) == hex_len and all(c in "0123456789abcdef" for c in rest)');
  }

  if (helpers.has('_check_digits')) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push('def _check_digits(s: str) -> bool:');
    lines.push("    return len(s) > 0 and all('0' <= c <= '9' for c in s)");
  }

  if (helpers.has('_check_signed_int')) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push('def _check_signed_int(s: str) -> bool:');
    lines.push('    v = s.lstrip("-")');
    lines.push("    return len(v) > 0 and (len(s) - len(v)) <= 1 and all('0' <= c <= '9' for c in v)");
  }

  if (helpers.has('_check_chars_in')) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push('def _check_chars_in(s: str, charset: str, min_len: int, max_len: int) -> bool:');
    lines.push('    n = len(s)');
    lines.push('    if n < min_len:');
    lines.push('        return False');
    lines.push('    if max_len >= 0 and n > max_len:');
    lines.push('        return False');
    lines.push('    return all(c in charset for c in s)');
  }

  if (helpers.has('_check_date_iso')) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push('def _check_date_iso(s: str) -> bool:');
    lines.push("    if len(s) != 10 or s[4] != '-' or s[7] != '-':");
    lines.push('        return False');
    lines.push('    for i in range(10):');
    lines.push('        if i == 4 or i == 7:');
    lines.push('            continue');
    lines.push("        if not ('0' <= s[i] <= '9'):");
    lines.push('            return False');
    lines.push('    return True');
  }

  if (helpers.has('_check_datetime_iso')) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push('def _check_datetime_iso(s: str) -> bool:');
    lines.push('    if len(s) < 10:');
    lines.push('        return False');
    lines.push("    if not all('0' <= s[i] <= '9' for i in range(4)):");
    lines.push('        return False');
    lines.push("    if s[4] != '-':");
    lines.push('        return False');
    lines.push("    if not all('0' <= s[i] <= '9' for i in range(5, 7)):");
    lines.push('        return False');
    lines.push("    if s[7] != '-':");
    lines.push('        return False');
    lines.push("    if not all('0' <= s[i] <= '9' for i in range(8, 10)):");
    lines.push('        return False');
    lines.push('    if len(s) == 10:');
    lines.push('        return True');
    lines.push("    if s[10] != 'T' or len(s) < 16:");
    lines.push('        return False');
    lines.push("    if not all('0' <= s[i] <= '9' for i in range(11, 13)):");
    lines.push('        return False');
    lines.push("    if s[13] != ':':");
    lines.push('        return False');
    lines.push("    if not all('0' <= s[i] <= '9' for i in range(14, 16)):");
    lines.push('        return False');
    lines.push('    pos = 16');
    lines.push('    if pos == len(s):');
    lines.push('        return True');
    lines.push("    if s[pos] == ':':");
    lines.push('        if pos + 3 > len(s):');
    lines.push('            return False');
    lines.push("        if not ('0' <= s[pos+1] <= '9' and '0' <= s[pos+2] <= '9'):");
    lines.push('            return False');
    lines.push('        pos += 3');
    lines.push('    if pos == len(s):');
    lines.push('        return True');
    lines.push("    if s[pos] == '.':");
    lines.push('        pos += 1');
    lines.push("        if pos >= len(s) or not ('0' <= s[pos] <= '9'):");
    lines.push('            return False');
    lines.push("        while pos < len(s) and '0' <= s[pos] <= '9':");
    lines.push('            pos += 1');
    lines.push('    if pos == len(s):');
    lines.push('        return True');
    lines.push("    if s[pos] == 'Z':");
    lines.push('        return pos + 1 == len(s)');
    lines.push("    if s[pos] in ('+', '-'):");
    lines.push('        if pos + 6 != len(s):');
    lines.push('            return False');
    lines.push("        if not ('0' <= s[pos+1] <= '9' and '0' <= s[pos+2] <= '9'):");
    lines.push('            return False');
    lines.push("        if s[pos+3] != ':':");
    lines.push('            return False');
    lines.push("        return '0' <= s[pos+4] <= '9' and '0' <= s[pos+5] <= '9'");
    lines.push('    return False');
  }

  if (helpers.has('_check_decimal')) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push('def _check_decimal(s: str) -> bool:');
    lines.push('    if not s:');
    lines.push('        return False');
    lines.push('    i = 0');
    lines.push("    while i < len(s) and '0' <= s[i] <= '9':");
    lines.push('        i += 1');
    lines.push('    if i == 0:');
    lines.push('        return False');
    lines.push("    if i < len(s) and s[i] == '.':");
    lines.push('        i += 1');
    lines.push("        if i >= len(s) or not ('0' <= s[i] <= '9'):");
    lines.push('            return False');
    lines.push("        while i < len(s) and '0' <= s[i] <= '9':");
    lines.push('            i += 1');
    lines.push('    return i == len(s)');
  }

  if (helpers.has('_check_relay_url') || helpers.has('_check_a_tag') || helpers.has('_check_dot_tail')) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push('def _check_dot_tail(s: str, pos: int) -> bool:');
    lines.push("    return pos < len(s) and '\\n' not in s[pos:]");
  }

  if (helpers.has('_check_relay_url')) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push('_RELAY_HOST_CHARS = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-")');
    lines.push('');
    lines.push('');
    lines.push('def _check_relay_url(s: str) -> bool:');
    lines.push("    if s.startswith('wss://'):  pos = 6");
    lines.push("    elif s.startswith('ws://'):  pos = 5");
    lines.push('    else:  return False');
    lines.push('    host_start = pos');
    lines.push('    while pos < len(s) and s[pos] in _RELAY_HOST_CHARS:');
    lines.push('        pos += 1');
    lines.push('    if pos == host_start:');
    lines.push('        return False');
    lines.push("    if pos < len(s) and s[pos] == ':':");
    lines.push('        pos += 1');
    lines.push('        port_start = pos');
    lines.push("        while pos < len(s) and '0' <= s[pos] <= '9':");
    lines.push('            pos += 1');
    lines.push('        if pos == port_start:');
    lines.push('            return False');
    lines.push("    if pos < len(s) and s[pos] == '/':");
    lines.push("        return _check_dot_tail(s, pos + 1) or pos + 1 == len(s)");
    lines.push('    return pos == len(s)');
  }

  if (helpers.has('_check_a_tag')) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push('_HEX_LOWER = set("0123456789abcdef")');
    lines.push('');
    lines.push('');
    lines.push('def _check_a_tag(s: str, kinds: list[str] | None = None) -> bool:');
    lines.push('    if len(s) < 68:');
    lines.push('        return False');
    lines.push('    pos = 0');
    lines.push("    if not ('0' <= s[pos] <= '9'):");
    lines.push('        return False');
    lines.push("    while pos < len(s) and '0' <= s[pos] <= '9':");
    lines.push('        pos += 1');
    lines.push("    if pos >= len(s) or s[pos] != ':':");
    lines.push('        return False');
    lines.push('    kind_str = s[:pos]');
    lines.push('    if kinds is not None and kind_str not in kinds:');
    lines.push('        return False');
    lines.push('    pos += 1');
    lines.push('    if pos + 64 >= len(s):');
    lines.push('        return False');
    lines.push('    if not all(c in _HEX_LOWER for c in s[pos:pos+64]):');
    lines.push('        return False');
    lines.push('    pos += 64');
    lines.push("    if pos >= len(s) or s[pos] != ':':");
    lines.push('        return False');
    lines.push('    pos += 1');
    lines.push('    return _check_dot_tail(s, pos)');
  }

  if (helpers.has('_check_bech32')) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push('_BECH32_CHARS = set("023456789acdefghjklmnpqrstuvwxyz")');
    lines.push('');
    lines.push('');
    lines.push('def _check_bech32(s: str, prefix: str, data_len: int | None = None) -> bool:');
    lines.push('    if not s.startswith(prefix):');
    lines.push('        return False');
    lines.push('    data = s[len(prefix):]');
    lines.push('    if not data or not all(c in _BECH32_CHARS for c in data):');
    lines.push('        return False');
    lines.push('    if data_len is not None:');
    lines.push('        return len(data) == data_len');
    lines.push('    return True');
  }

  if (helpers.has('_check_wrapped')) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push('def _check_wrapped(s: str, prefix: str, suffix: str) -> bool:');
    lines.push('    return len(s) >= len(prefix) + len(suffix) and s.startswith(prefix) and s.endswith(suffix)');
  }

  if (helpers.has('_check_csv_list')) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push('def _check_csv_list(s: str, charset: str) -> bool:');
    lines.push('    if not s:');
    lines.push('        return False');
    lines.push('    i = 0');
    lines.push('    while True:');
    lines.push('        start = i');
    lines.push('        while i < len(s) and s[i] in charset:');
    lines.push('            i += 1');
    lines.push('        if i == start:');
    lines.push('            return False');
    lines.push('        if i == len(s):');
    lines.push('            return True');
    lines.push("        if s[i] != ',':");
    lines.push('            return False');
    lines.push('        i += 1');
  }

  if (helpers.has('_is_ecma_ws')) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push('def _is_ecma_ws(c: str) -> bool:');
    lines.push("    return c in (' ', '\\t', '\\n', '\\r', '\\x0b', '\\x0c', '\\xa0', '\\u1680',");
    lines.push("               '\\u2000', '\\u2001', '\\u2002', '\\u2003', '\\u2004', '\\u2005',");
    lines.push("               '\\u2006', '\\u2007', '\\u2008', '\\u2009', '\\u200a',");
    lines.push("               '\\u2028', '\\u2029', '\\u202f', '\\u205f', '\\u3000', '\\ufeff')");
  }

  if (helpers.has('_check_ln_invoice')) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push('def _is_bech32_data(c: str) -> bool:');
    lines.push("    return ('0' <= c <= '9' and c != '1') or ('a' <= c <= 'z' and c != 'b' and c != 'i' and c != 'o')");
    lines.push('');
    lines.push('');
    lines.push('def _check_ln_invoice(s: str, prefix: str, min_hrp_len: int) -> bool:');
    lines.push('    if not s.startswith(prefix):');
    lines.push('        return False');
    lines.push("    sep = s.rfind('1')");
    lines.push('    if sep < 0:');
    lines.push('        return False');
    lines.push('    hrp = s[:sep]');
    lines.push('    if len(hrp) < min_hrp_len:');
    lines.push('        return False');
    lines.push('    for c in hrp:');
    lines.push("        if not ('a' <= c <= 'z') and not ('0' <= c <= '9'):");
    lines.push('            return False');
    lines.push('    data = s[sep + 1:]');
    lines.push('    if not data:');
    lines.push('        return False');
    lines.push('    for c in data:');
    lines.push('        if not _is_bech32_data(c):');
    lines.push('            return False');
    lines.push('    return True');
  }

  if (helpers.has('_check_mime_type')) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push('def _check_mime_type(s: str) -> bool:');
    lines.push('    i = 0');
    lines.push("    if i >= len(s) or not ('a' <= s[i] <= 'z'):");
    lines.push('        return False');
    lines.push("    while i < len(s) and 'a' <= s[i] <= 'z':");
    lines.push('        i += 1');
    lines.push("    if i >= len(s) or s[i] != '/':");
    lines.push('        return False');
    lines.push('    i += 1');
    lines.push("    if i >= len(s) or not ('a' <= s[i] <= 'z' or '0' <= s[i] <= '9' or s[i] in '.+-'):");
    lines.push('        return False');
    lines.push("    while i < len(s) and ('a' <= s[i] <= 'z' or '0' <= s[i] <= '9' or s[i] in '.+-'):");
    lines.push('        i += 1');
    lines.push('    return i == len(s)');
  }

  if (helpers.has('_check_http_origin')) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push('def _check_http_origin(s: str) -> bool:');
    lines.push("    if s.startswith('https://'):  pos = 8");
    lines.push("    elif s.startswith('http://'):  pos = 7");
    lines.push('    else:  return False');
    lines.push('    start = pos');
    lines.push("    while pos < len(s) and s[pos] != '/':");
    lines.push('        pos += 1');
    lines.push('    if pos == start:');
    lines.push('        return False');
    lines.push("    if pos < len(s) and s[pos] == '/':");
    lines.push('        pos += 1');
    lines.push('    return pos == len(s)');
  }

  if (helpers.has('_check_email_like')) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push('def _check_email_like(s: str) -> bool:');
    lines.push('    i = 0');
    lines.push("    if i >= len(s) or _is_ecma_ws(s[i]) or s[i] == '@':");
    lines.push('        return False');
    lines.push("    while i < len(s) and not _is_ecma_ws(s[i]) and s[i] != '@':");
    lines.push('        i += 1');
    lines.push("    if i >= len(s) or s[i] != '@':");
    lines.push('        return False');
    lines.push('    i += 1');
    lines.push("    if i >= len(s) or _is_ecma_ws(s[i]) or s[i] == '@':");
    lines.push('        return False');
    lines.push("    while i < len(s) and not _is_ecma_ws(s[i]) and s[i] != '@':");
    lines.push('        i += 1');
    lines.push('    return i == len(s)');
  }

  if (helpers.has('_check_git_clone_url')) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push('def _check_git_clone_url(s: str) -> bool:');
    lines.push("    if s.startswith('git@'):");
    lines.push('        pos = 4');
    lines.push('    else:');
    lines.push("        if not s or not ('a' <= s[0] <= 'z'):");
    lines.push('            return False');
    lines.push('        pos = 1');
    lines.push("        while pos < len(s) and ('a' <= s[pos] <= 'z' or '0' <= s[pos] <= '9' or s[pos] in '+.-'):");
    lines.push('            pos += 1');
    lines.push("        if pos + 3 > len(s) or s[pos:pos+3] != '://':");
    lines.push('            return False');
    lines.push('        pos += 3');
    lines.push('    if pos >= len(s):');
    lines.push('        return False');
    lines.push('    for i in range(pos, len(s)):');
    lines.push('        if _is_ecma_ws(s[i]):');
    lines.push('            return False');
    lines.push('    return True');
  }

  if (helpers.has('_check_content_type')) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push('def _is_type_char(c: str) -> bool:');
    lines.push("    return ('a' <= c <= 'z') or ('A' <= c <= 'Z') or ('0' <= c <= '9') or c in '!#$&^_-'");
    lines.push('');
    lines.push('');
    lines.push('def _is_subtype_char(c: str) -> bool:');
    lines.push("    return _is_type_char(c) or c in '.+'");
    lines.push('');
    lines.push('');
    lines.push('def _check_content_type(s: str) -> bool:');
    lines.push('    i = 0');
    lines.push("    if i >= len(s) or not (('a' <= s[i] <= 'z') or ('A' <= s[i] <= 'Z')):");
    lines.push('        return False');
    lines.push('    i += 1');
    lines.push('    while i < len(s) and _is_type_char(s[i]):');
    lines.push('        i += 1');
    lines.push("    if i >= len(s) or s[i] != '/':");
    lines.push('        return False');
    lines.push('    i += 1');
    lines.push("    if i >= len(s) or not (('a' <= s[i] <= 'z') or ('A' <= s[i] <= 'Z') or ('0' <= s[i] <= '9') or s[i] == '*'):");
    lines.push('        return False');
    lines.push('    i += 1');
    lines.push('    while i < len(s) and _is_subtype_char(s[i]):');
    lines.push('        i += 1');
    lines.push('    while i < len(s):');
    lines.push("        j = i");
    lines.push("        while j < len(s) and _is_ecma_ws(s[j]):");
    lines.push("            j += 1");
    lines.push("        if j >= len(s):");
    lines.push('            return False');
    lines.push("        if s[j] != ';':");
    lines.push('            break');
    lines.push('        j += 1');
    lines.push("        while j < len(s) and _is_ecma_ws(s[j]):");
    lines.push("            j += 1");
    lines.push('        start = j');
    lines.push('        while j < len(s) and _is_subtype_char(s[j]):');
    lines.push('            j += 1');
    lines.push('        if j == start:');
    lines.push('            break');
    lines.push("        if j >= len(s) or s[j] != '=':");
    lines.push('            break');
    lines.push('        j += 1');
    lines.push('        start = j');
    lines.push('        while j < len(s) and _is_subtype_char(s[j]):');
    lines.push('            j += 1');
    lines.push('        if j == start:');
    lines.push('            break');
    lines.push('        i = j');
    lines.push('    return i == len(s)');
  }

  if (helpers.has('_check_doi')) {
    // doi uses _check_dot_tail which is emitted when _check_relay_url or _check_a_tag is present
    // but doi may appear without those, so emit dot_tail unconditionally if doi is present
    if (!helpers.has('_check_relay_url') && !helpers.has('_check_a_tag') && !helpers.has('_check_dot_tail')) {
      if (lines.length > 0) lines.push('');
      lines.push('');
      lines.push('def _check_dot_tail(s: str, pos: int) -> bool:');
      lines.push("    return pos < len(s) and '\\n' not in s[pos:]");
    }
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push('def _check_doi(s: str) -> bool:');
    lines.push("    if not s.startswith('10.'):");
    lines.push('        return False');
    lines.push('    i = 3');
    lines.push('    count = 0');
    lines.push("    while i < len(s) and '0' <= s[i] <= '9':");
    lines.push('        count += 1');
    lines.push('        i += 1');
    lines.push('    if count < 4 or count > 9:');
    lines.push('        return False');
    lines.push("    if i >= len(s) or s[i] != '/':");
    lines.push('        return False');
    lines.push('    i += 1');
    lines.push('    return _check_dot_tail(s, i)');
  }

  if (helpers.has('_check_annotate_user')) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push('def _check_annotate_user(s: str) -> bool:');
    lines.push("    if not s.startswith('annotate-user '):");
    lines.push('        return False');
    lines.push('    i = 14');
    lines.push('    if i + 64 > len(s):');
    lines.push('        return False');
    lines.push('    for j in range(64):');
    lines.push("        c = s[i + j]");
    lines.push("        if not (('0' <= c <= '9') or ('a' <= c <= 'f')):");
    lines.push('            return False');
    lines.push('    i += 64');
    lines.push('    for _ in range(2):');
    lines.push("        if i >= len(s) or s[i] != ':':");
    lines.push('            return False');
    lines.push('        i += 1');
    lines.push("        if i >= len(s) or not ('0' <= s[i] <= '9'):");
    lines.push('            return False');
    lines.push("        while i < len(s) and '0' <= s[i] <= '9':");
    lines.push('            i += 1');
    lines.push("        if i < len(s) and s[i] == '.':");
    lines.push('            i += 1');
    lines.push("            if i >= len(s) or not ('0' <= s[i] <= '9'):");
    lines.push('                return False');
    lines.push("            while i < len(s) and '0' <= s[i] <= '9':");
    lines.push('                i += 1');
    lines.push('    return i == len(s)');
  }

  if (helpers.has('_check_no_ws_tail')) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push('def _check_no_ws_tail(s: str, offset: int) -> bool:');
    lines.push('    if offset >= len(s):');
    lines.push('        return False');
    lines.push('    for i in range(offset, len(s)):');
    lines.push('        if _is_ecma_ws(s[i]):');
    lines.push('            return False');
    lines.push('    return True');
  }

  if (helpers.has('_check_external_identity')) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push('def _check_external_identity(s: str) -> bool:');
    lines.push('    i = 0');
    lines.push("    if i >= len(s) or not ('a' <= s[i] <= 'z' or '0' <= s[i] <= '9' or s[i] in '._-/'):");
    lines.push('        return False');
    lines.push("    while i < len(s) and ('a' <= s[i] <= 'z' or '0' <= s[i] <= '9' or s[i] in '._-/'):");
    lines.push('        i += 1');
    lines.push("    if i >= len(s) or s[i] != ':':");
    lines.push('        return False');
    lines.push('    i += 1');
    lines.push('    if i >= len(s):');
    lines.push('        return False');
    lines.push("    return '\\n' not in s[i:]");
  }

  if (helpers.has('_check_package_id')) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push('def _check_package_id(s: str) -> bool:');
    lines.push("    if s == '#':");
    lines.push('        return True');
    lines.push("    if not s or not (('a' <= s[0] <= 'z') or ('A' <= s[0] <= 'Z') or ('0' <= s[0] <= '9')):");
    lines.push('        return False');
    lines.push('    i = 1');
    lines.push("    while i < len(s) and (('a' <= s[i] <= 'z') or ('A' <= s[i] <= 'Z') or ('0' <= s[i] <= '9') or s[i] in '._+-'):");
    lines.push('        i += 1');
    lines.push('    while i < len(s):');
    lines.push("        if s[i] != ':':");
    lines.push('            return False');
    lines.push('        i += 1');
    lines.push("        if i >= len(s) or not (('a' <= s[i] <= 'z') or ('A' <= s[i] <= 'Z') or ('0' <= s[i] <= '9')):");
    lines.push('            return False');
    lines.push('        i += 1');
    lines.push("        while i < len(s) and (('a' <= s[i] <= 'z') or ('A' <= s[i] <= 'Z') or ('0' <= s[i] <= '9') or s[i] in '._+-'):");
    lines.push('            i += 1');
    lines.push('    return i == len(s)');
  }

  if (helpers.has('_check_imeta_dim')) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push('def _check_imeta_dim(s: str) -> bool:');
    lines.push('    if len(s) < 7:');
    lines.push('        return False');
    lines.push('    if s[:4] != "dim ":');
    lines.push('        return False');
    lines.push('    i = 4');
    lines.push('    dc = 0');
    lines.push('    while i < len(s) and \'0\' <= s[i] <= \'9\':');
    lines.push('        i += 1');
    lines.push('        dc += 1');
    lines.push('    if dc < 1 or dc > 5:');
    lines.push('        return False');
    lines.push('    if i >= len(s) or s[i] != \'x\':');
    lines.push('        return False');
    lines.push('    i += 1');
    lines.push('    dc = 0');
    lines.push('    while i < len(s) and \'0\' <= s[i] <= \'9\':');
    lines.push('        i += 1');
    lines.push('        dc += 1');
    lines.push('    if dc < 1 or dc > 5:');
    lines.push('        return False');
    lines.push('    return i == len(s)');
    lines.push('');
  }

  if (helpers.has('_check_dim')) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push('def _check_dim(s: str) -> bool:');
    lines.push('    if not s:');
    lines.push('        return False');
    lines.push('    i = 0');
    lines.push("    if not ('0' <= s[i] <= '9'):");
    lines.push('        return False');
    lines.push("    while i < len(s) and '0' <= s[i] <= '9':");
    lines.push('        i += 1');
    lines.push("    if i >= len(s) or s[i] != 'x':");
    lines.push('        return False');
    lines.push('    i += 1');
    lines.push("    if i >= len(s) or not ('0' <= s[i] <= '9'):");
    lines.push('        return False');
    lines.push("    while i < len(s) and '0' <= s[i] <= '9':");
    lines.push('        i += 1');
    lines.push('    return i == len(s)');
  }

  if (helpers.has('_check_no_uppercase')) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push('def _check_no_uppercase(s: str) -> bool:');
    lines.push('    if not s:');
    lines.push('        return False');
    lines.push('    for c in s:');
    lines.push("        if 'A' <= c <= 'Z':");
    lines.push('            return False');
    lines.push('    return True');
  }

  if (helpers.has('_check_dotted_digits')) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push('def _check_dotted_digits(s: str) -> bool:');
    lines.push('    if not s:');
    lines.push('        return False');
    lines.push('    i = 0');
    lines.push("    if not ('0' <= s[i] <= '9'):");
    lines.push('        return False');
    lines.push("    while i < len(s) and '0' <= s[i] <= '9':");
    lines.push('        i += 1');
    lines.push("    while i < len(s) and s[i] == '.':");
    lines.push('        i += 1');
    lines.push("        if i >= len(s) or not ('0' <= s[i] <= '9'):");
    lines.push('            return False');
    lines.push("        while i < len(s) and '0' <= s[i] <= '9':");
    lines.push('            i += 1');
    lines.push('    return i == len(s)');
  }

  if (helpers.has('_check_slash_segments')) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push('def _check_slash_segments(s: str, charset: str) -> bool:');
    lines.push('    if not s:');
    lines.push('        return False');
    lines.push('    i = 0');
    lines.push('    if s[i] not in charset:');
    lines.push('        return False');
    lines.push('    while i < len(s) and s[i] in charset:');
    lines.push('        i += 1');
    lines.push("    while i < len(s) and s[i] == '/':");
    lines.push('        i += 1');
    lines.push('        if i >= len(s) or s[i] not in charset:');
    lines.push('            return False');
    lines.push('        while i < len(s) and s[i] in charset:');
    lines.push('            i += 1');
    lines.push('    return i == len(s)');
  }

  if (helpers.has('_check_space_separated_tokens')) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push('def _check_space_separated_tokens(s: str) -> bool:');
    lines.push('    if not s:');
    lines.push('        return False');
    lines.push('    i = 0');
    lines.push('    if _is_ecma_ws(s[i]):');
    lines.push('        return False');
    lines.push('    while i < len(s) and not _is_ecma_ws(s[i]):');
    lines.push('        i += 1');
    lines.push("    while i < len(s) and s[i] == ' ':");
    lines.push('        i += 1');
    lines.push('        if i >= len(s) or _is_ecma_ws(s[i]):');
    lines.push('            return False');
    lines.push('        while i < len(s) and not _is_ecma_ws(s[i]):');
    lines.push('            i += 1');
    lines.push('    return i == len(s)');
  }

  if (helpers.has('_check_starts_with_charset')) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push('def _check_starts_with_charset(s: str, charset: str) -> bool:');
    lines.push('    return len(s) > 0 and s[0] in charset');
  }

  if (helpers.has('_check_base64')) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push('def _is_b64_char(c: str) -> bool:');
    lines.push("    return ('A' <= c <= 'Z') or ('a' <= c <= 'z') or ('0' <= c <= '9') or c == '+' or c == '/'");
    lines.push('');
    lines.push('');
    lines.push('def _check_base64(s: str) -> bool:');
    lines.push('    n = len(s)');
    lines.push('    if n == 0:');
    lines.push('        return True');
    lines.push('    if n % 4 != 0:');
    lines.push('        return False');
    lines.push('    i = 0');
    lines.push("    while i < n and s[i] != '=':");
    lines.push('        if not _is_b64_char(s[i]):');
    lines.push('            return False');
    lines.push('        i += 1');
    lines.push('    data_len = i');
    lines.push('    pad_len = n - data_len');
    lines.push('    if pad_len > 2:');
    lines.push('        return False');
    lines.push('    if pad_len == 1 and data_len % 4 != 3:');
    lines.push('        return False');
    lines.push('    if pad_len == 2 and data_len % 4 != 2:');
    lines.push('        return False');
    lines.push("    while i < n:");
    lines.push("        if s[i] != '=':");
    lines.push('            return False');
    lines.push('        i += 1');
    lines.push('    return True');
  }

  if (helpers.has('_check_base64_2pad')) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push('def _check_base64_2pad(s: str) -> bool:');
    lines.push('    n = len(s)');
    lines.push('    if n < 4 or n % 4 != 0:');
    lines.push('        return False');
    lines.push("    if s[n - 1] != '=' or s[n - 2] != '=':");
    lines.push('        return False');
    lines.push('    for i in range(n - 2):');
    lines.push('        if not _is_b64_char(s[i]):');
    lines.push('            return False');
    lines.push('    return True');
  }

  if (helpers.has('_check_nostr_uri')) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push('_BECH32_DATA_CHARS = set("023456789acdefghjklmnpqrstuvwxyz")');
    lines.push('');
    lines.push('');
    lines.push('def _check_nostr_uri(s: str) -> bool:');
    lines.push("    if not s.startswith('nostr:'):");
    lines.push('        return False');
    lines.push('    p = s[6:]');
    lines.push('    rest = len(p)');
    lines.push('    # npub1 or note1 + exactly 58 data chars');
    lines.push("    if rest == 63 and (p.startswith('npub1') or p.startswith('note1')):");
    lines.push('        return all(c in _BECH32_DATA_CHARS for c in p[5:])');
    lines.push('    # nprofile1, nevent1, naddr1 + 1+ data chars');
    lines.push('    prefix_len = 0');
    lines.push("    if p.startswith('nprofile1'):  prefix_len = 9");
    lines.push("    elif p.startswith('nevent1'):  prefix_len = 7");
    lines.push("    elif p.startswith('naddr1'):  prefix_len = 6");
    lines.push('    if prefix_len == 0 or rest <= prefix_len:');
    lines.push('        return False');
    lines.push('    return all(c in _BECH32_DATA_CHARS for c in p[prefix_len:])');
  }

  if (helpers.has('_check_nip04_encrypted')) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push('def _check_nip04_encrypted(s: str) -> bool:');
    lines.push("    sep = s.find('?iv=')");
    lines.push('    if sep < 1:');
    lines.push('        return False');
    lines.push('    right_start = sep + 4');
    lines.push('    if right_start >= len(s):');
    lines.push('        return False');
    lines.push('    # check left half: 1+ b64 chars + 0-2 =');
    lines.push('    i = 0');
    lines.push('    while i < sep and _is_b64_char(s[i]):');
    lines.push('        i += 1');
    lines.push('    if i == 0:');
    lines.push('        return False');
    lines.push('    eq = 0');
    lines.push("    while i < sep and s[i] == '=':");
    lines.push('        i += 1');
    lines.push('        eq += 1');
    lines.push('    if i != sep or eq > 2:');
    lines.push('        return False');
    lines.push('    # check right half');
    lines.push('    i = right_start');
    lines.push('    data_start = i');
    lines.push('    while i < len(s) and _is_b64_char(s[i]):');
    lines.push('        i += 1');
    lines.push('    if i == data_start:');
    lines.push('        return False');
    lines.push('    eq = 0');
    lines.push("    while i < len(s) and s[i] == '=':");
    lines.push('        i += 1');
    lines.push('        eq += 1');
    lines.push('    return i == len(s) and eq <= 2');
  }

  if (helpers.has('_check_nip05_identifier')) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push('def _is_nip05_local_char(c: str) -> bool:');
    lines.push("    return c == '_' or ('A' <= c <= 'Z') or ('a' <= c <= 'z') or ('0' <= c <= '9') or c == '.' or c == '-'");
    lines.push('');
    lines.push('');
    lines.push('def _is_domain_char(c: str) -> bool:');
    lines.push("    return ('A' <= c <= 'Z') or ('a' <= c <= 'z') or ('0' <= c <= '9') or c == '-'");
    lines.push('');
    lines.push('');
    lines.push('def _is_alnum(c: str) -> bool:');
    lines.push("    return ('A' <= c <= 'Z') or ('a' <= c <= 'z') or ('0' <= c <= '9')");
    lines.push('');
    lines.push('');
    lines.push('def _check_nip05_identifier(s: str) -> bool:');
    lines.push('    if not s:');
    lines.push('        return False');
    lines.push('    # find last @');
    lines.push("    at = s.rfind('@')");
    lines.push('    if at < 1:');
    lines.push('        return False');
    lines.push('    # local part: [_A-Za-z0-9.-]+');
    lines.push('    local = s[:at]');
    lines.push('    if not all(_is_nip05_local_char(c) for c in local):');
    lines.push('        return False');
    lines.push('    # domain: 2+ dot-separated labels');
    lines.push('    domain = s[at + 1:]');
    lines.push('    if not domain:');
    lines.push('        return False');
    lines.push('    dot_count = 0');
    lines.push('    di = 0');
    lines.push('    dlen = len(domain)');
    lines.push('    while di < dlen:');
    lines.push('        if not _is_alnum(domain[di]):');
    lines.push('            return False');
    lines.push('        while di < dlen and _is_domain_char(domain[di]):');
    lines.push('            di += 1');
    lines.push('        if not _is_alnum(domain[di - 1]):');
    lines.push('            return False');
    lines.push("        if di < dlen and domain[di] == '.':");
    lines.push('            dot_count += 1');
    lines.push('            di += 1');
    lines.push('        elif di < dlen:');
    lines.push('            return False');
    lines.push('    return dot_count >= 1 and _is_alnum(domain[dlen - 1])');
  }

  if (helpers.has('_check_mime_type_strict')) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push('_MIME_STRICT_CHARS = set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$&^_.+-")');
    lines.push('');
    lines.push('');
    lines.push('def _is_mime_alnum(c: str) -> bool:');
    lines.push("    return ('A' <= c <= 'Z') or ('a' <= c <= 'z') or ('0' <= c <= '9')");
    lines.push('');
    lines.push('');
    lines.push('def _check_mime_type_strict(s: str) -> bool:');
    lines.push('    if not s:');
    lines.push('        return False');
    lines.push('    i = 0');
    lines.push('    if not _is_mime_alnum(s[i]):');
    lines.push('        return False');
    lines.push('    i += 1');
    lines.push('    while i < len(s) and s[i] in _MIME_STRICT_CHARS:');
    lines.push('        i += 1');
    lines.push("    if i >= len(s) or s[i] != '/':");
    lines.push('        return False');
    lines.push('    i += 1');
    lines.push('    if i >= len(s) or not _is_mime_alnum(s[i]):');
    lines.push('        return False');
    lines.push('    i += 1');
    lines.push('    while i < len(s) and s[i] in _MIME_STRICT_CHARS:');
    lines.push('        i += 1');
    lines.push('    return i == len(s)');
  }

  if (helpers.has('_check_prefix_delim_rest')) {
    if (lines.length > 0) lines.push('');
    lines.push('');
    lines.push('def _check_prefix_delim_rest(s: str, charset: str, delimiter: str) -> bool:');
    lines.push('    if not s:');
    lines.push('        return False');
    lines.push('    i = 0');
    lines.push('    if s[i] not in charset:');
    lines.push('        return False');
    lines.push('    while i < len(s) and s[i] in charset:');
    lines.push('        i += 1');
    lines.push('    dlen = len(delimiter)');
    lines.push('    if i + dlen >= len(s):');
    lines.push('        return False');
    lines.push('    if s[i:i + dlen] != delimiter:');
    lines.push('        return False');
    lines.push('    i += dlen');
    lines.push('    if i >= len(s):');
    lines.push('        return False');
    lines.push("    # .+ first char must not be a line terminator (Python re . excludes \\n only)");
    lines.push("    if s[i] == '\\n':");
    lines.push('        return False');
    lines.push('    return True');
  }

  return lines.join('\n');
}
