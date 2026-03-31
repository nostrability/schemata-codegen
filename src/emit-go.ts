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
    case 'relay_url': {
      helpers.add('checkRelayUrl');
      return { expr: `checkRelayUrl(${varExpr})`, helpers };
    }
    case 'a_tag': {
      helpers.add('checkATag');
      if (check.kinds && check.kinds.length > 0) {
        const arr = check.kinds.map(k => JSON.stringify(k)).join(', ');
        return { expr: `checkATag(${varExpr}, []string{${arr}})`, helpers };
      }
      return { expr: `checkATag(${varExpr}, nil)`, helpers };
    }
    case 'date_iso': {
      helpers.add('checkDateIso');
      return { expr: `checkDateIso(${varExpr})`, helpers };
    }
    case 'datetime_iso': {
      helpers.add('checkDatetimeIso');
      return { expr: `checkDatetimeIso(${varExpr})`, helpers };
    }
    case 'decimal': {
      helpers.add('checkDecimal');
      return { expr: `checkDecimal(${varExpr})`, helpers };
    }
    case 'exact_values': {
      const checks = check.values.map(v => `${varExpr} == ${JSON.stringify(v)}`);
      return { expr: checks.length === 1 ? checks[0] : `(${checks.join(' || ')})`, helpers };
    }
    case 'prefix_nonempty': {
      helpers.add('strings');
      helpers.add('checkDotTail');
      return {
        expr: `(strings.HasPrefix(${varExpr}, ${JSON.stringify(check.prefix)}) && checkDotTail(${varExpr}, ${check.prefix.length}))`,
        helpers,
      };
    }
    case 'wrapped': {
      helpers.add('checkWrapped');
      helpers.add('strings');
      return { expr: `checkWrapped(${varExpr}, ${JSON.stringify(check.prefix)}, ${JSON.stringify(check.suffix)})`, helpers };
    }
    case 'csv_list': {
      helpers.add('checkCsvList');
      return { expr: `checkCsvList(${varExpr}, ${JSON.stringify(check.itemCharset)})`, helpers };
    }
    case 'ln_invoice': {
      helpers.add('checkLnInvoice');
      helpers.add('checkBech32');
      helpers.add('strings');
      return { expr: `checkLnInvoice(${varExpr}, ${JSON.stringify(check.prefix)}, ${check.minHrpLen})`, helpers };
    }
    case 'mime_type': {
      helpers.add('checkMimeType');
      return { expr: `checkMimeType(${varExpr})`, helpers };
    }
    case 'http_origin': {
      helpers.add('checkHttpOrigin');
      return { expr: `checkHttpOrigin(${varExpr})`, helpers };
    }
    case 'email_like': {
      helpers.add('checkEmailLike');
      helpers.add('isEcmaWs');
      return { expr: `checkEmailLike(${varExpr})`, helpers };
    }
    case 'git_clone_url': {
      helpers.add('checkGitCloneUrl');
      helpers.add('isEcmaWs');
      return { expr: `checkGitCloneUrl(${varExpr})`, helpers };
    }
    case 'content_type': {
      helpers.add('checkContentType');
      return { expr: `checkContentType(${varExpr})`, helpers };
    }
    case 'doi': {
      helpers.add('checkDoi');
      return { expr: `checkDoi(${varExpr})`, helpers };
    }
    case 'annotate_user': {
      helpers.add('checkAnnotateUser');
      return { expr: `checkAnnotateUser(${varExpr})`, helpers };
    }
    case 'prefix_no_whitespace': {
      helpers.add('strings');
      helpers.add('checkNoWsTail');
      helpers.add('isEcmaWs');
      const checks = check.prefixes.map(p =>
        `(strings.HasPrefix(${varExpr}, ${JSON.stringify(p)}) && checkNoWsTail(${varExpr}, ${p.length}))`
      );
      return { expr: checks.length === 1 ? checks[0] : `(${checks.join(' || ')})`, helpers };
    }
    case 'external_identity': {
      helpers.add('checkExternalIdentity');
      return { expr: `checkExternalIdentity(${varExpr})`, helpers };
    }
    case 'package_id': {
      helpers.add('checkPackageId');
      return { expr: `checkPackageId(${varExpr})`, helpers };
    }
    case 'imeta_dim': {
      helpers.add('checkImetaDim');
      return { expr: `checkImetaDim(${varExpr})`, helpers };
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
    default: {
      const _exhaustive: never = check;
      throw new Error(`Unhandled PatternCheck op: ${(_exhaustive as any).op}`);
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

  if (helpers.has('checkDateIso')) {
    lines.push('func checkDateIso(s string) bool {');
    lines.push('\tif len(s) != 10 {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push("\tif s[4] != '-' || s[7] != '-' {");
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\tfor i := 0; i < 10; i++ {');
    lines.push('\t\tif i == 4 || i == 7 {');
    lines.push('\t\t\tcontinue');
    lines.push('\t\t}');
    lines.push("\t\tif s[i] < '0' || s[i] > '9' {");
    lines.push('\t\t\treturn false');
    lines.push('\t\t}');
    lines.push('\t}');
    lines.push('\treturn true');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkDecimal')) {
    lines.push('func checkDecimal(s string) bool {');
    lines.push('\tif len(s) == 0 {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\ti := 0');
    lines.push("\tfor i < len(s) && s[i] >= '0' && s[i] <= '9' {");
    lines.push('\t\ti++');
    lines.push('\t}');
    lines.push('\tif i == 0 {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push("\tif i < len(s) && s[i] == '.' {");
    lines.push('\t\ti++');
    lines.push("\t\tif i >= len(s) || s[i] < '0' || s[i] > '9' {");
    lines.push('\t\t\treturn false');
    lines.push('\t\t}');
    lines.push("\t\tfor i < len(s) && s[i] >= '0' && s[i] <= '9' {");
    lines.push('\t\t\ti++');
    lines.push('\t\t}');
    lines.push('\t}');
    lines.push('\treturn i == len(s)');
    lines.push('}');
    lines.push('');
  }

  // Shared dot-tail helper: Go regexp . excludes \n only
  if (helpers.has('checkRelayUrl') || helpers.has('checkATag') || helpers.has('checkDoi') || helpers.has('checkDotTail')) {
    lines.push('func checkDotTail(s string, pos int) bool {');
    lines.push('\tif pos >= len(s) { return false }');
    lines.push('\tfor j := pos; j < len(s); j++ {');
    lines.push("\t\tif s[j] == '\\n' { return false }");
    lines.push('\t}');
    lines.push('\treturn true');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkRelayUrl')) {
    lines.push('func checkRelayUrl(s string) bool {');
    lines.push('\ti := 0');
    lines.push('\tif len(s) >= 6 && s[:6] == "wss://" {');
    lines.push('\t\ti = 6');
    lines.push('\t} else if len(s) >= 5 && s[:5] == "ws://" {');
    lines.push('\t\ti = 5');
    lines.push('\t} else {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\thostStart := i');
    lines.push('\tfor i < len(s) {');
    lines.push('\t\tb := s[i]');
    lines.push("\t\tif (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') || (b >= '0' && b <= '9') || b == '.' || b == '_' || b == '-' {");
    lines.push('\t\t\ti++');
    lines.push('\t\t} else {');
    lines.push('\t\t\tbreak');
    lines.push('\t\t}');
    lines.push('\t}');
    lines.push('\tif i == hostStart {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push("\tif i < len(s) && s[i] == ':' {");
    lines.push('\t\ti++');
    lines.push('\t\tportStart := i');
    lines.push("\t\tfor i < len(s) && s[i] >= '0' && s[i] <= '9' {");
    lines.push('\t\t\ti++');
    lines.push('\t\t}');
    lines.push('\t\tif i == portStart {');
    lines.push('\t\t\treturn false');
    lines.push('\t\t}');
    lines.push('\t}');
    lines.push("\tif i < len(s) && s[i] == '/' {");
    lines.push('\t\treturn checkDotTail(s, i + 1) || i + 1 == len(s)');
    lines.push('\t}');
    lines.push('\treturn i == len(s)');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkATag')) {
    lines.push('func checkATag(s string, kinds []string) bool {');
    lines.push('\tif len(s) < 68 { return false }');
    lines.push('\tpos := 0');
    lines.push("\tif s[pos] < '0' || s[pos] > '9' { return false }");
    lines.push('\tcolonPos := 0');
    lines.push("\tfor colonPos < len(s) && s[colonPos] >= '0' && s[colonPos] <= '9' {");
    lines.push('\t\tcolonPos++');
    lines.push('\t}');
    lines.push("\tif colonPos >= len(s) || s[colonPos] != ':' { return false }");
    lines.push('\tkindStr := s[:colonPos]');
    lines.push("\tif len(kindStr) > 1 && kindStr[0] == '0' { return false }");
    lines.push('\tif len(kinds) > 0 {');
    lines.push('\t\tfound := false');
    lines.push('\t\tfor _, k := range kinds {');
    lines.push('\t\t\tif k == kindStr { found = true; break }');
    lines.push('\t\t}');
    lines.push('\t\tif !found { return false }');
    lines.push('\t}');
    lines.push('\tpos = colonPos + 1');
    lines.push('\tif pos+64 >= len(s) { return false }');
    lines.push('\tfor i := 0; i < 64; i++ {');
    lines.push('\t\tc := s[pos+i]');
    lines.push("\t\tif !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) { return false }");
    lines.push('\t}');
    lines.push('\tpos += 64');
    lines.push("\tif pos >= len(s) || s[pos] != ':' { return false }");
    lines.push('\tpos++');
    lines.push('\treturn checkDotTail(s, pos)');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkDatetimeIso')) {
    lines.push('func checkDatetimeIso(s string) bool {');
    lines.push('\tif len(s) < 10 { return false }');
    lines.push("\tfor _, i := range []int{0,1,2,3} { if s[i] < '0' || s[i] > '9' { return false } }");
    lines.push("\tif s[4] != '-' { return false }");
    lines.push("\tfor _, i := range []int{5,6} { if s[i] < '0' || s[i] > '9' { return false } }");
    lines.push("\tif s[7] != '-' { return false }");
    lines.push("\tfor _, i := range []int{8,9} { if s[i] < '0' || s[i] > '9' { return false } }");
    lines.push('\tif len(s) == 10 { return true }');
    lines.push("\tif s[10] != 'T' || len(s) < 16 { return false }");
    lines.push("\tfor _, i := range []int{11,12} { if s[i] < '0' || s[i] > '9' { return false } }");
    lines.push("\tif s[13] != ':' { return false }");
    lines.push("\tfor _, i := range []int{14,15} { if s[i] < '0' || s[i] > '9' { return false } }");
    lines.push('\tpos := 16');
    lines.push('\tif pos == len(s) { return true }');
    lines.push("\tif s[pos] == ':' {");
    lines.push('\t\tif pos+3 > len(s) { return false }');
    lines.push("\t\tif s[pos+1] < '0' || s[pos+1] > '9' || s[pos+2] < '0' || s[pos+2] > '9' { return false }");
    lines.push('\t\tpos += 3');
    lines.push('\t}');
    lines.push('\tif pos == len(s) { return true }');
    lines.push("\tif s[pos] == '.' {");
    lines.push('\t\tpos++');
    lines.push("\t\tif pos >= len(s) || s[pos] < '0' || s[pos] > '9' { return false }");
    lines.push("\t\tfor pos < len(s) && s[pos] >= '0' && s[pos] <= '9' { pos++ }");
    lines.push('\t}');
    lines.push('\tif pos == len(s) { return true }');
    lines.push("\tif s[pos] == 'Z' { return pos+1 == len(s) }");
    lines.push("\tif s[pos] == '+' || s[pos] == '-' {");
    lines.push('\t\tif pos+6 != len(s) { return false }');
    lines.push("\t\tif s[pos+1] < '0' || s[pos+1] > '9' || s[pos+2] < '0' || s[pos+2] > '9' { return false }");
    lines.push("\t\tif s[pos+3] != ':' { return false }");
    lines.push("\t\treturn s[pos+4] >= '0' && s[pos+4] <= '9' && s[pos+5] >= '0' && s[pos+5] <= '9'");
    lines.push('\t}');
    lines.push('\treturn false');
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

  if (helpers.has('checkWrapped')) {
    lines.push('func checkWrapped(s string, prefix string, suffix string) bool {');
    lines.push('\treturn len(s) >= len(prefix)+len(suffix) && strings.HasPrefix(s, prefix) && strings.HasSuffix(s, suffix)');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkCsvList')) {
    lines.push('func checkCsvList(s string, charset string) bool {');
    lines.push('\tif len(s) == 0 {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\ti := 0');
    lines.push('\tfor {');
    lines.push('\t\tstart := i');
    lines.push('\t\tfor i < len(s) {');
    lines.push('\t\t\tfound := false');
    lines.push('\t\t\tfor j := 0; j < len(charset); j++ {');
    lines.push('\t\t\t\tif s[i] == charset[j] {');
    lines.push('\t\t\t\t\tfound = true');
    lines.push('\t\t\t\t\tbreak');
    lines.push('\t\t\t\t}');
    lines.push('\t\t\t}');
    lines.push('\t\t\tif !found {');
    lines.push('\t\t\t\tbreak');
    lines.push('\t\t\t}');
    lines.push('\t\t\ti++');
    lines.push('\t\t}');
    lines.push('\t\tif i == start {');
    lines.push('\t\t\treturn false');
    lines.push('\t\t}');
    lines.push('\t\tif i == len(s) {');
    lines.push('\t\t\treturn true');
    lines.push('\t\t}');
    lines.push("\t\tif s[i] != ',' {");
    lines.push('\t\t\treturn false');
    lines.push('\t\t}');
    lines.push('\t\ti++');
    lines.push('\t}');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkLnInvoice')) {
    lines.push('func checkLnInvoice(s string, prefix string, minHrpLen int) bool {');
    lines.push('\tif !strings.HasPrefix(s, prefix) {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push("\tsep := strings.LastIndex(s, \"1\")");
    lines.push('\tif sep < 0 {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\tif sep < minHrpLen {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\tfor i := 0; i < sep; i++ {');
    lines.push('\t\tc := s[i]');
    lines.push("\t\tif !((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) {");
    lines.push('\t\t\treturn false');
    lines.push('\t\t}');
    lines.push('\t}');
    lines.push('\tdata := s[sep+1:]');
    lines.push('\tif len(data) == 0 {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\tfor i := 0; i < len(data); i++ {');
    lines.push('\t\tif !isBech32Char(data[i]) {');
    lines.push('\t\t\treturn false');
    lines.push('\t\t}');
    lines.push('\t}');
    lines.push('\treturn true');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkMimeType')) {
    lines.push('func checkMimeType(s string) bool {');
    lines.push('\tif len(s) == 0 {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\ti := 0');
    lines.push("\tfor i < len(s) && s[i] >= 'a' && s[i] <= 'z' {");
    lines.push('\t\ti++');
    lines.push('\t}');
    lines.push('\tif i == 0 {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push("\tif i >= len(s) || s[i] != '/' {");
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\ti++');
    lines.push('\tstart := i');
    lines.push('\tfor i < len(s) {');
    lines.push('\t\tc := s[i]');
    lines.push("\t\tif (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '+' || c == '-' {");
    lines.push('\t\t\ti++');
    lines.push('\t\t} else {');
    lines.push('\t\t\tbreak');
    lines.push('\t\t}');
    lines.push('\t}');
    lines.push('\tif i == start {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\treturn i == len(s)');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkHttpOrigin')) {
    lines.push('func checkHttpOrigin(s string) bool {');
    lines.push('\ti := 0');
    lines.push('\tif len(s) >= 8 && s[:8] == "https://" {');
    lines.push('\t\ti = 8');
    lines.push('\t} else if len(s) >= 7 && s[:7] == "http://" {');
    lines.push('\t\ti = 7');
    lines.push('\t} else {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\tstart := i');
    lines.push("\tfor i < len(s) && s[i] != '/' {");
    lines.push('\t\ti++');
    lines.push('\t}');
    lines.push('\tif i == start {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push("\tif i < len(s) && s[i] == '/' {");
    lines.push('\t\ti++');
    lines.push('\t}');
    lines.push('\treturn i == len(s)');
    lines.push('}');
    lines.push('');
  }

  // Shared isEcmaWs helper — matches ECMAScript \s (all 25 Unicode whitespace code points)
  if (helpers.has('isEcmaWs')) {
    lines.push('func isEcmaWs(r rune) bool {');
    lines.push('\tswitch r {');
    lines.push("\tcase '\\t', '\\n', 0x0B, 0x0C, '\\r', ' ',");
    lines.push('\t\t0x00A0, 0x1680,');
    lines.push('\t\t0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200A,');
    lines.push('\t\t0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF:');
    lines.push('\t\treturn true');
    lines.push('\t}');
    lines.push('\treturn false');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkEmailLike')) {
    lines.push('func checkEmailLike(s string) bool {');
    lines.push('\tif len(s) == 0 {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\tatPos := -1');
    lines.push('\tfor i, r := range s {');
    lines.push('\t\tif isEcmaWs(r) {');
    lines.push('\t\t\treturn false');
    lines.push('\t\t}');
    lines.push("\t\tif r == '@' {");
    lines.push('\t\t\tif atPos >= 0 {');
    lines.push('\t\t\t\treturn false');
    lines.push('\t\t\t}');
    lines.push('\t\t\tatPos = i');
    lines.push('\t\t}');
    lines.push('\t}');
    lines.push('\tif atPos <= 0 || atPos >= len(s)-1 {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\treturn true');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkGitCloneUrl')) {
    lines.push('func checkGitCloneUrl(s string) bool {');
    lines.push('\tif len(s) == 0 {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\ti := 0');
    lines.push('\tif len(s) >= 4 && s[:4] == "git@" {');
    lines.push('\t\ti = 4');
    lines.push('\t} else {');
    lines.push("\t\tif !(s[0] >= 'a' && s[0] <= 'z') {");
    lines.push('\t\t\treturn false');
    lines.push('\t\t}');
    lines.push('\t\ti = 1');
    lines.push('\t\tfor i < len(s) {');
    lines.push('\t\t\tc := s[i]');
    lines.push("\t\t\tif (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '+' || c == '.' || c == '-' {");
    lines.push('\t\t\t\ti++');
    lines.push('\t\t\t} else {');
    lines.push('\t\t\t\tbreak');
    lines.push('\t\t\t}');
    lines.push('\t\t}');
    lines.push("\t\tif i+3 > len(s) || s[i] != ':' || s[i+1] != '/' || s[i+2] != '/' {");
    lines.push('\t\t\treturn false');
    lines.push('\t\t}');
    lines.push('\t\ti += 3');
    lines.push('\t}');
    lines.push('\tif i >= len(s) {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\tfor _, r := range s[i:] {');
    lines.push('\t\tif isEcmaWs(r) {');
    lines.push('\t\t\treturn false');
    lines.push('\t\t}');
    lines.push('\t}');
    lines.push('\treturn true');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkContentType')) {
    lines.push('func isTypeChar(c byte) bool {');
    lines.push("\treturn (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '!' || c == '#' || c == '$' || c == '&' || c == '^' || c == '_' || c == '-'");
    lines.push('}');
    lines.push('');
    lines.push('func isSubtypeChar(c byte) bool {');
    lines.push("\treturn isTypeChar(c) || c == '.' || c == '+'");
    lines.push('}');
    lines.push('');
    lines.push('func checkContentType(s string) bool {');
    lines.push('\tif len(s) == 0 {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\ti := 0');
    lines.push("\tif !((s[i] >= 'a' && s[i] <= 'z') || (s[i] >= 'A' && s[i] <= 'Z')) {");
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\ti++');
    lines.push('\tfor i < len(s) && isTypeChar(s[i]) {');
    lines.push('\t\ti++');
    lines.push('\t}');
    lines.push("\tif i >= len(s) || s[i] != '/' {");
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\ti++');
    lines.push('\tif i >= len(s) {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\tc := s[i]');
    lines.push("\tif !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '*') {");
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\ti++');
    lines.push('\tfor i < len(s) && isSubtypeChar(s[i]) {');
    lines.push('\t\ti++');
    lines.push('\t}');
    lines.push('\tfor i < len(s) {');
    lines.push("\t\tfor i < len(s) && (s[i] == ' ' || s[i] == '\\t') {");
    lines.push('\t\t\ti++');
    lines.push('\t\t}');
    lines.push('\t\tif i >= len(s) {');
    lines.push('\t\t\treturn false');
    lines.push('\t\t}');
    lines.push("\t\tif s[i] != ';' {");
    lines.push('\t\t\treturn false');
    lines.push('\t\t}');
    lines.push('\t\ti++');
    lines.push("\t\tfor i < len(s) && (s[i] == ' ' || s[i] == '\\t') {");
    lines.push('\t\t\ti++');
    lines.push('\t\t}');
    lines.push('\t\tstart := i');
    lines.push('\t\tfor i < len(s) && isSubtypeChar(s[i]) {');
    lines.push('\t\t\ti++');
    lines.push('\t\t}');
    lines.push('\t\tif i == start {');
    lines.push('\t\t\treturn false');
    lines.push('\t\t}');
    lines.push("\t\tif i >= len(s) || s[i] != '=' {");
    lines.push('\t\t\treturn false');
    lines.push('\t\t}');
    lines.push('\t\ti++');
    lines.push('\t\tvstart := i');
    lines.push('\t\tfor i < len(s) && isSubtypeChar(s[i]) {');
    lines.push('\t\t\ti++');
    lines.push('\t\t}');
    lines.push('\t\tif i == vstart {');
    lines.push('\t\t\treturn false');
    lines.push('\t\t}');
    lines.push('\t}');
    lines.push('\treturn i == len(s)');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkDoi')) {
    lines.push('func checkDoi(s string) bool {');
    lines.push('\tif len(s) < 8 {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push("\tif s[0] != '1' || s[1] != '0' || s[2] != '.' {");
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\ti := 3');
    lines.push('\tstart := i');
    lines.push("\tfor i < len(s) && s[i] >= '0' && s[i] <= '9' {");
    lines.push('\t\ti++');
    lines.push('\t}');
    lines.push('\tdigitCount := i - start');
    lines.push('\tif digitCount < 4 || digitCount > 9 {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push("\tif i >= len(s) || s[i] != '/' {");
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\ti++');
    lines.push('\treturn checkDotTail(s, i)');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkAnnotateUser')) {
    lines.push('func checkAnnotateUser(s string) bool {');
    lines.push('\tif len(s) < 82 {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\tif s[:14] != "annotate-user " {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\ti := 14');
    lines.push('\tif i+64 > len(s) {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\tfor j := 0; j < 64; j++ {');
    lines.push('\t\tc := s[i+j]');
    lines.push("\t\tif !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {");
    lines.push('\t\t\treturn false');
    lines.push('\t\t}');
    lines.push('\t}');
    lines.push('\ti += 64');
    lines.push('\tfor round := 0; round < 2; round++ {');
    lines.push("\t\tif i >= len(s) || s[i] != ':' {");
    lines.push('\t\t\treturn false');
    lines.push('\t\t}');
    lines.push('\t\ti++');
    lines.push('\t\tstart := i');
    lines.push("\t\tfor i < len(s) && s[i] >= '0' && s[i] <= '9' {");
    lines.push('\t\t\ti++');
    lines.push('\t\t}');
    lines.push('\t\tif i == start {');
    lines.push('\t\t\treturn false');
    lines.push('\t\t}');
    lines.push("\t\tif i < len(s) && s[i] == '.' {");
    lines.push('\t\t\ti++');
    lines.push('\t\t\tdstart := i');
    lines.push("\t\t\tfor i < len(s) && s[i] >= '0' && s[i] <= '9' {");
    lines.push('\t\t\t\ti++');
    lines.push('\t\t\t}');
    lines.push('\t\t\tif i == dstart {');
    lines.push('\t\t\t\treturn false');
    lines.push('\t\t\t}');
    lines.push('\t\t}');
    lines.push('\t}');
    lines.push('\treturn i == len(s)');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkNoWsTail')) {
    lines.push('func checkNoWsTail(s string, offset int) bool {');
    lines.push('\tif offset >= len(s) {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\tfor _, r := range s[offset:] {');
    lines.push('\t\tif isEcmaWs(r) {');
    lines.push('\t\t\treturn false');
    lines.push('\t\t}');
    lines.push('\t}');
    lines.push('\treturn true');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkExternalIdentity')) {
    lines.push('func checkExternalIdentity(s string) bool {');
    lines.push('\tif len(s) == 0 {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\ti := 0');
    lines.push('\tfor i < len(s) {');
    lines.push('\t\tc := s[i]');
    lines.push("\t\tif (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '-' || c == '/' {");
    lines.push('\t\t\ti++');
    lines.push('\t\t} else {');
    lines.push('\t\t\tbreak');
    lines.push('\t\t}');
    lines.push('\t}');
    lines.push('\tif i == 0 {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push("\tif i >= len(s) || s[i] != ':' {");
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\ti++');
    lines.push('\tif i >= len(s) {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push("\tfor _, c := range s[i:] {");
    lines.push("\t\tif c == '\\n' {");
    lines.push('\t\t\treturn false');
    lines.push('\t\t}');
    lines.push('\t}');
    lines.push('\treturn true');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkPackageId')) {
    lines.push('func isPkgChar(c byte) bool {');
    lines.push("\treturn (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '+' || c == '-'");
    lines.push('}');
    lines.push('');
    lines.push('func checkPackageId(s string) bool {');
    lines.push('\tif len(s) == 0 {');
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push("\tif s == \"#\" {");
    lines.push('\t\treturn true');
    lines.push('\t}');
    lines.push('\ti := 0');
    lines.push("\tif !((s[i] >= 'a' && s[i] <= 'z') || (s[i] >= 'A' && s[i] <= 'Z') || (s[i] >= '0' && s[i] <= '9')) {");
    lines.push('\t\treturn false');
    lines.push('\t}');
    lines.push('\ti++');
    lines.push('\tfor i < len(s) && isPkgChar(s[i]) {');
    lines.push('\t\ti++');
    lines.push('\t}');
    lines.push("\tfor i < len(s) && s[i] == ':' {");
    lines.push('\t\ti++');
    lines.push('\t\tif i >= len(s) {');
    lines.push('\t\t\treturn false');
    lines.push('\t\t}');
    lines.push("\t\tif !((s[i] >= 'a' && s[i] <= 'z') || (s[i] >= 'A' && s[i] <= 'Z') || (s[i] >= '0' && s[i] <= '9')) {");
    lines.push('\t\t\treturn false');
    lines.push('\t\t}');
    lines.push('\t\ti++');
    lines.push('\t\tfor i < len(s) && isPkgChar(s[i]) {');
    lines.push('\t\t\ti++');
    lines.push('\t\t}');
    lines.push('\t}');
    lines.push('\treturn i == len(s)');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkImetaDim')) {
    lines.push('');
    lines.push('func checkImetaDim(s string) bool {');
    lines.push('\tif len(s) < 7 { return false }');
    lines.push('\tif s[:4] != "dim " { return false }');
    lines.push('\ti := 4');
    lines.push('\tdc := 0');
    lines.push('\tfor i < len(s) && s[i] >= \'0\' && s[i] <= \'9\' { i++; dc++ }');
    lines.push('\tif dc < 1 || dc > 5 { return false }');
    lines.push('\tif i >= len(s) || s[i] != \'x\' { return false }');
    lines.push('\ti++; dc = 0');
    lines.push('\tfor i < len(s) && s[i] >= \'0\' && s[i] <= \'9\' { i++; dc++ }');
    lines.push('\tif dc < 1 || dc > 5 { return false }');
    lines.push('\treturn i == len(s)');
    lines.push('}');
  }

  return lines.join('\n');
}
