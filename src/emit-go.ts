/**
 * Go validator emitter: ValidatorAction[] → .go file
 *
 * Statement-oriented: uses loop + found flag for tag search (no closures).
 * Generated code is idiomatic Go with explicit iteration and break.
 *
 * Tag access model:
 *   - tags: [][]string  (slice of string slices)
 *   - t[i] with len(t) > i guard
 *   - Tag name: len(t) > 0 && t[0] == "name"
 *   - String comparison: == (not strcmp)
 *
 * Pattern helpers as private functions: checkHex64, checkDigits, etc.
 * Imports "strings" only if HasPrefix is needed, "regexp" only if regex fallback used.
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

function renderPatternCheckGo(check: PatternCheck, varExpr: string): { expr: string; helpers: Set<string> } {
  const helpers = new Set<string>();
  switch (check.op) {
    case 'hex': {
      const fn = check.case === 'lower' ? `checkHex${check.len}` : `checkHex${check.len}Mixed`;
      helpers.add(fn);
      return { expr: `${fn}(${varExpr})`, helpers };
    }
    case 'hex_range': {
      const fn = check.case === 'lower' ? 'checkHexRange' : 'checkHexRangeMixed';
      helpers.add(fn);
      return { expr: `${fn}(${varExpr}, ${check.min}, ${check.max})`, helpers };
    }
    case 'hex_prefixed': {
      helpers.add('checkHexPrefixed');
      helpers.add('strings');
      return { expr: `checkHexPrefixed(${varExpr}, ${JSON.stringify(check.prefix)}, ${check.hexLen})`, helpers };
    }
    case 'all_digits': {
      const fn = check.allowNeg ? 'checkSignedInt' : 'checkDigits';
      helpers.add(fn);
      return { expr: `${fn}(${varExpr})`, helpers };
    }
    case 'starts_with_any': {
      helpers.add('strings');
      const checks = check.prefixes.map(p => `strings.HasPrefix(${varExpr}, ${JSON.stringify(p)})`);
      return { expr: checks.length === 1 ? checks[0] : `(${checks.join(' || ')})`, helpers };
    }
    case 'chars_in': {
      if (check.min === 0 && check.max === 0) {
        return { expr: `len(${varExpr}) == 0`, helpers };
      }
      helpers.add('checkCharsIn');
      const maxVal = check.max !== undefined ? String(check.max) : '0x7FFFFFFF';
      return {
        expr: `checkCharsIn(${varExpr}, ${JSON.stringify(check.charset)}, ${check.min ?? 0}, ${maxVal})`,
        helpers,
      };
    }
    case 'bech32': {
      helpers.add('checkBech32');
      helpers.add('strings');
      if (check.dataLen !== undefined) {
        return { expr: `checkBech32(${varExpr}, ${JSON.stringify(check.hrp + '1')}, ${check.dataLen})`, helpers };
      }
      return { expr: `checkBech32(${varExpr}, ${JSON.stringify(check.hrp + '1')}, -1)`, helpers };
    }
    case 'regex': {
      helpers.add('regexp');
      return { expr: `checkRegex(${varExpr}, ${JSON.stringify(check.pattern)})`, helpers };
    }
    case 'compound': {
      const allHelpers = new Set<string>();
      const parts: string[] = [];
      for (const sub of check.checks) {
        const r = renderPatternCheckGo(sub, varExpr);
        parts.push(r.expr);
        for (const h of r.helpers) allHelpers.add(h);
      }
      return { expr: `(${parts.join(' && ')})`, helpers: allHelpers };
    }
  }
}

// --- Value check rendering ---

function renderValueCheckGo(
  check: ValueCheck,
  tagVar: string,
  index: number,
): { expr: string; helpers: Set<string> } {
  const helpers = new Set<string>();
  const access = `${tagVar}[${index}]`;
  const lenGuard = `len(${tagVar}) > ${index}`;

  switch (check.type) {
    case 'const':
      return { expr: `${lenGuard} && ${access} == ${JSON.stringify(check.value)}`, helpers };
    case 'enum': {
      const vals = check.values.map(v => `${access} == ${JSON.stringify(v)}`);
      return {
        expr: `${lenGuard} && (${vals.join(' || ')})`,
        helpers,
      };
    }
    case 'pattern': {
      const r = renderPatternCheckGo(check.native, access);
      for (const h of r.helpers) helpers.add(h);
      return {
        expr: `${lenGuard} && ${r.expr}`,
        helpers,
      };
    }
    case 'anyOf': {
      const parts: string[] = [];
      for (const alt of check.alternatives) {
        const r = renderValueCheckGo(alt, tagVar, index);
        parts.push(`(${r.expr})`);
        for (const h of r.helpers) helpers.add(h);
      }
      return { expr: `(${parts.join(' || ')})`, helpers };
    }
  }
}

/**
 * Render a value check for optional position validation context.
 * Here we already know len(t) > index, so no len guard on the access itself.
 */
