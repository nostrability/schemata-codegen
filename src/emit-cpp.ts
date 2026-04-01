/**
 * C++ validator emitter: ValidatorAction[] → header-only .hpp file
 *
 * Expression-oriented: uses std::any_of/std::none_of with lambdas
 * for tag searches, range-based for loops for iteration.
 *
 * Generated code is C++17 compatible (uses compare() for starts_with,
 * std::string overloaded == for comparison). Emits a single header
 * wrapped in namespace schemata {}.
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

function renderPatternCheckCpp(check: PatternCheck, varExpr: string): { expr: string; helpers: Set<string> } {
  const helpers = new Set<string>();
  switch (check.op) {
    case 'hex': {
      const fn = check.case === 'lower' ? `check_hex_${check.len}` : `check_hex_${check.len}_mixed`;
      helpers.add(fn);
      return { expr: `${fn}(${varExpr})`, helpers };
    }
    case 'hex_range': {
      const fn = check.case === 'lower' ? 'check_hex_range' : 'check_hex_range_mixed';
      helpers.add(fn);
      return { expr: `${fn}(${varExpr}, ${check.min}, ${check.max})`, helpers };
    }
    case 'hex_prefixed': {
      helpers.add('check_hex_prefixed');
      return { expr: `check_hex_prefixed(${varExpr}, ${JSON.stringify(check.prefix)}, ${check.hexLen})`, helpers };
    }
    case 'all_digits': {
      const fn = check.allowNeg ? 'check_signed_int' : 'check_digits';
      helpers.add(fn);
      return { expr: `${fn}(${varExpr})`, helpers };
    }
    case 'starts_with_any': {
      const checks = check.prefixes.map(p => {
        const len = p.length;
        return `(${varExpr}.size() >= ${len} && ${varExpr}.compare(0, ${len}, ${JSON.stringify(p)}) == 0)`;
      });
      return { expr: checks.length === 1 ? checks[0] : `(${checks.join(' || ')})`, helpers };
    }
    case 'chars_in': {
      if (check.min === 0 && check.max === 0) {
        return { expr: `${varExpr}.empty()`, helpers };
      }
      helpers.add('check_chars_in');
      const maxVal = check.max !== undefined ? String(check.max) : 'std::string::npos';
      return {
        expr: `check_chars_in(${varExpr}, ${JSON.stringify(check.charset)}, ${check.min ?? 0}, ${maxVal})`,
        helpers,
      };
    }
    case 'bech32': {
      helpers.add('check_bech32');
      if (check.dataLen !== undefined) {
        return { expr: `check_bech32(${varExpr}, ${JSON.stringify(check.hrp + '1')}, ${check.dataLen})`, helpers };
      }
      return { expr: `check_bech32(${varExpr}, ${JSON.stringify(check.hrp + '1')})`, helpers };
    }
    case 'regex': {
      helpers.add('regex');
      return { expr: `std::regex_match(${varExpr}, std::regex(${JSON.stringify(check.pattern)}))`, helpers };
    }
    case 'relay_url': {
      helpers.add('check_relay_url');
      return { expr: `check_relay_url(${varExpr})`, helpers };
    }
    case 'a_tag': {
      helpers.add('check_a_tag');
      if (check.kinds && check.kinds.length > 0) {
        return { expr: `check_a_tag(${varExpr}, {${check.kinds.map(k => JSON.stringify(k)).join(', ')}})`, helpers };
      }
      return { expr: `check_a_tag(${varExpr}, {})`, helpers };
    }
    case 'date_iso': {
      helpers.add('check_date_iso');
      return { expr: `check_date_iso(${varExpr})`, helpers };
    }
    case 'datetime_iso': {
      helpers.add('check_datetime_iso');
      return { expr: `check_datetime_iso(${varExpr})`, helpers };
    }
    case 'decimal': {
      helpers.add('check_decimal');
      return { expr: `check_decimal(${varExpr})`, helpers };
    }
    case 'exact_values': {
      const checks = check.values.map(v => `${varExpr} == ${JSON.stringify(v)}`);
      return { expr: checks.length === 1 ? checks[0] : `(${checks.join(' || ')})`, helpers };
    }
    case 'prefix_nonempty': {
      helpers.add('check_dot_tail');
      const len = check.prefix.length;
      return {
        expr: `(${varExpr}.size() > ${len} && ${varExpr}.compare(0, ${len}, ${JSON.stringify(check.prefix)}) == 0 && check_dot_tail(${varExpr}, ${len}))`,
        helpers,
      };
    }
    case 'wrapped': {
      helpers.add('check_wrapped');
      return { expr: `check_wrapped(${varExpr}, ${JSON.stringify(check.prefix)}, ${JSON.stringify(check.suffix)})`, helpers };
    }
    case 'csv_list': {
      helpers.add('check_csv_list');
      return { expr: `check_csv_list(${varExpr}, ${JSON.stringify(check.itemCharset)})`, helpers };
    }
    case 'ln_invoice': {
      helpers.add('check_ln_invoice');
      helpers.add('check_bech32'); // triggers is_bech32_char
      return { expr: `check_ln_invoice(${varExpr}, ${JSON.stringify(check.prefix)}, ${check.minHrpLen})`, helpers };
    }
    case 'mime_type': {
      helpers.add('check_mime_type');
      return { expr: `check_mime_type(${varExpr})`, helpers };
    }
    case 'http_origin': {
      helpers.add('check_http_origin');
      return { expr: `check_http_origin(${varExpr})`, helpers };
    }
    case 'email_like': {
      helpers.add('check_email_like');
      helpers.add('is_ecma_ws');
      return { expr: `check_email_like(${varExpr})`, helpers };
    }
    case 'git_clone_url': {
      helpers.add('check_git_clone_url');
      helpers.add('is_ecma_ws');
      return { expr: `check_git_clone_url(${varExpr})`, helpers };
    }
    case 'content_type': {
      helpers.add('check_content_type');
      helpers.add('is_ecma_ws');
      return { expr: `check_content_type(${varExpr})`, helpers };
    }
    case 'doi': {
      helpers.add('check_doi');
      helpers.add('check_relay_url'); // triggers check_dot_tail
      return { expr: `check_doi(${varExpr})`, helpers };
    }
    case 'annotate_user': {
      helpers.add('check_annotate_user');
      return { expr: `check_annotate_user(${varExpr})`, helpers };
    }
    case 'prefix_no_whitespace': {
      helpers.add('check_no_ws_tail');
      helpers.add('is_ecma_ws');
      const checks = check.prefixes.map(p => {
        const len = p.length;
        return `(${varExpr}.size() >= ${len} && ${varExpr}.compare(0, ${len}, ${JSON.stringify(p)}) == 0 && check_no_ws_tail(${varExpr}, ${len}))`;
      });
      return { expr: checks.length === 1 ? checks[0] : `(${checks.join(' || ')})`, helpers };
    }
    case 'external_identity': {
      helpers.add('check_external_identity');
      return { expr: `check_external_identity(${varExpr})`, helpers };
    }
    case 'package_id': {
      helpers.add('check_package_id');
      return { expr: `check_package_id(${varExpr})`, helpers };
    }
    case 'imeta_dim': {
      helpers.add('check_imeta_dim');
      return { expr: `check_imeta_dim(${varExpr})`, helpers };
    }
    case 'dim': {
      helpers.add('check_dim');
      return { expr: `check_dim(${varExpr})`, helpers };
    }
    case 'no_uppercase': {
      helpers.add('check_no_uppercase');
      return { expr: `check_no_uppercase(${varExpr})`, helpers };
    }
    case 'dotted_digits': {
      helpers.add('check_dotted_digits');
      return { expr: `check_dotted_digits(${varExpr})`, helpers };
    }
    case 'slash_segments': {
      helpers.add('check_slash_segments');
      return { expr: `check_slash_segments(${varExpr}, ${JSON.stringify(check.charset)})`, helpers };
    }
    case 'space_separated_tokens': {
      helpers.add('check_space_separated_tokens');
      helpers.add('is_ecma_ws');
      return { expr: `check_space_separated_tokens(${varExpr})`, helpers };
    }
    case 'starts_with_charset': {
      helpers.add('check_starts_with_charset');
      return { expr: `check_starts_with_charset(${varExpr}, ${JSON.stringify(check.charset)})`, helpers };
    }
    case 'base64': {
      helpers.add('check_base64');
      return { expr: `check_base64(${varExpr})`, helpers };
    }
    case 'nostr_uri': {
      helpers.add('check_nostr_uri');
      return { expr: `check_nostr_uri(${varExpr})`, helpers };
    }
    case 'nip04_encrypted': {
      helpers.add('check_nip04_encrypted');
      helpers.add('check_base64'); // for is_b64_char
      return { expr: `check_nip04_encrypted(${varExpr})`, helpers };
    }
    case 'nip05_identifier': {
      helpers.add('check_nip05_identifier');
      helpers.add('is_alnum');
      return { expr: `check_nip05_identifier(${varExpr})`, helpers };
    }
    case 'mime_type_strict': {
      helpers.add('check_mime_type_strict');
      helpers.add('is_alnum');
      return { expr: `check_mime_type_strict(${varExpr})`, helpers };
    }
    case 'prefix_delim_rest': {
      helpers.add('check_prefix_delim_rest');
      return { expr: `check_prefix_delim_rest(${varExpr}, ${JSON.stringify(check.charset)}, ${JSON.stringify(check.delimiter)})`, helpers };
    }
    case 'compound': {
      const allHelpers = new Set<string>();
      const parts: string[] = [];
      for (const sub of check.checks) {
        const r = renderPatternCheckCpp(sub, varExpr);
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

// --- Value check rendering ---

function renderValueCheckCpp(
  check: ValueCheck,
  tagVar: string,
  index: number,
): { expr: string; helpers: Set<string> } {
  const helpers = new Set<string>();
  const sizeGuard = `${tagVar}.size() > ${index}`;
  const access = `${tagVar}[${index}]`;

  switch (check.type) {
    case 'const':
      return { expr: `(${sizeGuard} && ${access} == ${JSON.stringify(check.value)})`, helpers };
    case 'enum': {
      const vals = check.values.map(v => `${access} == ${JSON.stringify(v)}`);
      return {
        expr: `(${sizeGuard} && (${vals.join(' || ')}))`,
        helpers,
      };
    }
    case 'pattern': {
      const r = renderPatternCheckCpp(check.native, access);
      for (const h of r.helpers) helpers.add(h);
      return {
        expr: `(${sizeGuard} && ${r.expr})`,
        helpers,
      };
    }
    case 'anyOf': {
      const parts: string[] = [];
      for (const alt of check.alternatives) {
        const r = renderValueCheckCpp(alt, tagVar, index);
        parts.push(r.expr);
        for (const h of r.helpers) helpers.add(h);
      }
      return { expr: `(${parts.join(' || ')})`, helpers };
    }
  }
}

function describePositionConstraintCpp(pc: PositionCheck, tagName: string): string {
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

function renderTagMatcherCpp(
  matcher: TagMatcher,
  tagVar: string,
  helpers: Set<string>,
): string {
  const checks: string[] = [];

  checks.push(`!${tagVar}.empty() && ${tagVar}[0] == ${JSON.stringify(matcher.tagName)}`);
  checks.push(`${tagVar}.size() >= ${matcher.minItems}`);
  if (matcher.maxItems !== undefined) {
    checks.push(`${tagVar}.size() <= ${matcher.maxItems}`);
  }

  for (const pc of matcher.positionChecks) {
    const r = renderValueCheckCpp(pc.check, tagVar, pc.index);
    for (const h of r.helpers) helpers.add(h);
    checks.push(r.expr);
  }

  return checks.join(' && ');
}

// --- Main emitter ---

export function emitCppValidators(kindShapes: KindShape[]): string {
  const allHelpers = new Set<string>();
  const fnBodies: string[] = [];
  const constrainedKinds: { kindNumber: number; nip: string }[] = [];

  for (const shape of [...kindShapes].sort((a, b) => a.kindNumber - b.kindNumber)) {
    const actions = planKindValidator(shape);
    if (!actions) continue;

    constrainedKinds.push({ kindNumber: shape.kindNumber, nip: shape.nip });
    const { code, helpers } = emitKindFunctionCpp(shape.kindNumber, shape.nip, actions);
    fnBodies.push(code);
    for (const h of helpers) allHelpers.add(h);
  }

  return emitCppFile(fnBodies, constrainedKinds, allHelpers);
}

function emitKindFunctionCpp(
  kindNumber: number,
  nip: string,
  actions: ValidatorAction[],
): { code: string; helpers: Set<string> } {
  const helpers = new Set<string>();
  const lines: string[] = [];

  lines.push(`/// Validate tags for kind ${kindNumber} (${nip})`);
  lines.push(`inline std::vector<ValidationError> validate_kind_${kindNumber}(const std::vector<std::vector<std::string>>& tags) {`);
  lines.push('    std::vector<ValidationError> errors;');

  for (const action of actions) {
    switch (action.type) {
      case 'check_min_tags':
        lines.push(`    if (tags.size() < ${action.min}) {`);
        lines.push(`        errors.push_back({"tags", "tags must have at least ${action.min} item(s)"});`);
        lines.push('    }');
        break;

      case 'require_tag': {
        const matcherExpr = renderTagMatcherCpp(action.matcher, 't', helpers);
        lines.push(`    if (!std::any_of(tags.begin(), tags.end(), [](const std::vector<std::string>& t) { return ${matcherExpr}; })) {`);
        lines.push(`        errors.push_back({"tags", ${JSON.stringify(action.errorMsg)}});`);
        lines.push('    }');
        break;
      }

      case 'validate_optional_positions': {
        lines.push('    for (const auto& t : tags) {');
        lines.push(`        if (!t.empty() && t[0] == ${JSON.stringify(action.tagName)}) {`);
        for (const pc of action.checks) {
          const r = renderValueCheckCpp(pc.check, 't', pc.index);
          for (const h of r.helpers) helpers.add(h);
          const msg = describePositionConstraintCpp(pc, action.tagName);
          lines.push(`            if (t.size() > ${pc.index} && !(${r.expr})) {`);
          lines.push(`                errors.push_back({"tags", ${JSON.stringify(msg)}});`);
          lines.push('            }');
        }
        lines.push('        }');
        lines.push('    }');
        break;
      }

      case 'per_item_conditional': {
        const matcherExpr = renderTagMatcherCpp(action.matcher, 't', helpers);
        lines.push('    for (const auto& t : tags) {');
        lines.push(`        if (!t.empty() && t[0] == ${JSON.stringify(action.condTag)} && !(${matcherExpr})) {`);
        lines.push(`            errors.push_back({"tags", ${JSON.stringify(action.errorMsg)}});`);
        lines.push('        }');
        if (action.optChecks.length > 0) {
          lines.push(`        if (!t.empty() && t[0] == ${JSON.stringify(action.condTag)}) {`);
          for (const pc of action.optChecks) {
            const r = renderValueCheckCpp(pc.check, 't', pc.index);
            for (const h of r.helpers) helpers.add(h);
            const msg = describePositionConstraintCpp(pc, action.condTag);
            lines.push(`            if (t.size() > ${pc.index} && !(${r.expr})) {`);
            lines.push(`                errors.push_back({"tags", ${JSON.stringify(msg)}});`);
            lines.push('            }');
          }
          lines.push('        }');
        }
        lines.push('    }');
        break;
      }

      case 'array_level_conditional': {
        lines.push(`    if (std::any_of(tags.begin(), tags.end(), [](const std::vector<std::string>& t) { return !t.empty() && t[0] == ${JSON.stringify(action.condTag)}; })) {`);
        const matcherExpr = renderTagMatcherCpp(action.matcher, 't', helpers);
        lines.push(`        if (!std::any_of(tags.begin(), tags.end(), [](const std::vector<std::string>& t) { return ${matcherExpr}; })) {`);
        lines.push(`            errors.push_back({"tags", ${JSON.stringify(action.errorMsg)}});`);
        lines.push('        }');
        if (action.optChecks.length > 0) {
          lines.push('        for (const auto& t : tags) {');
          lines.push(`            if (!t.empty() && t[0] == ${JSON.stringify(action.matcher.tagName)}) {`);
          for (const pc of action.optChecks) {
            const r = renderValueCheckCpp(pc.check, 't', pc.index);
            for (const h of r.helpers) helpers.add(h);
            const msg = describePositionConstraintCpp(pc, action.matcher.tagName);
            lines.push(`                if (t.size() > ${pc.index} && !(${r.expr})) {`);
            lines.push(`                    errors.push_back({"tags", ${JSON.stringify(msg)}});`);
            lines.push('                }');
          }
          lines.push('            }');
          lines.push('        }');
        }
        lines.push('    }');
        break;
      }

      case 'any_of_group': {
        const matchers = action.matchers.map(m => {
          const expr = renderTagMatcherCpp(m, 't', helpers);
          return `std::any_of(tags.begin(), tags.end(), [](const std::vector<std::string>& t) { return ${expr}; })`;
        });
        lines.push(`    if (!(${matchers.join(' || ')})) {`);
        lines.push(`        errors.push_back({"tags", ${JSON.stringify(action.errorMsg)}});`);
        lines.push('    }');
        break;
      }
    }
  }

  lines.push('    return errors;');
  lines.push('}');

  return { code: lines.join('\n'), helpers };
}

// --- File generation ---

function emitCppFile(
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
    '#pragma once',
    '',
    '#include <vector>',
    '#include <string>',
    '#include <algorithm>',
    '#include <cstddef>',
  ];

  if (needsRegex) {
    lines.push('#include <regex>');
  }

  lines.push('');
  lines.push('namespace schemata {');
  lines.push('');
  lines.push('struct ValidationError {');
  lines.push('    const char* path;');
  lines.push('    const char* message;');
  lines.push('};');
  lines.push('');

  lines.push(emitCppHelpers(helpers));

  for (const fn of fnBodies) {
    lines.push(fn);
    lines.push('');
  }

  lines.push('/// Validate tags for a given kind number.');
  lines.push('/// Returns empty vector if kind has no constraints or is unknown.');
  lines.push('inline std::vector<ValidationError> validate_kind_tags(int kind, const std::vector<std::vector<std::string>>& tags) {');
  lines.push('    switch (kind) {');
  for (const k of constrainedKinds) {
    lines.push(`    case ${k.kindNumber}: return validate_kind_${k.kindNumber}(tags);`);
  }
  lines.push('    default: return {};');
  lines.push('    }');
  lines.push('}');
  lines.push('');
  lines.push('} // namespace schemata');
  lines.push('');

  return lines.join('\n');
}

function emitCppHelpers(helpers: Set<string>): string {
  const lines: string[] = [];

  const hexLengths = new Set<number>();
  const hexMixedLengths = new Set<number>();
  for (const h of helpers) {
    const m = h.match(/^check_hex_(\d+)$/);
    if (m) hexLengths.add(parseInt(m[1], 10));
    const mm = h.match(/^check_hex_(\d+)_mixed$/);
    if (mm) hexMixedLengths.add(parseInt(mm[1], 10));
  }

  for (const len of [...hexLengths].sort((a, b) => a - b)) {
    lines.push(`inline bool check_hex_${len}(const std::string& s) {`);
    lines.push(`    return s.size() == ${len} && std::all_of(s.begin(), s.end(), [](char c) { return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'); });`);
    lines.push('}');
    lines.push('');
  }

  for (const len of [...hexMixedLengths].sort((a, b) => a - b)) {
    lines.push(`inline bool check_hex_${len}_mixed(const std::string& s) {`);
    lines.push(`    return s.size() == ${len} && std::all_of(s.begin(), s.end(), [](char c) {`);
    lines.push(`        return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');`);
    lines.push('    });');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_hex_range')) {
    lines.push('inline bool check_hex_range(const std::string& s, std::size_t min, std::size_t max) {');
    lines.push('    return s.size() >= min && s.size() <= max && std::all_of(s.begin(), s.end(), [](char c) { return (c >= \'0\' && c <= \'9\') || (c >= \'a\' && c <= \'f\'); });');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_hex_range_mixed')) {
    lines.push('inline bool check_hex_range_mixed(const std::string& s, std::size_t min, std::size_t max) {');
    lines.push('    return s.size() >= min && s.size() <= max && std::all_of(s.begin(), s.end(), [](char c) {');
    lines.push('        return (c >= \'0\' && c <= \'9\') || (c >= \'a\' && c <= \'f\') || (c >= \'A\' && c <= \'F\');');
    lines.push('    });');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_hex_prefixed')) {
    lines.push('inline bool check_hex_prefixed(const std::string& s, const std::string& prefix, std::size_t hex_len) {');
    lines.push('    if (s.size() != prefix.size() + hex_len) return false;');
    lines.push('    if (s.compare(0, prefix.size(), prefix) != 0) return false;');
    lines.push('    return std::all_of(s.begin() + static_cast<std::ptrdiff_t>(prefix.size()), s.end(), [](char c) { return (c >= \'0\' && c <= \'9\') || (c >= \'a\' && c <= \'f\'); });');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_digits')) {
    lines.push('inline bool check_digits(const std::string& s) {');
    lines.push('    return !s.empty() && std::all_of(s.begin(), s.end(), [](char c) { return c >= \'0\' && c <= \'9\'; });');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_signed_int')) {
    lines.push('inline bool check_signed_int(const std::string& s) {');
    lines.push('    if (s.empty()) return false;');
    lines.push('    auto it = s.begin();');
    lines.push('    if (*it == \'-\') ++it;');
    lines.push('    if (it == s.end()) return false;');
    lines.push('    return std::all_of(it, s.end(), [](char c) { return c >= \'0\' && c <= \'9\'; });');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_chars_in')) {
    lines.push('inline bool check_chars_in(const std::string& s, const std::string& charset, std::size_t min, std::size_t max) {');
    lines.push('    return s.size() >= min && (max == std::string::npos || s.size() <= max) && std::all_of(s.begin(), s.end(), [&charset](char c) {');
    lines.push('        return charset.find(c) != std::string::npos;');
    lines.push('    });');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_date_iso')) {
    lines.push('inline bool check_date_iso(const std::string& s) {');
    lines.push('    if (s.size() != 10) return false;');
    lines.push("    if (s[4] != '-' || s[7] != '-') return false;");
    lines.push('    for (int i = 0; i < 10; i++) {');
    lines.push('        if (i == 4 || i == 7) continue;');
    lines.push("        if (s[i] < '0' || s[i] > '9') return false;");
    lines.push('    }');
    lines.push('    return true;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_datetime_iso')) {
    lines.push('inline bool check_datetime_iso(const std::string& s) {');
    lines.push('    if (s.size() < 10) return false;');
    lines.push("    for (int i = 0; i < 4; i++) if (s[i] < '0' || s[i] > '9') return false;");
    lines.push("    if (s[4] != '-') return false;");
    lines.push("    for (int i = 5; i < 7; i++) if (s[i] < '0' || s[i] > '9') return false;");
    lines.push("    if (s[7] != '-') return false;");
    lines.push("    for (int i = 8; i < 10; i++) if (s[i] < '0' || s[i] > '9') return false;");
    lines.push('    if (s.size() == 10) return true;');
    lines.push("    if (s[10] != 'T' || s.size() < 16) return false;");
    lines.push("    for (int i = 11; i < 13; i++) if (s[i] < '0' || s[i] > '9') return false;");
    lines.push("    if (s[13] != ':') return false;");
    lines.push("    for (int i = 14; i < 16; i++) if (s[i] < '0' || s[i] > '9') return false;");
    lines.push('    std::size_t pos = 16;');
    lines.push('    if (pos == s.size()) return true;');
    lines.push("    if (s[pos] == ':') {");
    lines.push('        if (pos + 3 > s.size()) return false;');
    lines.push("        if (s[pos+1] < '0' || s[pos+1] > '9' || s[pos+2] < '0' || s[pos+2] > '9') return false;");
    lines.push('        pos += 3;');
    lines.push('    }');
    lines.push('    if (pos == s.size()) return true;');
    lines.push("    if (s[pos] == '.') {");
    lines.push('        pos++;');
    lines.push("        if (pos >= s.size() || s[pos] < '0' || s[pos] > '9') return false;");
    lines.push("        while (pos < s.size() && s[pos] >= '0' && s[pos] <= '9') pos++;");
    lines.push('    }');
    lines.push('    if (pos == s.size()) return true;');
    lines.push("    if (s[pos] == 'Z') return pos + 1 == s.size();");
    lines.push("    if (s[pos] == '+' || s[pos] == '-') {");
    lines.push('        if (pos + 6 != s.size()) return false;');
    lines.push("        if (s[pos+1] < '0' || s[pos+1] > '9' || s[pos+2] < '0' || s[pos+2] > '9') return false;");
    lines.push("        if (s[pos+3] != ':') return false;");
    lines.push("        return s[pos+4] >= '0' && s[pos+4] <= '9' && s[pos+5] >= '0' && s[pos+5] <= '9';");
    lines.push('    }');
    lines.push('    return false;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_decimal')) {
    lines.push('inline bool check_decimal(const std::string& s) {');
    lines.push('    if (s.empty()) return false;');
    lines.push('    size_t i = 0;');
    lines.push("    while (i < s.size() && s[i] >= '0' && s[i] <= '9') i++;");
    lines.push("    if (i == 0) return false;");
    lines.push("    if (i < s.size() && s[i] == '.') {");
    lines.push('        i++;');
    lines.push("        if (i >= s.size() || s[i] < '0' || s[i] > '9') return false;");
    lines.push("        while (i < s.size() && s[i] >= '0' && s[i] <= '9') i++;");
    lines.push('    }');
    lines.push('    return i == s.size();');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_relay_url') || helpers.has('check_a_tag') || helpers.has('check_dot_tail')) {
    lines.push('inline bool check_dot_tail(const std::string& s, size_t pos) {');
    lines.push('    if (pos >= s.size()) return false;');
    lines.push('    const unsigned char* u = reinterpret_cast<const unsigned char*>(s.data());');
    lines.push('    for (size_t j = pos; j < s.size(); j++) {');
    lines.push("        if (u[j] == 0x0A || u[j] == 0x0D) return false;");
    lines.push('    }');
    lines.push('    return true;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_relay_url')) {
    lines.push('inline bool check_relay_url(const std::string& s) {');
    lines.push('    std::size_t pos = 0;');
    lines.push('    if (s.compare(0, 6, "wss://") == 0) { pos = 6; }');
    lines.push('    else if (s.compare(0, 5, "ws://") == 0) { pos = 5; }');
    lines.push('    else { return false; }');
    lines.push('    std::size_t host_start = pos;');
    lines.push('    while (pos < s.size()) {');
    lines.push('        char c = s[pos];');
    lines.push("        if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '-') { pos++; }");
    lines.push('        else { break; }');
    lines.push('    }');
    lines.push('    if (pos == host_start) return false;');
    lines.push("    if (pos < s.size() && s[pos] == ':') {");
    lines.push('        pos++;');
    lines.push('        std::size_t port_start = pos;');
    lines.push("        while (pos < s.size() && s[pos] >= '0' && s[pos] <= '9') pos++;");
    lines.push('        if (pos == port_start) return false;');
    lines.push('    }');
    lines.push("    if (pos < s.size() && s[pos] == '/') {");
    lines.push('        return check_dot_tail(s, pos + 1) || pos + 1 == s.size();');
    lines.push('    }');
    lines.push('    return pos == s.size();');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_a_tag')) {
    lines.push('inline bool check_a_tag(const std::string& s, const std::vector<std::string>& kinds) {');
    lines.push('    if (s.size() < 68) return false;');
    lines.push('    std::size_t pos = 0;');
    lines.push("    if (s[pos] < '0' || s[pos] > '9') return false;");
    lines.push('    std::size_t kind_start = pos;');
    lines.push("    while (pos < s.size() && s[pos] >= '0' && s[pos] <= '9') pos++;");
    lines.push('    std::size_t kind_len = pos - kind_start;');
    lines.push("    if (pos >= s.size() || s[pos] != ':') return false;");
    lines.push('    if (!kinds.empty()) {');
    lines.push('        bool found = false;');
    lines.push('        for (const auto& k : kinds) {');
    lines.push('            if (k.size() == kind_len && s.compare(kind_start, kind_len, k) == 0) { found = true; break; }');
    lines.push('        }');
    lines.push('        if (!found) return false;');
    lines.push('    }');
    lines.push('    pos++;');
    lines.push('    if (pos + 64 >= s.size()) return false;');
    lines.push('    for (std::size_t i = 0; i < 64; i++) {');
    lines.push('        char c = s[pos + i];');
    lines.push("        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;");
    lines.push('    }');
    lines.push('    pos += 64;');
    lines.push("    if (pos >= s.size() || s[pos] != ':') return false;");
    lines.push('    pos++;');
    lines.push('    return check_dot_tail(s, pos);');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_bech32')) {
    lines.push('inline bool is_bech32_char(char c) {');
    lines.push("    return (c >= '0' && c <= '9' && c != '1') || (c >= 'a' && c <= 'z' && c != 'b' && c != 'i' && c != 'o');");
    lines.push('}');
    lines.push('');
    lines.push('inline bool check_bech32(const std::string& s, const std::string& prefix, int data_len = -1) {');
    lines.push('    if (s.size() < prefix.size() || s.compare(0, prefix.size(), prefix) != 0) return false;');
    lines.push('    auto data = s.substr(prefix.size());');
    lines.push('    if (data.empty()) return false;');
    lines.push('    if (!std::all_of(data.begin(), data.end(), is_bech32_char)) return false;');
    lines.push('    if (data_len >= 0) return static_cast<int>(data.size()) == data_len;');
    lines.push('    return true;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('is_ecma_ws')) {
    lines.push('/* ECMAScript \\s semantics: full Unicode whitespace set (UTF-8 bytes) */');
    lines.push('/* Returns number of bytes consumed (1-3) if whitespace, 0 otherwise */');
    lines.push('inline int is_ecma_ws(const std::string& s, size_t pos) {');
    lines.push('    if (pos >= s.size()) return 0;');
    lines.push('    unsigned char c = static_cast<unsigned char>(s[pos]);');
    lines.push('    /* ASCII whitespace: 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20 */');
    lines.push('    if (c == 0x09 || c == 0x0A || c == 0x0B || c == 0x0C || c == 0x0D || c == 0x20) return 1;');
    lines.push('    /* 2-byte UTF-8: U+00A0 (C2 A0) */');
    lines.push('    if (c == 0xC2 && pos + 1 < s.size() && static_cast<unsigned char>(s[pos + 1]) == 0xA0) return 2;');
    lines.push('    /* 3-byte UTF-8 */');
    lines.push('    if (c == 0xE1 && pos + 2 < s.size() && static_cast<unsigned char>(s[pos + 1]) == 0x9A && static_cast<unsigned char>(s[pos + 2]) == 0x80) return 3; /* U+1680 */');
    lines.push('    if (c == 0xE2 && pos + 2 < s.size()) {');
    lines.push('        unsigned char b1 = static_cast<unsigned char>(s[pos + 1]);');
    lines.push('        unsigned char b2 = static_cast<unsigned char>(s[pos + 2]);');
    lines.push('        /* U+2000-200A: E2 80 80-8A */');
    lines.push('        if (b1 == 0x80 && b2 >= 0x80 && b2 <= 0x8A) return 3;');
    lines.push('        /* U+2028: E2 80 A8, U+2029: E2 80 A9 */');
    lines.push('        if (b1 == 0x80 && (b2 == 0xA8 || b2 == 0xA9)) return 3;');
    lines.push('        /* U+202F: E2 80 AF */');
    lines.push('        if (b1 == 0x80 && b2 == 0xAF) return 3;');
    lines.push('        /* U+205F: E2 81 9F */');
    lines.push('        if (b1 == 0x81 && b2 == 0x9F) return 3;');
    lines.push('    }');
    lines.push('    if (c == 0xE3 && pos + 2 < s.size() && static_cast<unsigned char>(s[pos + 1]) == 0x80 && static_cast<unsigned char>(s[pos + 2]) == 0x80) return 3; /* U+3000 */');
    lines.push('    if (c == 0xEF && pos + 2 < s.size() && static_cast<unsigned char>(s[pos + 1]) == 0xBB && static_cast<unsigned char>(s[pos + 2]) == 0xBF) return 3; /* U+FEFF */');
    lines.push('    return 0;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_wrapped')) {
    lines.push('inline bool check_wrapped(const std::string& s, const std::string& prefix, const std::string& suffix) {');
    lines.push('    return s.size() >= prefix.size() + suffix.size() && s.compare(0, prefix.size(), prefix) == 0 && s.compare(s.size() - suffix.size(), suffix.size(), suffix) == 0;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_csv_list')) {
    lines.push('inline bool check_csv_list(const std::string& s, const std::string& charset) {');
    lines.push('    if (s.empty()) return false;');
    lines.push('    size_t i = 0;');
    lines.push('    while (true) {');
    lines.push('        size_t start = i;');
    lines.push('        while (i < s.size() && charset.find(s[i]) != std::string::npos) i++;');
    lines.push('        if (i == start) return false;');
    lines.push('        if (i == s.size()) return true;');
    lines.push("        if (s[i] != ',') return false;");
    lines.push('        i++;');
    lines.push('    }');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_ln_invoice')) {
    lines.push('inline bool check_ln_invoice(const std::string& s, const std::string& prefix, int min_hrp_len) {');
    lines.push('    if (s.size() < prefix.size() || s.compare(0, prefix.size(), prefix) != 0) return false;');
    lines.push("    auto sep = s.rfind('1');");
    lines.push('    if (sep == std::string::npos) return false;');
    lines.push('    int hrp_len = static_cast<int>(sep);');
    lines.push('    if (hrp_len < min_hrp_len) return false;');
    lines.push('    for (size_t j = 0; j < sep; j++) {');
    lines.push("        char c = s[j];");
    lines.push("        if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'))) return false;");
    lines.push('    }');
    lines.push('    if (sep + 1 >= s.size()) return false;');
    lines.push('    for (size_t j = sep + 1; j < s.size(); j++) {');
    lines.push("        if (!is_bech32_char(s[j])) return false;");
    lines.push('    }');
    lines.push('    return true;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_mime_type')) {
    lines.push('inline bool check_mime_type(const std::string& s) {');
    lines.push('    size_t i = 0;');
    lines.push("    if (i >= s.size() || s[i] < 'a' || s[i] > 'z') return false;");
    lines.push("    while (i < s.size() && s[i] >= 'a' && s[i] <= 'z') i++;");
    lines.push("    if (i >= s.size() || s[i] != '/') return false;");
    lines.push('    i++;');
    lines.push('    size_t sub_start = i;');
    lines.push('    while (i < s.size()) {');
    lines.push("        char c = s[i];");
    lines.push("        if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '+' || c == '-') i++;");
    lines.push('        else break;');
    lines.push('    }');
    lines.push('    if (i == sub_start) return false;');
    lines.push('    return i == s.size();');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_http_origin')) {
    lines.push('inline bool check_http_origin(const std::string& s) {');
    lines.push('    size_t pos = 0;');
    lines.push('    if (s.compare(0, 8, "https://") == 0) { pos = 8; }');
    lines.push('    else if (s.compare(0, 7, "http://") == 0) { pos = 7; }');
    lines.push('    else { return false; }');
    lines.push('    size_t host_start = pos;');
    lines.push("    while (pos < s.size() && s[pos] != '/') pos++;");
    lines.push('    if (pos == host_start) return false;');
    lines.push("    if (pos < s.size() && s[pos] == '/') pos++;");
    lines.push('    return pos == s.size();');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_email_like')) {
    lines.push('inline bool check_email_like(const std::string& s) {');
    lines.push('    size_t i = 0;');
    lines.push("    while (i < s.size() && is_ecma_ws(s, i) == 0 && s[i] != '@') i++;");
    lines.push('    if (i == 0) return false;');
    lines.push("    if (i >= s.size() || s[i] != '@') return false;");
    lines.push('    i++;');
    lines.push('    size_t after_at = i;');
    lines.push("    while (i < s.size() && is_ecma_ws(s, i) == 0 && s[i] != '@') i++;");
    lines.push('    if (i == after_at) return false;');
    lines.push('    return i == s.size();');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_git_clone_url')) {
    lines.push('inline bool check_git_clone_url(const std::string& s) {');
    lines.push('    size_t pos = 0;');
    lines.push('    if (s.compare(0, 4, "git@") == 0) { pos = 4; }');
    lines.push('    else {');
    lines.push("        if (s.empty() || s[0] < 'a' || s[0] > 'z') return false;");
    lines.push('        pos = 1;');
    lines.push('        while (pos < s.size()) {');
    lines.push("            char c = s[pos];");
    lines.push("            if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '+' || c == '.' || c == '-') pos++;");
    lines.push('            else break;');
    lines.push('        }');
    lines.push('        if (pos + 3 > s.size() || s.compare(pos, 3, "://") != 0) return false;');
    lines.push('        pos += 3;');
    lines.push('    }');
    lines.push('    if (pos >= s.size()) return false;');
    lines.push('    for (size_t j = pos; j < s.size(); ) {');
    lines.push('        int adv = is_ecma_ws(s, j);');
    lines.push('        if (adv > 0) return false;');
    lines.push('        j++;');
    lines.push('    }');
    lines.push('    return true;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_content_type')) {
    lines.push('inline bool is_type_char(char c) {');
    lines.push("    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '!' || c == '#' || c == '$' || c == '&' || c == '^' || c == '_' || c == '-';");
    lines.push('}');
    lines.push('');
    lines.push('inline bool is_subtype_char(char c) {');
    lines.push("    return is_type_char(c) || c == '.' || c == '+';");
    lines.push('}');
    lines.push('');
    lines.push('inline bool check_content_type(const std::string& s) {');
    lines.push('    size_t i = 0;');
    lines.push("    if (i >= s.size() || !((s[i] >= 'a' && s[i] <= 'z') || (s[i] >= 'A' && s[i] <= 'Z'))) return false;");
    lines.push('    i++;');
    lines.push('    while (i < s.size() && is_type_char(s[i])) i++;');
    lines.push("    if (i >= s.size() || s[i] != '/') return false;");
    lines.push('    i++;');
    lines.push("    if (i >= s.size() || !((s[i] >= 'a' && s[i] <= 'z') || (s[i] >= 'A' && s[i] <= 'Z') || (s[i] >= '0' && s[i] <= '9') || s[i] == '*')) return false;");
    lines.push('    i++;');
    lines.push('    while (i < s.size() && is_subtype_char(s[i])) i++;');
    lines.push('    while (i < s.size()) {');
    lines.push("        { int adv; while (i < s.size() && (adv = is_ecma_ws(s, i)) > 0) i += adv; }");
    lines.push('        if (i >= s.size()) return false;  /* trailing OWS not allowed */');
    lines.push("        if (s[i] != ';') return false;");
    lines.push('        i++;');
    lines.push("        { int adv; while (i < s.size() && (adv = is_ecma_ws(s, i)) > 0) i += adv; }");
    lines.push('        size_t param_start = i;');
    lines.push('        while (i < s.size() && is_subtype_char(s[i])) i++;');
    lines.push('        if (i == param_start) return false;');
    lines.push("        if (i >= s.size() || s[i] != '=') return false;");
    lines.push('        i++;');
    lines.push('        size_t val_start = i;');
    lines.push('        while (i < s.size() && is_subtype_char(s[i])) i++;');
    lines.push('        if (i == val_start) return false;');
    lines.push('    }');
    lines.push('    return i == s.size();');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_doi')) {
    lines.push('inline bool check_doi(const std::string& s) {');
    lines.push('    if (s.size() < 8 || s.compare(0, 3, "10.") != 0) return false;');
    lines.push('    size_t i = 3;');
    lines.push('    size_t digit_start = i;');
    lines.push("    while (i < s.size() && s[i] >= '0' && s[i] <= '9') i++;");
    lines.push('    size_t digit_count = i - digit_start;');
    lines.push('    if (digit_count < 4 || digit_count > 9) return false;');
    lines.push("    if (i >= s.size() || s[i] != '/') return false;");
    lines.push('    i++;');
    lines.push('    return check_dot_tail(s, i);');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_annotate_user')) {
    lines.push('inline bool check_annotate_user(const std::string& s) {');
    lines.push('    if (s.size() < 14 + 64 + 4 || s.compare(0, 14, "annotate-user ") != 0) return false;');
    lines.push('    for (size_t j = 14; j < 78; j++) {');
    lines.push("        char c = s[j];");
    lines.push("        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;");
    lines.push('    }');
    lines.push('    size_t pos = 78;');
    lines.push('    for (int coord = 0; coord < 2; coord++) {');
    lines.push("        if (pos >= s.size() || s[pos] != ':') return false;");
    lines.push('        pos++;');
    lines.push('        size_t dstart = pos;');
    lines.push("        while (pos < s.size() && s[pos] >= '0' && s[pos] <= '9') pos++;");
    lines.push('        if (pos == dstart) return false;');
    lines.push("        if (pos < s.size() && s[pos] == '.') {");
    lines.push('            pos++;');
    lines.push('            size_t fstart = pos;');
    lines.push("            while (pos < s.size() && s[pos] >= '0' && s[pos] <= '9') pos++;");
    lines.push('            if (pos == fstart) return false;');
    lines.push('        }');
    lines.push('    }');
    lines.push('    return pos == s.size();');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_no_ws_tail')) {
    lines.push('inline bool check_no_ws_tail(const std::string& s, size_t offset) {');
    lines.push('    if (offset >= s.size()) return false;');
    lines.push('    for (size_t j = offset; j < s.size(); ) {');
    lines.push('        int adv = is_ecma_ws(s, j);');
    lines.push('        if (adv > 0) return false;');
    lines.push('        j++;');
    lines.push('    }');
    lines.push('    return true;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_external_identity')) {
    lines.push('inline bool check_external_identity(const std::string& s) {');
    lines.push('    size_t i = 0;');
    lines.push('    while (i < s.size()) {');
    lines.push("        char c = s[i];");
    lines.push("        if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '-' || c == '/') i++;");
    lines.push('        else break;');
    lines.push('    }');
    lines.push('    if (i == 0) return false;');
    lines.push("    if (i >= s.size() || s[i] != ':') return false;");
    lines.push('    i++;');
    lines.push('    /* .+ tail: at least one char, no line terminators */');
    lines.push('    if (i >= s.size()) return false;');
    lines.push('    const unsigned char* u = reinterpret_cast<const unsigned char*>(s.data());');
    lines.push('    for (size_t j = i; j < s.size(); j++) {');
    lines.push("        if (u[j] == 0x0A || u[j] == 0x0D) return false;");
    lines.push('    }');
    lines.push('    return true;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_imeta_dim')) {
    lines.push('inline bool check_imeta_dim(const std::string& s) {');
    lines.push('    if (s.size() < 7 || s.compare(0, 4, "dim ") != 0) return false;');
    lines.push('    size_t i = 4;');
    lines.push('    size_t d1 = i;');
    lines.push("    while (i < s.size() && s[i] >= '0' && s[i] <= '9') i++;");
    lines.push('    size_t d1len = i - d1;');
    lines.push('    if (d1len < 1 || d1len > 5) return false;');
    lines.push("    if (i >= s.size() || s[i] != 'x') return false;");
    lines.push('    i++;');
    lines.push('    size_t d2 = i;');
    lines.push("    while (i < s.size() && s[i] >= '0' && s[i] <= '9') i++;");
    lines.push('    size_t d2len = i - d2;');
    lines.push('    if (d2len < 1 || d2len > 5) return false;');
    lines.push('    return i == s.size();');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_dim')) {
    lines.push('/* ^[0-9]+x[0-9]+$ */');
    lines.push('inline bool check_dim(const std::string& s) {');
    lines.push('    if (s.empty()) return false;');
    lines.push('    size_t i = 0;');
    lines.push("    if (s[i] < '0' || s[i] > '9') return false;");
    lines.push("    while (i < s.size() && s[i] >= '0' && s[i] <= '9') i++;");
    lines.push("    if (i >= s.size() || s[i] != 'x') return false;");
    lines.push('    i++;');
    lines.push("    if (i >= s.size() || s[i] < '0' || s[i] > '9') return false;");
    lines.push("    while (i < s.size() && s[i] >= '0' && s[i] <= '9') i++;");
    lines.push('    return i == s.size();');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_no_uppercase')) {
    lines.push('/* ^[^A-Z]+$ */');
    lines.push('inline bool check_no_uppercase(const std::string& s) {');
    lines.push('    if (s.empty()) return false;');
    lines.push("    return std::none_of(s.begin(), s.end(), [](char c) { return c >= 'A' && c <= 'Z'; });");
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_dotted_digits')) {
    lines.push('/* ^[0-9]+(\\.[0-9]+)*$ */');
    lines.push('inline bool check_dotted_digits(const std::string& s) {');
    lines.push('    if (s.empty()) return false;');
    lines.push('    size_t i = 0;');
    lines.push("    if (s[i] < '0' || s[i] > '9') return false;");
    lines.push("    while (i < s.size() && s[i] >= '0' && s[i] <= '9') i++;");
    lines.push("    while (i < s.size() && s[i] == '.') {");
    lines.push('        i++;');
    lines.push("        if (i >= s.size() || s[i] < '0' || s[i] > '9') return false;");
    lines.push("        while (i < s.size() && s[i] >= '0' && s[i] <= '9') i++;");
    lines.push('    }');
    lines.push('    return i == s.size();');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_slash_segments')) {
    lines.push('/* ^[charset]+(/[charset]+)*$ */');
    lines.push('inline bool check_slash_segments(const std::string& s, const std::string& charset) {');
    lines.push('    if (s.empty()) return false;');
    lines.push('    size_t i = 0;');
    lines.push('    if (charset.find(s[i]) == std::string::npos) return false;');
    lines.push('    while (i < s.size() && charset.find(s[i]) != std::string::npos) i++;');
    lines.push("    while (i < s.size() && s[i] == '/') {");
    lines.push('        i++;');
    lines.push('        if (i >= s.size() || charset.find(s[i]) == std::string::npos) return false;');
    lines.push('        while (i < s.size() && charset.find(s[i]) != std::string::npos) i++;');
    lines.push('    }');
    lines.push('    return i == s.size();');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_space_separated_tokens')) {
    lines.push('/* ^\\S+( \\S+)*$ */');
    lines.push('inline bool check_space_separated_tokens(const std::string& s) {');
    lines.push('    if (s.empty()) return false;');
    lines.push('    size_t i = 0;');
    lines.push('    /* first token: 1+ non-whitespace chars */');
    lines.push('    if (is_ecma_ws(s, i) > 0) return false;');
    lines.push('    while (i < s.size() && is_ecma_ws(s, i) == 0) i++;');
    lines.push("    while (i < s.size() && s[i] == ' ') {");
    lines.push('        i++;');
    lines.push('        if (i >= s.size() || is_ecma_ws(s, i) > 0) return false;');
    lines.push('        while (i < s.size() && is_ecma_ws(s, i) == 0) i++;');
    lines.push('    }');
    lines.push('    return i == s.size();');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_starts_with_charset')) {
    lines.push('/* ^[charset]+ (no end anchor) */');
    lines.push('inline bool check_starts_with_charset(const std::string& s, const std::string& charset) {');
    lines.push('    if (s.empty()) return false;');
    lines.push('    return charset.find(s[0]) != std::string::npos;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_base64')) {
    lines.push('inline bool is_b64_char(char c) {');
    lines.push("    return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '+' || c == '/';");
    lines.push('}');
    lines.push('');
    lines.push('/* ^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$ */');
    lines.push('inline bool check_base64(const std::string& s) {');
    lines.push('    if (s.empty()) return true; /* empty string is valid */');
    lines.push('    if (s.size() % 4 != 0) return false;');
    lines.push('    size_t i;');
    lines.push('    for (i = 0; i < s.size(); i++) {');
    lines.push("        if (s[i] == '=') break;");
    lines.push('        if (!is_b64_char(s[i])) return false;');
    lines.push('    }');
    lines.push('    size_t data_len = i;');
    lines.push('    size_t pad_len = s.size() - data_len;');
    lines.push('    if (pad_len > 2) return false;');
    lines.push('    if (pad_len == 1 && data_len % 4 != 3) return false;');
    lines.push('    if (pad_len == 2 && data_len % 4 != 2) return false;');
    lines.push("    for (; i < s.size(); i++) { if (s[i] != '=') return false; }");
    lines.push('    return true;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_nostr_uri')) {
    lines.push('inline bool is_bech32_data_char(char c) {');
    lines.push("    return (c >= '0' && c <= '9' && c != '1') || (c >= 'a' && c <= 'z' && c != 'b' && c != 'i' && c != 'o');");
    lines.push('}');
    lines.push('');
    lines.push('/* ^nostr:((npub|note)1[bech32]{58}|(nprofile|nevent|naddr)1[bech32]+)$ */');
    lines.push('inline bool check_nostr_uri(const std::string& s) {');
    lines.push('    if (s.size() < 6 || s.compare(0, 6, "nostr:") != 0) return false;');
    lines.push('    size_t rest = s.size() - 6;');
    lines.push('    const char* p = s.data() + 6;');
    lines.push('    /* npub1 or note1 + exactly 58 data chars */');
    lines.push('    if (rest == 63 && (s.compare(6, 5, "npub1") == 0 || s.compare(6, 5, "note1") == 0)) {');
    lines.push('        for (size_t i = 5; i < 63; i++) if (!is_bech32_data_char(p[i])) return false;');
    lines.push('        return true;');
    lines.push('    }');
    lines.push('    /* nprofile1, nevent1, naddr1 + 1+ data chars */');
    lines.push('    size_t prefix_len = 0;');
    lines.push('    if (s.compare(6, 9, "nprofile1") == 0) prefix_len = 9;');
    lines.push('    else if (s.compare(6, 7, "nevent1") == 0) prefix_len = 7;');
    lines.push('    else if (s.compare(6, 6, "naddr1") == 0) prefix_len = 6;');
    lines.push('    if (prefix_len == 0 || rest <= prefix_len) return false;');
    lines.push('    for (size_t i = prefix_len; i < rest; i++) if (!is_bech32_data_char(p[i])) return false;');
    lines.push('    return true;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_nip04_encrypted')) {
    lines.push('/* ^[A-Za-z0-9+/]+={0,2}\\?iv=[A-Za-z0-9+/]+={0,2}$ */');
    lines.push('inline bool check_nip04_encrypted(const std::string& s) {');
    lines.push('    if (s.empty()) return false;');
    lines.push('    /* find "?iv=" separator */');
    lines.push('    auto sep = s.find("?iv=");');
    lines.push('    if (sep == std::string::npos || sep == 0) return false;');
    lines.push('    size_t right_start = sep + 4;');
    lines.push('    if (right_start >= s.size()) return false;');
    lines.push('    /* check left half: 1+ b64 chars + 0-2 = */');
    lines.push('    size_t i = 0;');
    lines.push('    while (i < sep && is_b64_char(s[i])) i++;');
    lines.push('    if (i == 0) return false;');
    lines.push('    int eq = 0;');
    lines.push("    while (i < sep && s[i] == '=') { i++; eq++; }");
    lines.push('    if (i != sep || eq > 2) return false;');
    lines.push('    /* check right half */');
    lines.push('    i = right_start;');
    lines.push('    size_t data_start = i;');
    lines.push('    while (i < s.size() && is_b64_char(s[i])) i++;');
    lines.push('    if (i == data_start) return false;');
    lines.push('    eq = 0;');
    lines.push("    while (i < s.size() && s[i] == '=') { i++; eq++; }");
    lines.push('    return i == s.size() && eq <= 2;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('is_alnum')) {
    lines.push('inline bool is_alnum(char c) {');
    lines.push("    return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');");
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_nip05_identifier')) {
    lines.push('inline bool is_nip05_local_char(char c) {');
    lines.push("    return c == '_' || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '-';");
    lines.push('}');
    lines.push('');
    lines.push('inline bool is_domain_char(char c) {');
    lines.push("    return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-';");
    lines.push('}');
    lines.push('');
    lines.push('/* NIP-05: local@domain.tld */');
    lines.push('inline bool check_nip05_identifier(const std::string& s) {');
    lines.push('    if (s.empty()) return false;');
    lines.push('    /* find last @ */');
    lines.push('    auto at = s.rfind(\'@\');');
    lines.push('    if (at == std::string::npos || at == 0) return false;');
    lines.push('    /* local part: [_A-Za-z0-9.-]+ or just "_" */');
    lines.push('    for (size_t i = 0; i < at; i++) {');
    lines.push('        if (!is_nip05_local_char(s[i])) return false;');
    lines.push('    }');
    lines.push('    /* domain: 2+ dot-separated labels */');
    lines.push('    size_t d = at + 1;');
    lines.push('    size_t dlen = s.size() - at - 1;');
    lines.push('    if (dlen == 0) return false;');
    lines.push('    int dot_count = 0;');
    lines.push('    size_t di = 0;');
    lines.push('    while (di < dlen) {');
    lines.push('        if (!is_alnum(s[d + di])) return false;');
    lines.push('        while (di < dlen && is_domain_char(s[d + di])) di++;');
    lines.push('        if (!is_alnum(s[d + di - 1])) return false;');
    lines.push("        if (di < dlen && s[d + di] == '.') { dot_count++; di++; }");
    lines.push('        else if (di < dlen) return false;');
    lines.push('    }');
    lines.push('    return dot_count >= 1 && is_alnum(s[s.size() - 1]);');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_mime_type_strict')) {
    lines.push('inline bool is_mime_strict_char(char c) {');
    lines.push("    return is_alnum(c) || c == '!' || c == '#' || c == '$' || c == '&' || c == '^' || c == '_' || c == '.' || c == '+' || c == '-';");
    lines.push('}');
    lines.push('');
    lines.push('/* ^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$ */');
    lines.push('inline bool check_mime_type_strict(const std::string& s) {');
    lines.push('    if (s.empty()) return false;');
    lines.push('    size_t i = 0;');
    lines.push('    if (!is_alnum(s[i])) return false;');
    lines.push('    i++;');
    lines.push('    while (i < s.size() && is_mime_strict_char(s[i])) i++;');
    lines.push("    if (i >= s.size() || s[i] != '/') return false;");
    lines.push('    i++;');
    lines.push('    if (i >= s.size() || !is_alnum(s[i])) return false;');
    lines.push('    i++;');
    lines.push('    while (i < s.size() && is_mime_strict_char(s[i])) i++;');
    lines.push('    return i == s.size();');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_prefix_delim_rest')) {
    lines.push('/* ^[charset]+<delim>.+ (no end anchor) */');
    lines.push('inline bool check_prefix_delim_rest(const std::string& s, const std::string& charset, const std::string& delim) {');
    lines.push('    if (s.empty()) return false;');
    lines.push('    size_t i = 0;');
    lines.push('    if (charset.find(s[i]) == std::string::npos) return false;');
    lines.push('    while (i < s.size() && charset.find(s[i]) != std::string::npos) i++;');
    lines.push('    if (i + delim.size() >= s.size()) return false;');
    lines.push('    if (s.compare(i, delim.size(), delim) != 0) return false;');
    lines.push('    i += delim.size();');
    lines.push('    if (i >= s.size()) return false;');
    lines.push('    /* .+ first char must not be a line terminator (C++ std::regex . excludes \\n, \\r) */');
    lines.push("    unsigned char c = static_cast<unsigned char>(s[i]);");
    lines.push("    if (c == '\\n' || c == '\\r') return false;");
    lines.push('    return true;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_package_id')) {
    lines.push('inline bool is_pkg_id_char(char c) {');
    lines.push("    return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '+' || c == '-';");
    lines.push('}');
    lines.push('');
    lines.push('inline bool check_package_id(const std::string& s) {');
    lines.push('    if (s.empty()) return false;');
    lines.push("    if (s == \"#\") return true;");
    lines.push('    size_t i = 0;');
    lines.push("    if (!((s[i] >= 'A' && s[i] <= 'Z') || (s[i] >= 'a' && s[i] <= 'z') || (s[i] >= '0' && s[i] <= '9'))) return false;");
    lines.push('    i++;');
    lines.push('    while (i < s.size() && is_pkg_id_char(s[i])) i++;');
    lines.push("    while (i < s.size() && s[i] == ':') {");
    lines.push('        i++;');
    lines.push("        if (i >= s.size() || !((s[i] >= 'A' && s[i] <= 'Z') || (s[i] >= 'a' && s[i] <= 'z') || (s[i] >= '0' && s[i] <= '9'))) return false;");
    lines.push('        i++;');
    lines.push('        while (i < s.size() && is_pkg_id_char(s[i])) i++;');
    lines.push('    }');
    lines.push('    return i == s.size();');
    lines.push('}');
    lines.push('');
  }

  return lines.join('\n');
}
