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
  planContentChecks,
  type ValidatorAction,
  type ContentAction,
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
    case 'a_tag': {
      helpers.add('check_a_tag');
      if (check.kinds && check.kinds.length > 0) {
        const arr = check.kinds.map(k => JSON.stringify(k)).join(', ');
        return { expr: `check_a_tag(${varExpr}, [${arr}])`, helpers };
      }
      return { expr: `check_a_tag(${varExpr})`, helpers };
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
      const vals = check.values.map(v => rubyString(v));
      return { expr: `[${vals.join(', ')}].include?(${varExpr})`, helpers };
    }
    case 'prefix_nonempty': {
      helpers.add('check_dot_tail');
      return {
        expr: `${varExpr}.is_a?(String) && ${varExpr}.start_with?(${rubyString(check.prefix)}) && ${varExpr}.length > ${check.prefix.length} && check_dot_tail(${varExpr}, ${check.prefix.length})`,
        helpers,
      };
    }
    case 'wrapped': {
      helpers.add('check_wrapped');
      return { expr: `check_wrapped(${varExpr}, ${rubyString(check.prefix)}, ${rubyString(check.suffix)})`, helpers };
    }
    case 'csv_list': {
      helpers.add('check_csv_list');
      return { expr: `check_csv_list(${varExpr}, ${rubyString(check.itemCharset)})`, helpers };
    }
    case 'ln_invoice': {
      helpers.add('check_ln_invoice');
      helpers.add('check_bech32'); // triggers BECH32_CHARS
      return { expr: `check_ln_invoice(${varExpr}, ${rubyString(check.prefix)}, ${check.minHrpLen})`, helpers };
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
      helpers.add('ascii_ws');
      return { expr: `check_email_like(${varExpr})`, helpers };
    }
    case 'git_clone_url': {
      helpers.add('check_git_clone_url');
      helpers.add('ascii_ws');
      return { expr: `check_git_clone_url(${varExpr})`, helpers };
    }
    case 'content_type': {
      helpers.add('check_content_type');
      helpers.add('ascii_ws');
      return { expr: `check_content_type(${varExpr})`, helpers };
    }
    case 'doi': {
      helpers.add('check_doi');
      helpers.add('check_dot_tail');
      return { expr: `check_doi(${varExpr})`, helpers };
    }
    case 'annotate_user': {
      helpers.add('check_annotate_user');
      return { expr: `check_annotate_user(${varExpr})`, helpers };
    }
    case 'prefix_no_whitespace': {
      helpers.add('check_no_ws_tail');
      helpers.add('ascii_ws');
      const checks = check.prefixes.map(p =>
        `(${varExpr}.is_a?(String) && ${varExpr}.start_with?(${rubyString(p)}) && check_no_ws_tail(${varExpr}, ${p.length}))`
      );
      return { expr: checks.length === 1 ? checks[0] : `(${checks.join(' || ')})`, helpers };
    }
    case 'external_identity': {
      helpers.add('check_external_identity');
      helpers.add('check_dot_tail');
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
      return { expr: `check_slash_segments(${varExpr}, ${rubyString(check.charset)})`, helpers };
    }
    case 'space_separated_tokens': {
      helpers.add('check_space_separated_tokens');
      helpers.add('ascii_ws');
      return { expr: `check_space_separated_tokens(${varExpr})`, helpers };
    }
    case 'starts_with_charset': {
      helpers.add('check_starts_with_charset');
      return { expr: `check_starts_with_charset(${varExpr}, ${rubyString(check.charset)})`, helpers };
    }
    case 'base64': {
      helpers.add('check_base64');
      return { expr: `check_base64(${varExpr})`, helpers };
    }
    case 'hex_alternation': {
      const fns = check.lengths.map(len => {
        const fn = check.case === 'lower' ? `check_hex_${len}` : `check_hex_${len}_mixed`;
        helpers.add(fn);
        return `${fn}(${varExpr})`;
      });
      return { expr: `(${fns.join(' || ')})`, helpers };
    }
    case 'base64_2pad': {
      helpers.add('check_base64_2pad');
      helpers.add('check_base64'); // for is_b64_char
      return { expr: `check_base64_2pad(${varExpr})`, helpers };
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
      return { expr: `check_prefix_delim_rest(${varExpr}, ${rubyString(check.charset)}, ${rubyString(check.delimiter)})`, helpers };
    }
    case 'identifier': {
      helpers.add('check_identifier');
      return { expr: `check_identifier(${varExpr}, ${JSON.stringify(check.firstCharset)}, ${JSON.stringify(check.restCharset)}${check.optionalPrefix ? `, ${JSON.stringify(check.optionalPrefix)}` : ''})`, helpers };
    }
    case 'space_separated_charset': {
      helpers.add('check_space_separated_charset');
      return { expr: `check_space_separated_charset(${varExpr}, ${JSON.stringify(check.charset)})`, helpers };
    }
    case 'uri_scheme': {
      helpers.add('check_uri_scheme');
      return { expr: `check_uri_scheme(${varExpr})`, helpers };
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

// --- Content validation ---

function renderContentActionsRuby(
  actions: ContentAction[],
  helpers: Set<string>,
): string[] {
  const lines: string[] = [];
  for (const action of actions) {
    switch (action.type) {
      case 'check_content_min_length':
        lines.push(`          errors << ValidationError.new('content', 'content must be at least ${action.min} character(s)') if content.length < ${action.min}`);
        break;
      case 'check_content_max_length':
        lines.push(`          errors << ValidationError.new('content', 'content must be at most ${action.max} character(s)') if content.length > ${action.max}`);
        break;
      case 'check_content_pattern': {
        const r = renderPatternCheckRuby(action.native, 'content');
        for (const h of r.helpers) helpers.add(h);
        lines.push(`          errors << ValidationError.new('content', 'content must match pattern ${action.regex.replace(/'/g, "\\'")}') unless ${r.expr}`);
        break;
      }
      case 'check_content_enum': {
        const vals = action.values.map(v => rubyString(v)).join(', ');
        lines.push(`          errors << ValidationError.new('content', ${rubyString('content must be one of: ' + action.values.join(', '))}) unless [${vals}].include?(content)`);
        break;
      }
    }
  }
  return lines;
}

// --- Event validation ---

function emitEventDispatchRuby(
  constrainedKinds: { kindNumber: number; nip: string }[],
  contentPlans: Map<number, ContentAction[]>,
  helpers: Set<string>,
): string {
  const sorted = [...constrainedKinds].sort((a, b) => a.kindNumber - b.kindNumber);
  const contentKinds = [...contentPlans.entries()].sort((a, b) => a[0] - b[0]);

  const lines: string[] = [];
  lines.push('    # Validate an event\'s base fields, content constraints, and tag structure.');
  lines.push('    def self.validate_event(event)');
  lines.push('      return [ValidationError.new(\'event\', \'event must be a Hash\')] unless event.is_a?(Hash)');
  lines.push('      errors = []');
  lines.push('      kind = event[\'kind\']');
  lines.push('      unless kind.is_a?(Integer)');
  lines.push('        errors << ValidationError.new(\'kind\', \'kind must be an integer\')');
  lines.push('        return errors');
  lines.push('      end');

  helpers.add('check_hex_64');
  helpers.add('check_hex_128');

  lines.push('      id = event[\'id\']');
  lines.push('      errors << ValidationError.new(\'id\', \'id must be a 64-char lowercase hex string\') unless id.is_a?(String) && check_hex_64(id)');
  lines.push('      pk = event[\'pubkey\']');
  lines.push('      errors << ValidationError.new(\'pubkey\', \'pubkey must be a 64-char lowercase hex string\') unless pk.is_a?(String) && check_hex_64(pk)');
  lines.push('      sig = event[\'sig\']');
  lines.push('      errors << ValidationError.new(\'sig\', \'sig must be a 128-char lowercase hex string\') unless sig.is_a?(String) && check_hex_128(sig)');
  lines.push('      ca = event[\'created_at\']');
  lines.push('      errors << ValidationError.new(\'created_at\', \'created_at must be a non-negative integer\') unless ca.is_a?(Integer) && ca >= 0');

  lines.push("      unless event.key?('content')");
  lines.push("        errors << ValidationError.new('content', 'content is required')");
  lines.push('      else');
  lines.push("        content_raw = event['content']");
  lines.push('        if content_raw.is_a?(String)');
  if (contentKinds.length > 0) {
    lines.push('          content = content_raw');
    lines.push('          case kind');
    for (const [kindNumber, actions] of contentKinds) {
      lines.push(`          when ${kindNumber}`);
      lines.push(...renderContentActionsRuby(actions, helpers));
    }
    lines.push('          end');
  }
  lines.push('        else');
  lines.push("          errors << ValidationError.new('content', 'content must be a string')");
  lines.push('        end');
  lines.push('      end');

  lines.push("      unless event.key?('tags')");
  lines.push("        errors << ValidationError.new('tags', 'tags is required')");
  lines.push('      else');
  lines.push("        tags_raw = event['tags']");
  lines.push('        if tags_raw.is_a?(Array)');
  lines.push('          tags = []');
  lines.push('          tags_raw.each_with_index do |t, i|');
  lines.push('            if t.is_a?(Array) && t.all? { |v| v.is_a?(String) }');
  lines.push('              tags << t');
  lines.push('            else');
  lines.push('              errors << ValidationError.new("tags[#{i}]", "tags[#{i}] must be an array of strings")');
  lines.push('              tags << []');
  lines.push('            end');
  lines.push('          end');
  lines.push('          errors.concat(validate_kind_tags(kind, tags))');
  lines.push('        else');
  lines.push("          errors << ValidationError.new('tags', 'tags must be an array')");
  lines.push('        end');
  lines.push('      end');

  lines.push('      errors');
  lines.push('    end');
  return lines.join('\n');
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

  const contentPlans = new Map<number, ContentAction[]>();
  for (const shape of kindShapes) {
    const contentActions = planContentChecks(shape);
    if (contentActions) contentPlans.set(shape.kindNumber, contentActions);
  }

  return emitRubyFile(fnBodies, constrainedKinds, allHelpers, contentPlans);
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
  contentPlans: Map<number, ContentAction[]>,
): string {
  const eventDispatchCode = emitEventDispatchRuby(constrainedKinds, contentPlans, helpers);

  const needsSet = helpers.has('check_relay_url') || helpers.has('check_bech32') || helpers.has('check_a_tag') || helpers.has('check_ln_invoice') || helpers.has('ascii_ws') || helpers.has('check_package_id') || helpers.has('check_nostr_uri');
  const lines: string[] = [
    '# frozen_string_literal: true',
    '',
    '# Auto-generated by @nostrability/schemata-codegen',
    '# Do not edit manually.',
    '#',
    '# Runtime validators for Nostr event tag constraints',
    '',
  ];
  if (needsSet) {
    lines.push("require 'set'");
    lines.push('');
  }
  lines.push(
    'module SchemataValidators',
    "  ValidationError = Struct.new(:path, :message)",
    '',
  );

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

  if (eventDispatchCode) {
    lines.push('');
    lines.push(eventDispatchCode);
  }

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

  if (helpers.has('check_datetime_iso')) {
    lines.push('  def self.check_datetime_iso(s)');
    lines.push('    return false unless s.is_a?(String) && s.length >= 10');
    lines.push("    (0...4).each { |i| return false unless s[i] >= '0' && s[i] <= '9' }");
    lines.push("    return false unless s[4] == '-'");
    lines.push("    (5...7).each { |i| return false unless s[i] >= '0' && s[i] <= '9' }");
    lines.push("    return false unless s[7] == '-'");
    lines.push("    (8...10).each { |i| return false unless s[i] >= '0' && s[i] <= '9' }");
    lines.push('    return true if s.length == 10');
    lines.push("    return false unless s[10] == 'T' && s.length >= 16");
    lines.push("    (11...13).each { |i| return false unless s[i] >= '0' && s[i] <= '9' }");
    lines.push("    return false unless s[13] == ':'");
    lines.push("    (14...16).each { |i| return false unless s[i] >= '0' && s[i] <= '9' }");
    lines.push('    pos = 16');
    lines.push('    return true if pos == s.length');
    lines.push("    if s[pos] == ':'");
    lines.push('      return false if pos + 3 > s.length');
    lines.push("      return false unless s[pos+1] >= '0' && s[pos+1] <= '9' && s[pos+2] >= '0' && s[pos+2] <= '9'");
    lines.push('      pos += 3');
    lines.push('    end');
    lines.push('    return true if pos == s.length');
    lines.push("    if s[pos] == '.'");
    lines.push('      pos += 1');
    lines.push("      return false if pos >= s.length || !(s[pos] >= '0' && s[pos] <= '9')");
    lines.push("      pos += 1 while pos < s.length && s[pos] >= '0' && s[pos] <= '9'");
    lines.push('    end');
    lines.push('    return true if pos == s.length');
    lines.push("    return pos + 1 == s.length if s[pos] == 'Z'");
    lines.push("    if s[pos] == '+' || s[pos] == '-'");
    lines.push('      return false unless pos + 6 == s.length');
    lines.push("      return false unless s[pos+1] >= '0' && s[pos+1] <= '9' && s[pos+2] >= '0' && s[pos+2] <= '9'");
    lines.push("      return false unless s[pos+3] == ':'");
    lines.push("      return s[pos+4] >= '0' && s[pos+4] <= '9' && s[pos+5] >= '0' && s[pos+5] <= '9'");
    lines.push('    end');
    lines.push('    false');
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

  if (helpers.has('check_relay_url') || helpers.has('check_a_tag') || helpers.has('check_dot_tail')) {
    lines.push('  def self.check_dot_tail(s, pos)');
    lines.push('    return false if pos >= s.length');
    lines.push('    (pos...s.length).each { |j| return false if s[j] == "\\n" }');
    lines.push('    true');
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
    lines.push("    if pos < s.length && s[pos] == '/'");
    lines.push('      return check_dot_tail(s, pos + 1) || pos + 1 == s.length');
    lines.push('    end');
    lines.push('    pos == s.length');
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('check_a_tag')) {
    lines.push('  HEX_LOWER = Set.new("0123456789abcdef".chars).freeze');
    lines.push('');
    lines.push('  def self.check_a_tag(s, kinds = nil)');
    lines.push('    return false unless s.is_a?(String) && s.length >= 68');
    lines.push('    pos = 0');
    lines.push("    return false unless s[pos] >= '0' && s[pos] <= '9'");
    lines.push('    kind_start = pos');
    lines.push("    pos += 1 while pos < s.length && s[pos] >= '0' && s[pos] <= '9'");
    lines.push("    return false unless pos < s.length && s[pos] == ':'");
    lines.push('    kind_str = s[kind_start...pos]');
    lines.push('    return false if kinds && !kinds.include?(kind_str)');
    lines.push('    pos += 1');
    lines.push('    return false if pos + 64 >= s.length');
    lines.push('    (0...64).each { |i| return false unless HEX_LOWER.include?(s[pos + i]) }');
    lines.push('    pos += 64');
    lines.push("    return false unless pos < s.length && s[pos] == ':'");
    lines.push('    pos += 1');
    lines.push('    check_dot_tail(s, pos)');
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('check_bech32') || helpers.has('check_ln_invoice')) {
    lines.push('  BECH32_CHARS = Set.new("023456789acdefghjklmnpqrstuvwxyz".chars).freeze');
    lines.push('');
  }

  if (helpers.has('check_bech32')) {
    lines.push('  def self.check_bech32(s, prefix, data_len = nil)');
    lines.push('    return false unless s.is_a?(String) && s.start_with?(prefix)');
    lines.push('    data = s[prefix.length..]');
    lines.push('    return false if data.nil? || data.empty? || !data.chars.all? { |c| BECH32_CHARS.include?(c) }');
    lines.push('    return data.length == data_len unless data_len.nil?');
    lines.push('    true');
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('check_wrapped')) {
    lines.push('  def self.check_wrapped(s, prefix, suffix)');
    lines.push('    s.is_a?(String) && s.length >= prefix.length + suffix.length && s.start_with?(prefix) && s.end_with?(suffix)');
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('check_csv_list')) {
    lines.push('  def self.check_csv_list(s, charset)');
    lines.push('    return false unless s.is_a?(String) && !s.empty?');
    lines.push('    i = 0');
    lines.push('    loop do');
    lines.push('      start = i');
    lines.push('      i += 1 while i < s.length && charset.include?(s[i])');
    lines.push('      return false if i == start');
    lines.push('      return true if i == s.length');
    lines.push("      return false unless s[i] == ','");
    lines.push('      i += 1');
    lines.push('    end');
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('check_ln_invoice')) {
    lines.push('  def self.check_ln_invoice(s, prefix, min_hrp_len)');
    lines.push('    return false unless s.is_a?(String) && s.start_with?(prefix)');
    lines.push("    sep = s.rindex('1')");
    lines.push('    return false if sep.nil?');
    lines.push('    hrp = s[0...sep]');
    lines.push('    return false if hrp.length < min_hrp_len');
    lines.push("    return false unless hrp.chars.all? { |c| (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') }");
    lines.push('    data = s[(sep + 1)..]');
    lines.push('    return false if data.nil? || data.empty?');
    lines.push('    data.chars.all? { |c| BECH32_CHARS.include?(c) }');
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('check_mime_type')) {
    lines.push('  def self.check_mime_type(s)');
    lines.push('    return false unless s.is_a?(String) && !s.empty?');
    lines.push('    i = 0');
    lines.push('    start = i');
    lines.push("    i += 1 while i < s.length && s[i] >= 'a' && s[i] <= 'z'");
    lines.push('    return false if i == start');
    lines.push("    return false unless i < s.length && s[i] == '/'");
    lines.push('    i += 1');
    lines.push('    sub_start = i');
    lines.push('    while i < s.length');
    lines.push('      c = s[i]');
    lines.push("      if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '+' || c == '-'");
    lines.push('        i += 1');
    lines.push('      else');
    lines.push('        break');
    lines.push('      end');
    lines.push('    end');
    lines.push('    return false if i == sub_start');
    lines.push('    i == s.length');
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('check_http_origin')) {
    lines.push('  def self.check_http_origin(s)');
    lines.push('    return false unless s.is_a?(String)');
    lines.push("    if s.start_with?('https://')");
    lines.push('      i = 8');
    lines.push("    elsif s.start_with?('http://')");
    lines.push('      i = 7');
    lines.push('    else');
    lines.push('      return false');
    lines.push('    end');
    lines.push('    start = i');
    lines.push("    i += 1 while i < s.length && s[i] != '/'");
    lines.push('    return false if i == start');
    lines.push("    i += 1 if i < s.length && s[i] == '/'");
    lines.push('    i == s.length');
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('ascii_ws')) {
    lines.push('  ECMA_WS = Set.new([');
    lines.push('    "\\u0009", "\\u000A", "\\u000B", "\\u000C", "\\u000D", "\\u0020",');
    lines.push('    "\\u00A0", "\\u1680",');
    lines.push('    "\\u2000", "\\u2001", "\\u2002", "\\u2003", "\\u2004", "\\u2005",');
    lines.push('    "\\u2006", "\\u2007", "\\u2008", "\\u2009", "\\u200A",');
    lines.push('    "\\u2028", "\\u2029", "\\u202F", "\\u205F", "\\u3000", "\\uFEFF"');
    lines.push('  ]).freeze');
    lines.push('');
  }

  if (helpers.has('check_email_like')) {
    lines.push('  def self.check_email_like(s)');
    lines.push('    return false unless s.is_a?(String) && !s.empty?');
    lines.push('    i = 0');
    lines.push('    start = i');
    lines.push("    i += 1 while i < s.length && !ECMA_WS.include?(s[i]) && s[i] != '@'");
    lines.push('    return false if i == start');
    lines.push("    return false unless i < s.length && s[i] == '@'");
    lines.push('    i += 1');
    lines.push('    dom_start = i');
    lines.push("    i += 1 while i < s.length && !ECMA_WS.include?(s[i]) && s[i] != '@'");
    lines.push('    return false if i == dom_start');
    lines.push('    i == s.length');
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('check_git_clone_url')) {
    lines.push('  def self.check_git_clone_url(s)');
    lines.push('    return false unless s.is_a?(String) && !s.empty?');
    lines.push("    if s.start_with?('git@')");
    lines.push('      i = 4');
    lines.push('    else');
    lines.push("      return false unless s[0] >= 'a' && s[0] <= 'z'");
    lines.push('      i = 1');
    lines.push('      while i < s.length');
    lines.push('        c = s[i]');
    lines.push("        if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '+' || c == '.' || c == '-'");
    lines.push('          i += 1');
    lines.push('        else');
    lines.push('          break');
    lines.push('        end');
    lines.push('      end');
    lines.push("      return false unless i + 3 <= s.length && s[i] == ':' && s[i + 1] == '/' && s[i + 2] == '/'");
    lines.push('      i += 3');
    lines.push('    end');
    lines.push('    return false if i >= s.length');
    lines.push('    (i...s.length).each { |j| return false if ECMA_WS.include?(s[j]) }');
    lines.push('    true');
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('check_content_type')) {
    lines.push('  TYPE_CHARS = Set.new(("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" + \'!#$&^_-\').chars).freeze');
    lines.push('  SUBTYPE_CHARS = Set.new(("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" + \'!#$&^_.+-\').chars).freeze');
    lines.push('');
    lines.push('  def self.check_content_type(s)');
    lines.push('    return false unless s.is_a?(String) && !s.empty?');
    lines.push('    i = 0');
    lines.push("    return false unless (s[i] >= 'a' && s[i] <= 'z') || (s[i] >= 'A' && s[i] <= 'Z')");
    lines.push('    i += 1');
    lines.push('    i += 1 while i < s.length && TYPE_CHARS.include?(s[i])');
    lines.push("    return false unless i < s.length && s[i] == '/'");
    lines.push('    i += 1');
    lines.push('    return false if i >= s.length');
    lines.push('    sc = s[i]');
    lines.push("    return false unless (sc >= 'a' && sc <= 'z') || (sc >= 'A' && sc <= 'Z') || (sc >= '0' && sc <= '9') || sc == '*'");
    lines.push('    i += 1');
    lines.push('    i += 1 while i < s.length && SUBTYPE_CHARS.include?(s[i])');
    lines.push('    while i < s.length');
    lines.push("      i += 1 while i < s.length && ECMA_WS.include?(s[i])");
    lines.push('      return false if i >= s.length');
    lines.push("      return false unless s[i] == ';'");
    lines.push('      i += 1');
    lines.push("      i += 1 while i < s.length && ECMA_WS.include?(s[i])");
    lines.push('      name_start = i');
    lines.push('      i += 1 while i < s.length && SUBTYPE_CHARS.include?(s[i])');
    lines.push('      return false if i == name_start');
    lines.push("      return false unless i < s.length && s[i] == '='");
    lines.push('      i += 1');
    lines.push('      val_start = i');
    lines.push('      i += 1 while i < s.length && SUBTYPE_CHARS.include?(s[i])');
    lines.push('      return false if i == val_start');
    lines.push('    end');
    lines.push('    i == s.length');
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('check_doi')) {
    lines.push('  def self.check_doi(s)');
    lines.push('    return false unless s.is_a?(String) && s.length >= 8');
    lines.push("    return false unless s.start_with?('10.')");
    lines.push('    i = 3');
    lines.push('    d_start = i');
    lines.push("    i += 1 while i < s.length && s[i] >= '0' && s[i] <= '9'");
    lines.push('    d_count = i - d_start');
    lines.push('    return false if d_count < 4 || d_count > 9');
    lines.push("    return false unless i < s.length && s[i] == '/'");
    lines.push('    i += 1');
    lines.push('    check_dot_tail(s, i)');
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('check_annotate_user')) {
    lines.push('  def self.check_annotate_user(s)');
    lines.push('    return false unless s.is_a?(String) && s.length >= 82');
    lines.push("    return false unless s.start_with?('annotate-user ')");
    lines.push('    i = 14');
    lines.push('    return false if i + 64 > s.length');
    lines.push('    (0...64).each do |j|');
    lines.push('      c = s[i + j]');
    lines.push("      return false unless (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')");
    lines.push('    end');
    lines.push('    i += 64');
    lines.push('    2.times do');
    lines.push("      return false unless i < s.length && s[i] == ':'");
    lines.push('      i += 1');
    lines.push('      start = i');
    lines.push("      i += 1 while i < s.length && s[i] >= '0' && s[i] <= '9'");
    lines.push('      return false if i == start');
    lines.push("      if i < s.length && s[i] == '.'");
    lines.push('        i += 1');
    lines.push('        f_start = i');
    lines.push("        i += 1 while i < s.length && s[i] >= '0' && s[i] <= '9'");
    lines.push('        return false if i == f_start');
    lines.push('      end');
    lines.push('    end');
    lines.push('    i == s.length');
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('check_no_ws_tail')) {
    lines.push('  def self.check_no_ws_tail(s, offset)');
    lines.push('    return false unless s.is_a?(String) && offset < s.length');
    lines.push('    (offset...s.length).each { |j| return false if ECMA_WS.include?(s[j]) }');
    lines.push('    true');
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('check_external_identity')) {
    lines.push('  def self.check_external_identity(s)');
    lines.push('    return false unless s.is_a?(String) && !s.empty?');
    lines.push('    i = 0');
    lines.push('    while i < s.length');
    lines.push('      c = s[i]');
    lines.push("      if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '-' || c == '/'");
    lines.push('        i += 1');
    lines.push('      else');
    lines.push('        break');
    lines.push('      end');
    lines.push('    end');
    lines.push('    return false if i == 0');
    lines.push("    return false unless i < s.length && s[i] == ':'");
    lines.push('    i += 1');
    lines.push('    check_dot_tail(s, i)');
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('check_package_id')) {
    lines.push('  PKG_CHARS = Set.new("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._+-".chars).freeze');
    lines.push('');
    lines.push('  def self.check_package_id(s)');
    lines.push('    return false unless s.is_a?(String) && !s.empty?');
    lines.push("    return true if s == '#'");
    lines.push('    i = 0');
    lines.push("    return false unless (s[i] >= 'a' && s[i] <= 'z') || (s[i] >= 'A' && s[i] <= 'Z') || (s[i] >= '0' && s[i] <= '9')");
    lines.push('    i += 1');
    lines.push('    i += 1 while i < s.length && PKG_CHARS.include?(s[i])');
    lines.push("    while i < s.length && s[i] == ':'");
    lines.push('      i += 1');
    lines.push('      return false if i >= s.length');
    lines.push("      return false unless (s[i] >= 'a' && s[i] <= 'z') || (s[i] >= 'A' && s[i] <= 'Z') || (s[i] >= '0' && s[i] <= '9')");
    lines.push('      i += 1');
    lines.push('      i += 1 while i < s.length && PKG_CHARS.include?(s[i])');
    lines.push('    end');
    lines.push('    i == s.length');
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('check_imeta_dim')) {
    lines.push('  def self.check_imeta_dim(s)');
    lines.push('    return false if s.length < 7');
    lines.push('    return false unless s.start_with?("dim ")');
    lines.push('    i = 4');
    lines.push('    dc = 0');
    lines.push('    while i < s.length && s[i] >= \'0\' && s[i] <= \'9\'');
    lines.push('      i += 1');
    lines.push('      dc += 1');
    lines.push('    end');
    lines.push('    return false if dc < 1 || dc > 5');
    lines.push('    return false if i >= s.length || s[i] != \'x\'');
    lines.push('    i += 1');
    lines.push('    dc = 0');
    lines.push('    while i < s.length && s[i] >= \'0\' && s[i] <= \'9\'');
    lines.push('      i += 1');
    lines.push('      dc += 1');
    lines.push('    end');
    lines.push('    return false if dc < 1 || dc > 5');
    lines.push('    i == s.length');
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('check_dim')) {
    lines.push('  # ^[0-9]+x[0-9]+$');
    lines.push('  def self.check_dim(s)');
    lines.push('    return false unless s.is_a?(String) && !s.empty?');
    lines.push('    i = 0');
    lines.push("    return false unless s[i] >= '0' && s[i] <= '9'");
    lines.push("    i += 1 while i < s.length && s[i] >= '0' && s[i] <= '9'");
    lines.push("    return false unless i < s.length && s[i] == 'x'");
    lines.push('    i += 1');
    lines.push("    return false unless i < s.length && s[i] >= '0' && s[i] <= '9'");
    lines.push("    i += 1 while i < s.length && s[i] >= '0' && s[i] <= '9'");
    lines.push('    i == s.length');
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('check_no_uppercase')) {
    lines.push('  # ^[^A-Z]+$');
    lines.push('  def self.check_no_uppercase(s)');
    lines.push('    return false unless s.is_a?(String) && !s.empty?');
    lines.push("    s.each_char { |c| return false if c >= 'A' && c <= 'Z' }");
    lines.push('    true');
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('check_dotted_digits')) {
    lines.push('  # ^[0-9]+(\\.[0-9]+)*$');
    lines.push('  def self.check_dotted_digits(s)');
    lines.push('    return false unless s.is_a?(String) && !s.empty?');
    lines.push('    i = 0');
    lines.push("    return false unless s[i] >= '0' && s[i] <= '9'");
    lines.push("    i += 1 while i < s.length && s[i] >= '0' && s[i] <= '9'");
    lines.push("    while i < s.length && s[i] == '.'");
    lines.push('      i += 1');
    lines.push("      return false unless i < s.length && s[i] >= '0' && s[i] <= '9'");
    lines.push("      i += 1 while i < s.length && s[i] >= '0' && s[i] <= '9'");
    lines.push('    end');
    lines.push('    i == s.length');
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('check_slash_segments')) {
    lines.push('  # ^[charset]+(/[charset]+)*$');
    lines.push('  def self.check_slash_segments(s, charset)');
    lines.push('    return false unless s.is_a?(String) && !s.empty?');
    lines.push('    i = 0');
    lines.push('    return false unless charset.include?(s[i])');
    lines.push('    i += 1 while i < s.length && charset.include?(s[i])');
    lines.push("    while i < s.length && s[i] == '/'");
    lines.push('      i += 1');
    lines.push('      return false unless i < s.length && charset.include?(s[i])');
    lines.push('      i += 1 while i < s.length && charset.include?(s[i])');
    lines.push('    end');
    lines.push('    i == s.length');
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('check_space_separated_tokens')) {
    lines.push('  # ^\\S+( \\S+)*$');
    lines.push('  def self.check_space_separated_tokens(s)');
    lines.push('    return false unless s.is_a?(String) && !s.empty?');
    lines.push('    i = 0');
    lines.push('    return false if ECMA_WS.include?(s[i])');
    lines.push('    i += 1 while i < s.length && !ECMA_WS.include?(s[i])');
    lines.push("    while i < s.length && s[i] == ' '");
    lines.push('      i += 1');
    lines.push('      return false if i >= s.length || ECMA_WS.include?(s[i])');
    lines.push('      i += 1 while i < s.length && !ECMA_WS.include?(s[i])');
    lines.push('    end');
    lines.push('    i == s.length');
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('check_starts_with_charset')) {
    lines.push('  # ^[charset]+ (no end anchor)');
    lines.push('  def self.check_starts_with_charset(s, charset)');
    lines.push('    s.is_a?(String) && !s.empty? && charset.include?(s[0])');
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('check_base64')) {
    lines.push('  def self.is_b64_char(c)');
    lines.push("    (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '+' || c == '/'");
    lines.push('  end');
    lines.push('');
    lines.push('  # ^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$');
    lines.push('  def self.check_base64(s)');
    lines.push('    return false unless s.is_a?(String)');
    lines.push('    return true if s.empty?');
    lines.push('    return false unless s.length % 4 == 0');
    lines.push('    i = 0');
    lines.push("    i += 1 while i < s.length && s[i] != '=' && is_b64_char(s[i])");
    lines.push("    return false if i < s.length && s[i] != '='");
    lines.push('    data_len = i');
    lines.push('    pad_len = s.length - data_len');
    lines.push('    return false if pad_len > 2');
    lines.push('    return false if pad_len == 1 && data_len % 4 != 3');
    lines.push('    return false if pad_len == 2 && data_len % 4 != 2');
    lines.push("    (data_len...s.length).each { |j| return false unless s[j] == '=' }");
    lines.push('    true');
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('check_base64_2pad')) {
    lines.push('  # strict base64 with mandatory 2-char padding');
    lines.push('  def self.check_base64_2pad(s)');
    lines.push('    return false unless s.is_a?(String)');
    lines.push('    n = s.length');
    lines.push('    return false if n < 4 || n % 4 != 0');
    lines.push("    return false unless s[n - 1] == '=' && s[n - 2] == '='");
    lines.push('    (0...n - 2).each { |i| return false unless is_b64_char(s[i]) }');
    lines.push('    true');
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('check_nostr_uri')) {
    lines.push('  BECH32_DATA_CHARS = Set.new("023456789acdefghjklmnpqrstuvwxyz".chars).freeze');
    lines.push('');
    lines.push('  # ^nostr:((npub|note)1[bech32]{58}|(nprofile|nevent|naddr)1[bech32]+)$');
    lines.push('  def self.check_nostr_uri(s)');
    lines.push("    return false unless s.is_a?(String) && s.start_with?('nostr:')");
    lines.push('    p = s[6..]');
    lines.push('    return false if p.nil? || p.empty?');
    lines.push('    # npub1 or note1 + exactly 58 data chars');
    lines.push("    if p.length == 63 && (p.start_with?('npub1') || p.start_with?('note1'))");
    lines.push('      (5...63).each { |i| return false unless BECH32_DATA_CHARS.include?(p[i]) }');
    lines.push('      return true');
    lines.push('    end');
    lines.push('    # nprofile1, nevent1, naddr1 + 1+ data chars');
    lines.push('    prefix_len = 0');
    lines.push("    if p.start_with?('nprofile1')");
    lines.push('      prefix_len = 9');
    lines.push("    elsif p.start_with?('nevent1')");
    lines.push('      prefix_len = 7');
    lines.push("    elsif p.start_with?('naddr1')");
    lines.push('      prefix_len = 6');
    lines.push('    end');
    lines.push('    return false if prefix_len == 0 || p.length <= prefix_len');
    lines.push('    (prefix_len...p.length).each { |i| return false unless BECH32_DATA_CHARS.include?(p[i]) }');
    lines.push('    true');
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('check_nip04_encrypted')) {
    lines.push('  # ^[A-Za-z0-9+/]+={0,2}\\?iv=[A-Za-z0-9+/]+={0,2}$');
    lines.push('  def self.check_nip04_encrypted(s)');
    lines.push('    return false unless s.is_a?(String) && !s.empty?');
    lines.push("    sep = s.index('?iv=')");
    lines.push('    return false if sep.nil? || sep == 0');
    lines.push('    right_start = sep + 4');
    lines.push('    return false if right_start >= s.length');
    lines.push('    # check left half: 1+ b64 chars + 0-2 =');
    lines.push('    i = 0');
    lines.push('    i += 1 while i < sep && is_b64_char(s[i])');
    lines.push('    return false if i == 0');
    lines.push('    eq = 0');
    lines.push("    while i < sep && s[i] == '='");
    lines.push('      i += 1');
    lines.push('      eq += 1');
    lines.push('    end');
    lines.push('    return false if i != sep || eq > 2');
    lines.push('    # check right half');
    lines.push('    i = right_start');
    lines.push('    data_start = i');
    lines.push('    i += 1 while i < s.length && is_b64_char(s[i])');
    lines.push('    return false if i == data_start');
    lines.push('    eq = 0');
    lines.push("    while i < s.length && s[i] == '='");
    lines.push('      i += 1');
    lines.push('      eq += 1');
    lines.push('    end');
    lines.push('    i == s.length && eq <= 2');
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('is_alnum')) {
    lines.push('  def self.is_alnum(c)');
    lines.push("    (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')");
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('check_nip05_identifier')) {
    lines.push('  def self.is_nip05_local_char(c)');
    lines.push("    c == '_' || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '-'");
    lines.push('  end');
    lines.push('');
    lines.push('  def self.is_domain_char(c)');
    lines.push("    (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-'");
    lines.push('  end');
    lines.push('');
    lines.push('  # NIP-05: local@domain.tld');
    lines.push('  def self.check_nip05_identifier(s)');
    lines.push('    return false unless s.is_a?(String) && !s.empty?');
    lines.push('    # find last @');
    lines.push('    at = nil');
    lines.push("    (0...s.length).each { |i| at = i if s[i] == '@' }");
    lines.push('    return false if at.nil? || at == 0');
    lines.push('    # local part');
    lines.push('    (0...at).each { |i| return false unless is_nip05_local_char(s[i]) }');
    lines.push('    # domain: 2+ dot-separated labels');
    lines.push('    d = s[(at + 1)..]');
    lines.push('    return false if d.nil? || d.empty?');
    lines.push('    dot_count = 0');
    lines.push('    di = 0');
    lines.push('    while di < d.length');
    lines.push('      return false unless is_alnum(d[di])');
    lines.push('      di += 1 while di < d.length && is_domain_char(d[di])');
    lines.push('      return false unless is_alnum(d[di - 1])');
    lines.push("      if di < d.length && d[di] == '.'");
    lines.push('        dot_count += 1');
    lines.push('        di += 1');
    lines.push('      elsif di < d.length');
    lines.push('        return false');
    lines.push('      end');
    lines.push('    end');
    lines.push('    dot_count >= 1 && is_alnum(d[d.length - 1])');
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('check_mime_type_strict')) {
    lines.push('  def self.is_mime_strict_char(c)');
    lines.push("    is_alnum(c) || c == '!' || c == '#' || c == '$' || c == '&' || c == '^' || c == '_' || c == '.' || c == '+' || c == '-'");
    lines.push('  end');
    lines.push('');
    lines.push('  # ^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$');
    lines.push('  def self.check_mime_type_strict(s)');
    lines.push('    return false unless s.is_a?(String) && !s.empty?');
    lines.push('    i = 0');
    lines.push('    return false unless is_alnum(s[i])');
    lines.push('    i += 1');
    lines.push('    i += 1 while i < s.length && is_mime_strict_char(s[i])');
    lines.push("    return false unless i < s.length && s[i] == '/'");
    lines.push('    i += 1');
    lines.push('    return false unless i < s.length && is_alnum(s[i])');
    lines.push('    i += 1');
    lines.push('    i += 1 while i < s.length && is_mime_strict_char(s[i])');
    lines.push('    i == s.length');
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('check_prefix_delim_rest')) {
    lines.push('  # ^[charset]+<delim>.+ (no end anchor)');
    lines.push('  def self.check_prefix_delim_rest(s, charset, delim)');
    lines.push('    return false unless s.is_a?(String) && !s.empty?');
    lines.push('    i = 0');
    lines.push('    return false unless charset.include?(s[i])');
    lines.push('    i += 1 while i < s.length && charset.include?(s[i])');
    lines.push('    return false if i + delim.length >= s.length');
    lines.push('    return false unless s[i, delim.length] == delim');
    lines.push('    i += delim.length');
    lines.push('    return false if i >= s.length');
    lines.push("    # .+ first char must not be a line terminator (Ruby Regexp . excludes \\n only)");
    lines.push('    return false if s[i] == "\\n"');
    lines.push('    true');
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('check_identifier')) {
    if (lines.length > 0) lines.push('');
    lines.push("  def self.check_identifier(s, first_charset, rest_charset, prefix = '')");
    lines.push('    i = 0');
    lines.push("    if prefix != '' && i < s.length && s[i] == prefix");
    lines.push('      i += 1');
    lines.push('    end');
    lines.push('    return false if i >= s.length');
    lines.push('    return false unless first_charset.include?(s[i])');
    lines.push('    i += 1');
    lines.push('    while i < s.length');
    lines.push('      return false unless rest_charset.include?(s[i])');
    lines.push('      i += 1');
    lines.push('    end');
    lines.push('    true');
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('check_space_separated_charset')) {
    if (lines.length > 0) lines.push('');
    lines.push('  def self.check_space_separated_charset(s, charset)');
    lines.push('    return false if s.empty?');
    lines.push('    i = 0');
    lines.push('    return false unless charset.include?(s[i])');
    lines.push('    i += 1 while i < s.length && charset.include?(s[i])');
    lines.push("    while i < s.length && s[i] == ' '");
    lines.push('      i += 1');
    lines.push('      return false if i >= s.length || !charset.include?(s[i])');
    lines.push('      i += 1 while i < s.length && charset.include?(s[i])');
    lines.push('    end');
    lines.push('    i == s.length');
    lines.push('  end');
    lines.push('');
  }

  if (helpers.has('check_uri_scheme')) {
    if (lines.length > 0) lines.push('');
    lines.push('  def self.check_uri_scheme(s)');
    lines.push('    return false if s.length < 4');
    lines.push('    c = s[0]');
    lines.push("    return false unless (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')");
    lines.push('    i = 1');
    lines.push('    while i < s.length');
    lines.push('      c = s[i]');
    lines.push("      if (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '+' || c == '.' || c == '-'");
    lines.push('        i += 1');
    lines.push('      else');
    lines.push('        break');
    lines.push('      end');
    lines.push('    end');
    lines.push('    return false if i + 3 > s.length');
    lines.push("    s[i] == ':' && s[i+1] == '/' && s[i+2] == '/'");
    lines.push('  end');
    lines.push('');
  }

  return lines.join('\n');
}
