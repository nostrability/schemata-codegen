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
        return { expr: `schemata_check_a_tag(${varExpr}, [${check.kinds.join(', ')}])`, helpers };
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
    lines.push("    return $s !== '' && ctype_digit($s);");
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_signed_int')) {
    lines.push('function schemata_check_signed_int(string $s): bool {');
    lines.push("    if ($s === '') { return false; }");
    lines.push("    if ($s[0] === '-') { $s = substr($s, 1); }");
    lines.push("    return $s !== '' && ctype_digit($s);");
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

  if (helpers.has('schemata_check_relay_url') || helpers.has('schemata_check_a_tag')) {
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
    lines.push('    $pos = 0;');
    lines.push("    if ($s[$pos] < '0' || $s[$pos] > '9') { return false; }");
    lines.push('    $kind = 0;');
    lines.push("    while ($pos < strlen($s) && $s[$pos] >= '0' && $s[$pos] <= '9') {");
    lines.push("        $kind = $kind * 10 + (ord($s[$pos]) - ord('0'));");
    lines.push('        $pos++;');
    lines.push('    }');
    lines.push("    if ($pos >= strlen($s) || $s[$pos] !== ':') { return false; }");
    lines.push('    if ($kinds !== null && !in_array($kind, $kinds, true)) { return false; }');
    lines.push('    $pos++;');
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

  return lines.join('\n');
}
