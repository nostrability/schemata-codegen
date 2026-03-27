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
    case 'regex': {
      helpers.add('regex');
      return { expr: `std::regex_match(${varExpr}, std::regex(${JSON.stringify(check.pattern)}))`, helpers };
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
        lines.push('    }');
        if (action.optChecks.length > 0) {
          lines.push('    for (const auto& t : tags) {');
          lines.push(`        if (!t.empty() && t[0] == ${JSON.stringify(action.matcher.tagName)}) {`);
          for (const pc of action.optChecks) {
            const r = renderValueCheckCpp(pc.check, 't', pc.index);
            for (const h of r.helpers) helpers.add(h);
            const msg = describePositionConstraintCpp(pc, action.matcher.tagName);
            lines.push(`            if (t.size() > ${pc.index} && !(${r.expr})) {`);
            lines.push(`                errors.push_back({"tags", ${JSON.stringify(msg)}});`);
            lines.push('            }');
          }
          lines.push('        }');
          lines.push('    }');
        }
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

  return lines.join('\n');
}
