/**
 * Rust validator emitter: ValidatorAction[] → .rs file
 *
 * Default: generic Rust — tags are &[&[&str]] (slice of string slices).
 * Works with any Rust project regardless of which nostr crate they use.
 *
 * Optional API targets via --rust-api flag:
 *   - "nostr": nostr crate v0.37+ (Tags, Tag)
 *   - "nostrdb": nostrdb-rs crate (Note, Tag)
 *
 * All pattern checks use hand-coded Rust (no regex crate dependency
 * for the majority of patterns). Error messages are &'static str.
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

export type RustApi = 'generic' | 'nostr' | 'nostrdb';

// --- API adapter: abstracts how tags are accessed ---

interface RustApiAdapter {
  /** Type for the tags parameter in per-kind functions */
  tagsParam: string;
  /** Type for the tags parameter in dispatch function */
  dispatchParam: string;
  /** Expression to iterate tags: wraps closure body */
  iterExpr: string;
  /** Expression: get Option<&str> at position `index` within tag variable `t` */
  tagGet: (tagVar: string, index: number) => string;
  /** Expression: length of tag variable `t` */
  tagLen: (tagVar: string) => string;
  /** Expression: check if tag name equals `name` */
  tagNameCheck: (tagVar: string, name: string) => string;
}

function genericAdapter(): RustApiAdapter {
  return {
    tagsParam: "&[&[&str]]",
    dispatchParam: "&[&[&str]]",
    iterExpr: 'tags.iter()',
    tagGet: (t, i) => `${t}.get(${i}).copied()`,
    tagLen: (t) => `${t}.len()`,
    tagNameCheck: (t, name) => `${t}.first() == Some(&${JSON.stringify(name)})`,
  };
}

function nostrAdapter(): RustApiAdapter {
  return {
    tagsParam: "&Tags",
    dispatchParam: "&Tags",
    iterExpr: 'tags.iter()',
    tagGet: (t, i) => `${t}.as_slice().get(${i}).map(|s| s.as_str())`,
    tagLen: (t) => `${t}.len()`,
    tagNameCheck: (t, name) => `${t}.as_slice().first().map(|s| s.as_str()) == Some(${JSON.stringify(name)})`,
  };
}

function nostrdbAdapter(): RustApiAdapter {
  return {
    tagsParam: "&[Tag]",
    dispatchParam: "&[Tag]",
    iterExpr: 'tags.iter()',
    tagGet: (t, i) => `${t}.get_str(${i})`,
    tagLen: (t) => `${t}.count() as usize`,
    tagNameCheck: (t, name) => `${t}.get_str(0) == Some(${JSON.stringify(name)})`,
  };
}

function getAdapter(api: RustApi): RustApiAdapter {
  switch (api) {
    case 'nostr': return nostrAdapter();
    case 'nostrdb': return nostrdbAdapter();
    default: return genericAdapter();
  }
}

// --- Pattern check helpers (API-independent) ---

