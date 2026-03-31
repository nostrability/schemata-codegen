/**
 * Kotlin validator emitter: ValidatorAction[] → .kt file
 *
 * Generates Kotlin code using expression-oriented style with .any { } lambdas,
 * getOrNull() for safe tag access, and when() for dispatch.
 *
 * Tag type: List<List<String>> (list of string lists).
 * Error type: data class ValidationError(val path: String, val message: String)
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

function renderPatternCheckKotlin(check: PatternCheck, varExpr: string): { expr: string; helpers: Set<string> } {
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
      return { expr: `checkHexPrefixed(${varExpr}, ${JSON.stringify(check.prefix)}, ${check.hexLen})`, helpers };
    }
    case 'all_digits': {
      const fn = check.allowNeg ? 'checkSignedInt' : 'checkDigits';
      helpers.add(fn);
      return { expr: `${fn}(${varExpr})`, helpers };
    }
    case 'starts_with_any': {
      const checks = check.prefixes.map(p => `${varExpr}.startsWith(${JSON.stringify(p)})`);
      return { expr: checks.length === 1 ? checks[0] : `(${checks.join(' || ')})`, helpers };
    }
    case 'chars_in': {
      if (check.min === 0 && check.max === 0) {
        return { expr: `${varExpr}.isEmpty()`, helpers };
      }
      helpers.add('checkCharsIn');
      return {
        expr: `checkCharsIn(${varExpr}, ${JSON.stringify(check.charset)}, ${check.min ?? 0}, ${check.max ?? 'Int.MAX_VALUE'})`,
        helpers,
      };
    }
    case 'bech32': {
      helpers.add('checkBech32');
      if (check.dataLen !== undefined) {
        return { expr: `checkBech32(${varExpr}, ${JSON.stringify(check.hrp + '1')}, ${check.dataLen})`, helpers };
      }
      return { expr: `checkBech32(${varExpr}, ${JSON.stringify(check.hrp + '1')})`, helpers };
    }
    case 'regex': {
      helpers.add('regex');
      return { expr: `Regex(${JSON.stringify(check.pattern)}).matches(${varExpr})`, helpers };
    }
    case 'relay_url': {
      helpers.add('checkRelayUrl');
      return { expr: `checkRelayUrl(${varExpr})`, helpers };
    }
    case 'a_tag': {
      helpers.add('checkATag');
      if (check.kinds && check.kinds.length > 0) {
        return { expr: `checkATag(${varExpr}, listOf(${check.kinds.join(', ')}))`, helpers };
      }
      return { expr: `checkATag(${varExpr}, null)`, helpers };
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
      const len = check.prefix.length;
      return {
        expr: `(${varExpr}.startsWith(${JSON.stringify(check.prefix)}) && ${varExpr}.length > ${len})`,
        helpers,
      };
    }
    case 'wrapped': {
      helpers.add('checkWrapped');
      return { expr: `checkWrapped(${varExpr}, ${JSON.stringify(check.prefix)}, ${JSON.stringify(check.suffix)})`, helpers };
    }
    case 'csv_list': {
      helpers.add('checkCsvList');
      return { expr: `checkCsvList(${varExpr}, ${JSON.stringify(check.itemCharset)})`, helpers };
    }
    case 'ln_invoice': {
      helpers.add('checkLnInvoice');
      helpers.add('checkBech32'); // triggers isBech32Char
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
      helpers.add('isAsciiWs');
      return { expr: `checkEmailLike(${varExpr})`, helpers };
    }
    case 'git_clone_url': {
      helpers.add('checkGitCloneUrl');
      helpers.add('isAsciiWs');
      return { expr: `checkGitCloneUrl(${varExpr})`, helpers };
    }
    case 'content_type': {
      helpers.add('checkContentType');
      return { expr: `checkContentType(${varExpr})`, helpers };
    }
    case 'doi': {
      helpers.add('checkDoi');
      helpers.add('checkRelayUrl'); // triggers checkDotTail
      return { expr: `checkDoi(${varExpr})`, helpers };
    }
    case 'annotate_user': {
      helpers.add('checkAnnotateUser');
      return { expr: `checkAnnotateUser(${varExpr})`, helpers };
    }
    case 'prefix_no_whitespace': {
      helpers.add('checkNoWsTail');
      helpers.add('isAsciiWs');
      const checks = check.prefixes.map(p =>
        `(${varExpr}.startsWith(${JSON.stringify(p)}) && checkNoWsTail(${varExpr}, ${p.length}))`
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
        const r = renderPatternCheckKotlin(sub, varExpr);
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

function renderValueCheckKotlin(
  check: ValueCheck,
  tagVar: string,
  index: number,
): { expr: string; helpers: Set<string> } {
  const helpers = new Set<string>();
  const access = `${tagVar}.getOrNull(${index})`;

  switch (check.type) {
    case 'const':
      return { expr: `${access} == ${JSON.stringify(check.value)}`, helpers };
    case 'enum': {
      const vals = check.values.map(v => JSON.stringify(v));
      return {
        expr: `${access} in listOf(${vals.join(', ')})`,
        helpers,
      };
    }
    case 'pattern': {
      const r = renderPatternCheckKotlin(check.native, 'v');
      for (const h of r.helpers) helpers.add(h);
      return {
        expr: `${access}?.let { v -> ${r.expr} } ?: false`,
        helpers,
      };
    }
    case 'anyOf': {
      const parts: string[] = [];
      for (const alt of check.alternatives) {
        const r = renderValueCheckKotlin(alt, tagVar, index);
        parts.push(r.expr);
        for (const h of r.helpers) helpers.add(h);
      }
      return { expr: `(${parts.join(' || ')})`, helpers };
    }
  }
}

function describePositionConstraintKotlin(pc: PositionCheck, tagName: string): string {
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

function renderTagMatcherKotlin(
  matcher: TagMatcher,
  tagVar: string,
  helpers: Set<string>,
): string {
  const checks: string[] = [];

  checks.push(`${tagVar}.firstOrNull() == ${JSON.stringify(matcher.tagName)}`);
  checks.push(`${tagVar}.size >= ${matcher.minItems}`);
  if (matcher.maxItems !== undefined) {
    checks.push(`${tagVar}.size <= ${matcher.maxItems}`);
  }

  for (const pc of matcher.positionChecks) {
    const r = renderValueCheckKotlin(pc.check, tagVar, pc.index);
    for (const h of r.helpers) helpers.add(h);
    checks.push(r.expr);
  }

  return checks.join(' && ');
}

// --- Main emitter ---

export function emitKotlinValidators(kindShapes: KindShape[]): string {
  const allHelpers = new Set<string>();
  const fnBodies: string[] = [];
  const constrainedKinds: { kindNumber: number; nip: string }[] = [];

  for (const shape of [...kindShapes].sort((a, b) => a.kindNumber - b.kindNumber)) {
    const actions = planKindValidator(shape);
    if (!actions) continue;

    constrainedKinds.push({ kindNumber: shape.kindNumber, nip: shape.nip });
    const { code, helpers } = emitKindFunctionKotlin(shape.kindNumber, shape.nip, actions);
    fnBodies.push(code);
    for (const h of helpers) allHelpers.add(h);
  }

  return emitKotlinFile(fnBodies, constrainedKinds, allHelpers);
}

function emitKindFunctionKotlin(
  kindNumber: number,
  nip: string,
  actions: ValidatorAction[],
): { code: string; helpers: Set<string> } {
  const helpers = new Set<string>();
  const lines: string[] = [];

  lines.push(`/** Validate tags for kind ${kindNumber} (${nip}) */`);
  lines.push(`fun validateKind${kindNumber}(tags: List<List<String>>): List<ValidationError> {`);
  lines.push('    val errors = mutableListOf<ValidationError>()');

  for (const action of actions) {
    switch (action.type) {
      case 'check_min_tags':
        lines.push(`    if (tags.size < ${action.min}) {`);
        lines.push(`        errors.add(ValidationError("tags", "tags must have at least ${action.min} item(s)"))`);
        lines.push('    }');
        break;

      case 'require_tag': {
        const matcherExpr = renderTagMatcherKotlin(action.matcher, 't', helpers);
        lines.push(`    if (!tags.any { t -> ${matcherExpr} }) {`);
        lines.push(`        errors.add(ValidationError("tags", ${JSON.stringify(action.errorMsg)}))`);
        lines.push('    }');
        break;
      }

      case 'validate_optional_positions': {
        lines.push('    for (t in tags) {');
        lines.push(`        if (t.firstOrNull() == ${JSON.stringify(action.tagName)}) {`);
        for (const pc of action.checks) {
          const r = renderValueCheckKotlin(pc.check, 't', pc.index);
          for (const h of r.helpers) helpers.add(h);
          const msg = describePositionConstraintKotlin(pc, action.tagName);
          lines.push(`            if (t.size > ${pc.index} && !(${r.expr})) {`);
          lines.push(`                errors.add(ValidationError("tags", ${JSON.stringify(msg)}))`);
          lines.push('            }');
        }
        lines.push('        }');
        lines.push('    }');
        break;
      }

      case 'per_item_conditional': {
        const matcherExpr = renderTagMatcherKotlin(action.matcher, 't', helpers);
        lines.push('    for (t in tags) {');
        lines.push(`        if (t.firstOrNull() == ${JSON.stringify(action.condTag)} && !(${matcherExpr})) {`);
        lines.push(`            errors.add(ValidationError("tags", ${JSON.stringify(action.errorMsg)}))`);
        lines.push('        }');
        if (action.optChecks.length > 0) {
          lines.push(`        if (t.firstOrNull() == ${JSON.stringify(action.condTag)}) {`);
          for (const pc of action.optChecks) {
            const r = renderValueCheckKotlin(pc.check, 't', pc.index);
            for (const h of r.helpers) helpers.add(h);
            const msg = describePositionConstraintKotlin(pc, action.condTag);
            lines.push(`            if (t.size > ${pc.index} && !(${r.expr})) {`);
            lines.push(`                errors.add(ValidationError("tags", ${JSON.stringify(msg)}))`);
            lines.push('            }');
          }
          lines.push('        }');
        }
        lines.push('    }');
        break;
      }

      case 'array_level_conditional': {
        lines.push(`    if (tags.any { t -> t.firstOrNull() == ${JSON.stringify(action.condTag)} }) {`);
        const matcherExpr = renderTagMatcherKotlin(action.matcher, 't', helpers);
        lines.push(`        if (!tags.any { t -> ${matcherExpr} }) {`);
        lines.push(`            errors.add(ValidationError("tags", ${JSON.stringify(action.errorMsg)}))`);
        lines.push('        }');
        if (action.optChecks.length > 0) {
          lines.push('        for (t in tags) {');
          lines.push(`            if (t.firstOrNull() == ${JSON.stringify(action.matcher.tagName)}) {`);
          for (const pc of action.optChecks) {
            const r = renderValueCheckKotlin(pc.check, 't', pc.index);
            for (const h of r.helpers) helpers.add(h);
            const msg = describePositionConstraintKotlin(pc, action.matcher.tagName);
            lines.push(`                if (t.size > ${pc.index} && !(${r.expr})) {`);
            lines.push(`                    errors.add(ValidationError("tags", ${JSON.stringify(msg)}))`);
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
          const expr = renderTagMatcherKotlin(m, 't', helpers);
          return `tags.any { t -> ${expr} }`;
        });
        lines.push(`    if (!(${matchers.join(' || ')})) {`);
        lines.push(`        errors.add(ValidationError("tags", ${JSON.stringify(action.errorMsg)}))`);
        lines.push('    }');
        break;
      }
    }
  }

  lines.push('    return errors');
  lines.push('}');

  return { code: lines.join('\n'), helpers };
}

// --- File generation ---

function emitKotlinFile(
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
  ];

  if (needsRegex) {
    lines.push('import kotlin.text.Regex');
    lines.push('');
  }

  lines.push('data class ValidationError(val path: String, val message: String)');
  lines.push('');

  lines.push(emitKotlinHelpers(helpers));

  for (const fn of fnBodies) {
    lines.push(fn);
    lines.push('');
  }

  lines.push('/** Validate tags for a given kind number.');
  lines.push(' *  Returns empty list if kind has no constraints or is unknown. */');
  lines.push('fun validateKindTags(kind: Int, tags: List<List<String>>): List<ValidationError> = when (kind) {');
  for (const k of constrainedKinds) {
    lines.push(`    ${k.kindNumber} -> validateKind${k.kindNumber}(tags)`);
  }
  lines.push('    else -> emptyList()');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

function emitKotlinHelpers(helpers: Set<string>): string {
  const lines: string[] = [];

  const hexLengths = new Set<number>();
  const hexMixedLengths = new Set<number>();
  for (const h of helpers) {
    const m = h.match(/^checkHex(\d+)$/);
    if (m) hexLengths.add(parseInt(m[1], 10));
    const mm = h.match(/^checkHex(\d+)Mixed$/);
    if (mm) hexMixedLengths.add(parseInt(mm[1], 10));
  }

  for (const len of [...hexLengths].sort((a, b) => a - b)) {
    lines.push(`private fun checkHex${len}(s: String): Boolean =`);
    lines.push(`    s.length == ${len} && s.all { it in '0'..'9' || it in 'a'..'f' }`);
    lines.push('');
  }

  for (const len of [...hexMixedLengths].sort((a, b) => a - b)) {
    lines.push(`private fun checkHex${len}Mixed(s: String): Boolean =`);
    lines.push(`    s.length == ${len} && s.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }`);
    lines.push('');
  }

  if (helpers.has('checkHexRange')) {
    lines.push('private fun checkHexRange(s: String, min: Int, max: Int): Boolean =');
    lines.push("    s.length in min..max && s.all { it in '0'..'9' || it in 'a'..'f' }");
    lines.push('');
  }

  if (helpers.has('checkHexRangeMixed')) {
    lines.push('private fun checkHexRangeMixed(s: String, min: Int, max: Int): Boolean =');
    lines.push("    s.length in min..max && s.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }");
    lines.push('');
  }

  if (helpers.has('checkHexPrefixed')) {
    lines.push('private fun checkHexPrefixed(s: String, prefix: String, hexLen: Int): Boolean =');
    lines.push("    s.startsWith(prefix) && s.length == prefix.length + hexLen && s.substring(prefix.length).all { it in '0'..'9' || it in 'a'..'f' }");
    lines.push('');
  }

  if (helpers.has('checkDigits')) {
    lines.push('private fun checkDigits(s: String): Boolean =');
    lines.push("    s.isNotEmpty() && s.all { it in '0'..'9' }");
    lines.push('');
  }

  if (helpers.has('checkSignedInt')) {
    lines.push('private fun checkSignedInt(s: String): Boolean {');
    lines.push('    val v = if (s.startsWith("-")) s.substring(1) else s');
    lines.push("    return v.isNotEmpty() && v.all { it in '0'..'9' }");
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkCharsIn')) {
    lines.push('private fun checkCharsIn(s: String, charset: String, min: Int, max: Int): Boolean =');
    lines.push('    s.length in min..max && s.all { it in charset }');
    lines.push('');
  }

  if (helpers.has('checkDateIso')) {
    lines.push('private fun checkDateIso(s: String): Boolean {');
    lines.push("    if (s.length != 10 || s[4] != '-' || s[7] != '-') return false");
    lines.push('    for (i in 0 until 10) {');
    lines.push('        if (i == 4 || i == 7) continue');
    lines.push("        if (s[i] < '0' || s[i] > '9') return false");
    lines.push('    }');
    lines.push('    return true');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkDecimal')) {
    lines.push('private fun checkDecimal(s: String): Boolean {');
    lines.push('    if (s.isEmpty()) return false');
    lines.push('    var i = 0');
    lines.push("    while (i < s.length && s[i] in '0'..'9') i++");
    lines.push("    if (i == 0) return false");
    lines.push("    if (i < s.length && s[i] == '.') {");
    lines.push('        i++');
    lines.push("        if (i >= s.length || s[i] !in '0'..'9') return false");
    lines.push("        while (i < s.length && s[i] in '0'..'9') i++");
    lines.push('    }');
    lines.push('    return i == s.length');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkRelayUrl') || helpers.has('checkATag')) {
    lines.push('private fun checkDotTail(s: String, pos: Int): Boolean {');
    lines.push('    if (pos >= s.length) return false');
    lines.push('    for (j in pos until s.length) {');
    lines.push("        if (s[j] == '\\n' || s[j] == '\\r' || s[j] == '\\u0085' || s[j] == '\\u2028' || s[j] == '\\u2029') return false");
    lines.push('    }');
    lines.push('    return true');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkRelayUrl')) {
    lines.push('private fun checkRelayUrl(s: String): Boolean {');
    lines.push('    val pos: Int');
    lines.push('    if (s.startsWith("wss://")) { pos = 6 }');
    lines.push('    else if (s.startsWith("ws://")) { pos = 5 }');
    lines.push('    else { return false }');
    lines.push('    var i = pos');
    lines.push('    while (i < s.length) {');
    lines.push('        val c = s[i]');
    lines.push("        if (c in 'a'..'z' || c in 'A'..'Z' || c in '0'..'9' || c == '.' || c == '_' || c == '-') { i++ }");
    lines.push('        else { break }');
    lines.push('    }');
    lines.push('    if (i == pos) return false');
    lines.push("    if (i < s.length && s[i] == ':') {");
    lines.push('        i++');
    lines.push('        val portStart = i');
    lines.push("        while (i < s.length && s[i] in '0'..'9') i++");
    lines.push('        if (i == portStart) return false');
    lines.push('    }');
    lines.push("    if (i < s.length && s[i] == '/') {");
    lines.push('        return checkDotTail(s, i + 1) || i + 1 == s.length');
    lines.push('    }');
    lines.push('    return i == s.length');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkATag')) {
    lines.push('private fun checkATag(s: String, kinds: List<Int>?): Boolean {');
    lines.push('    if (s.length < 68) return false');
    lines.push('    var pos = 0');
    lines.push("    if (s[pos] < '0' || s[pos] > '9') return false");
    lines.push('    var kind = 0');
    lines.push("    while (pos < s.length && s[pos] in '0'..'9') {");
    lines.push("        kind = kind * 10 + (s[pos] - '0')");
    lines.push('        pos++');
    lines.push('    }');
    lines.push("    if (pos >= s.length || s[pos] != ':') return false");
    lines.push('    if (kinds != null && kind !in kinds) return false');
    lines.push('    pos++');
    lines.push('    if (pos + 64 >= s.length) return false');
    lines.push('    for (i in 0 until 64) {');
    lines.push('        val c = s[pos + i]');
    lines.push("        if (!((c in '0'..'9') || (c in 'a'..'f'))) return false");
    lines.push('    }');
    lines.push('    pos += 64');
    lines.push("    if (pos >= s.length || s[pos] != ':') return false");
    lines.push('    pos++');
    lines.push('    return checkDotTail(s, pos)');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkDatetimeIso')) {
    lines.push('private fun checkDatetimeIso(s: String): Boolean {');
    lines.push('    if (s.length < 10) return false');
    lines.push("    for (i in 0..3) if (s[i] < '0' || s[i] > '9') return false");
    lines.push("    if (s[4] != '-') return false");
    lines.push("    for (i in 5..6) if (s[i] < '0' || s[i] > '9') return false");
    lines.push("    if (s[7] != '-') return false");
    lines.push("    for (i in 8..9) if (s[i] < '0' || s[i] > '9') return false");
    lines.push('    if (s.length == 10) return true');
    lines.push("    if (s[10] != 'T' || s.length < 16) return false");
    lines.push("    for (i in 11..12) if (s[i] < '0' || s[i] > '9') return false");
    lines.push("    if (s[13] != ':') return false");
    lines.push("    for (i in 14..15) if (s[i] < '0' || s[i] > '9') return false");
    lines.push('    var pos = 16');
    lines.push('    if (pos == s.length) return true');
    lines.push("    if (s[pos] == ':') {");
    lines.push('        if (pos + 3 > s.length) return false');
    lines.push("        if (s[pos+1] < '0' || s[pos+1] > '9' || s[pos+2] < '0' || s[pos+2] > '9') return false");
    lines.push('        pos += 3');
    lines.push('    }');
    lines.push('    if (pos == s.length) return true');
    lines.push("    if (s[pos] == '.') {");
    lines.push('        pos++');
    lines.push("        if (pos >= s.length || s[pos] < '0' || s[pos] > '9') return false");
    lines.push("        while (pos < s.length && s[pos] in '0'..'9') pos++");
    lines.push('    }');
    lines.push('    if (pos == s.length) return true');
    lines.push("    if (s[pos] == 'Z') return pos + 1 == s.length");
    lines.push("    if (s[pos] == '+' || s[pos] == '-') {");
    lines.push('        if (pos + 6 != s.length) return false');
    lines.push("        if (s[pos+1] < '0' || s[pos+1] > '9' || s[pos+2] < '0' || s[pos+2] > '9') return false");
    lines.push("        if (s[pos+3] != ':') return false");
    lines.push("        return s[pos+4] >= '0' && s[pos+4] <= '9' && s[pos+5] >= '0' && s[pos+5] <= '9'");
    lines.push('    }');
    lines.push('    return false');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkBech32')) {
    lines.push('private fun isBech32Char(c: Char): Boolean =');
    lines.push("    (c in '0'..'9' && c != '1') || (c in 'a'..'z' && c != 'b' && c != 'i' && c != 'o')");
    lines.push('');
    lines.push('private fun checkBech32(s: String, prefix: String, dataLen: Int = -1): Boolean {');
    lines.push('    if (!s.startsWith(prefix)) return false');
    lines.push('    val data = s.substring(prefix.length)');
    lines.push('    if (data.isEmpty() || !data.all { isBech32Char(it) }) return false');
    lines.push('    if (dataLen >= 0) return data.length == dataLen');
    lines.push('    return true');
    lines.push('}');
    lines.push('');
  }

  // Note: regex helper is not needed as a standalone function in Kotlin;
  // we inline Regex(pattern).matches(s) directly.

  if (helpers.has('isAsciiWs')) {
    lines.push('private fun isAsciiWs(c: Char): Boolean =');
    lines.push("    c == ' ' || c == '\\t' || c == '\\n' || c == '\\r' || c == '\\u000B' || c == '\\u000C'");
    lines.push('');
  }

  if (helpers.has('checkWrapped')) {
    lines.push('private fun checkWrapped(s: String, prefix: String, suffix: String): Boolean =');
    lines.push('    s.length >= prefix.length + suffix.length && s.startsWith(prefix) && s.endsWith(suffix)');
    lines.push('');
  }

  if (helpers.has('checkCsvList')) {
    lines.push('private fun checkCsvList(s: String, charset: String): Boolean {');
    lines.push('    if (s.isEmpty()) return false');
    lines.push('    var i = 0');
    lines.push('    while (true) {');
    lines.push('        val start = i');
    lines.push('        while (i < s.length && s[i] in charset) i++');
    lines.push('        if (i == start) return false');
    lines.push('        if (i == s.length) return true');
    lines.push("        if (s[i] != ',') return false");
    lines.push('        i++');
    lines.push('    }');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkLnInvoice')) {
    lines.push('private fun checkLnInvoice(s: String, prefix: String, minHrpLen: Int): Boolean {');
    lines.push('    if (!s.startsWith(prefix)) return false');
    lines.push("    val sep = s.lastIndexOf('1')");
    lines.push('    if (sep < 0) return false');
    lines.push('    if (sep < minHrpLen) return false');
    lines.push('    for (j in 0 until sep) {');
    lines.push('        val c = s[j]');
    lines.push("        if (!((c in 'a'..'z') || (c in '0'..'9'))) return false");
    lines.push('    }');
    lines.push('    if (sep + 1 >= s.length) return false');
    lines.push('    for (j in (sep + 1) until s.length) {');
    lines.push('        if (!isBech32Char(s[j])) return false');
    lines.push('    }');
    lines.push('    return true');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkMimeType')) {
    lines.push('private fun checkMimeType(s: String): Boolean {');
    lines.push('    var i = 0');
    lines.push("    if (i >= s.length || s[i] !in 'a'..'z') return false");
    lines.push("    while (i < s.length && s[i] in 'a'..'z') i++");
    lines.push("    if (i >= s.length || s[i] != '/') return false");
    lines.push('    i++');
    lines.push('    val subStart = i');
    lines.push('    while (i < s.length) {');
    lines.push('        val c = s[i]');
    lines.push("        if (c in 'a'..'z' || c in '0'..'9' || c == '.' || c == '+' || c == '-') i++");
    lines.push('        else break');
    lines.push('    }');
    lines.push('    if (i == subStart) return false');
    lines.push('    return i == s.length');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkHttpOrigin')) {
    lines.push('private fun checkHttpOrigin(s: String): Boolean {');
    lines.push('    val pos: Int');
    lines.push('    if (s.startsWith("https://")) { pos = 8 }');
    lines.push('    else if (s.startsWith("http://")) { pos = 7 }');
    lines.push('    else { return false }');
    lines.push('    var i = pos');
    lines.push("    while (i < s.length && s[i] != '/') i++");
    lines.push('    if (i == pos) return false');
    lines.push("    if (i < s.length && s[i] == '/') i++");
    lines.push('    return i == s.length');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkEmailLike')) {
    lines.push('private fun checkEmailLike(s: String): Boolean {');
    lines.push('    var i = 0');
    lines.push("    while (i < s.length && !isAsciiWs(s[i]) && s[i] != '@') i++");
    lines.push('    if (i == 0) return false');
    lines.push("    if (i >= s.length || s[i] != '@') return false");
    lines.push('    i++');
    lines.push('    val afterAt = i');
    lines.push("    while (i < s.length && !isAsciiWs(s[i]) && s[i] != '@') i++");
    lines.push('    if (i == afterAt) return false');
    lines.push('    return i == s.length');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkGitCloneUrl')) {
    lines.push('private fun checkGitCloneUrl(s: String): Boolean {');
    lines.push('    var pos = 0');
    lines.push('    if (s.startsWith("git@")) { pos = 4 }');
    lines.push('    else {');
    lines.push("        if (s.isEmpty() || s[0] !in 'a'..'z') return false");
    lines.push('        pos = 1');
    lines.push('        while (pos < s.length) {');
    lines.push('            val c = s[pos]');
    lines.push("            if (c in 'a'..'z' || c in '0'..'9' || c == '+' || c == '.' || c == '-') pos++");
    lines.push('            else break');
    lines.push('        }');
    lines.push('        if (pos + 3 > s.length || s.substring(pos, pos + 3) != "://") return false');
    lines.push('        pos += 3');
    lines.push('    }');
    lines.push('    if (pos >= s.length) return false');
    lines.push('    for (j in pos until s.length) {');
    lines.push('        if (isAsciiWs(s[j])) return false');
    lines.push('    }');
    lines.push('    return true');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkContentType')) {
    lines.push('private fun isTypeChar(c: Char): Boolean =');
    lines.push("    c in 'a'..'z' || c in 'A'..'Z' || c in '0'..'9' || c == '!' || c == '#' || c == '$' || c == '&' || c == '^' || c == '_' || c == '-'");
    lines.push('');
    lines.push('private fun isSubtypeChar(c: Char): Boolean =');
    lines.push("    isTypeChar(c) || c == '.' || c == '+'");
    lines.push('');
    lines.push('private fun checkContentType(s: String): Boolean {');
    lines.push('    var i = 0');
    lines.push("    if (i >= s.length || !(s[i] in 'a'..'z' || s[i] in 'A'..'Z')) return false");
    lines.push('    i++');
    lines.push('    while (i < s.length && isTypeChar(s[i])) i++');
    lines.push("    if (i >= s.length || s[i] != '/') return false");
    lines.push('    i++');
    lines.push("    if (i >= s.length || !(s[i] in 'a'..'z' || s[i] in 'A'..'Z' || s[i] in '0'..'9' || s[i] == '*')) return false");
    lines.push('    i++');
    lines.push('    while (i < s.length && isSubtypeChar(s[i])) i++');
    lines.push("    while (i < s.length && (s[i] == ' ' || s[i] == '\\t' || s[i] == ';')) {");
    lines.push("        while (i < s.length && (s[i] == ' ' || s[i] == '\\t')) i++");
    lines.push("        if (i >= s.length || s[i] != ';') return false");
    lines.push('        i++');
    lines.push("        while (i < s.length && (s[i] == ' ' || s[i] == '\\t')) i++");
    lines.push('        val paramStart = i');
    lines.push('        while (i < s.length && isSubtypeChar(s[i])) i++');
    lines.push('        if (i == paramStart) return false');
    lines.push("        if (i >= s.length || s[i] != '=') return false");
    lines.push('        i++');
    lines.push('        val valStart = i');
    lines.push('        while (i < s.length && isSubtypeChar(s[i])) i++');
    lines.push('        if (i == valStart) return false');
    lines.push('    }');
    lines.push('    return i == s.length');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkDoi')) {
    lines.push('private fun checkDoi(s: String): Boolean {');
    lines.push('    if (s.length < 8 || !s.startsWith("10.")) return false');
    lines.push('    var i = 3');
    lines.push('    val digitStart = i');
    lines.push("    while (i < s.length && s[i] in '0'..'9') i++");
    lines.push('    val digitCount = i - digitStart');
    lines.push('    if (digitCount < 4 || digitCount > 9) return false');
    lines.push("    if (i >= s.length || s[i] != '/') return false");
    lines.push('    i++');
    lines.push('    return checkDotTail(s, i)');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkAnnotateUser')) {
    lines.push('private fun checkAnnotateUser(s: String): Boolean {');
    lines.push('    // "annotate-user " (15 chars) + 64 hex + ":" + digit + ":" + digit = min 83');
    lines.push('    if (s.length < 83 || !s.startsWith("annotate-user ")) return false');
    lines.push('    for (j in 15 until 79) {');
    lines.push('        val c = s[j]');
    lines.push("        if (!((c in '0'..'9') || (c in 'a'..'f'))) return false");
    lines.push('    }');
    lines.push('    var pos = 79');
    lines.push('    for (coord in 0 until 2) {');
    lines.push("        if (pos >= s.length || s[pos] != ':') return false");
    lines.push('        pos++');
    lines.push('        val dstart = pos');
    lines.push("        while (pos < s.length && s[pos] in '0'..'9') pos++");
    lines.push('        if (pos == dstart) return false');
    lines.push("        if (pos < s.length && s[pos] == '.') {");
    lines.push('            pos++');
    lines.push("            while (pos < s.length && s[pos] in '0'..'9') pos++");
    lines.push('        }');
    lines.push('    }');
    lines.push('    return pos == s.length');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkNoWsTail')) {
    lines.push('private fun checkNoWsTail(s: String, offset: Int): Boolean {');
    lines.push('    if (offset >= s.length) return false');
    lines.push('    for (j in offset until s.length) {');
    lines.push('        if (isAsciiWs(s[j])) return false');
    lines.push('    }');
    lines.push('    return true');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkExternalIdentity')) {
    lines.push('private fun checkExternalIdentity(s: String): Boolean {');
    lines.push('    var i = 0');
    lines.push('    while (i < s.length) {');
    lines.push('        val c = s[i]');
    lines.push("        if (c in 'a'..'z' || c in '0'..'9' || c == '.' || c == '_' || c == '-' || c == '/') i++");
    lines.push('        else break');
    lines.push('    }');
    lines.push('    if (i == 0) return false');
    lines.push("    if (i >= s.length || s[i] != ':') return false");
    lines.push('    return i + 1 < s.length');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkImetaDim')) {
    lines.push('private fun checkImetaDim(s: String): Boolean {');
    lines.push('    // "dim " + at least 1 digit + "x" + at least 1 digit = min 7');
    lines.push('    if (s.length < 7 || !s.startsWith("dim ")) return false');
    lines.push('    var i = 4');
    lines.push('    val d1 = i');
    lines.push("    while (i < s.length && s[i] in '0'..'9') i++");
    lines.push('    val d1len = i - d1');
    lines.push('    if (d1len < 1 || d1len > 5) return false');
    lines.push("    if (i >= s.length || s[i] != 'x') return false");
    lines.push('    i++');
    lines.push('    val d2 = i');
    lines.push("    while (i < s.length && s[i] in '0'..'9') i++");
    lines.push('    val d2len = i - d2');
    lines.push('    if (d2len < 1 || d2len > 5) return false');
    lines.push('    return i == s.length');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkPackageId')) {
    lines.push('private fun isPkgIdChar(c: Char): Boolean =');
    lines.push("    c in 'A'..'Z' || c in 'a'..'z' || c in '0'..'9' || c == '.' || c == '_' || c == '+' || c == '-'");
    lines.push('');
    lines.push('private fun checkPackageId(s: String): Boolean {');
    lines.push('    if (s.isEmpty()) return false');
    lines.push('    if (s == "#") return true');
    lines.push('    var i = 0');
    lines.push("    if (!(s[i] in 'A'..'Z' || s[i] in 'a'..'z' || s[i] in '0'..'9')) return false");
    lines.push('    i++');
    lines.push('    while (i < s.length && isPkgIdChar(s[i])) i++');
    lines.push("    while (i < s.length && s[i] == ':') {");
    lines.push('        i++');
    lines.push("        if (i >= s.length || !(s[i] in 'A'..'Z' || s[i] in 'a'..'z' || s[i] in '0'..'9')) return false");
    lines.push('        i++');
    lines.push('        while (i < s.length && isPkgIdChar(s[i])) i++');
    lines.push('    }');
    lines.push('    return i == s.length');
    lines.push('}');
    lines.push('');
  }

  return lines.join('\n');
}