function renderValueCheckGoNoGuard(
  check: ValueCheck,
  tagVar: string,
  index: number,
): { expr: string; helpers: Set<string> } {
  const helpers = new Set<string>();
  const access = `${tagVar}[${index}]`;

  switch (check.type) {
    case 'const':
      return { expr: `${access} == ${JSON.stringify(check.value)}`, helpers };
    case 'enum': {
      const vals = check.values.map(v => `${access} == ${JSON.stringify(v)}`);
      return {
        expr: `(${vals.join(' || ')})`,
        helpers,
      };
    }
    case 'pattern': {
      const r = renderPatternCheckGo(check.native, access);
      for (const h of r.helpers) helpers.add(h);
      return {
        expr: r.expr,
        helpers,
      };
    }
    case 'anyOf': {
      const parts: string[] = [];
      for (const alt of check.alternatives) {
        const r = renderValueCheckGoNoGuard(alt, tagVar, index);
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

// --- Tag matcher rendering (for loop + found flag) ---

function renderTagMatcherCondition(
  matcher: TagMatcher,
  tagVar: string,
  helpers: Set<string>,
): string {
  const checks: string[] = [];

  checks.push(`len(${tagVar}) > 0 && ${tagVar}[0] == ${JSON.stringify(matcher.tagName)}`);
  checks.push(`len(${tagVar}) >= ${matcher.minItems}`);
  if (matcher.maxItems !== undefined) {
    checks.push(`len(${tagVar}) <= ${matcher.maxItems}`);
  }

  for (const pc of matcher.positionChecks) {
    const r = renderValueCheckGo(pc.check, tagVar, pc.index);
    for (const h of r.helpers) helpers.add(h);
    checks.push(r.expr);
  }

  return checks.join(' && ');
}

// --- Main emitter ---

export function emitGoValidators(kindShapes: KindShape[]): string {
  const allHelpers = new Set<string>();
  const fnBodies: string[] = [];
  const constrainedKinds: { kindNumber: number; nip: string }[] = [];

  for (const shape of [...kindShapes].sort((a, b) => a.kindNumber - b.kindNumber)) {
    const actions = planKindValidator(shape);
    if (!actions) continue;

    constrainedKinds.push({ kindNumber: shape.kindNumber, nip: shape.nip });
    const { code, helpers } = emitKindFunctionGo(shape.kindNumber, shape.nip, actions);
    fnBodies.push(code);
    for (const h of helpers) allHelpers.add(h);
  }

  return emitGoFile(fnBodies, constrainedKinds, allHelpers);
}

function emitKindFunctionGo(
  kindNumber: number,
  nip: string,
  actions: ValidatorAction[],
): { code: string; helpers: Set<string> } {
  const helpers = new Set<string>();
  const lines: string[] = [];

  lines.push(`// ValidateKind${kindNumber} validates tags for kind ${kindNumber} (${nip}).`);
  lines.push(`func ValidateKind${kindNumber}(tags [][]string) []ValidationError {`);
  lines.push('\tvar errors []ValidationError');

  for (const action of actions) {
    lines.push('');
    switch (action.type) {
      case 'check_min_tags':
        lines.push(`\tif len(tags) < ${action.min} {`);
        lines.push(`\t\terrors = append(errors, ValidationError{Path: "tags", Message: "tags must have at least ${action.min} item(s)"})`);
        lines.push('\t}');
        break;

      case 'require_tag': {
        const cond = renderTagMatcherCondition(action.matcher, 't', helpers);
        lines.push('\tfound := false');
        lines.push('\tfor _, t := range tags {');
        lines.push(`\t\tif ${cond} {`);
        lines.push('\t\t\tfound = true');
        lines.push('\t\t\tbreak');
        lines.push('\t\t}');
        lines.push('\t}');
        lines.push('\tif !found {');
        lines.push(`\t\terrors = append(errors, ValidationError{Path: "tags", Message: ${JSON.stringify(action.errorMsg)}})`);
        lines.push('\t}');
        break;
      }

      case 'validate_optional_positions': {
        lines.push('\tfor _, t := range tags {');
        lines.push(`\t\tif len(t) > 0 && t[0] == ${JSON.stringify(action.tagName)} {`);
        for (const pc of action.checks) {
          const r = renderValueCheckGoNoGuard(pc.check, 't', pc.index);
          for (const h of r.helpers) helpers.add(h);
          const msg = describePositionConstraint(pc, action.tagName);
          lines.push(`\t\t\tif len(t) > ${pc.index} && !(${r.expr}) {`);
          lines.push(`\t\t\t\terrors = append(errors, ValidationError{Path: "tags", Message: ${JSON.stringify(msg)}})`);
          lines.push('\t\t\t}');
        }
        lines.push('\t\t}');
        lines.push('\t}');
        break;
      }

      case 'per_item_conditional': {
        const cond = renderTagMatcherCondition(action.matcher, 't', helpers);
        lines.push('\tfor _, t := range tags {');
        lines.push(`\t\tif len(t) > 0 && t[0] == ${JSON.stringify(action.condTag)} && !(${cond}) {`);
        lines.push(`\t\t\terrors = append(errors, ValidationError{Path: "tags", Message: ${JSON.stringify(action.errorMsg)}})`);
        lines.push('\t\t}');
        if (action.optChecks.length > 0) {
          lines.push(`\t\tif len(t) > 0 && t[0] == ${JSON.stringify(action.condTag)} {`);
          for (const pc of action.optChecks) {
            const r = renderValueCheckGoNoGuard(pc.check, 't', pc.index);
            for (const h of r.helpers) helpers.add(h);
            const msg = describePositionConstraint(pc, action.condTag);
            lines.push(`\t\t\tif len(t) > ${pc.index} && !(${r.expr}) {`);
            lines.push(`\t\t\t\terrors = append(errors, ValidationError{Path: "tags", Message: ${JSON.stringify(msg)}})`);
            lines.push('\t\t\t}');
          }
          lines.push('\t\t}');
        }
        lines.push('\t}');
        break;
      }

      case 'array_level_conditional': {
        // First: check if condition tag exists
        lines.push('\t{');
        lines.push('\t\tcondFound := false');
        lines.push('\t\tfor _, t := range tags {');
        lines.push(`\t\t\tif len(t) > 0 && t[0] == ${JSON.stringify(action.condTag)} {`);
        lines.push('\t\t\t\tcondFound = true');
        lines.push('\t\t\t\tbreak');
        lines.push('\t\t\t}');
        lines.push('\t\t}');
        lines.push('\t\tif condFound {');
        // Then: check if matching tag exists
        const cond = renderTagMatcherCondition(action.matcher, 't', helpers);
        lines.push('\t\t\tmatchFound := false');
        lines.push('\t\t\tfor _, t := range tags {');
        lines.push(`\t\t\t\tif ${cond} {`);
        lines.push('\t\t\t\t\tmatchFound = true');
        lines.push('\t\t\t\t\tbreak');
        lines.push('\t\t\t\t}');
        lines.push('\t\t\t}');
        lines.push('\t\t\tif !matchFound {');
        lines.push(`\t\t\t\terrors = append(errors, ValidationError{Path: "tags", Message: ${JSON.stringify(action.errorMsg)}})`);
        lines.push('\t\t\t}');
        // Optional position checks (inside condTag guard)
        if (action.optChecks.length > 0) {
          lines.push('\t\t\tfor _, t := range tags {');
          lines.push(`\t\t\t\tif len(t) > 0 && t[0] == ${JSON.stringify(action.matcher.tagName)} {`);
          for (const pc of action.optChecks) {
            const r = renderValueCheckGoNoGuard(pc.check, 't', pc.index);
            for (const h of r.helpers) helpers.add(h);
            const msg = describePositionConstraint(pc, action.matcher.tagName);
            lines.push(`\t\t\t\t\tif len(t) > ${pc.index} && !(${r.expr}) {`);
            lines.push(`\t\t\t\t\t\terrors = append(errors, ValidationError{Path: "tags", Message: ${JSON.stringify(msg)}})`);
            lines.push('\t\t\t\t\t}');
          }
          lines.push('\t\t\t\t}');
          lines.push('\t\t\t}');
        }

        lines.push('\t\t}');
        lines.push('\t}');
        break;
      }

      case 'any_of_group': {
        // Check each matcher with its own found flag, then OR them
        lines.push('\t{');
        const varNames: string[] = [];
        for (let i = 0; i < action.matchers.length; i++) {
          const m = action.matchers[i];
          const varName = `found${i}`;
          varNames.push(varName);
          const cond = renderTagMatcherCondition(m, 't', helpers);
          lines.push(`\t\t${varName} := false`);
          lines.push('\t\tfor _, t := range tags {');
          lines.push(`\t\t\tif ${cond} {`);
          lines.push(`\t\t\t\t${varName} = true`);
          lines.push('\t\t\t\tbreak');
          lines.push('\t\t\t}');
          lines.push('\t\t}');
        }
        const orExpr = varNames.join(' || ');
        lines.push(`\t\tif !(${orExpr}) {`);
        lines.push(`\t\t\terrors = append(errors, ValidationError{Path: "tags", Message: ${JSON.stringify(action.errorMsg)}})`);
        lines.push('\t\t}');
        lines.push('\t}');
        break;
      }
    }
  }

  lines.push('');
  lines.push('\treturn errors');
  lines.push('}');

  return { code: lines.join('\n'), helpers };
}

// --- File generation ---

function emitGoFile(
  fnBodies: string[],
  constrainedKinds: { kindNumber: number; nip: string }[],
  helpers: Set<string>,
): string {
  const lines: string[] = [
    '// Code generated by @nostrability/schemata-codegen. DO NOT EDIT.',
    '//',
    '// Runtime validators for Nostr event tag constraints.',
    '',
    'package schemata',
    '',
  ];

  // Imports
  const imports: string[] = [];
  if (helpers.has('strings')) {
    imports.push('"strings"');
  }
  if (helpers.has('regexp')) {
    imports.push('"regexp"');
  }
  if (imports.length > 0) {
    if (imports.length === 1) {
      lines.push(`import ${imports[0]}`);
    } else {
      lines.push('import (');
      for (const imp of imports.sort()) {
        lines.push(`\t${imp}`);
      }
      lines.push(')');
    }
    lines.push('');
  }

  // ValidationError struct
  lines.push('// ValidationError represents a tag constraint violation.');
  lines.push('type ValidationError struct {');
  lines.push('\tPath    string');
  lines.push('\tMessage string');
  lines.push('}');
  lines.push('');

  // Helper functions
  lines.push(emitGoHelpers(helpers));

  // Per-kind functions
  for (const fn of fnBodies) {
    lines.push(fn);
    lines.push('');
  }

  // Dispatch function
  lines.push('// ValidateKindTags validates tags for a given kind number.');
  lines.push('// Returns nil if kind has no constraints or is unknown.');
  lines.push('func ValidateKindTags(kind int, tags [][]string) []ValidationError {');
  lines.push('\tswitch kind {');
  for (const k of constrainedKinds) {
    lines.push(`\tcase ${k.kindNumber}:`);
    lines.push(`\t\treturn ValidateKind${k.kindNumber}(tags)`);
  }
  lines.push('\tdefault:');
  lines.push('\t\treturn nil');
  lines.push('\t}');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

function emitGoHelpers(helpers: Set<string>): string {
  const lines: string[] = [];

  // Collect hex lengths
  const hexLengths = new Set<number>();
  const hexMixedLengths = new Set<number>();
  for (const h of helpers) {
    const m = h.match(/^checkHex(\d+)$/);
    if (m) hexLengths.add(parseInt(m[1], 10));
    const mm = h.match(/^checkHex(\d+)Mixed$/);
    if (mm) hexMixedLengths.add(parseInt(mm[1], 10));
  }

  for (const len of [...hexLengths].sort((a, b) => a - b)) {
    lines.push(`func checkHex${len}(s string) bool {`);
    lines.push(`\tif len(s) != ${len} {`);
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\tfor i := 0; i < len(s); i++ {');
    lines.push('\t\tb := s[i]');
    lines.push("\t\tif !((b >= '0' && b <= '9') || (b >= 'a' && b <= 'f')) {");
    lines.push('\t\t\treturn false');
    lines.push('\t\t}');
    lines.push('\t}');
    lines.push('\treturn true');
    lines.push('}');
    lines.push('');
  }

  for (const len of [...hexMixedLengths].sort((a, b) => a - b)) {
    lines.push(`func checkHex${len}Mixed(s string) bool {`);
    lines.push(`\tif len(s) != ${len} {`);
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\tfor i := 0; i < len(s); i++ {');
    lines.push('\t\tb := s[i]');
    lines.push("\t\tif !((b >= '0' && b <= '9') || (b >= 'a' && b <= 'f') || (b >= 'A' && b <= 'F')) {");
    lines.push('\t\t\treturn false');
    lines.push('\t\t}');
    lines.push('\t}');
    lines.push('\treturn true');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkHexRange')) {
    lines.push('func checkHexRange(s string, min, max int) bool {');
    lines.push('\tl := len(s)');
    lines.push('\tif l < min || l > max {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\tfor i := 0; i < l; i++ {');
    lines.push('\t\tb := s[i]');
    lines.push("\t\tif !((b >= '0' && b <= '9') || (b >= 'a' && b <= 'f')) {");
    lines.push('\t\t\treturn false');
    lines.push('\t\t}');
    lines.push('\t}');
    lines.push('\treturn true');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkHexRangeMixed')) {
    lines.push('func checkHexRangeMixed(s string, min, max int) bool {');
    lines.push('\tl := len(s)');
    lines.push('\tif l < min || l > max {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\tfor i := 0; i < l; i++ {');
    lines.push('\t\tb := s[i]');
    lines.push("\t\tif !((b >= '0' && b <= '9') || (b >= 'a' && b <= 'f') || (b >= 'A' && b <= 'F')) {");
    lines.push('\t\t\treturn false');
    lines.push('\t\t}');
    lines.push('\t}');
    lines.push('\treturn true');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkHexPrefixed')) {
    lines.push('func checkHexPrefixed(s string, prefix string, hexLen int) bool {');
    lines.push('\tif !strings.HasPrefix(s, prefix) {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\trest := s[len(prefix):]');
    lines.push('\tif len(rest) != hexLen {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\tfor i := 0; i < len(rest); i++ {');
    lines.push('\t\tb := rest[i]');
    lines.push("\t\tif !((b >= '0' && b <= '9') || (b >= 'a' && b <= 'f')) {");
    lines.push('\t\t\treturn false');
    lines.push('\t\t}');
    lines.push('\t}');
    lines.push('\treturn true');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkDigits')) {
    lines.push('func checkDigits(s string) bool {');
    lines.push('\tif len(s) == 0 {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\tfor i := 0; i < len(s); i++ {');
    lines.push("\t\tif s[i] < '0' || s[i] > '9' {");
    lines.push('\t\t\treturn false');
    lines.push('\t\t}');
    lines.push('\t}');
    lines.push('\treturn true');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkSignedInt')) {
    lines.push('func checkSignedInt(s string) bool {');
    lines.push('\tif len(s) == 0 {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\tstart := 0');
    lines.push("\tif s[0] == '-' {");
    lines.push('\t\tstart = 1');
    lines.push('\t}');
    lines.push('\tif start >= len(s) {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\tfor i := start; i < len(s); i++ {');
    lines.push("\t\tif s[i] < '0' || s[i] > '9' {");
    lines.push('\t\t\treturn false');
    lines.push('\t\t}');
    lines.push('\t}');
    lines.push('\treturn true');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkCharsIn')) {
    lines.push('func checkCharsIn(s string, charset string, min, max int) bool {');
    lines.push('\tl := len(s)');
    lines.push('\tif l < min || l > max {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\tfor _, c := range s {');
    lines.push('\t\tfound := false');
    lines.push('\t\tfor _, a := range charset {');
    lines.push('\t\t\tif c == a {');
    lines.push('\t\t\t\tfound = true');
    lines.push('\t\t\t\tbreak');
    lines.push('\t\t\t}');
    lines.push('\t\t}');
    lines.push('\t\tif !found {');
    lines.push('\t\t\treturn false');
    lines.push('\t\t}');
    lines.push('\t}');
    lines.push('\treturn true');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkBech32')) {
    lines.push('func isBech32Char(b byte) bool {');
    lines.push("\treturn (b >= '0' && b <= '9' && b != '1') || (b >= 'a' && b <= 'z' && b != 'b' && b != 'i' && b != 'o')");
    lines.push('}');
    lines.push('');
    lines.push('func checkBech32(s string, prefix string, dataLen int) bool {');
    lines.push('\tif !strings.HasPrefix(s, prefix) {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\tdata := s[len(prefix):]');
    lines.push('\tif len(data) == 0 {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\tfor i := 0; i < len(data); i++ {');
    lines.push('\t\tif !isBech32Char(data[i]) {');
    lines.push('\t\t\treturn false');
    lines.push('\t\t}');
    lines.push('\t}');
    lines.push('\tif dataLen >= 0 {');
    lines.push('\t\treturn len(data) == dataLen');
    lines.push('\t}');
    lines.push('\treturn true');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('regexp')) {
    lines.push('func checkRegex(s string, pattern string) bool {');
    lines.push('\tmatched, err := regexp.MatchString(pattern, s)');
    lines.push('\tif err != nil {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\treturn matched');
    lines.push('}');
    lines.push('');
  }

  return lines.join('\n');
}