function renderPatternCheckRust(check: PatternCheck, varExpr: string): { expr: string; helpers: Set<string> } {
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
      const checks = check.prefixes.map(p => `${varExpr}.starts_with(${JSON.stringify(p)})`);
      return { expr: checks.length === 1 ? checks[0] : `(${checks.join(' || ')})`, helpers };
    }
    case 'chars_in': {
      if (check.min === 0 && check.max === 0) {
        return { expr: `${varExpr}.is_empty()`, helpers };
      }
      helpers.add('check_chars_in');
      return {
        expr: `check_chars_in(${varExpr}, ${JSON.stringify(check.charset)}, ${check.min ?? 0}, ${check.max ?? 'usize::MAX'})`,
        helpers,
      };
    }
    case 'bech32': {
      helpers.add('check_bech32');
      if (check.dataLen !== undefined) {
        return { expr: `check_bech32(${varExpr}, ${JSON.stringify(check.hrp + '1')}, Some(${check.dataLen}))`, helpers };
      }
      return { expr: `check_bech32(${varExpr}, ${JSON.stringify(check.hrp + '1')}, None)`, helpers };
    }
    case 'regex': {
      helpers.add('regex');
      return { expr: `check_regex(${varExpr}, ${JSON.stringify(check.pattern)})`, helpers };
    }
    case 'relay_url': {
      helpers.add('check_relay_url');
      return { expr: `check_relay_url(${varExpr})`, helpers };
    }
    case 'a_tag': {
      helpers.add('check_a_tag');
      if (check.kinds && check.kinds.length > 0) {
        return { expr: `check_a_tag(${varExpr}, &[${check.kinds.join(', ')}])`, helpers };
      }
      return { expr: `check_a_tag(${varExpr}, &[])`, helpers };
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
      return {
        expr: `(${varExpr}.starts_with(${JSON.stringify(check.prefix)}) && ${varExpr}.len() > ${check.prefix.length})`,
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
      helpers.add('check_bech32');
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
      return { expr: `check_email_like(${varExpr})`, helpers };
    }
    case 'git_clone_url': {
      helpers.add('check_git_clone_url');
      return { expr: `check_git_clone_url(${varExpr})`, helpers };
    }
    case 'content_type': {
      helpers.add('check_content_type');
      return { expr: `check_content_type(${varExpr})`, helpers };
    }
    case 'doi': {
      helpers.add('check_doi');
      return { expr: `check_doi(${varExpr})`, helpers };
    }
    case 'annotate_user': {
      helpers.add('check_annotate_user');
      return { expr: `check_annotate_user(${varExpr})`, helpers };
    }
    case 'prefix_no_whitespace': {
      helpers.add('check_no_ws_tail');
      const checks = check.prefixes.map(p =>
        `(${varExpr}.starts_with(${JSON.stringify(p)}) && check_no_ws_tail(${varExpr}.as_bytes(), ${p.length}))`
      );
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
    case 'compound': {
      const allHelpers = new Set<string>();
      const parts: string[] = [];
      for (const sub of check.checks) {
        const r = renderPatternCheckRust(sub, varExpr);
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

function renderValueCheckRust(
  check: ValueCheck,
  adapter: RustApiAdapter,
  tagVar: string,
  index: number,
): { expr: string; helpers: Set<string> } {
  const helpers = new Set<string>();
  const access = adapter.tagGet(tagVar, index);

  switch (check.type) {
    case 'const':
      return { expr: `${access} == Some(${JSON.stringify(check.value)})`, helpers };
    case 'enum': {
      const vals = check.values.map(v => JSON.stringify(v));
      return {
        expr: `matches!(${access}, Some(v) if [${vals.join(', ')}].contains(&v))`,
        helpers,
      };
    }
    case 'pattern': {
      const r = renderPatternCheckRust(check.native, 'v');
      for (const h of r.helpers) helpers.add(h);
      return {
        expr: `${access}.map_or(false, |v| ${r.expr})`,
        helpers,
      };
    }
    case 'anyOf': {
      const parts: string[] = [];
      for (const alt of check.alternatives) {
        const r = renderValueCheckRust(alt, adapter, tagVar, index);
        parts.push(r.expr);
        for (const h of r.helpers) helpers.add(h);
      }
      return { expr: `(${parts.join(' || ')})`, helpers };
    }
  }
}

function describePositionConstraintRust(pc: PositionCheck, tagName: string): string {
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

function renderTagMatcherRust(
  matcher: TagMatcher,
  tagVar: string,
  adapter: RustApiAdapter,
  helpers: Set<string>,
): string {
  const checks: string[] = [];

  checks.push(adapter.tagNameCheck(tagVar, matcher.tagName));
  checks.push(`${adapter.tagLen(tagVar)} >= ${matcher.minItems}`);
  if (matcher.maxItems !== undefined) {
    checks.push(`${adapter.tagLen(tagVar)} <= ${matcher.maxItems}`);
  }

  for (const pc of matcher.positionChecks) {
    const r = renderValueCheckRust(pc.check, adapter, tagVar, pc.index);
    for (const h of r.helpers) helpers.add(h);
    checks.push(r.expr);
  }

  return checks.join(' && ');
}

// --- Main emitter ---

export function emitRustValidators(
  kindShapes: KindShape[],
  api: RustApi = 'generic',
): string {
  const adapter = getAdapter(api);
  const allHelpers = new Set<string>();
  const fnBodies: string[] = [];
  const constrainedKinds: { kindNumber: number; nip: string }[] = [];

  for (const shape of [...kindShapes].sort((a, b) => a.kindNumber - b.kindNumber)) {
    const actions = planKindValidator(shape);
    if (!actions) continue;

    constrainedKinds.push({ kindNumber: shape.kindNumber, nip: shape.nip });
    const { code, helpers } = emitKindFunctionRust(shape.kindNumber, shape.nip, actions, adapter);
    fnBodies.push(code);
    for (const h of helpers) allHelpers.add(h);
  }

  return emitRustFile(fnBodies, constrainedKinds, allHelpers, adapter);
}

function emitKindFunctionRust(
  kindNumber: number,
  nip: string,
  actions: ValidatorAction[],
  adapter: RustApiAdapter,
): { code: string; helpers: Set<string> } {
  const helpers = new Set<string>();
  const lines: string[] = [];

  lines.push(`/// Validate tags for kind ${kindNumber} (${nip})`);
  lines.push(`pub fn validate_kind_${kindNumber}(tags: ${adapter.tagsParam}) -> Vec<ValidationError> {`);
  lines.push('    let mut errors = Vec::new();');

  for (const action of actions) {
    switch (action.type) {
      case 'check_min_tags':
        lines.push(`    if tags.len() < ${action.min} {`);
        lines.push(`        errors.push(ValidationError { path: "tags", message: "tags must have at least ${action.min} item(s)" });`);
        lines.push('    }');
        break;

      case 'require_tag': {
        const matcherExpr = renderTagMatcherRust(action.matcher, 't', adapter, helpers);
        lines.push(`    if !${adapter.iterExpr}.any(|t| ${matcherExpr}) {`);
        lines.push(`        errors.push(ValidationError { path: "tags", message: ${JSON.stringify(action.errorMsg)} });`);
        lines.push('    }');
        break;
      }

      case 'validate_optional_positions': {
        lines.push(`    for t in ${adapter.iterExpr} {`);
        lines.push(`        if ${adapter.tagNameCheck('t', action.tagName)} {`);
        for (const pc of action.checks) {
          const r = renderValueCheckRust(pc.check, adapter, 't', pc.index);
          for (const h of r.helpers) helpers.add(h);
          const msg = describePositionConstraintRust(pc, action.tagName);
          lines.push(`            if ${adapter.tagLen('t')} > ${pc.index} && !(${r.expr}) {`);
          lines.push(`                errors.push(ValidationError { path: "tags", message: ${JSON.stringify(msg)} });`);
          lines.push('            }');
        }
        lines.push('        }');
        lines.push('    }');
        break;
      }

      case 'per_item_conditional': {
        const matcherExpr = renderTagMatcherRust(action.matcher, 't', adapter, helpers);
        lines.push(`    for t in ${adapter.iterExpr} {`);
        lines.push(`        if ${adapter.tagNameCheck('t', action.condTag)} && !(${matcherExpr}) {`);
        lines.push(`            errors.push(ValidationError { path: "tags", message: ${JSON.stringify(action.errorMsg)} });`);
        lines.push('        }');
        if (action.optChecks.length > 0) {
          lines.push(`        if ${adapter.tagNameCheck('t', action.condTag)} {`);
          for (const pc of action.optChecks) {
            const r = renderValueCheckRust(pc.check, adapter, 't', pc.index);
            for (const h of r.helpers) helpers.add(h);
            const msg = describePositionConstraintRust(pc, action.condTag);
            lines.push(`            if ${adapter.tagLen('t')} > ${pc.index} && !(${r.expr}) {`);
            lines.push(`                errors.push(ValidationError { path: "tags", message: ${JSON.stringify(msg)} });`);
            lines.push('            }');
          }
          lines.push('        }');
        }
        lines.push('    }');
        break;
      }

      case 'array_level_conditional': {
        lines.push(`    if ${adapter.iterExpr}.any(|t| ${adapter.tagNameCheck('t', action.condTag)}) {`);
        const matcherExpr = renderTagMatcherRust(action.matcher, 't', adapter, helpers);
        lines.push(`        if !${adapter.iterExpr}.any(|t| ${matcherExpr}) {`);
        lines.push(`            errors.push(ValidationError { path: "tags", message: ${JSON.stringify(action.errorMsg)} });`);
        lines.push('        }');
        if (action.optChecks.length > 0) {
          lines.push(`        for t in ${adapter.iterExpr} {`);
          lines.push(`            if ${adapter.tagNameCheck('t', action.matcher.tagName)} {`);
          for (const pc of action.optChecks) {
            const r = renderValueCheckRust(pc.check, adapter, 't', pc.index);
            for (const h of r.helpers) helpers.add(h);
            const msg = describePositionConstraintRust(pc, action.matcher.tagName);
            lines.push(`                if ${adapter.tagLen('t')} > ${pc.index} && !(${r.expr}) {`);
            lines.push(`                    errors.push(ValidationError { path: "tags", message: ${JSON.stringify(msg)} });`);
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
          const expr = renderTagMatcherRust(m, 't', adapter, helpers);
          return `${adapter.iterExpr}.any(|t| ${expr})`;
        });
        lines.push(`    if !(${matchers.join(' || ')}) {`);
        lines.push(`        errors.push(ValidationError { path: "tags", message: ${JSON.stringify(action.errorMsg)} });`);
        lines.push('    }');
        break;
      }
    }
  }

  lines.push('    errors');
  lines.push('}');

  return { code: lines.join('\n'), helpers };
}

// --- File generation ---

function emitRustFile(
  fnBodies: string[],
  constrainedKinds: { kindNumber: number; nip: string }[],
  helpers: Set<string>,
  adapter: RustApiAdapter,
): string {
  const lines: string[] = [
    '// Auto-generated by @nostrability/schemata-codegen',
    '// Do not edit manually.',
    '//',
    '// Runtime validators for Nostr event tag constraints',
    '',
    '#[derive(Debug, Clone)]',
    'pub struct ValidationError {',
    "    pub path: &'static str,",
    "    pub message: &'static str,",
    '}',
    '',
  ];

  lines.push(emitRustHelpers(helpers));

  for (const fn of fnBodies) {
    lines.push(fn);
    lines.push('');
  }

  lines.push('/// Validate tags for a given kind number.');
  lines.push('/// Returns empty Vec if kind has no constraints or is unknown.');
  lines.push(`pub fn validate_kind_tags(kind: u32, tags: ${adapter.dispatchParam}) -> Vec<ValidationError> {`);
  lines.push('    match kind {');
  for (const k of constrainedKinds) {
    lines.push(`        ${k.kindNumber} => validate_kind_${k.kindNumber}(tags),`);
  }
  lines.push('        _ => Vec::new(),');
  lines.push('    }');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

function emitRustHelpers(helpers: Set<string>): string {
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
    lines.push(`fn check_hex_${len}(s: &str) -> bool {`);
    lines.push(`    s.len() == ${len} && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))`);
    lines.push('}');
    lines.push('');
  }

  for (const len of [...hexMixedLengths].sort((a, b) => a - b)) {
    lines.push(`fn check_hex_${len}_mixed(s: &str) -> bool {`);
    lines.push(`    s.len() == ${len} && s.bytes().all(|b| b.is_ascii_hexdigit())`);
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_hex_range')) {
    lines.push('fn check_hex_range(s: &str, min: usize, max: usize) -> bool {');
    lines.push('    let len = s.len();');
    lines.push("    len >= min && len <= max && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))");
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_hex_range_mixed')) {
    lines.push('fn check_hex_range_mixed(s: &str, min: usize, max: usize) -> bool {');
    lines.push('    let len = s.len();');
    lines.push('    len >= min && len <= max && s.bytes().all(|b| b.is_ascii_hexdigit())');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_hex_prefixed')) {
    lines.push('fn check_hex_prefixed(s: &str, prefix: &str, hex_len: usize) -> bool {');
    lines.push('    s.starts_with(prefix)');
    lines.push("        && s[prefix.len()..].len() == hex_len");
    lines.push("        && s[prefix.len()..].bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))");
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_digits')) {
    lines.push('fn check_digits(s: &str) -> bool {');
    lines.push('    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_signed_int')) {
    lines.push("fn check_signed_int(s: &str) -> bool {");
    lines.push("    let s = s.strip_prefix('-').unwrap_or(s);");
    lines.push('    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_chars_in')) {
    lines.push('fn check_chars_in(s: &str, charset: &str, min: usize, max: usize) -> bool {');
    lines.push('    let len = s.len();');
    lines.push('    len >= min && len <= max && s.chars().all(|c| charset.contains(c))');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_bech32')) {
    lines.push('fn is_bech32_char(b: u8) -> bool {');
    lines.push("    matches!(b, b'0' | b'2'..=b'9' | b'a' | b'c'..=b'h' | b'j'..=b'n' | b'p'..=b'z')");
    lines.push('}');
    lines.push('');
    lines.push('fn check_bech32(s: &str, prefix: &str, data_len: Option<usize>) -> bool {');
    lines.push('    if !s.starts_with(prefix) { return false; }');
    lines.push('    let data = &s[prefix.len()..];');
    lines.push('    if data.is_empty() { return false; }');
    lines.push('    if !data.bytes().all(is_bech32_char) { return false; }');
    lines.push('    match data_len {');
    lines.push('        Some(len) => data.len() == len,');
    lines.push('        None => true,');
    lines.push('    }');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_date_iso')) {
    lines.push('fn check_date_iso(s: &str) -> bool {');
    lines.push('    let b = s.as_bytes();');
    lines.push("    b.len() == 10 && b[4] == b'-' && b[7] == b'-'");
    lines.push('        && b[..4].iter().all(|c| c.is_ascii_digit())');
    lines.push('        && b[5..7].iter().all(|c| c.is_ascii_digit())');
    lines.push('        && b[8..10].iter().all(|c| c.is_ascii_digit())');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_decimal')) {
    lines.push('fn check_decimal(s: &str) -> bool {');
    lines.push('    if s.is_empty() { return false; }');
    lines.push('    let b = s.as_bytes();');
    lines.push('    let mut i = 0;');
    lines.push('    while i < b.len() && b[i].is_ascii_digit() { i += 1; }');
    lines.push('    if i == 0 { return false; }');
    lines.push("    if i < b.len() && b[i] == b'.' {");
    lines.push('        i += 1;');
    lines.push('        if i >= b.len() || !b[i].is_ascii_digit() { return false; }');
    lines.push('        while i < b.len() && b[i].is_ascii_digit() { i += 1; }');
    lines.push('    }');
    lines.push('    i == b.len() && i > 0');
    lines.push('}');
    lines.push('');
  }

  // Shared dot-tail helper: checks remaining bytes have >=1 byte and no \n (Rust regex . excludes \n only)
  if (helpers.has('check_relay_url') || helpers.has('check_a_tag') || helpers.has('check_doi')) {
    lines.push('fn check_dot_tail(b: &[u8], pos: usize) -> bool {');
    lines.push("    pos < b.len() && b[pos..].iter().all(|&c| c != b'\\n')");
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_relay_url')) {
    lines.push('fn check_relay_url(s: &str) -> bool {');
    lines.push('    let b = s.as_bytes();');
    lines.push('    let pos;');
    lines.push('    if b.starts_with(b"wss://") { pos = 6; }');
    lines.push('    else if b.starts_with(b"ws://") { pos = 5; }');
    lines.push('    else { return false; }');
    lines.push('    let host_start = pos;');
    lines.push('    let mut i = pos;');
    lines.push("    while i < b.len() && matches!(b[i], b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'.' | b'_' | b'-') { i += 1; }");
    lines.push('    if i == host_start { return false; }');
    lines.push("    if i < b.len() && b[i] == b':' {");
    lines.push('        i += 1;');
    lines.push('        let port_start = i;');
    lines.push('        while i < b.len() && b[i].is_ascii_digit() { i += 1; }');
    lines.push('        if i == port_start { return false; }');
    lines.push('    }');
    lines.push("    if i < b.len() && b[i] == b'/' {");
    lines.push('        return check_dot_tail(b, i + 1) || i + 1 == b.len();');
    lines.push('    }');
    lines.push('    i == b.len()');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_a_tag')) {
    lines.push('fn check_a_tag(s: &str, kinds: &[u32]) -> bool {');
    lines.push('    let b = s.as_bytes();');
    lines.push('    if b.len() < 68 { return false; }');
    lines.push('    let mut pos = 0;');
    lines.push('    if !b[pos].is_ascii_digit() { return false; }');
    lines.push('    let mut kind: u32 = 0;');
    lines.push('    while pos < b.len() && b[pos].is_ascii_digit() {');
    lines.push("        kind = kind * 10 + (b[pos] - b'0') as u32;");
    lines.push('        pos += 1;');
    lines.push('    }');
    lines.push("    if pos >= b.len() || b[pos] != b':' { return false; }");
    lines.push('    if !kinds.is_empty() && !kinds.contains(&kind) { return false; }');
    lines.push('    pos += 1;');
    lines.push('    if pos + 64 >= b.len() { return false; }');
    lines.push("    if !b[pos..pos+64].iter().all(|&c| matches!(c, b'0'..=b'9' | b'a'..=b'f')) { return false; }");
    lines.push('    pos += 64;');
    lines.push("    if pos >= b.len() || b[pos] != b':' { return false; }");
    lines.push('    pos += 1;');
    lines.push('    check_dot_tail(b, pos)');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_datetime_iso')) {
    lines.push('fn check_datetime_iso(s: &str) -> bool {');
    lines.push('    let b = s.as_bytes();');
    lines.push('    if b.len() < 10 { return false; }');
    lines.push("    if !b[..4].iter().all(|c| c.is_ascii_digit()) || b[4] != b'-' { return false; }");
    lines.push("    if !b[5..7].iter().all(|c| c.is_ascii_digit()) || b[7] != b'-' { return false; }");
    lines.push('    if !b[8..10].iter().all(|c| c.is_ascii_digit()) { return false; }');
    lines.push('    if b.len() == 10 { return true; }');
    lines.push("    if b[10] != b'T' || b.len() < 16 { return false; }");
    lines.push("    if !b[11..13].iter().all(|c| c.is_ascii_digit()) || b[13] != b':' { return false; }");
    lines.push('    if !b[14..16].iter().all(|c| c.is_ascii_digit()) { return false; }');
    lines.push('    let mut pos = 16;');
    lines.push('    if pos == b.len() { return true; }');
    lines.push("    if b[pos] == b':' {");
    lines.push('        if pos + 3 > b.len() { return false; }');
    lines.push('        if !b[pos+1..pos+3].iter().all(|c| c.is_ascii_digit()) { return false; }');
    lines.push('        pos += 3;');
    lines.push('    }');
    lines.push('    if pos == b.len() { return true; }');
    lines.push("    if b[pos] == b'.' {");
    lines.push('        pos += 1;');
    lines.push('        if pos >= b.len() || !b[pos].is_ascii_digit() { return false; }');
    lines.push('        while pos < b.len() && b[pos].is_ascii_digit() { pos += 1; }');
    lines.push('    }');
    lines.push('    if pos == b.len() { return true; }');
    lines.push("    if b[pos] == b'Z' { return pos + 1 == b.len(); }");
    lines.push("    if b[pos] == b'+' || b[pos] == b'-' {");
    lines.push('        if pos + 6 != b.len() { return false; }');
    lines.push('        if !b[pos+1..pos+3].iter().all(|c| c.is_ascii_digit()) { return false; }');
    lines.push("        if b[pos+3] != b':' { return false; }");
    lines.push('        return b[pos+4..pos+6].iter().all(|c| c.is_ascii_digit());');
    lines.push('    }');
    lines.push('    false');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('regex')) {
    lines.push('fn check_regex(s: &str, pattern: &str) -> bool {');
    lines.push('    // NOTE: This requires the `regex` crate dependency.');
    lines.push('    // Consider pre-compiling patterns with `lazy_static!` or `once_cell`.');
    lines.push('    regex::Regex::new(pattern).map_or(false, |re| re.is_match(s))');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_wrapped')) {
    lines.push('fn check_wrapped(s: &str, prefix: &str, suffix: &str) -> bool {');
    lines.push('    s.len() >= prefix.len() + suffix.len() && s.starts_with(prefix) && s.ends_with(suffix)');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_csv_list')) {
    lines.push('fn check_csv_list(s: &str, charset: &str) -> bool {');
    lines.push('    if s.is_empty() { return false; }');
    lines.push('    let b = s.as_bytes();');
    lines.push('    let mut i = 0;');
    lines.push('    loop {');
    lines.push('        let start = i;');
    lines.push('        while i < b.len() && charset.as_bytes().contains(&b[i]) { i += 1; }');
    lines.push('        if i == start { return false; }');
    lines.push('        if i == b.len() { return true; }');
    lines.push("        if b[i] != b',' { return false; }");
    lines.push('        i += 1;');
    lines.push('    }');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_ln_invoice')) {
    lines.push('fn check_ln_invoice(s: &str, prefix: &str, min_hrp_len: usize) -> bool {');
    lines.push('    if !s.starts_with(prefix) { return false; }');
    lines.push('    let b = s.as_bytes();');
    lines.push("    let sep = match b.iter().rposition(|&c| c == b'1') {");
    lines.push('        Some(pos) => pos,');
    lines.push('        None => return false,');
    lines.push('    };');
    lines.push('    if sep < min_hrp_len { return false; }');
    lines.push("    if !b[..sep].iter().all(|&c| matches!(c, b'a'..=b'z' | b'0'..=b'9')) { return false; }");
    lines.push('    let data = &b[sep + 1..];');
    lines.push('    if data.is_empty() { return false; }');
    lines.push('    data.iter().all(|&c| is_bech32_char(c))');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_mime_type')) {
    lines.push('fn check_mime_type(s: &str) -> bool {');
    lines.push('    let b = s.as_bytes();');
    lines.push('    if b.is_empty() { return false; }');
    lines.push('    let mut i = 0;');
    lines.push("    while i < b.len() && matches!(b[i], b'a'..=b'z') { i += 1; }");
    lines.push('    if i == 0 { return false; }');
    lines.push("    if i >= b.len() || b[i] != b'/' { return false; }");
    lines.push('    i += 1;');
    lines.push('    let start = i;');
    lines.push("    while i < b.len() && matches!(b[i], b'a'..=b'z' | b'0'..=b'9' | b'.' | b'+' | b'-') { i += 1; }");
    lines.push('    if i == start { return false; }');
    lines.push('    i == b.len()');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_http_origin')) {
    lines.push('fn check_http_origin(s: &str) -> bool {');
    lines.push('    let b = s.as_bytes();');
    lines.push('    let mut i;');
    lines.push('    if b.starts_with(b"https://") { i = 8; }');
    lines.push('    else if b.starts_with(b"http://") { i = 7; }');
    lines.push('    else { return false; }');
    lines.push('    let start = i;');
    lines.push("    while i < b.len() && b[i] != b'/' { i += 1; }");
    lines.push('    if i == start { return false; }');
    lines.push("    if i < b.len() && b[i] == b'/' { i += 1; }");
    lines.push('    i == b.len()');
    lines.push('}');
    lines.push('');
  }

  // Shared is_ascii_ws helper
  if (helpers.has('check_email_like') || helpers.has('check_git_clone_url') || helpers.has('check_no_ws_tail')) {
    lines.push('fn is_ascii_ws(c: u8) -> bool {');
    lines.push("    matches!(c, b' ' | b'\\t' | b'\\n' | b'\\r' | 0x0B | 0x0C)");
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_email_like')) {
    lines.push('fn check_email_like(s: &str) -> bool {');
    lines.push('    let b = s.as_bytes();');
    lines.push('    if b.is_empty() { return false; }');
    lines.push('    let mut i = 0;');
    lines.push("    while i < b.len() && !is_ascii_ws(b[i]) && b[i] != b'@' { i += 1; }");
    lines.push('    if i == 0 { return false; }');
    lines.push("    if i >= b.len() || b[i] != b'@' { return false; }");
    lines.push('    i += 1;');
    lines.push('    let start = i;');
    lines.push("    while i < b.len() && !is_ascii_ws(b[i]) && b[i] != b'@' { i += 1; }");
    lines.push('    if i == start { return false; }');
    lines.push('    i == b.len()');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_git_clone_url')) {
    lines.push('fn check_git_clone_url(s: &str) -> bool {');
    lines.push('    let b = s.as_bytes();');
    lines.push('    if b.is_empty() { return false; }');
    lines.push('    let mut i;');
    lines.push('    if b.starts_with(b"git@") {');
    lines.push('        i = 4;');
    lines.push('    } else {');
    lines.push("        if !matches!(b[0], b'a'..=b'z') { return false; }");
    lines.push('        i = 1;');
    lines.push("        while i < b.len() && matches!(b[i], b'a'..=b'z' | b'0'..=b'9' | b'+' | b'.' | b'-') { i += 1; }");
    lines.push("        if i + 3 > b.len() || b[i] != b':' || b[i + 1] != b'/' || b[i + 2] != b'/' { return false; }");
    lines.push('        i += 3;');
    lines.push('    }');
    lines.push('    if i >= b.len() { return false; }');
    lines.push('    !b[i..].iter().any(|&c| is_ascii_ws(c))');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_content_type')) {
    lines.push('fn is_type_char(c: u8) -> bool {');
    lines.push("    matches!(c, b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'!' | b'#' | b'$' | b'&' | b'^' | b'_' | b'-')");
    lines.push('}');
    lines.push('');
    lines.push('fn is_subtype_char(c: u8) -> bool {');
    lines.push("    is_type_char(c) || matches!(c, b'.' | b'+')");
    lines.push('}');
    lines.push('');
    lines.push('fn check_content_type(s: &str) -> bool {');
    lines.push('    let b = s.as_bytes();');
    lines.push('    if b.is_empty() { return false; }');
    lines.push('    let mut i = 0;');
    lines.push("    if !matches!(b[i], b'a'..=b'z' | b'A'..=b'Z') { return false; }");
    lines.push('    i += 1;');
    lines.push('    while i < b.len() && is_type_char(b[i]) { i += 1; }');
    lines.push("    if i >= b.len() || b[i] != b'/' { return false; }");
    lines.push('    i += 1;');
    lines.push('    if i >= b.len() { return false; }');
    lines.push("    if !matches!(b[i], b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'*') { return false; }");
    lines.push('    i += 1;');
    lines.push('    while i < b.len() && is_subtype_char(b[i]) { i += 1; }');
    lines.push('    while i < b.len() {');
    lines.push("        while i < b.len() && matches!(b[i], b' ' | b'\\t') { i += 1; }");
    lines.push('        if i >= b.len() { break; }');
    lines.push("        if b[i] != b';' { return false; }");
    lines.push('        i += 1;');
    lines.push("        while i < b.len() && matches!(b[i], b' ' | b'\\t') { i += 1; }");
    lines.push('        let start = i;');
    lines.push('        while i < b.len() && is_subtype_char(b[i]) { i += 1; }');
    lines.push('        if i == start { return false; }');
    lines.push("        if i >= b.len() || b[i] != b'=' { return false; }");
    lines.push('        i += 1;');
    lines.push('        let vstart = i;');
    lines.push('        while i < b.len() && is_subtype_char(b[i]) { i += 1; }');
    lines.push('        if i == vstart { return false; }');
    lines.push('    }');
    lines.push('    i == b.len()');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_doi')) {
    lines.push('fn check_doi(s: &str) -> bool {');
    lines.push('    let b = s.as_bytes();');
    lines.push("    if b.len() < 8 { return false; }");
    lines.push("    if b[0] != b'1' || b[1] != b'0' || b[2] != b'.' { return false; }");
    lines.push('    let mut i = 3;');
    lines.push('    let start = i;');
    lines.push('    while i < b.len() && b[i].is_ascii_digit() { i += 1; }');
    lines.push('    let digit_count = i - start;');
    lines.push('    if digit_count < 4 || digit_count > 9 { return false; }');
    lines.push("    if i >= b.len() || b[i] != b'/' { return false; }");
    lines.push('    i += 1;');
    lines.push('    check_dot_tail(b, i)');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_annotate_user')) {
    lines.push('fn check_annotate_user(s: &str) -> bool {');
    lines.push('    let b = s.as_bytes();');
    lines.push('    if b.len() < 82 { return false; }');
    lines.push('    if !s.starts_with("annotate-user ") { return false; }');
    lines.push('    let mut i = 14;');
    lines.push('    if i + 64 > b.len() { return false; }');
    lines.push("    if !b[i..i+64].iter().all(|&c| matches!(c, b'0'..=b'9' | b'a'..=b'f')) { return false; }");
    lines.push('    i += 64;');
    lines.push('    for _ in 0..2 {');
    lines.push("        if i >= b.len() || b[i] != b':' { return false; }");
    lines.push('        i += 1;');
    lines.push('        let start = i;');
    lines.push('        while i < b.len() && b[i].is_ascii_digit() { i += 1; }');
    lines.push('        if i == start { return false; }');
    lines.push("        if i < b.len() && b[i] == b'.' {");
    lines.push('            i += 1;');
    lines.push('            let dstart = i;');
    lines.push('            while i < b.len() && b[i].is_ascii_digit() { i += 1; }');
    lines.push('            if i == dstart { return false; }');
    lines.push('        }');
    lines.push('    }');
    lines.push('    i == b.len()');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_no_ws_tail')) {
    lines.push('fn check_no_ws_tail(b: &[u8], offset: usize) -> bool {');
    lines.push('    if offset >= b.len() { return false; }');
    lines.push('    !b[offset..].iter().any(|&c| is_ascii_ws(c))');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_external_identity')) {
    lines.push('fn check_external_identity(s: &str) -> bool {');
    lines.push('    let b = s.as_bytes();');
    lines.push('    if b.is_empty() { return false; }');
    lines.push('    let mut i = 0;');
    lines.push("    while i < b.len() && matches!(b[i], b'a'..=b'z' | b'0'..=b'9' | b'.' | b'_' | b'-' | b'/') { i += 1; }");
    lines.push('    if i == 0 { return false; }');
    lines.push("    if i >= b.len() || b[i] != b':' { return false; }");
    lines.push('    i += 1;');
    lines.push('    i < b.len()');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_package_id')) {
    lines.push('fn is_pkg_char(c: u8) -> bool {');
    lines.push("    matches!(c, b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'.' | b'_' | b'+' | b'-')");
    lines.push('}');
    lines.push('');
    lines.push('fn check_package_id(s: &str) -> bool {');
    lines.push('    let b = s.as_bytes();');
    lines.push('    if b.is_empty() { return false; }');
    lines.push("    if b.len() == 1 && b[0] == b'#' { return true; }");
    lines.push('    let mut i = 0;');
    lines.push("    if !matches!(b[i], b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9') { return false; }");
    lines.push('    i += 1;');
    lines.push('    while i < b.len() && is_pkg_char(b[i]) { i += 1; }');
    lines.push("    while i < b.len() && b[i] == b':' {");
    lines.push('        i += 1;');
    lines.push('        if i >= b.len() { return false; }');
    lines.push("        if !matches!(b[i], b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9') { return false; }");
    lines.push('        i += 1;');
    lines.push('        while i < b.len() && is_pkg_char(b[i]) { i += 1; }');
    lines.push('    }');
    lines.push('    i == b.len()');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('check_imeta_dim')) {
    lines.push('fn check_imeta_dim(s: &str) -> bool {');
    lines.push('    let b = s.as_bytes();');
    lines.push('    if b.len() < 7 { return false; }');
    lines.push('    if &b[..4] != b"dim " { return false; }');
    lines.push('    let mut i = 4;');
    lines.push('    let mut dc = 0;');
    lines.push('    while i < b.len() && b[i] >= b\'0\' && b[i] <= b\'9\' { i += 1; dc += 1; }');
    lines.push('    if dc < 1 || dc > 5 { return false; }');
    lines.push('    if i >= b.len() || b[i] != b\'x\' { return false; }');
    lines.push('    i += 1; dc = 0;');
    lines.push('    while i < b.len() && b[i] >= b\'0\' && b[i] <= b\'9\' { i += 1; dc += 1; }');
    lines.push('    if dc < 1 || dc > 5 { return false; }');
    lines.push('    i == b.len()');
    lines.push('}');
    lines.push('');
  }

  return lines.join('\n');
}
