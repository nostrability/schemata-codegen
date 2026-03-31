/**
 * Ruby validator emitter: ValidatorAction[] → .rb file
 *
 * Generates a Ruby module with per-kind validation methods.
 * Tags are Array<Array<String>> (array of string arrays).
 * Ruby is expression-oriented: uses .any? { |t| ... }, .each, unless, etc.
 *
 * Output uses:
 *   - 2-space indentation (Ruby convention)
 *   - Single quotes for strings (Ruby convention)
 *   - `unless` for simple negated conditions
 *   - `module SchemataValidators` wrapper
 *   - `ValidationError = Struct.new(:path, :message)`
 *   - Class methods via `def self.method_name`
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

function renderPatternCheckRuby(check: PatternCheck, varExpr: string): { expr: string; helpers: Set<string> } {
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
      return { expr: `check_hex_prefixed(${varExpr}, ${rubyString(check.prefix)}, ${check.hexLen})`, helpers };
    }
    case 'all_digits': {
      const fn = check.allowNeg ? 'check_signed_int' : 'check_digits';
      helpers.add(fn);
      return { expr: `${fn}(${varExpr})`, helpers };
    }
    case 'starts_with_any': {
      const checks = check.prefixes.map(p => `${varExpr}.start_with?(${rubyString(p)})`);
      return { expr: checks.length === 1 ? checks[0] : `(${checks.join(' || ')})`, helpers };
    }
    case 'chars_in': {
      if (check.min === 0 && check.max === 0) {
        return { expr: `${varExpr}.empty?`, helpers };
      }
      helpers.add('check_chars_in');
      return {
        expr: `check_chars_in(${varExpr}, ${rubyString(check.charset)}, ${check.min ?? 0}, ${check.max ?? 'Float::INFINITY'})`,
        helpers,
      };
    }
    case 'bech32': {
      helpers.add('check_bech32');
      if (check.dataLen !== undefined) {
        return { expr: `check_bech32(${varExpr}, ${rubyString(check.hrp + '1')}, ${check.dataLen})`, helpers };
      }
      return { expr: `check_bech32(${varExpr}, ${rubyString(check.hrp + '1')})`, helpers };
    }
    case 'regex': {
      return { expr: `${varExpr}.match?(Regexp.new(${rubyString(check.pattern)}))`, helpers };
    }
    case 'relay_url': {
      helpers.add('check_relay_url');
      return { expr: `check_relay_url(${varExpr})`, helpers };
    }
    case 'date_iso': {
      helpers.add('check_date_iso');
      return { expr: `check_date_iso(${varExpr})`, helpers };
    }
    case 'decimal': {
      helpers.add('check_decimal');
      return { expr: `check_decimal(${varExpr})`, helpers };
    }
    case 'compound': {
      const allHelpers = new Set<string>();
      const parts: string[] = [];
      for (const sub of check.checks) {
        const r = renderPatternCheckRuby(sub, varExpr);
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

function renderValueCheckRuby(
  check: ValueCheck,
  tagVar: string,
  index: number,
): { expr: string; helpers: Set<string> } {
  const helpers = new Set<string>();
  const access = `${tagVar}[${index}]`;

  switch (check.type) {
    case 'const':
      return { expr: `${access} == ${rubyString(check.value)}`, helpers };
    case 'enum': {
      const vals = check.values.map(v => rubyString(v));
      return {
        expr: `[${vals.join(', ')}].include?(${access})`,
        helpers,
      };
    }
    case 'pattern': {
      const r = renderPatternCheckRuby(check.native, access);
      for (const h of r.helpers) helpers.add(h);
      // Guard against nil: check that position exists before pattern check
      return {
        expr: `!${access}.nil? && ${r.expr}`,
        helpers,
      };
    }
    case 'anyOf': {
      const parts: string[] = [];
      for (const alt of check.alternatives) {
        const r = renderValueCheckRuby(alt, tagVar, index);
        parts.push(r.expr);
        for (const h of r.helpers) helpers.add(h);
      }
      return { expr: `(${parts.join(' || ')})`, helpers };
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

function renderTagMatcherRuby(
  matcher: TagMatcher,
  tagVar: string,
  helpers: Set<string>,
): string {
  const checks: string[] = [];

  checks.push(`${tagVar}[0] == ${rubyString(matcher.tagName)}`);
  checks.push(`${tagVar}.length >= ${matcher.minItems}`);
  if (matcher.maxItems !== undefined) {
    checks.push(`${tagVar}.length <= ${matcher.maxItems}`);
  }

  for (const pc of matcher.positionChecks) {
    const r = renderValueCheckRuby(pc.check, tagVar, pc.index);
    for (const h of r.helpers) helpers.add(h);
    checks.push(r.expr);
  }

  return checks.join(' && ');
}

// --- Ruby string helpers ---

/** Produce a single-quoted Ruby string, escaping ' and \ */
function rubyString(s: string): string {
  return "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

// --- Main emitter ---

export function emitRubyValidators(kindShapes: KindShape[]): string {
  const allHelpers = new Set<string>();
  const fnBodies: string[] = [];
  const constrainedKinds: { kindNumber: number; nip: string }[] = [];

  for (const shape of [...kindShapes].sort((a, b) => a.kindNumber - b.kindNumber)) {
    const actions = planKindValidator(shape);
    if (!actions) continue;

    constrainedKinds.push({ kindNumber: shape.kindNumber, nip: shape.nip });
    const { code, helpers } = emitKindFunctionRuby(shape.kindNumber, shape.nip, actions);
    fnBodies.push(code);
    for (const h of helpers) allHelpers.add(h);
  }

  return emitRubyFile(fnBodies, constrainedKinds, allHelpers);
}

function emitKindFunctionRuby(
  kindNumber: number,
  nip: string,
  actions: ValidatorAction[],
): { code: string; helpers: Set<string> } {
  const helpers = new Set<string>();
  const lines: string[] = [];

  lines.push(`  # Validate tags for kind ${kindNumber} (${nip})`);
  lines.push(`  def self.validate_kind_${kindNumber}(tags)`);
  lines.push('    errors = []');

  for (const action of actions) {
    switch (action.type) {
      case 'check_min_tags':
        lines.push(`    if tags.length < ${action.min}`);
        lines.push(`      errors << ValidationError.new('tags', 'tags must have at least ${action.min} item(s)')`);
        lines.push('    end');
        break;

      case 'require_tag': {
        const matcherExpr = renderTagMatcherRuby(action.matcher, 't', helpers);
        lines.push(`    unless tags.any? { |t| ${matcherExpr} }`);
        lines.push(`      errors << ValidationError.new('tags', ${rubyString(action.errorMsg)})`);
        lines.push('    end');
        break;
      }

      case 'validate_optional_positions': {
        lines.push('    tags.each do |t|');
        lines.push(`      if t[0] == ${rubyString(action.tagName)}`);
        for (const pc of action.checks) {
          const r = renderValueCheckRuby(pc.check, 't', pc.index);
          for (const h of r.helpers) helpers.add(h);
          const msg = describePositionConstraint(pc, action.tagName);
          lines.push(`        if t.length > ${pc.index} && !(${r.expr})`);
          lines.push(`          errors << ValidationError.new('tags', ${rubyString(msg)})`);
          lines.push('        end');
        }
        lines.push('      end');
        lines.push('    end');
        break;
      }

      case 'per_item_conditional': {
        const matcherExpr = renderTagMatcherRuby(action.matcher, 't', helpers);
        lines.push('    tags.each do |t|');
        lines.push(`      if t[0] == ${rubyString(action.condTag)} && !(${matcherExpr})`);
        lines.push(`        errors << ValidationError.new('tags', ${rubyString(action.errorMsg)})`);
        lines.push('      end');
        if (action.optChecks.length > 0) {
          lines.push(`      if t[0] == ${rubyString(action.condTag)}`);
          for (const pc of action.optChecks) {
            const r = renderValueCheckRuby(pc.check, 't', pc.index);
            for (const h of r.helpers) helpers.add(h);
            const msg = describePositionConstraint(pc, action.condTag);
            lines.push(`        if t.length > ${pc.index} && !(${r.expr})`);
            lines.push(`          errors << ValidationError.new('tags', ${rubyString(msg)})`);
            lines.push('        end');
          }
          lines.push('      end');
        }
        lines.push('    end');
        break;
      }

      case 'array_level_conditional': {
        lines.push(`    if tags.any? { |t| t[0] == ${rubyString(action.condTag)} }`);
        const matcherExpr = renderTagMatcherRuby(action.matcher, 't', helpers);
        lines.push(`      unless tags.any? { |t| ${matcherExpr} }`);
        lines.push(`        errors << ValidationError.new('tags', ${rubyString(action.errorMsg)})`);
        lines.push('      end');
        if (action.optChecks.length > 0) {
          lines.push('      tags.each do |t|');
          lines.push(`        if t[0] == ${rubyString(action.matcher.tagName)}`);
          for (const pc of action.optChecks) {
            const r = renderValueCheckRuby(pc.check, 't', pc.index);
            for (const h of r.helpers) helpers.add(h);
            const msg = describePositionConstraint(pc, action.matcher.tagName);
            lines.push(`          if t.length > ${pc.index} && !(${r.expr})`);
            lines.push(`            errors << ValidationError.new('tags', ${rubyString(msg)})`);
            lines.push('          end');
          }
          lines.push('        end');
          lines.push('      end');
        }
        lines.push('    end');
        break;
      }

      case 'any_of_group': {
        const matchers = action.matchers.map(m => {
          const expr = renderTagMatcherRuby(m, 't', helpers);
          return `tags.any? { |t| ${expr} }`;
        });
        lines.push(`    unless ${matchers.join(' || ')}`);
        lines.push(`      errors << ValidationError.new('tags', ${rubyString(action.errorMsg)})`);
        lines.push('    end');
        break;
      }
    }
  }

  lines.push('    errors');
  lines.push('  end');

  return { code: lines.join('\n'), helpers };
}

// --- File generation ---

function emitRubyFile(
  fnBodies: string[],
  constrainedKinds: { kindNumber: number; nip: string }[],
  helpers: Set<string>,
): string {
  const lines: string[] = [
    '# frozen_string_literal: true',
    '',
    '# Auto-generated by @nostrability/schemata-codegen',
    '# Do not edit manually.',
    '#',
    '# Runtime validators for Nostr event tag constraints',
    '',
    'module SchemataValidators',
    "  ValidationError = Struct.new(:path, :message)",
    '',
  ];

  const helperCode = emitRubyHelpers(helpers);
  if (helperCode) {
    lines.push(helperCode);
    lines.push('');
  }

  for (const fn of fnBodies) {
    lines.push(fn);
    lines.push('');
  }

  // Dispatch method
  lines.push('  # Validate tags for a given kind number.');
  lines.push('  # Returns empty array if kind has no constraints or is unknown.');
  lines.push('  def self.validate_kind_tags(kind, tags)');
  lines.push('    case kind');
  for (const k of constrainedKinds) {
    lines.push(`    when ${k.kindNumber} then validate_kind_${k.kindNumber}(tags)`);
  }
  lines.push('    else []');
  lines.push('    end');
  lines.push('  end');

  lines.push('end');
  lines.push('');

  return lines.join('\n');
}

function emitRubyHelpers(helpers: Set<string>): string {
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
    lines.push(`  def self.check_hex_${len}(s)`);
    lines.push(`    s.is_a?(String) && s.length == ${len} && s.match?(/\\A[a-f0-9]{${len}}\\z/)`);
    lines.push('  end');
    lines.push('');
  }

  for (const len of [...hexMixedLengths].sort((a, b) => a - b)) {
    lines.push(`  def self.check_hex_${len}_mixed(s)`);
    lines.push(`    s.is_a?(String) && s.length == ${len} && s.match?(/\\A[a-fA-F0-9]{${len}}\\z/)`);
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('check_hex_range')) {
    lines.push('  def self.check_hex_range(s, min, max)');
    lines.push('    s.is_a?(String) && s.length >= min && s.length <= max && s.match?(/\\A[a-f0-9]+\\z/)');
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('check_hex_range_mixed')) {
    lines.push('  def self.check_hex_range_mixed(s, min, max)');
    lines.push('    s.is_a?(String) && s.length >= min && s.length <= max && s.match?(/\\A[a-fA-F0-9]+\\z/)');
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('check_hex_prefixed')) {
    lines.push('  def self.check_hex_prefixed(s, prefix, hex_len)');
    lines.push('    s.is_a?(String) && s.start_with?(prefix) && s[prefix.length..].length == hex_len && s[prefix.length..].match?(/\\A[a-f0-9]+\\z/)');
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('check_digits')) {
    lines.push('  def self.check_digits(s)');
    lines.push('    s.is_a?(String) && !s.empty? && s.match?(/\\A[0-9]+\\z/)');
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('check_signed_int')) {
    lines.push('  def self.check_signed_int(s)');
    lines.push("    s.is_a?(String) && s.match?(/\\A-?[0-9]+\\z/)");
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('check_chars_in')) {
    lines.push('  def self.check_chars_in(s, charset, min, max)');
    lines.push('    s.is_a?(String) && s.length >= min && s.length <= max && s.chars.all? { |c| charset.include?(c) }');
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('check_date_iso')) {
    lines.push('  def self.check_date_iso(s)');
    lines.push('    return false unless s.is_a?(String) && s.length == 10');
    lines.push("    return false unless s[4] == '-' && s[7] == '-'");
    lines.push('    (0...10).each do |i|');
    lines.push('      next if i == 4 || i == 7');
    lines.push("      return false unless s[i] >= '0' && s[i] <= '9'");
    lines.push('    end');
    lines.push('    true');
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('check_decimal')) {
    lines.push('  def self.check_decimal(s)');
    lines.push('    return false unless s.is_a?(String) && !s.empty?');
    lines.push('    i = 0');
    lines.push("    i += 1 while i < s.length && s[i] >= '0' && s[i] <= '9'");
    lines.push("    return false if i == 0");
    lines.push("    if i < s.length && s[i] == '.'");
    lines.push('      i += 1');
    lines.push("      return false if i >= s.length || s[i] < '0' || s[i] > '9'");
    lines.push("      i += 1 while i < s.length && s[i] >= '0' && s[i] <= '9'");
    lines.push('    end');
    lines.push('    i == s.length');
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('check_relay_url')) {
    lines.push('  RELAY_HOST_CHARS = Set.new("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-".chars).freeze');
    lines.push('');
    lines.push('  def self.check_relay_url(s)');
    lines.push('    return false unless s.is_a?(String)');
    lines.push("    if s.start_with?('wss://')");
    lines.push('      pos = 6');
    lines.push("    elsif s.start_with?('ws://')");
    lines.push('      pos = 5');
    lines.push('    else');
    lines.push('      return false');
    lines.push('    end');
    lines.push('    host_start = pos');
    lines.push('    pos += 1 while pos < s.length && RELAY_HOST_CHARS.include?(s[pos])');
    lines.push('    return false if pos == host_start');
    lines.push("    if pos < s.length && s[pos] == ':'");
    lines.push('      pos += 1');
    lines.push('      port_start = pos');
    lines.push("      pos += 1 while pos < s.length && s[pos] >= '0' && s[pos] <= '9'");
    lines.push('      return false if pos == port_start');
    lines.push('    end');
    lines.push("    return true if pos < s.length && s[pos] == '/'");
    lines.push('    pos == s.length');
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('check_bech32')) {
    lines.push('  BECH32_CHARS = Set.new("023456789acdefghjklmnpqrstuvwxyz".chars).freeze');
    lines.push('');
    lines.push('  def self.check_bech32(s, prefix, data_len = nil)');
    lines.push('    return false unless s.is_a?(String) && s.start_with?(prefix)');
    lines.push('    data = s[prefix.length..]');
    lines.push('    return false if data.nil? || data.empty? || !data.chars.all? { |c| BECH32_CHARS.include?(c) }');
    lines.push('    return data.length == data_len unless data_len.nil?');
    lines.push('    true');
    lines.push('  end');
    lines.push('');
  }

  return lines.join('\n');
}
