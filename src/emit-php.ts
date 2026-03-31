/**
 * PHP validator emitter: ValidatorAction[] -> single .php file
 *
 * Statement-oriented: uses foreach + $found flag for tag search (like C).
 * Generated code targets PHP 8.0+ (match expression, str_starts_with).
 *
 * Tag access model:
 *   - $tags: array of arrays (array<array<string>>)
 *   - $t[$i] ?? null for safe access
 *   - count($t) for tag length
 *   - isset($t[0]) && $t[0] === 'name' for tag name check
 *   - === for strict string comparison
 *
 * Pattern helpers as module-level functions: schemata_check_hex64, etc.
 * Error list: $errors = []; $errors[] = new SchemataValidationError('tags', '...');
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

// --- Pattern check rendering ---

function renderPatternCheckPhp(check: PatternCheck, varExpr: string): { expr: string; helpers: Set<string> } {
  const helpers = new Set<string>();
  switch (check.op) {
    case 'hex': {
      const fn = check.case === 'lower' ? `schemata_check_hex${check.len}` : `schemata_check_hex${check.len}_mixed`;
      helpers.add(fn);
      return { expr: `${fn}(${varExpr})`, helpers };
    }
    case 'hex_range': {
      const fn = check.case === 'lower' ? 'schemata_check_hex_range' : 'schemata_check_hex_range_mixed';
      helpers.add(fn);
      return { expr: `${fn}(${varExpr}, ${check.min}, ${check.max})`, helpers };
    }
    case 'hex_prefixed': {
      const fn = `schemata_check_hex_prefixed_${check.hexLen}`;
      helpers.add(fn);
      return { expr: `${fn}(${varExpr}, ${phpString(check.prefix)})`, helpers };
    }
    case 'all_digits': {
      const fn = check.allowNeg ? 'schemata_check_signed_int' : 'schemata_check_digits';
      helpers.add(fn);
      return { expr: `${fn}(${varExpr})`, helpers };
    }
    case 'starts_with_any': {
      const checks = check.prefixes.map(p => `str_starts_with(${varExpr}, ${phpString(p)})`);
      return { expr: checks.length === 1 ? checks[0] : `(${checks.join(' || ')})`, helpers };
    }
    case 'chars_in': {
      if (check.min === 0 && check.max === 0) {
        return { expr: `${varExpr} === ''`, helpers };
      }
      helpers.add('schemata_check_chars_in');
      const args = [varExpr, phpString(check.charset)];
      if (check.min !== undefined) args.push(String(check.min));
      if (check.max !== undefined) args.push(String(check.max));
      return { expr: `schemata_check_chars_in(${args.join(', ')})`, helpers };
    }
    case 'bech32': {
      helpers.add('schemata_check_bech32');
      if (check.dataLen !== undefined) {
        return { expr: `schemata_check_bech32(${varExpr}, ${phpString(check.hrp + '1')}, ${check.dataLen})`, helpers };
      }
      return { expr: `schemata_check_bech32(${varExpr}, ${phpString(check.hrp + '1')})`, helpers };
    }
    case 'regex': {
      const escaped = check.pattern.replace(/#/g, '\\#');
      return { expr: `preg_match(${phpString('#' + escaped + '#')}, ${varExpr}) === 1`, helpers };
    }
    case 'relay_url': {
      helpers.add('schemata_check_relay_url');
      return { expr: `schemata_check_relay_url(${varExpr})`, helpers };
    }
    case 'a_tag': {
      helpers.add('schemata_check_a_tag');
      if (check.kinds && check.kinds.length > 0) {
        const arr = check.kinds.map(k => JSON.stringify(k)).join(', ');
        return { expr: `schemata_check_a_tag(${varExpr}, [${arr}])`, helpers };
      }
      return { expr: `schemata_check_a_tag(${varExpr})`, helpers };
    }
    case 'date_iso': {
      helpers.add('schemata_check_date_iso');
      return { expr: `schemata_check_date_iso(${varExpr})`, helpers };
    }
    case 'datetime_iso': {
      helpers.add('schemata_check_datetime_iso');
      return { expr: `schemata_check_datetime_iso(${varExpr})`, helpers };
    }
    case 'decimal': {
      helpers.add('schemata_check_decimal');
      return { expr: `schemata_check_decimal(${varExpr})`, helpers };
    }
    case 'exact_values': {
      const checks = check.values.map(v => `${varExpr} === ${phpString(v)}`);
      return { expr: checks.length === 1 ? checks[0] : `(${checks.join(' || ')})`, helpers };
    }
    case 'prefix_nonempty': {
      helpers.add('schemata_check_dot_tail');
      return {
        expr: `(str_starts_with(${varExpr}, ${phpString(check.prefix)}) && schemata_check_dot_tail(${varExpr}, ${check.prefix.length}))`,
        helpers,
      };
    }
    case 'wrapped': {
      helpers.add('schemata_check_wrapped');
      return { expr: `schemata_check_wrapped(${varExpr}, ${phpString(check.prefix)}, ${phpString(check.suffix)})`, helpers };
    }
    case 'csv_list': {
      helpers.add('schemata_check_csv_list');
      return { expr: `schemata_check_csv_list(${varExpr}, ${phpString(check.itemCharset)})`, helpers };
    }
    case 'ln_invoice': {
      helpers.add('schemata_check_ln_invoice');
      return { expr: `schemata_check_ln_invoice(${varExpr}, ${phpString(check.prefix)}, ${check.minHrpLen})`, helpers };
    }
    case 'mime_type': {
      helpers.add('schemata_check_mime_type');
      return { expr: `schemata_check_mime_type(${varExpr})`, helpers };
    }
    case 'http_origin': {
      helpers.add('schemata_check_http_origin');
      return { expr: `schemata_check_http_origin(${varExpr})`, helpers };
    }
    case 'email_like': {
      helpers.add('schemata_check_email_like');
      helpers.add('schemata_is_ecma_ws');
      return { expr: `schemata_check_email_like(${varExpr})`, helpers };
    }
    case 'git_clone_url': {
      helpers.add('schemata_check_git_clone_url');
      helpers.add('schemata_is_ecma_ws');
      return { expr: `schemata_check_git_clone_url(${varExpr})`, helpers };
    }
    case 'content_type': {
      helpers.add('schemata_check_content_type');
      helpers.add('schemata_is_ecma_ws');
      return { expr: `schemata_check_content_type(${varExpr})`, helpers };
    }
    case 'doi': {
      helpers.add('schemata_check_doi');
      return { expr: `schemata_check_doi(${varExpr})`, helpers };
    }
    case 'annotate_user': {
      helpers.add('schemata_check_annotate_user');
      return { expr: `schemata_check_annotate_user(${varExpr})`, helpers };
    }
    case 'prefix_no_whitespace': {
      helpers.add('schemata_check_no_ws_tail');
      helpers.add('schemata_is_ecma_ws');
      const checks = check.prefixes.map(p =>
        `(str_starts_with(${varExpr}, ${phpString(p)}) && schemata_check_no_ws_tail(${varExpr}, ${p.length}))`
      );
      return { expr: checks.length === 1 ? checks[0] : `(${checks.join(' || ')})`, helpers };
    }
    case 'external_identity': {
      helpers.add('schemata_check_external_identity');
      return { expr: `schemata_check_external_identity(${varExpr})`, helpers };
    }
    case 'package_id': {
      helpers.add('schemata_check_package_id');
      return { expr: `schemata_check_package_id(${varExpr})`, helpers };
    }
    case 'imeta_dim': {
      helpers.add('schemata_check_imeta_dim');
      return { expr: `schemata_check_imeta_dim(${varExpr})`, helpers };
    }
    case 'compound': {
      const allHelpers = new Set<string>();
      const parts: string[] = [];
      for (const sub of check.checks) {
        const r = renderPatternCheckPhp(sub, varExpr);
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

function renderValueCheckPhp(
  check: ValueCheck,
  index: number,
): { expr: string; helpers: Set<string> } {
  const helpers = new Set<string>();
  const access = `$t[${index}]`;
  const countGuard = `count($t) > ${index}`;

  switch (check.type) {
    case 'const':
      return { expr: `${countGuard} && ${access} === ${phpString(check.value)}`, helpers };
    case 'enum': {
      const vals = check.values.map(v => `${access} === ${phpString(v)}`);
      return {
        expr: `${countGuard} && (${vals.join(' || ')})`,
        helpers,
      };
    }
    case 'pattern': {
      const r = renderPatternCheckPhp(check.native, access);
      for (const h of r.helpers) helpers.add(h);
      return {
        expr: `${countGuard} && ${r.expr}`,
        helpers,
      };
    }
    case 'anyOf': {
      const parts: string[] = [];
      for (const alt of check.alternatives) {
        const r = renderValueCheckPhp(alt, index);
        parts.push(`(${r.expr})`);
        for (const h of r.helpers) helpers.add(h);
      }
      return { expr: `(${parts.join(' || ')})`, helpers };
    }
  }
}

/**
 * Render a value check for optional position validation context.
 * Here we already know count($t) > index, so no count guard.
 */
function renderValueCheckPhpNoGuard(
  check: ValueCheck,
  index: number,
): { expr: string; helpers: Set<string> } {
  const helpers = new Set<string>();
  const access = `$t[${index}]`;

  switch (check.type) {
    case 'const':
      return { expr: `${access} === ${phpString(check.value)}`, helpers };
    case 'enum': {
      const vals = check.values.map(v => `${access} === ${phpString(v)}`);
      return {
        expr: `(${vals.join(' || ')})`,
        helpers,
      };
    }
    case 'pattern': {
      const r = renderPatternCheckPhp(check.native, access);
      for (const h of r.helpers) helpers.add(h);
      return {
        expr: r.expr,
        helpers,
      };
    }
    case 'anyOf': {
      const parts: string[] = [];
      for (const alt of check.alternatives) {
        const r = renderValueCheckPhpNoGuard(alt, index);
        parts.push(`(${r.expr})`);
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

// --- Tag matcher condition rendering ---

function renderTagMatcherCondition(
  matcher: TagMatcher,
  helpers: Set<string>,
): string {
  const checks: string[] = [];

  checks.push(`isset($t[0]) && $t[0] === ${phpString(matcher.tagName)}`);
  checks.push(`count($t) >= ${matcher.minItems}`);
  if (matcher.maxItems !== undefined) {
    checks.push(`count($t) <= ${matcher.maxItems}`);
  }

  for (const pc of matcher.positionChecks) {
    const r = renderValueCheckPhp(pc.check, pc.index);
    for (const h of r.helpers) helpers.add(h);
    checks.push(r.expr);
  }

  return checks.join(' && ');
}

// --- PHP string literal ---

function phpString(s: string): string {
  // Use single quotes, escaping only single quotes and backslashes
  return "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

// --- Main emitter ---

export function emitPhpValidators(kindShapes: KindShape[]): string {
  const allHelpers = new Set<string>();
  const fnBodies: string[] = [];
  const constrainedKinds: { kindNumber: number; nip: string }[] = [];

  for (const shape of [...kindShapes].sort((a, b) => a.kindNumber - b.kindNumber)) {
    const actions = planKindValidator(shape);
    if (!actions) continue;

    constrainedKinds.push({ kindNumber: shape.kindNumber, nip: shape.nip });
    const { code, helpers } = emitKindFunctionPhp(shape.kindNumber, shape.nip, actions);
    fnBodies.push(code);
    for (const h of helpers) allHelpers.add(h);
  }

  return emitPhpFile(fnBodies, constrainedKinds, allHelpers);
}

function emitKindFunctionPhp(
  kindNumber: number,
  nip: string,
  actions: ValidatorAction[],
): { code: string; helpers: Set<string> } {
  const helpers = new Set<string>();
  const lines: string[] = [];

  lines.push(`/** Validate tags for kind ${kindNumber} (${nip}). */`);
  lines.push(`function schemata_validate_kind_${kindNumber}(array $tags): array {`);
  lines.push('    $errors = [];');

  for (const action of actions) {
    lines.push('');
    switch (action.type) {
      case 'check_min_tags':
        lines.push(`    if (count($tags) < ${action.min}) {`);
        lines.push(`        $errors[] = new SchemataValidationError('tags', ${phpString(`tags must have at least ${action.min} item(s)`)});`);
        lines.push('    }');
        break;

      case 'require_tag': {
        // foreach + $found flag
        lines.push('    $found = false;');
        lines.push('    foreach ($tags as $t) {');
        lines.push(`        if (!(${renderTagNameCheck(action.matcher.tagName)})) { continue; }`);
        lines.push(`        if (count($t) < ${action.matcher.minItems}) { continue; }`);
        if (action.matcher.maxItems !== undefined) {
          lines.push(`        if (count($t) > ${action.matcher.maxItems}) { continue; }`);
        }
        for (const pc of action.matcher.positionChecks) {
          const r = renderValueCheckPhp(pc.check, pc.index);
          for (const h of r.helpers) helpers.add(h);
          lines.push(`        if (!(${r.expr})) { continue; }`);
        }
        lines.push('        $found = true;');
        lines.push('        break;');
        lines.push('    }');
        lines.push(`    if (!$found) {`);
        lines.push(`        $errors[] = new SchemataValidationError('tags', ${phpString(action.errorMsg)});`);
        lines.push('    }');
        break;
      }

      case 'validate_optional_positions': {
        lines.push('    foreach ($tags as $t) {');
        lines.push(`        if (!(${renderTagNameCheck(action.tagName)})) { continue; }`);
        for (const pc of action.checks) {
          const r = renderValueCheckPhpNoGuard(pc.check, pc.index);
          for (const h of r.helpers) helpers.add(h);
          const msg = describePositionConstraint(pc, action.tagName);
          lines.push(`        if (count($t) > ${pc.index} && !(${r.expr})) {`);
          lines.push(`            $errors[] = new SchemataValidationError('tags', ${phpString(msg)});`);
          lines.push('        }');
        }
        lines.push('    }');
        break;
      }

      case 'per_item_conditional': {
        const cond = renderTagMatcherCondition(action.matcher, helpers);
        lines.push('    foreach ($tags as $t) {');
        lines.push(`        if (!(${renderTagNameCheck(action.condTag)})) { continue; }`);
        lines.push(`        if (!(${cond})) {`);
        lines.push(`            $errors[] = new SchemataValidationError('tags', ${phpString(action.errorMsg)});`);
        lines.push('        }');
        if (action.optChecks.length > 0) {
          for (const pc of action.optChecks) {
            const r = renderValueCheckPhpNoGuard(pc.check, pc.index);
            for (const h of r.helpers) helpers.add(h);
            const msg = describePositionConstraint(pc, action.condTag);
            lines.push(`        if (count($t) > ${pc.index} && !(${r.expr})) {`);
            lines.push(`            $errors[] = new SchemataValidationError('tags', ${phpString(msg)});`);
            lines.push('        }');
          }
        }
        lines.push('    }');
        break;
      }

      case 'array_level_conditional': {
        // First pass: check if condition tag exists
        lines.push('    $hasCond = false;');
        lines.push('    foreach ($tags as $t) {');
        lines.push(`        if (${renderTagNameCheck(action.condTag)}) {`);
        lines.push('            $hasCond = true;');
        lines.push('            break;');
        lines.push('        }');
        lines.push('    }');
        lines.push('    if ($hasCond) {');
        // Second pass: check if matching tag exists
        lines.push('        $found = false;');
        lines.push('        foreach ($tags as $t) {');
        lines.push(`            if (!(${renderTagNameCheck(action.matcher.tagName)})) { continue; }`);
        lines.push(`            if (count($t) < ${action.matcher.minItems}) { continue; }`);
        if (action.matcher.maxItems !== undefined) {
          lines.push(`            if (count($t) > ${action.matcher.maxItems}) { continue; }`);
        }
        for (const pc of action.matcher.positionChecks) {
          const r = renderValueCheckPhp(pc.check, pc.index);
          for (const h of r.helpers) helpers.add(h);
          lines.push(`            if (!(${r.expr})) { continue; }`);
        }
        lines.push('            $found = true;');
        lines.push('            break;');
        lines.push('        }');
        lines.push('        if (!$found) {');
        lines.push(`            $errors[] = new SchemataValidationError('tags', ${phpString(action.errorMsg)});`);
        lines.push('        }');
        // Optional position checks (inside condTag guard)
        if (action.optChecks.length > 0) {
          lines.push('        foreach ($tags as $t) {');
          lines.push(`            if (!(${renderTagNameCheck(action.matcher.tagName)})) { continue; }`);
          for (const pc of action.optChecks) {
            const r = renderValueCheckPhpNoGuard(pc.check, pc.index);
            for (const h of r.helpers) helpers.add(h);
            const msg = describePositionConstraint(pc, action.matcher.tagName);
            lines.push(`            if (count($t) > ${pc.index} && !(${r.expr})) {`);
            lines.push(`                $errors[] = new SchemataValidationError('tags', ${phpString(msg)});`);
            lines.push('            }');
          }
          lines.push('        }');
        }
        lines.push('    }');
        break;
      }

      case 'any_of_group': {
        const varNames: string[] = [];
        for (let i = 0; i < action.matchers.length; i++) {
          const m = action.matchers[i];
          const varName = `$found${i}`;
          varNames.push(varName);
          lines.push(`    ${varName} = false;`);
          lines.push('    foreach ($tags as $t) {');
          lines.push(`        if (!(${renderTagNameCheck(m.tagName)})) { continue; }`);
          lines.push(`        if (count($t) < ${m.minItems}) { continue; }`);
          if (m.maxItems !== undefined) {
            lines.push(`        if (count($t) > ${m.maxItems}) { continue; }`);
          }
          for (const pc of m.positionChecks) {
            const r = renderValueCheckPhp(pc.check, pc.index);
            for (const h of r.helpers) helpers.add(h);
            lines.push(`        if (!(${r.expr})) { continue; }`);
          }
          lines.push(`        ${varName} = true;`);
          lines.push('        break;');
          lines.push('    }');
        }
        const orExpr = varNames.join(' || ');
        lines.push(`    if (!(${orExpr})) {`);
        lines.push(`        $errors[] = new SchemataValidationError('tags', ${phpString(action.errorMsg)});`);
        lines.push('    }');
        break;
      }
    }
  }

  lines.push('');
  lines.push('    return $errors;');
  lines.push('}');

  return { code: lines.join('\n'), helpers };
}

function renderTagNameCheck(tagName: string): string {
  return `isset($t[0]) && $t[0] === ${phpString(tagName)}`;
}

// --- File generation ---

function emitPhpFile(
  fnBodies: string[],
  constrainedKinds: { kindNumber: number; nip: string }[],
  helpers: Set<string>,
): string {
  const lines: string[] = [
    '<?php',
    '',
    '// Auto-generated by @nostrability/schemata-codegen',
    '// Do not edit manually.',
    '',
  ];

  // SchemataValidationError class
  lines.push('class SchemataValidationError {');
  lines.push('    public string $path;');
  lines.push('    public string $message;');
  lines.push('');
  lines.push('    public function __construct(string $path, string $message) {');
  lines.push('        $this->path = $path;');
  lines.push('        $this->message = $message;');
  lines.push('    }');
  lines.push('}');
  lines.push('');

  // Helper functions
  const helperCode = emitPhpHelpers(helpers);
  if (helperCode) {
    lines.push(helperCode);
  }

  // Per-kind functions
  for (const fn of fnBodies) {
    lines.push(fn);
    lines.push('');
  }

  // Dispatch function
  lines.push('/** Validate tags for a given kind number. */');
  lines.push('function schemata_validate_kind_tags(int $kind, array $tags): array {');
  lines.push('    return match($kind) {');
  for (const k of constrainedKinds) {
    lines.push(`        ${k.kindNumber} => schemata_validate_kind_${k.kindNumber}($tags),`);
  }
  lines.push('        default => [],');
  lines.push('    };');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

function emitPhpHelpers(helpers: Set<string>): string {
  const lines: string[] = [];

  // Collect hex lengths
  const hexLengths = new Set<number>();
  const hexMixedLengths = new Set<number>();
  for (const h of helpers) {
    const m = h.match(/^schemata_check_hex(\d+)$/);
    if (m) hexLengths.add(parseInt(m[1], 10));
    const mm = h.match(/^schemata_check_hex(\d+)_mixed$/);
    if (mm) hexMixedLengths.add(parseInt(mm[1], 10));
  }

  for (const len of [...hexLengths].sort((a, b) => a - b)) {
    lines.push(`function schemata_check_hex${len}(string $s): bool {`);
    lines.push(`    return strlen($s) === ${len} && ctype_xdigit($s) && $s === strtolower($s);`);
    lines.push('}');
    lines.push('');
  }

  for (const len of [...hexMixedLengths].sort((a, b) => a - b)) {
    lines.push(`function schemata_check_hex${len}_mixed(string $s): bool {`);
    lines.push(`    return strlen($s) === ${len} && ctype_xdigit($s);`);
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_hex_range')) {
    lines.push('function schemata_check_hex_range(string $s, int $min, int $max): bool {');
    lines.push('    $len = strlen($s);');
    lines.push('    return $len >= $min && $len <= $max && ctype_xdigit($s) && $s === strtolower($s);');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_hex_range_mixed')) {
    lines.push('function schemata_check_hex_range_mixed(string $s, int $min, int $max): bool {');
    lines.push('    $len = strlen($s);');
    lines.push('    return $len >= $min && $len <= $max && ctype_xdigit($s);');
    lines.push('}');
    lines.push('');
  }

  for (const h of helpers) {
    const m = h.match(/^schemata_check_hex_prefixed_(\d+)$/);
    if (m) {
      const hexLen = parseInt(m[1], 10);
      lines.push(`function schemata_check_hex_prefixed_${hexLen}(string $s, string $prefix): bool {`);
      lines.push('    if (!str_starts_with($s, $prefix)) { return false; }');
      lines.push('    $rest = substr($s, strlen($prefix));');
      lines.push(`    return strlen($rest) === ${hexLen} && ctype_xdigit($rest) && $rest === strtolower($rest);`);
      lines.push('}');
      lines.push('');
    }
  }

  if (helpers.has('schemata_check_digits')) {
    lines.push('function schemata_check_digits(string $s): bool {');
    lines.push("    if ($s === '') { return false; }");
    lines.push('    for ($i = 0; $i < strlen($s); $i++) {');
    lines.push("        if ($s[$i] < '0' || $s[$i] > '9') { return false; }");
    lines.push('    }');
    lines.push('    return true;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_signed_int')) {
    lines.push('function schemata_check_signed_int(string $s): bool {');
    lines.push("    if ($s === '') { return false; }");
    lines.push("    $start = 0;");
    lines.push("    if ($s[0] === '-') { $start = 1; }");
    lines.push("    if ($start >= strlen($s)) { return false; }");
    lines.push('    for ($i = $start; $i < strlen($s); $i++) {');
    lines.push("        if ($s[$i] < '0' || $s[$i] > '9') { return false; }");
    lines.push('    }');
    lines.push('    return true;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_chars_in')) {
    lines.push('function schemata_check_chars_in(string $s, string $charset, int $min = 0, int $max = PHP_INT_MAX): bool {');
    lines.push('    $len = strlen($s);');
    lines.push('    if ($len < $min || $len > $max) { return false; }');
    lines.push('    for ($i = 0; $i < $len; $i++) {');
    lines.push('        if (strpos($charset, $s[$i]) === false) { return false; }');
    lines.push('    }');
    lines.push('    return true;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_date_iso')) {
    lines.push('function schemata_check_date_iso(string $s): bool {');
    lines.push("    if (strlen($s) !== 10 || $s[4] !== '-' || $s[7] !== '-') { return false; }");
    lines.push('    for ($i = 0; $i < 10; $i++) {');
    lines.push('        if ($i === 4 || $i === 7) { continue; }');
    lines.push("        if ($s[$i] < '0' || $s[$i] > '9') { return false; }");
    lines.push('    }');
    lines.push('    return true;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_decimal')) {
    lines.push('function schemata_check_decimal(string $s): bool {');
    lines.push("    if ($s === '') { return false; }");
    lines.push('    $i = 0;');
    lines.push("    while ($i < strlen($s) && $s[$i] >= '0' && $s[$i] <= '9') { $i++; }");
    lines.push("    if ($i === 0) { return false; }");
    lines.push("    if ($i < strlen($s) && $s[$i] === '.') {");
    lines.push('        $i++;');
    lines.push("        if ($i >= strlen($s) || $s[$i] < '0' || $s[$i] > '9') { return false; }");
    lines.push("        while ($i < strlen($s) && $s[$i] >= '0' && $s[$i] <= '9') { $i++; }");
    lines.push('    }');
    lines.push('    return $i === strlen($s);');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_dot_tail') || helpers.has('schemata_check_relay_url') || helpers.has('schemata_check_a_tag') || helpers.has('schemata_check_doi') || helpers.has('schemata_check_external_identity')) {
    lines.push('function schemata_check_dot_tail(string $s, int $pos): bool {');
    lines.push('    if ($pos >= strlen($s)) { return false; }');
    lines.push('    for ($j = $pos; $j < strlen($s); $j++) {');
    lines.push('        if ($s[$j] === "\\n") { return false; }');
    lines.push('    }');
    lines.push('    return true;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_relay_url')) {
    lines.push('function schemata_check_relay_url(string $s): bool {');
    lines.push("    if (str_starts_with($s, 'wss://')) { $pos = 6; }");
    lines.push("    elseif (str_starts_with($s, 'ws://')) { $pos = 5; }");
    lines.push('    else { return false; }');
    lines.push('    $hostStart = $pos;');
    lines.push('    while ($pos < strlen($s)) {');
    lines.push('        $c = ord($s[$pos]);');
    lines.push('        if (($c >= 97 && $c <= 122) || ($c >= 65 && $c <= 90) || ($c >= 48 && $c <= 57) || $c === 46 || $c === 95 || $c === 45) { $pos++; }');
    lines.push('        else { break; }');
    lines.push('    }');
    lines.push('    if ($pos === $hostStart) { return false; }');
    lines.push("    if ($pos < strlen($s) && $s[$pos] === ':') {");
    lines.push('        $pos++;');
    lines.push('        $portStart = $pos;');
    lines.push("        while ($pos < strlen($s) && $s[$pos] >= '0' && $s[$pos] <= '9') { $pos++; }");
    lines.push('        if ($pos === $portStart) { return false; }');
    lines.push('    }');
    lines.push("    if ($pos < strlen($s) && $s[$pos] === '/') {");
    lines.push('        return schemata_check_dot_tail($s, $pos + 1) || $pos + 1 === strlen($s);');
    lines.push('    }');
    lines.push('    return $pos === strlen($s);');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_a_tag')) {
    lines.push('function schemata_check_a_tag(string $s, ?array $kinds = null): bool {');
    lines.push('    if (strlen($s) < 68) { return false; }');
    lines.push('    $colonPos = strpos($s, \':\');');
    lines.push('    if ($colonPos === false || $colonPos === 0) { return false; }');
    lines.push('    $kindStr = substr($s, 0, $colonPos);');
    lines.push('    $kLen = strlen($kindStr);');
    lines.push('    for ($i = 0; $i < $kLen; $i++) {');
    lines.push("        if ($kindStr[$i] < '0' || $kindStr[$i] > '9') { return false; }");
    lines.push('    }');
    lines.push('    if ($kinds !== null && !in_array($kindStr, $kinds, true)) { return false; }');
    lines.push('    $pos = $colonPos + 1;');
    lines.push('    if ($pos + 64 >= strlen($s)) { return false; }');
    lines.push('    for ($i = 0; $i < 64; $i++) {');
    lines.push('        $c = $s[$pos + $i];');
    lines.push("        if (!(($c >= '0' && $c <= '9') || ($c >= 'a' && $c <= 'f'))) { return false; }");
    lines.push('    }');
    lines.push('    $pos += 64;');
    lines.push("    if ($pos >= strlen($s) || $s[$pos] !== ':') { return false; }");
    lines.push('    $pos++;');
    lines.push('    return schemata_check_dot_tail($s, $pos);');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_datetime_iso')) {
    lines.push('function schemata_check_datetime_iso(string $s): bool {');
    lines.push('    $len = strlen($s);');
    lines.push('    if ($len < 10) { return false; }');
    lines.push("    for ($i = 0; $i < 4; $i++) if ($s[$i] < '0' || $s[$i] > '9') return false;");
    lines.push("    if ($s[4] !== '-') { return false; }");
    lines.push("    for ($i = 5; $i < 7; $i++) if ($s[$i] < '0' || $s[$i] > '9') return false;");
    lines.push("    if ($s[7] !== '-') { return false; }");
    lines.push("    for ($i = 8; $i < 10; $i++) if ($s[$i] < '0' || $s[$i] > '9') return false;");
    lines.push('    if ($len === 10) { return true; }');
    lines.push("    if ($s[10] !== 'T' || $len < 16) { return false; }");
    lines.push("    for ($i = 11; $i < 13; $i++) if ($s[$i] < '0' || $s[$i] > '9') return false;");
    lines.push("    if ($s[13] !== ':') { return false; }");
    lines.push("    for ($i = 14; $i < 16; $i++) if ($s[$i] < '0' || $s[$i] > '9') return false;");
    lines.push('    $pos = 16;');
    lines.push('    if ($pos === $len) { return true; }');
    lines.push("    if ($s[$pos] === ':') {");
    lines.push('        if ($pos + 3 > $len) { return false; }');
    lines.push("        if ($s[$pos+1] < '0' || $s[$pos+1] > '9' || $s[$pos+2] < '0' || $s[$pos+2] > '9') return false;");
    lines.push('        $pos += 3;');
    lines.push('    }');
    lines.push('    if ($pos === $len) { return true; }');
    lines.push("    if ($s[$pos] === '.') {");
    lines.push('        $pos++;');
    lines.push("        if ($pos >= $len || $s[$pos] < '0' || $s[$pos] > '9') { return false; }");
    lines.push("        while ($pos < $len && $s[$pos] >= '0' && $s[$pos] <= '9') { $pos++; }");
    lines.push('    }');
    lines.push('    if ($pos === $len) { return true; }');
    lines.push("    if ($s[$pos] === 'Z') { return $pos + 1 === $len; }");
    lines.push("    if ($s[$pos] === '+' || $s[$pos] === '-') {");
    lines.push('        if ($pos + 6 !== $len) { return false; }');
    lines.push("        if ($s[$pos+1] < '0' || $s[$pos+1] > '9' || $s[$pos+2] < '0' || $s[$pos+2] > '9') return false;");
    lines.push("        if ($s[$pos+3] !== ':') { return false; }");
    lines.push("        return $s[$pos+4] >= '0' && $s[$pos+4] <= '9' && $s[$pos+5] >= '0' && $s[$pos+5] <= '9';");
    lines.push('    }');
    lines.push('    return false;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_bech32')) {
    lines.push('function schemata_is_bech32_char(string $c): bool {');
    lines.push("    return ($c >= '0' && $c <= '9' && $c !== '1') || ($c >= 'a' && $c <= 'z' && $c !== 'b' && $c !== 'i' && $c !== 'o');");
    lines.push('}');
    lines.push('');
    lines.push('function schemata_check_bech32(string $s, string $prefix, ?int $dataLen = null): bool {');
    lines.push('    if (!str_starts_with($s, $prefix)) { return false; }');
    lines.push('    $data = substr($s, strlen($prefix));');
    lines.push("    if ($data === '' || $data === false) { return false; }");
    lines.push('    for ($i = 0; $i < strlen($data); $i++) {');
    lines.push('        if (!schemata_is_bech32_char($data[$i])) { return false; }');
    lines.push('    }');
    lines.push('    if ($dataLen !== null) { return strlen($data) === $dataLen; }');
    lines.push('    return true;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_wrapped')) {
    lines.push('function schemata_check_wrapped(string $s, string $prefix, string $suffix): bool {');
    lines.push('    return strlen($s) >= strlen($prefix) + strlen($suffix) && str_starts_with($s, $prefix) && str_ends_with($s, $suffix);');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_csv_list')) {
    lines.push('function schemata_check_csv_list(string $s, string $charset): bool {');
    lines.push("    if ($s === '') { return false; }");
    lines.push('    $i = 0;');
    lines.push('    while (true) {');
    lines.push('        $start = $i;');
    lines.push('        while ($i < strlen($s) && strpos($charset, $s[$i]) !== false) { $i++; }');
    lines.push('        if ($i === $start) { return false; }');
    lines.push('        if ($i === strlen($s)) { return true; }');
    lines.push("        if ($s[$i] !== ',') { return false; }");
    lines.push('        $i++;');
    lines.push('    }');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_is_ecma_ws')) {
    lines.push('/** ECMAScript \\s semantics: full Unicode whitespace set (UTF-8 byte-level). Returns bytes consumed (0 = not ws). */');
    lines.push('function schemata_is_ecma_ws(string $s, int $pos): int {');
    lines.push('    if ($pos >= strlen($s)) { return 0; }');
    lines.push('    $c = ord($s[$pos]);');
    lines.push('    /* ASCII whitespace */');
    lines.push('    if ($c === 0x09 || $c === 0x0A || $c === 0x0B || $c === 0x0C || $c === 0x0D || $c === 0x20) { return 1; }');
    lines.push('    /* 2-byte UTF-8: U+00A0 (C2 A0) */');
    lines.push('    if ($c === 0xC2 && $pos + 1 < strlen($s) && ord($s[$pos + 1]) === 0xA0) { return 2; }');
    lines.push('    /* 3-byte UTF-8 */');
    lines.push('    if ($c === 0xE1 && $pos + 2 < strlen($s) && ord($s[$pos + 1]) === 0x9A && ord($s[$pos + 2]) === 0x80) { return 3; } /* U+1680 */');
    lines.push('    if ($c === 0xE2 && $pos + 2 < strlen($s)) {');
    lines.push('        $b1 = ord($s[$pos + 1]); $b2 = ord($s[$pos + 2]);');
    lines.push('        /* U+2000-200A: E2 80 80-8A */');
    lines.push('        if ($b1 === 0x80 && $b2 >= 0x80 && $b2 <= 0x8A) { return 3; }');
    lines.push('        /* U+2028: E2 80 A8, U+2029: E2 80 A9 */');
    lines.push('        if ($b1 === 0x80 && ($b2 === 0xA8 || $b2 === 0xA9)) { return 3; }');
    lines.push('        /* U+202F: E2 80 AF */');
    lines.push('        if ($b1 === 0x80 && $b2 === 0xAF) { return 3; }');
    lines.push('        /* U+205F: E2 81 9F */');
    lines.push('        if ($b1 === 0x81 && $b2 === 0x9F) { return 3; }');
    lines.push('    }');
    lines.push('    if ($c === 0xE3 && $pos + 2 < strlen($s) && ord($s[$pos + 1]) === 0x80 && ord($s[$pos + 2]) === 0x80) { return 3; } /* U+3000 */');
    lines.push('    if ($c === 0xEF && $pos + 2 < strlen($s) && ord($s[$pos + 1]) === 0xBB && ord($s[$pos + 2]) === 0xBF) { return 3; } /* U+FEFF */');
    lines.push('    return 0;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_ln_invoice')) {
    lines.push('function schemata_is_bech32_data(string $c): bool {');
    lines.push("    return ($c >= '0' && $c <= '9' && $c !== '1') || ($c >= 'a' && $c <= 'z' && $c !== 'b' && $c !== 'i' && $c !== 'o');");
    lines.push('}');
    lines.push('');
    lines.push('function schemata_check_ln_invoice(string $s, string $prefix, int $minHrpLen): bool {');
    lines.push('    if (!str_starts_with($s, $prefix)) { return false; }');
    lines.push("    $sep = strrpos($s, '1');");
    lines.push('    if ($sep === false) { return false; }');
    lines.push('    $hrp = substr($s, 0, $sep);');
    lines.push('    if (strlen($hrp) < $minHrpLen) { return false; }');
    lines.push('    for ($i = 0; $i < strlen($hrp); $i++) {');
    lines.push('        $c = $hrp[$i];');
    lines.push("        if (!(($c >= 'a' && $c <= 'z') || ($c >= '0' && $c <= '9'))) { return false; }");
    lines.push('    }');
    lines.push('    $data = substr($s, $sep + 1);');
    lines.push("    if ($data === '' || $data === false) { return false; }");
    lines.push('    for ($i = 0; $i < strlen($data); $i++) {');
    lines.push('        if (!schemata_is_bech32_data($data[$i])) { return false; }');
    lines.push('    }');
    lines.push('    return true;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_mime_type')) {
    lines.push('function schemata_check_mime_type(string $s): bool {');
    lines.push('    $i = 0;');
    lines.push("    if ($i >= strlen($s) || $s[$i] < 'a' || $s[$i] > 'z') { return false; }");
    lines.push("    while ($i < strlen($s) && $s[$i] >= 'a' && $s[$i] <= 'z') { $i++; }");
    lines.push("    if ($i >= strlen($s) || $s[$i] !== '/') { return false; }");
    lines.push('    $i++;');
    lines.push('    if ($i >= strlen($s)) { return false; }');
    lines.push('    $c = $s[$i];');
    lines.push("    if (!(($c >= 'a' && $c <= 'z') || ($c >= '0' && $c <= '9') || $c === '.' || $c === '+' || $c === '-')) { return false; }");
    lines.push("    while ($i < strlen($s) && (($s[$i] >= 'a' && $s[$i] <= 'z') || ($s[$i] >= '0' && $s[$i] <= '9') || $s[$i] === '.' || $s[$i] === '+' || $s[$i] === '-')) { $i++; }");
    lines.push('    return $i === strlen($s);');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_http_origin')) {
    lines.push('function schemata_check_http_origin(string $s): bool {');
    lines.push("    if (str_starts_with($s, 'https://')) { $pos = 8; }");
    lines.push("    elseif (str_starts_with($s, 'http://')) { $pos = 7; }");
    lines.push('    else { return false; }');
    lines.push('    $start = $pos;');
    lines.push("    while ($pos < strlen($s) && $s[$pos] !== '/' && $s[$pos] !== \"\\n\" && $s[$pos] !== \"\\r\") { $pos++; }");
    lines.push('    if ($pos === $start) { return false; }');
    lines.push("    if ($pos < strlen($s) && $s[$pos] === '/') { $pos++; }");
    lines.push('    return $pos === strlen($s);');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_email_like')) {
    lines.push('function schemata_check_email_like(string $s): bool {');
    lines.push("    if ($s === '') { return false; }");
    lines.push('    $len = strlen($s);');
    lines.push('    $i = 0;');
    lines.push("    if (schemata_is_ecma_ws($s, $i) > 0 || $s[$i] === '@') { return false; }");
    lines.push("    while ($i < $len && schemata_is_ecma_ws($s, $i) === 0 && $s[$i] !== '@') { $i++; }");
    lines.push("    if ($i >= $len || $s[$i] !== '@') { return false; }");
    lines.push('    $i++;');
    lines.push("    if ($i >= $len || schemata_is_ecma_ws($s, $i) > 0 || $s[$i] === '@') { return false; }");
    lines.push("    while ($i < $len && schemata_is_ecma_ws($s, $i) === 0 && $s[$i] !== '@') { $i++; }");
    lines.push('    return $i === $len;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_git_clone_url')) {
    lines.push('function schemata_check_git_clone_url(string $s): bool {');
    lines.push("    if ($s === '') { return false; }");
    lines.push('    $len = strlen($s);');
    lines.push("    if (str_starts_with($s, 'git@')) {");
    lines.push('        $pos = 4;');
    lines.push('    } else {');
    lines.push("        if ($s[0] < 'a' || $s[0] > 'z') { return false; }");
    lines.push('        $pos = 1;');
    lines.push("        while ($pos < $len && (($s[$pos] >= 'a' && $s[$pos] <= 'z') || ($s[$pos] >= '0' && $s[$pos] <= '9') || $s[$pos] === '+' || $s[$pos] === '.' || $s[$pos] === '-')) { $pos++; }");
    lines.push("        if ($pos + 3 > $len || substr($s, $pos, 3) !== '://') { return false; }");
    lines.push('        $pos += 3;');
    lines.push('    }');
    lines.push('    if ($pos >= $len) { return false; }');
    lines.push('    for ($i = $pos; $i < $len; ) {');
    lines.push('        $adv = schemata_is_ecma_ws($s, $i);');
    lines.push('        if ($adv > 0) { return false; }');
    lines.push('        $i++;');
    lines.push('    }');
    lines.push('    return true;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_content_type')) {
    lines.push('function schemata_is_type_char(string $c): bool {');
    lines.push("    return (($c >= 'a' && $c <= 'z') || ($c >= 'A' && $c <= 'Z')) || ($c >= '0' && $c <= '9') || strpos('!#$&^_-', $c) !== false;");
    lines.push('}');
    lines.push('');
    lines.push('function schemata_is_subtype_char(string $c): bool {');
    lines.push("    return schemata_is_type_char($c) || $c === '.' || $c === '+';");
    lines.push('}');
    lines.push('');
    lines.push('function schemata_check_content_type(string $s): bool {');
    lines.push("    if ($s === '') { return false; }");
    lines.push('    $i = 0;');
    lines.push("    if (!(($s[$i] >= 'a' && $s[$i] <= 'z') || ($s[$i] >= 'A' && $s[$i] <= 'Z'))) { return false; }");
    lines.push('    $i++;');
    lines.push('    while ($i < strlen($s) && schemata_is_type_char($s[$i])) { $i++; }');
    lines.push("    if ($i >= strlen($s) || $s[$i] !== '/') { return false; }");
    lines.push('    $i++;');
    lines.push("    if ($i >= strlen($s) || !(($s[$i] >= 'a' && $s[$i] <= 'z') || ($s[$i] >= 'A' && $s[$i] <= 'Z') || ($s[$i] >= '0' && $s[$i] <= '9') || $s[$i] === '*')) { return false; }");
    lines.push('    $i++;');
    lines.push('    while ($i < strlen($s) && schemata_is_subtype_char($s[$i])) { $i++; }');
    lines.push('    while ($i < strlen($s)) {');
    lines.push('        $j = $i;');
    lines.push("        while (($__adv = schemata_is_ecma_ws($s, $j)) > 0) { $j += $__adv; }");
    lines.push("        if ($j >= strlen($s) || $s[$j] !== ';') { return false; }");
    lines.push('        $j++;');
    lines.push("        while (($__adv = schemata_is_ecma_ws($s, $j)) > 0) { $j += $__adv; }");
    lines.push('        $start = $j;');
    lines.push('        while ($j < strlen($s) && schemata_is_subtype_char($s[$j])) { $j++; }');
    lines.push('        if ($j === $start) { return false; }');
    lines.push("        if ($j >= strlen($s) || $s[$j] !== '=') { return false; }");
    lines.push('        $j++;');
    lines.push('        $start = $j;');
    lines.push('        while ($j < strlen($s) && schemata_is_subtype_char($s[$j])) { $j++; }');
    lines.push('        if ($j === $start) { return false; }');
    lines.push('        $i = $j;');
    lines.push('    }');
    lines.push('    return $i === strlen($s);');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_doi')) {
    lines.push('function schemata_check_doi(string $s): bool {');
    lines.push("    if (!str_starts_with($s, '10.')) { return false; }");
    lines.push('    $i = 3;');
    lines.push('    $count = 0;');
    lines.push("    while ($i < strlen($s) && $s[$i] >= '0' && $s[$i] <= '9') { $count++; $i++; }");
    lines.push('    if ($count < 4 || $count > 9) { return false; }');
    lines.push("    if ($i >= strlen($s) || $s[$i] !== '/') { return false; }");
    lines.push('    $i++;');
    lines.push('    return schemata_check_dot_tail($s, $i);');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_annotate_user')) {
    lines.push('function schemata_check_annotate_user(string $s): bool {');
    lines.push("    if (!str_starts_with($s, 'annotate-user ')) { return false; }");
    lines.push('    $i = 14;');
    lines.push('    if ($i + 64 > strlen($s)) { return false; }');
    lines.push('    for ($j = 0; $j < 64; $j++) {');
    lines.push('        $c = $s[$i + $j];');
    lines.push("        if (!(($c >= '0' && $c <= '9') || ($c >= 'a' && $c <= 'f'))) { return false; }");
    lines.push('    }');
    lines.push('    $i += 64;');
    lines.push('    for ($round = 0; $round < 2; $round++) {');
    lines.push("        if ($i >= strlen($s) || $s[$i] !== ':') { return false; }");
    lines.push('        $i++;');
    lines.push("        if ($i >= strlen($s) || $s[$i] < '0' || $s[$i] > '9') { return false; }");
    lines.push("        while ($i < strlen($s) && $s[$i] >= '0' && $s[$i] <= '9') { $i++; }");
    lines.push("        if ($i < strlen($s) && $s[$i] === '.') {");
    lines.push('            $i++;');
    lines.push("            if ($i >= strlen($s) || $s[$i] < '0' || $s[$i] > '9') { return false; }");
    lines.push("            while ($i < strlen($s) && $s[$i] >= '0' && $s[$i] <= '9') { $i++; }");
    lines.push('        }');
    lines.push('    }');
    lines.push('    return $i === strlen($s);');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_no_ws_tail')) {
    lines.push('function schemata_check_no_ws_tail(string $s, int $offset): bool {');
    lines.push('    $len = strlen($s);');
    lines.push('    if ($offset >= $len) { return false; }');
    lines.push('    for ($i = $offset; $i < $len; ) {');
    lines.push('        $adv = schemata_is_ecma_ws($s, $i);');
    lines.push('        if ($adv > 0) { return false; }');
    lines.push('        $i++;');
    lines.push('    }');
    lines.push('    return true;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_external_identity')) {
    lines.push('function schemata_check_external_identity(string $s): bool {');
    lines.push("    if ($s === '') { return false; }");
    lines.push('    $i = 0;');
    lines.push('    $c = $s[$i];');
    lines.push("    if (!(($c >= 'a' && $c <= 'z') || ($c >= '0' && $c <= '9') || $c === '.' || $c === '_' || $c === '-' || $c === '/')) { return false; }");
    lines.push("    while ($i < strlen($s) && (($s[$i] >= 'a' && $s[$i] <= 'z') || ($s[$i] >= '0' && $s[$i] <= '9') || $s[$i] === '.' || $s[$i] === '_' || $s[$i] === '-' || $s[$i] === '/')) { $i++; }");
    lines.push("    if ($i >= strlen($s) || $s[$i] !== ':') { return false; }");
    lines.push('    $i++;');
    lines.push('    return schemata_check_dot_tail($s, $i);');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_package_id')) {
    lines.push('function schemata_check_package_id(string $s): bool {');
    lines.push("    if ($s === '') { return false; }");
    lines.push("    if ($s === '#') { return true; }");
    lines.push("    if (!(($s[0] >= 'a' && $s[0] <= 'z') || ($s[0] >= 'A' && $s[0] <= 'Z') || ($s[0] >= '0' && $s[0] <= '9'))) { return false; }");
    lines.push('    $i = 1;');
    lines.push("    while ($i < strlen($s) && (($s[$i] >= 'a' && $s[$i] <= 'z') || ($s[$i] >= 'A' && $s[$i] <= 'Z') || ($s[$i] >= '0' && $s[$i] <= '9') || $s[$i] === '.' || $s[$i] === '_' || $s[$i] === '+' || $s[$i] === '-')) { $i++; }");
    lines.push('    while ($i < strlen($s)) {');
    lines.push("        if ($s[$i] !== ':') { return false; }");
    lines.push('        $i++;');
    lines.push("        if ($i >= strlen($s) || !(($s[$i] >= 'a' && $s[$i] <= 'z') || ($s[$i] >= 'A' && $s[$i] <= 'Z') || ($s[$i] >= '0' && $s[$i] <= '9'))) { return false; }");
    lines.push('        $i++;');
    lines.push("        while ($i < strlen($s) && (($s[$i] >= 'a' && $s[$i] <= 'z') || ($s[$i] >= 'A' && $s[$i] <= 'Z') || ($s[$i] >= '0' && $s[$i] <= '9') || $s[$i] === '.' || $s[$i] === '_' || $s[$i] === '+' || $s[$i] === '-')) { $i++; }");
    lines.push('    }');
    lines.push('    return $i === strlen($s);');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_imeta_dim')) {
    lines.push('function schemata_check_imeta_dim(string $s): bool {');
    lines.push('    $len = strlen($s);');
    lines.push('    if ($len < 7) return false;');
    lines.push('    if (substr($s, 0, 4) !== "dim ") return false;');
    lines.push('    $i = 4;');
    lines.push('    $dc = 0;');
    lines.push('    while ($i < $len && $s[$i] >= \'0\' && $s[$i] <= \'9\') { $i++; $dc++; }');
    lines.push('    if ($dc < 1 || $dc > 5) return false;');
    lines.push('    if ($i >= $len || $s[$i] !== \'x\') return false;');
    lines.push('    $i++; $dc = 0;');
    lines.push('    while ($i < $len && $s[$i] >= \'0\' && $s[$i] <= \'9\') { $i++; $dc++; }');
    lines.push('    if ($dc < 1 || $dc > 5) return false;');
    lines.push('    return $i === $len;');
    lines.push('}');
    lines.push('');
  }

  return lines.join('\n');
}
