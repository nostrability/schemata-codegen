/**
 * Dart validator emitter: ValidatorAction[] → .dart file
 *
 * Generates Dart code for validating Nostr event tags.
 * Tags are List<List<String>>, individual tags are List<String>.
 *
 * Dart is expression-oriented: uses `.any((t) => ...)` for search,
 * single-quoted strings, `final` for local variables.
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

function renderPatternCheckDart(check: PatternCheck, varExpr: string): { expr: string; helpers: Set<string> } {
  const helpers = new Set<string>();
  switch (check.op) {
    case 'hex': {
      const fn = check.case === 'lower' ? `_checkHex${check.len}` : `_checkHex${check.len}Mixed`;
      helpers.add(fn);
      return { expr: `${fn}(${varExpr})`, helpers };
    }
    case 'hex_range': {
      const fn = check.case === 'lower' ? '_checkHexRange' : '_checkHexRangeMixed';
      helpers.add(fn);
      return { expr: `${fn}(${varExpr}, ${check.min}, ${check.max})`, helpers };
    }
    case 'hex_prefixed': {
      helpers.add('_checkHexPrefixed');
      return { expr: `_checkHexPrefixed(${varExpr}, ${dartString(check.prefix)}, ${check.hexLen})`, helpers };
    }
    case 'all_digits': {
      const fn = check.allowNeg ? '_checkSignedInt' : '_checkDigits';
      helpers.add(fn);
      return { expr: `${fn}(${varExpr})`, helpers };
    }
    case 'starts_with_any': {
      const checks = check.prefixes.map(p => `${varExpr}.startsWith(${dartString(p)})`);
      return { expr: checks.length === 1 ? checks[0] : `(${checks.join(' || ')})`, helpers };
    }
    case 'chars_in': {
      if (check.min === 0 && check.max === 0) {
        return { expr: `${varExpr}.isEmpty`, helpers };
      }
      helpers.add('_checkCharsIn');
      return {
        expr: `_checkCharsIn(${varExpr}, ${dartString(check.charset)}, ${check.min ?? 0}, ${check.max ?? (1 << 30)})`,
        helpers,
      };
    }
    case 'bech32': {
      helpers.add('_checkBech32');
      if (check.dataLen !== undefined) {
        return { expr: `_checkBech32(${varExpr}, ${dartString(check.hrp + '1')}, ${check.dataLen})`, helpers };
      }
      return { expr: `_checkBech32(${varExpr}, ${dartString(check.hrp + '1')})`, helpers };
    }
    case 'regex': {
      return { expr: `RegExp(${dartString(check.pattern)}).hasMatch(${varExpr})`, helpers };
    }
    case 'relay_url': {
      helpers.add('_checkRelayUrl');
      return { expr: `_checkRelayUrl(${varExpr})`, helpers };
    }
    case 'a_tag': {
      helpers.add('_checkATag');
      if (check.kinds && check.kinds.length > 0) {
        const arr = check.kinds.map(k => JSON.stringify(k)).join(', ');
        return { expr: `_checkATag(${varExpr}, <String>[${arr}])`, helpers };
      }
      return { expr: `_checkATag(${varExpr}, null)`, helpers };
    }
    case 'date_iso': {
      helpers.add('_checkDateIso');
      return { expr: `_checkDateIso(${varExpr})`, helpers };
    }
    case 'datetime_iso': {
      helpers.add('_checkDatetimeIso');
      return { expr: `_checkDatetimeIso(${varExpr})`, helpers };
    }
    case 'decimal': {
      helpers.add('_checkDecimal');
      return { expr: `_checkDecimal(${varExpr})`, helpers };
    }
    case 'exact_values': {
      const vals = check.values.map(v => dartString(v));
      return { expr: `[${vals.join(', ')}].contains(${varExpr})`, helpers };
    }
    case 'prefix_nonempty': {
      helpers.add('_checkDotTail');
      return {
        expr: `${varExpr}.startsWith(${dartString(check.prefix)}) && ${varExpr}.length > ${check.prefix.length} && _checkDotTail(${varExpr}, ${check.prefix.length})`,
        helpers,
      };
    }
    case 'wrapped': {
      helpers.add('_checkWrapped');
      return { expr: `_checkWrapped(${varExpr}, ${dartString(check.prefix)}, ${dartString(check.suffix)})`, helpers };
    }
    case 'csv_list': {
      helpers.add('_checkCsvList');
      return { expr: `_checkCsvList(${varExpr}, ${dartString(check.itemCharset)})`, helpers };
    }
    case 'ln_invoice': {
      helpers.add('_checkLnInvoice');
      helpers.add('_isBech32Char');
      return { expr: `_checkLnInvoice(${varExpr}, ${dartString(check.prefix)}, ${check.minHrpLen})`, helpers };
    }
    case 'mime_type': {
      helpers.add('_checkMimeType');
      return { expr: `_checkMimeType(${varExpr})`, helpers };
    }
    case 'http_origin': {
      helpers.add('_checkHttpOrigin');
      return { expr: `_checkHttpOrigin(${varExpr})`, helpers };
    }
    case 'email_like': {
      helpers.add('_checkEmailLike');
      helpers.add('_isEcmaWs');
      return { expr: `_checkEmailLike(${varExpr})`, helpers };
    }
    case 'git_clone_url': {
      helpers.add('_checkGitCloneUrl');
      helpers.add('_isEcmaWs');
      return { expr: `_checkGitCloneUrl(${varExpr})`, helpers };
    }
    case 'content_type': {
      helpers.add('_checkContentType');
      helpers.add('_isEcmaWs');
      return { expr: `_checkContentType(${varExpr})`, helpers };
    }
    case 'doi': {
      helpers.add('_checkDoi');
      helpers.add('_checkDotTail');
      return { expr: `_checkDoi(${varExpr})`, helpers };
    }
    case 'annotate_user': {
      helpers.add('_checkAnnotateUser');
      return { expr: `_checkAnnotateUser(${varExpr})`, helpers };
    }
    case 'prefix_no_whitespace': {
      helpers.add('_checkNoWsTail');
      helpers.add('_isEcmaWs');
      const checks = check.prefixes.map(p =>
        `(${varExpr}.startsWith(${dartString(p)}) && _checkNoWsTail(${varExpr}, ${p.length}))`
      );
      return { expr: checks.length === 1 ? checks[0] : `(${checks.join(' || ')})`, helpers };
    }
    case 'external_identity': {
      helpers.add('_checkExternalIdentity');
      return { expr: `_checkExternalIdentity(${varExpr})`, helpers };
    }
    case 'package_id': {
      helpers.add('_checkPackageId');
      return { expr: `_checkPackageId(${varExpr})`, helpers };
    }
    case 'imeta_dim': {
      helpers.add('_checkImetaDim');
      return { expr: `_checkImetaDim(${varExpr})`, helpers };
    }
    case 'dim': {
      helpers.add('_checkDim');
      return { expr: `_checkDim(${varExpr})`, helpers };
    }
    case 'no_uppercase': {
      helpers.add('_checkNoUppercase');
      return { expr: `_checkNoUppercase(${varExpr})`, helpers };
    }
    case 'dotted_digits': {
      helpers.add('_checkDottedDigits');
      return { expr: `_checkDottedDigits(${varExpr})`, helpers };
    }
    case 'slash_segments': {
      helpers.add('_checkSlashSegments');
      return { expr: `_checkSlashSegments(${varExpr}, ${dartString(check.charset)})`, helpers };
    }
    case 'space_separated_tokens': {
      helpers.add('_checkSpaceSeparatedTokens');
      helpers.add('_isEcmaWs');
      return { expr: `_checkSpaceSeparatedTokens(${varExpr})`, helpers };
    }
    case 'starts_with_charset': {
      helpers.add('_checkStartsWithCharset');
      return { expr: `_checkStartsWithCharset(${varExpr}, ${dartString(check.charset)})`, helpers };
    }
    case 'base64': {
      helpers.add('_checkBase64');
      return { expr: `_checkBase64(${varExpr})`, helpers };
    }
    case 'hex_alternation': {
      const fns = check.lengths.map(len => {
        const fn = check.case === 'lower' ? `_checkHex${len}` : `_checkHex${len}Mixed`;
        helpers.add(fn);
        return `${fn}(${varExpr})`;
      });
      return { expr: `(${fns.join(' || ')})`, helpers };
    }
    case 'base64_2pad': {
      helpers.add('_checkBase642Pad');
      helpers.add('_isB64Char');
      return { expr: `_checkBase642Pad(${varExpr})`, helpers };
    }
    case 'nostr_uri': {
      helpers.add('_checkNostrUri');
      helpers.add('_isBech32Char');
      return { expr: `_checkNostrUri(${varExpr})`, helpers };
    }
    case 'nip04_encrypted': {
      helpers.add('_checkNip04Encrypted');
      helpers.add('_isB64Char');
      return { expr: `_checkNip04Encrypted(${varExpr})`, helpers };
    }
    case 'nip05_identifier': {
      helpers.add('_checkNip05Identifier');
      return { expr: `_checkNip05Identifier(${varExpr})`, helpers };
    }
    case 'mime_type_strict': {
      helpers.add('_checkMimeTypeStrict');
      return { expr: `_checkMimeTypeStrict(${varExpr})`, helpers };
    }
    case 'prefix_delim_rest': {
      helpers.add('_checkPrefixDelimRest');
      return { expr: `_checkPrefixDelimRest(${varExpr}, ${dartString(check.charset)}, ${dartString(check.delimiter)})`, helpers };
    }
    case 'identifier': {
      helpers.add('_checkIdentifier');
      return { expr: `_checkIdentifier(${varExpr}, ${dartString(check.firstCharset)}, ${dartString(check.restCharset)}${check.optionalPrefix ? `, ${dartString(check.optionalPrefix)}` : ''})`, helpers };
    }
    case 'space_separated_charset': {
      helpers.add('_checkSpaceSeparatedCharset');
      return { expr: `_checkSpaceSeparatedCharset(${varExpr}, ${dartString(check.charset)})`, helpers };
    }
    case 'uri_scheme': {
      helpers.add('_checkUriScheme');
      return { expr: `_checkUriScheme(${varExpr})`, helpers };
    }
    case 'compound': {
      const allHelpers = new Set<string>();
      const parts: string[] = [];
      for (const sub of check.checks) {
        const r = renderPatternCheckDart(sub, varExpr);
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

function renderValueCheckDart(
  check: ValueCheck,
  tagVar: string,
  index: number,
): { expr: string; helpers: Set<string> } {
  const helpers = new Set<string>();

  switch (check.type) {
    case 'const':
      return { expr: `${tagVar}.length > ${index} && ${tagVar}[${index}] == ${dartString(check.value)}`, helpers };
    case 'enum': {
      const vals = check.values.map(v => dartString(v));
      return {
        expr: `${tagVar}.length > ${index} && [${vals.join(', ')}].contains(${tagVar}[${index}])`,
        helpers,
      };
    }
    case 'pattern': {
      const r = renderPatternCheckDart(check.native, 'v');
      for (const h of r.helpers) helpers.add(h);
      return {
        expr: `${tagVar}.length > ${index} && (() { final v = ${tagVar}[${index}]; return ${r.expr}; }())`,
        helpers,
      };
    }
    case 'anyOf': {
      const parts: string[] = [];
      for (const alt of check.alternatives) {
        const r = renderValueCheckDart(alt, tagVar, index);
        parts.push(r.expr);
        for (const h of r.helpers) helpers.add(h);
      }
      return { expr: `(${parts.join(' || ')})`, helpers };
    }
  }
}

function describePositionConstraintDart(pc: PositionCheck, tagName: string): string {
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

function renderTagMatcherDart(
  matcher: TagMatcher,
  tagVar: string,
  helpers: Set<string>,
): string {
  const checks: string[] = [];

  checks.push(`${tagVar}.isNotEmpty && ${tagVar}[0] == ${dartString(matcher.tagName)}`);
  checks.push(`${tagVar}.length >= ${matcher.minItems}`);
  if (matcher.maxItems !== undefined) {
    checks.push(`${tagVar}.length <= ${matcher.maxItems}`);
  }

  for (const pc of matcher.positionChecks) {
    const r = renderValueCheckDart(pc.check, tagVar, pc.index);
    for (const h of r.helpers) helpers.add(h);
    checks.push(r.expr);
  }

  return checks.join(' && ');
}

// --- Dart string helper ---

function dartString(s: string): string {
  const escaped = s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\$/g, '\\$')
    .replace(/\n/g, '\\n');
  return `'${escaped}'`;
}

// --- Main emitter ---

export function emitDartValidators(kindShapes: KindShape[]): string {
  const allHelpers = new Set<string>();
  const fnBodies: string[] = [];
  const constrainedKinds: { kindNumber: number; nip: string }[] = [];

  for (const shape of [...kindShapes].sort((a, b) => a.kindNumber - b.kindNumber)) {
    const actions = planKindValidator(shape);
    if (!actions) continue;

    constrainedKinds.push({ kindNumber: shape.kindNumber, nip: shape.nip });
    const { code, helpers } = emitKindFunctionDart(shape.kindNumber, shape.nip, actions);
    fnBodies.push(code);
    for (const h of helpers) allHelpers.add(h);
  }

  return emitDartFile(fnBodies, constrainedKinds, allHelpers);
}

function emitKindFunctionDart(
  kindNumber: number,
  nip: string,
  actions: ValidatorAction[],
): { code: string; helpers: Set<string> } {
  const helpers = new Set<string>();
  const lines: string[] = [];

  lines.push(`/// Validate tags for kind ${kindNumber} (${nip})`);
  lines.push(`List<ValidationError> validateKind${kindNumber}(List<List<String>> tags) {`);
  lines.push('  final errors = <ValidationError>[];');

  for (const action of actions) {
    switch (action.type) {
      case 'check_min_tags':
        lines.push(`  if (tags.length < ${action.min}) {`);
        lines.push(`    errors.add(ValidationError(path: 'tags', message: 'tags must have at least ${action.min} item(s)'));`);
        lines.push('  }');
        break;

      case 'require_tag': {
        const matcherExpr = renderTagMatcherDart(action.matcher, 't', helpers);
        lines.push(`  if (!tags.any((t) => ${matcherExpr})) {`);
        lines.push(`    errors.add(ValidationError(path: 'tags', message: ${dartString(action.errorMsg)}));`);
        lines.push('  }');
        break;
      }

      case 'validate_optional_positions': {
        lines.push('  for (final t in tags) {');
        lines.push(`    if (t.isNotEmpty && t[0] == ${dartString(action.tagName)}) {`);
        for (const pc of action.checks) {
          const r = renderValueCheckDart(pc.check, 't', pc.index);
          for (const h of r.helpers) helpers.add(h);
          const msg = describePositionConstraintDart(pc, action.tagName);
          lines.push(`      if (t.length > ${pc.index} && !(${r.expr})) {`);
          lines.push(`        errors.add(ValidationError(path: 'tags', message: ${dartString(msg)}));`);
          lines.push('      }');
        }
        lines.push('    }');
        lines.push('  }');
        break;
      }

      case 'per_item_conditional': {
        const matcherExpr = renderTagMatcherDart(action.matcher, 't', helpers);
        lines.push('  for (final t in tags) {');
        lines.push(`    if (t.isNotEmpty && t[0] == ${dartString(action.condTag)} && !(${matcherExpr})) {`);
        lines.push(`      errors.add(ValidationError(path: 'tags', message: ${dartString(action.errorMsg)}));`);
        lines.push('    }');
        if (action.optChecks.length > 0) {
          lines.push(`    if (t.isNotEmpty && t[0] == ${dartString(action.condTag)}) {`);
          for (const pc of action.optChecks) {
            const r = renderValueCheckDart(pc.check, 't', pc.index);
            for (const h of r.helpers) helpers.add(h);
            const msg = describePositionConstraintDart(pc, action.condTag);
            lines.push(`      if (t.length > ${pc.index} && !(${r.expr})) {`);
            lines.push(`        errors.add(ValidationError(path: 'tags', message: ${dartString(msg)}));`);
            lines.push('      }');
          }
          lines.push('    }');
        }
        lines.push('  }');
        break;
      }

      case 'array_level_conditional': {
        lines.push(`  if (tags.any((t) => t.isNotEmpty && t[0] == ${dartString(action.condTag)})) {`);
        const matcherExpr = renderTagMatcherDart(action.matcher, 't', helpers);
        lines.push(`    if (!tags.any((t) => ${matcherExpr})) {`);
        lines.push(`      errors.add(ValidationError(path: 'tags', message: ${dartString(action.errorMsg)}));`);
        lines.push('    }');
        if (action.optChecks.length > 0) {
          lines.push('    for (final t in tags) {');
          lines.push(`      if (t.isNotEmpty && t[0] == ${dartString(action.matcher.tagName)}) {`);
          for (const pc of action.optChecks) {
            const r = renderValueCheckDart(pc.check, 't', pc.index);
            for (const h of r.helpers) helpers.add(h);
            const msg = describePositionConstraintDart(pc, action.matcher.tagName);
            lines.push(`        if (t.length > ${pc.index} && !(${r.expr})) {`);
            lines.push(`          errors.add(ValidationError(path: 'tags', message: ${dartString(msg)}));`);
            lines.push('        }');
          }
          lines.push('      }');
          lines.push('    }');
        }
        lines.push('  }');
        break;
      }

      case 'any_of_group': {
        const matchers = action.matchers.map(m => {
          const expr = renderTagMatcherDart(m, 't', helpers);
          return `tags.any((t) => ${expr})`;
        });
        lines.push(`  if (!(${matchers.join(' || ')})) {`);
        lines.push(`    errors.add(ValidationError(path: 'tags', message: ${dartString(action.errorMsg)}));`);
        lines.push('  }');
        break;
      }
    }
  }

  lines.push('  return errors;');
  lines.push('}');

  return { code: lines.join('\n'), helpers };
}

// --- File generation ---

function emitDartFile(
  fnBodies: string[],
  constrainedKinds: { kindNumber: number; nip: string }[],
  helpers: Set<string>,
): string {
  const lines: string[] = [
    '// Auto-generated by @nostrability/schemata-codegen',
    '// Do not edit manually.',
    '//',
    '// Runtime validators for Nostr event tag constraints',
    '',
    'class ValidationError {',
    '  final String path;',
    '  final String message;',
    '  const ValidationError({required this.path, required this.message});',
    '}',
    '',
  ];

  lines.push(emitDartHelpers(helpers));

  for (const fn of fnBodies) {
    lines.push(fn);
    lines.push('');
  }

  lines.push('/// Validate tags for a given kind number.');
  lines.push('/// Returns empty list if kind has no constraints or is unknown.');
  lines.push('List<ValidationError> validateKindTags(int kind, List<List<String>> tags) {');
  lines.push('  switch (kind) {');
  for (const k of constrainedKinds) {
    lines.push(`    case ${k.kindNumber}: return validateKind${k.kindNumber}(tags);`);
  }
  lines.push('    default: return [];');
  lines.push('  }');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

function emitDartHelpers(helpers: Set<string>): string {
  const lines: string[] = [];

  const hexLengths = new Set<number>();
  const hexMixedLengths = new Set<number>();
  for (const h of helpers) {
    const m = h.match(/^_checkHex(\d+)$/);
    if (m) hexLengths.add(parseInt(m[1], 10));
    const mm = h.match(/^_checkHex(\d+)Mixed$/);
    if (mm) hexMixedLengths.add(parseInt(mm[1], 10));
  }

  for (const len of [...hexLengths].sort((a, b) => a - b)) {
    lines.push(`bool _checkHex${len}(String s) {`);
    lines.push(`  return s.length == ${len} && s.codeUnits.every((c) => (c >= 48 && c <= 57) || (c >= 97 && c <= 102));`);
    lines.push('}');
    lines.push('');
  }

  for (const len of [...hexMixedLengths].sort((a, b) => a - b)) {
    lines.push(`bool _checkHex${len}Mixed(String s) {`);
    lines.push(`  return s.length == ${len} && s.codeUnits.every((c) => (c >= 48 && c <= 57) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70));`);
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkHexRange')) {
    lines.push('bool _checkHexRange(String s, int min, int max) {');
    lines.push('  final len = s.length;');
    lines.push('  return len >= min && len <= max && s.codeUnits.every((c) => (c >= 48 && c <= 57) || (c >= 97 && c <= 102));');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkHexRangeMixed')) {
    lines.push('bool _checkHexRangeMixed(String s, int min, int max) {');
    lines.push('  final len = s.length;');
    lines.push('  return len >= min && len <= max && s.codeUnits.every((c) => (c >= 48 && c <= 57) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70));');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkHexPrefixed')) {
    lines.push('bool _checkHexPrefixed(String s, String prefix, int hexLen) {');
    lines.push('  if (!s.startsWith(prefix)) return false;');
    lines.push('  final hex = s.substring(prefix.length);');
    lines.push('  return hex.length == hexLen && hex.codeUnits.every((c) => (c >= 48 && c <= 57) || (c >= 97 && c <= 102));');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkDigits')) {
    lines.push('bool _checkDigits(String s) {');
    lines.push('  return s.isNotEmpty && s.codeUnits.every((c) => c >= 48 && c <= 57);');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkSignedInt')) {
    lines.push('bool _checkSignedInt(String s) {');
    lines.push("  final v = s.startsWith('-') ? s.substring(1) : s;");
    lines.push('  return v.isNotEmpty && v.codeUnits.every((c) => c >= 48 && c <= 57);');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkCharsIn')) {
    lines.push('bool _checkCharsIn(String s, String charset, int min, int max) {');
    lines.push('  final len = s.length;');
    lines.push('  return len >= min && len <= max && s.runes.every((r) => charset.contains(String.fromCharCode(r)));');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkDateIso')) {
    lines.push('bool _checkDateIso(String s) {');
    lines.push("  if (s.length != 10 || s[4] != '-' || s[7] != '-') return false;");
    lines.push('  for (int i = 0; i < 10; i++) {');
    lines.push('    if (i == 4 || i == 7) continue;');
    lines.push("    final c = s.codeUnitAt(i);");
    lines.push('    if (c < 48 || c > 57) return false;');
    lines.push('  }');
    lines.push('  return true;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkDatetimeIso')) {
    lines.push('bool _checkDatetimeIso(String s) {');
    lines.push('  if (s.length < 10) return false;');
    lines.push('  for (var i = 0; i < 4; i++) if (s.codeUnitAt(i) < 48 || s.codeUnitAt(i) > 57) return false;');
    lines.push("  if (s[4] != '-') return false;");
    lines.push('  for (var i = 5; i < 7; i++) if (s.codeUnitAt(i) < 48 || s.codeUnitAt(i) > 57) return false;');
    lines.push("  if (s[7] != '-') return false;");
    lines.push('  for (var i = 8; i < 10; i++) if (s.codeUnitAt(i) < 48 || s.codeUnitAt(i) > 57) return false;');
    lines.push('  if (s.length == 10) return true;');
    lines.push("  if (s[10] != 'T' || s.length < 16) return false;");
    lines.push('  for (var i = 11; i < 13; i++) if (s.codeUnitAt(i) < 48 || s.codeUnitAt(i) > 57) return false;');
    lines.push("  if (s[13] != ':') return false;");
    lines.push('  for (var i = 14; i < 16; i++) if (s.codeUnitAt(i) < 48 || s.codeUnitAt(i) > 57) return false;');
    lines.push('  var pos = 16;');
    lines.push('  if (pos == s.length) return true;');
    lines.push("  if (s[pos] == ':') {");
    lines.push('    if (pos + 3 > s.length) return false;');
    lines.push('    if (s.codeUnitAt(pos+1) < 48 || s.codeUnitAt(pos+1) > 57 || s.codeUnitAt(pos+2) < 48 || s.codeUnitAt(pos+2) > 57) return false;');
    lines.push('    pos += 3;');
    lines.push('  }');
    lines.push('  if (pos == s.length) return true;');
    lines.push("  if (s[pos] == '.') {");
    lines.push('    pos++;');
    lines.push('    if (pos >= s.length || s.codeUnitAt(pos) < 48 || s.codeUnitAt(pos) > 57) return false;');
    lines.push('    while (pos < s.length && s.codeUnitAt(pos) >= 48 && s.codeUnitAt(pos) <= 57) pos++;');
    lines.push('  }');
    lines.push('  if (pos == s.length) return true;');
    lines.push("  if (s[pos] == 'Z') return pos + 1 == s.length;");
    lines.push("  if (s[pos] == '+' || s[pos] == '-') {");
    lines.push('    if (pos + 6 != s.length) return false;');
    lines.push('    if (s.codeUnitAt(pos+1) < 48 || s.codeUnitAt(pos+1) > 57 || s.codeUnitAt(pos+2) < 48 || s.codeUnitAt(pos+2) > 57) return false;');
    lines.push("    if (s[pos+3] != ':') return false;");
    lines.push('    return s.codeUnitAt(pos+4) >= 48 && s.codeUnitAt(pos+4) <= 57 && s.codeUnitAt(pos+5) >= 48 && s.codeUnitAt(pos+5) <= 57;');
    lines.push('  }');
    lines.push('  return false;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkDecimal')) {
    lines.push('bool _checkDecimal(String s) {');
    lines.push('  if (s.isEmpty) return false;');
    lines.push('  int i = 0;');
    lines.push('  while (i < s.length && s.codeUnitAt(i) >= 48 && s.codeUnitAt(i) <= 57) i++;');
    lines.push('  if (i == 0) return false;');
    lines.push("  if (i < s.length && s[i] == '.') {");
    lines.push('    i++;');
    lines.push('    if (i >= s.length || s.codeUnitAt(i) < 48 || s.codeUnitAt(i) > 57) return false;');
    lines.push('    while (i < s.length && s.codeUnitAt(i) >= 48 && s.codeUnitAt(i) <= 57) i++;');
    lines.push('  }');
    lines.push('  return i == s.length;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkRelayUrl') || helpers.has('_checkATag') || helpers.has('_checkDotTail')) {
    lines.push('bool _checkDotTail(String s, int pos) {');
    lines.push('  if (pos >= s.length) return false;');
    lines.push('  for (var j = pos; j < s.length; j++) {');
    lines.push('    final c = s.codeUnitAt(j);');
    lines.push('    if (c == 0x0A || c == 0x0D || c == 0x2028 || c == 0x2029) return false;');
    lines.push('  }');
    lines.push('  return true;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkRelayUrl')) {
    lines.push('bool _isRelayHostChar(int c) {');
    lines.push('  return (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c == 46 || c == 95 || c == 45;');
    lines.push('}');
    lines.push('');
    lines.push('bool _checkRelayUrl(String s) {');
    lines.push("  int pos;");
    lines.push("  if (s.startsWith('wss://')) { pos = 6; }");
    lines.push("  else if (s.startsWith('ws://')) { pos = 5; }");
    lines.push('  else { return false; }');
    lines.push('  final hostStart = pos;');
    lines.push('  while (pos < s.length && _isRelayHostChar(s.codeUnitAt(pos))) { pos++; }');
    lines.push('  if (pos == hostStart) return false;');
    lines.push("  if (pos < s.length && s[pos] == ':') {");
    lines.push('    pos++;');
    lines.push('    final portStart = pos;');
    lines.push('    while (pos < s.length && s.codeUnitAt(pos) >= 48 && s.codeUnitAt(pos) <= 57) { pos++; }');
    lines.push('    if (pos == portStart) return false;');
    lines.push('  }');
    lines.push("  if (pos < s.length && s[pos] == '/') {");
    lines.push('    return _checkDotTail(s, pos + 1) || pos + 1 == s.length;');
    lines.push('  }');
    lines.push('  return pos == s.length;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkATag')) {
    lines.push('bool _checkATag(String s, List<String>? kinds) {');
    lines.push('  if (s.length < 68) return false;');
    lines.push('  var pos = 0;');
    lines.push('  if (s.codeUnitAt(pos) < 48 || s.codeUnitAt(pos) > 57) return false;');
    lines.push('  final kindStart = pos;');
    lines.push('  while (pos < s.length && s.codeUnitAt(pos) >= 48 && s.codeUnitAt(pos) <= 57) {');
    lines.push('    pos++;');
    lines.push('  }');
    lines.push('  final kindLen = pos - kindStart;');
    lines.push("  if (pos >= s.length || s[pos] != ':') return false;");
    lines.push('  if (kinds != null) {');
    lines.push('    final kindStr = s.substring(kindStart, pos);');
    lines.push('    if (!kinds.contains(kindStr)) return false;');
    lines.push('  }');
    lines.push('  pos++;');
    lines.push('  if (pos + 64 >= s.length) return false;');
    lines.push('  for (var i = 0; i < 64; i++) {');
    lines.push('    final c = s.codeUnitAt(pos + i);');
    lines.push('    if (!((c >= 48 && c <= 57) || (c >= 97 && c <= 102))) return false;');
    lines.push('  }');
    lines.push('  pos += 64;');
    lines.push("  if (pos >= s.length || s[pos] != ':') return false;");
    lines.push('  pos++;');
    lines.push('  return _checkDotTail(s, pos);');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkBech32') || helpers.has('_isBech32Char')) {
    lines.push('bool _isBech32Char(int c) {');
    lines.push('  // 0-9 except 1, a-z except b, i, o');
    lines.push('  return (c >= 48 && c <= 57 && c != 49) || (c >= 97 && c <= 122 && c != 98 && c != 105 && c != 111);');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkBech32')) {
    lines.push('bool _checkBech32(String s, String prefix, [int? dataLen]) {');
    lines.push('  if (!s.startsWith(prefix)) return false;');
    lines.push('  final data = s.substring(prefix.length);');
    lines.push('  if (data.isEmpty || !data.codeUnits.every(_isBech32Char)) return false;');
    lines.push('  if (dataLen != null) return data.length == dataLen;');
    lines.push('  return true;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkWrapped')) {
    lines.push('bool _checkWrapped(String s, String prefix, String suffix) {');
    lines.push('  return s.length >= prefix.length + suffix.length && s.startsWith(prefix) && s.endsWith(suffix);');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkCsvList')) {
    lines.push('bool _checkCsvList(String s, String charset) {');
    lines.push('  if (s.isEmpty) return false;');
    lines.push('  int i = 0;');
    lines.push('  while (true) {');
    lines.push('    final start = i;');
    lines.push('    while (i < s.length && charset.contains(String.fromCharCode(s.codeUnitAt(i)))) i++;');
    lines.push('    if (i == start) return false;');
    lines.push('    if (i == s.length) return true;');
    lines.push("    if (s.codeUnitAt(i) != 44) return false; // ','");
    lines.push('    i++;');
    lines.push('  }');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkLnInvoice')) {
    lines.push('bool _checkLnInvoice(String s, String prefix, int minHrpLen) {');
    lines.push('  if (!s.startsWith(prefix)) return false;');
    lines.push('  final sep = s.lastIndexOf(\'1\');');
    lines.push('  if (sep < 0) return false;');
    lines.push('  final hrp = s.substring(0, sep);');
    lines.push('  if (hrp.length < minHrpLen) return false;');
    lines.push('  if (!hrp.codeUnits.every((c) => (c >= 97 && c <= 122) || (c >= 48 && c <= 57))) return false;');
    lines.push('  final data = s.substring(sep + 1);');
    lines.push('  if (data.isEmpty) return false;');
    lines.push('  return data.codeUnits.every(_isBech32Char);');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkMimeType')) {
    lines.push('bool _checkMimeType(String s) {');
    lines.push('  if (s.isEmpty) return false;');
    lines.push('  int i = 0;');
    lines.push('  final start = i;');
    lines.push('  while (i < s.length) { final c = s.codeUnitAt(i); if (c >= 97 && c <= 122) i++; else break; }');
    lines.push('  if (i == start) return false;');
    lines.push("  if (i >= s.length || s.codeUnitAt(i) != 47) return false; // '/'");
    lines.push('  i++;');
    lines.push('  final subStart = i;');
    lines.push('  while (i < s.length) {');
    lines.push('    final c = s.codeUnitAt(i);');
    lines.push('    if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c == 46 || c == 43 || c == 45) i++;');
    lines.push('    else break;');
    lines.push('  }');
    lines.push('  if (i == subStart) return false;');
    lines.push('  return i == s.length;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkHttpOrigin')) {
    lines.push('bool _checkHttpOrigin(String s) {');
    lines.push('  int i;');
    lines.push("  if (s.startsWith('https://')) { i = 8; }");
    lines.push("  else if (s.startsWith('http://')) { i = 7; }");
    lines.push('  else { return false; }');
    lines.push('  final start = i;');
    lines.push("  while (i < s.length && s.codeUnitAt(i) != 47) i++; // '/'");
    lines.push('  if (i == start) return false;');
    lines.push("  if (i < s.length && s.codeUnitAt(i) == 47) i++;");
    lines.push('  return i == s.length;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_isEcmaWs')) {
    lines.push('bool _isEcmaWs(int c) {');
    lines.push('  return c == 0x09 || c == 0x0A || c == 0x0B || c == 0x0C || c == 0x0D || c == 0x20');
    lines.push('      || c == 0x00A0 || c == 0x1680');
    lines.push('      || (c >= 0x2000 && c <= 0x200A)');
    lines.push('      || c == 0x2028 || c == 0x2029 || c == 0x202F || c == 0x205F');
    lines.push('      || c == 0x3000 || c == 0xFEFF;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkEmailLike')) {
    lines.push('bool _checkEmailLike(String s) {');
    lines.push('  if (s.isEmpty) return false;');
    lines.push('  int i = 0;');
    lines.push('  final start = i;');
    lines.push('  while (i < s.length && !_isEcmaWs(s.codeUnitAt(i)) && s.codeUnitAt(i) != 64) i++;');
    lines.push('  if (i == start) return false;');
    lines.push('  if (i >= s.length || s.codeUnitAt(i) != 64) return false;');
    lines.push('  i++;');
    lines.push('  final domStart = i;');
    lines.push('  while (i < s.length && !_isEcmaWs(s.codeUnitAt(i)) && s.codeUnitAt(i) != 64) i++;');
    lines.push('  if (i == domStart) return false;');
    lines.push('  return i == s.length;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkGitCloneUrl')) {
    lines.push('bool _checkGitCloneUrl(String s) {');
    lines.push('  if (s.isEmpty) return false;');
    lines.push('  int i;');
    lines.push("  if (s.startsWith('git@')) {");
    lines.push('    i = 4;');
    lines.push('  } else {');
    lines.push('    final c0 = s.codeUnitAt(0);');
    lines.push('    if (!(c0 >= 97 && c0 <= 122)) return false;');
    lines.push('    i = 1;');
    lines.push('    while (i < s.length) {');
    lines.push('      final c = s.codeUnitAt(i);');
    lines.push('      if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c == 43 || c == 46 || c == 45) i++;');
    lines.push('      else break;');
    lines.push('    }');
    lines.push("    if (i + 3 > s.length || s[i] != ':' || s[i + 1] != '/' || s[i + 2] != '/') return false;");
    lines.push('    i += 3;');
    lines.push('  }');
    lines.push('  if (i >= s.length) return false;');
    lines.push('  while (i < s.length) {');
    lines.push('    if (_isEcmaWs(s.codeUnitAt(i))) return false;');
    lines.push('    i++;');
    lines.push('  }');
    lines.push('  return true;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkContentType')) {
    lines.push('bool _isTypeChar(int c) {');
    lines.push('  return (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c == 33 || c == 35 || c == 36 || c == 38 || c == 94 || c == 95 || c == 45;');
    lines.push('}');
    lines.push('');
    lines.push('bool _isSubtypeChar(int c) {');
    lines.push('  return _isTypeChar(c) || c == 46 || c == 43;');
    lines.push('}');
    lines.push('');
    lines.push('bool _checkContentType(String s) {');
    lines.push('  if (s.isEmpty) return false;');
    lines.push('  int i = 0;');
    lines.push('  final c0 = s.codeUnitAt(i);');
    lines.push('  if (!((c0 >= 97 && c0 <= 122) || (c0 >= 65 && c0 <= 90))) return false;');
    lines.push('  i++;');
    lines.push('  while (i < s.length && _isTypeChar(s.codeUnitAt(i))) i++;');
    lines.push('  if (i >= s.length || s.codeUnitAt(i) != 47) return false;');
    lines.push('  i++;');
    lines.push('  if (i >= s.length) return false;');
    lines.push('  final sc = s.codeUnitAt(i);');
    lines.push('  if (!((sc >= 97 && sc <= 122) || (sc >= 65 && sc <= 90) || (sc >= 48 && sc <= 57) || sc == 42)) return false;');
    lines.push('  i++;');
    lines.push('  while (i < s.length && _isSubtypeChar(s.codeUnitAt(i))) i++;');
    lines.push('  while (i < s.length) {');
    lines.push('    while (i < s.length && _isEcmaWs(s.codeUnitAt(i))) i++;');
    lines.push('    if (i >= s.length) return false;');
    lines.push('    if (s.codeUnitAt(i) != 59) return false;');
    lines.push('    i++;');
    lines.push('    while (i < s.length && _isEcmaWs(s.codeUnitAt(i))) i++;');
    lines.push('    final nameStart = i;');
    lines.push('    while (i < s.length && _isSubtypeChar(s.codeUnitAt(i))) i++;');
    lines.push('    if (i == nameStart) return false;');
    lines.push('    if (i >= s.length || s.codeUnitAt(i) != 61) return false;');
    lines.push('    i++;');
    lines.push('    final valStart = i;');
    lines.push('    while (i < s.length && _isSubtypeChar(s.codeUnitAt(i))) i++;');
    lines.push('    if (i == valStart) return false;');
    lines.push('  }');
    lines.push('  return i == s.length;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkDoi')) {
    lines.push('bool _checkDoi(String s) {');
    lines.push("  if (s.length < 8) return false;");
    lines.push("  if (!s.startsWith('10.')) return false;");
    lines.push('  int i = 3;');
    lines.push('  final dStart = i;');
    lines.push('  while (i < s.length && s.codeUnitAt(i) >= 48 && s.codeUnitAt(i) <= 57) i++;');
    lines.push('  final dCount = i - dStart;');
    lines.push('  if (dCount < 4 || dCount > 9) return false;');
    lines.push("  if (i >= s.length || s.codeUnitAt(i) != 47) return false; // '/'");
    lines.push('  i++;');
    lines.push('  return _checkDotTail(s, i);');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkAnnotateUser')) {
    lines.push('bool _checkAnnotateUser(String s) {');
    lines.push("  if (s.length < 82) return false;");
    lines.push("  if (!s.startsWith('annotate-user ')) return false;");
    lines.push('  int i = 14;');
    lines.push('  if (i + 64 > s.length) return false;');
    lines.push('  for (var j = 0; j < 64; j++) {');
    lines.push('    final c = s.codeUnitAt(i + j);');
    lines.push('    if (!((c >= 48 && c <= 57) || (c >= 97 && c <= 102))) return false;');
    lines.push('  }');
    lines.push('  i += 64;');
    lines.push('  for (var round = 0; round < 2; round++) {');
    lines.push("    if (i >= s.length || s[i] != ':') return false;");
    lines.push('    i++;');
    lines.push('    final start = i;');
    lines.push('    while (i < s.length && s.codeUnitAt(i) >= 48 && s.codeUnitAt(i) <= 57) i++;');
    lines.push('    if (i == start) return false;');
    lines.push("    if (i < s.length && s[i] == '.') {");
    lines.push('      i++;');
    lines.push('      final fStart = i;');
    lines.push('      while (i < s.length && s.codeUnitAt(i) >= 48 && s.codeUnitAt(i) <= 57) i++;');
    lines.push('      if (i == fStart) return false;');
    lines.push('    }');
    lines.push('  }');
    lines.push('  return i == s.length;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkNoWsTail')) {
    lines.push('bool _checkNoWsTail(String s, int offset) {');
    lines.push('  if (offset >= s.length) return false;');
    lines.push('  for (var i = offset; i < s.length; i++) {');
    lines.push('    if (_isEcmaWs(s.codeUnitAt(i))) return false;');
    lines.push('  }');
    lines.push('  return true;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkExternalIdentity')) {
    lines.push('bool _checkExternalIdentity(String s) {');
    lines.push('  if (s.isEmpty) return false;');
    lines.push('  int i = 0;');
    lines.push('  while (i < s.length) {');
    lines.push('    final c = s.codeUnitAt(i);');
    lines.push('    if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c == 46 || c == 95 || c == 45 || c == 47) i++;');
    lines.push('    else break;');
    lines.push('  }');
    lines.push('  if (i == 0) return false;');
    lines.push("  if (i >= s.length || s.codeUnitAt(i) != 58) return false; // ':'");
    lines.push('  i++;');
    lines.push('  if (i >= s.length) return false;');
    lines.push('  for (var j = i; j < s.length; j++) {');
    lines.push('    final c = s.codeUnitAt(j);');
    lines.push('    if (c == 0x0A || c == 0x0D || c == 0x2028 || c == 0x2029) return false;');
    lines.push('  }');
    lines.push('  return true;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkPackageId')) {
    lines.push('bool _isPkgChar(int c) {');
    lines.push('  return (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c == 46 || c == 95 || c == 43 || c == 45;');
    lines.push('}');
    lines.push('');
    lines.push('bool _checkPackageId(String s) {');
    lines.push('  if (s.isEmpty) return false;');
    lines.push("  if (s == '#') return true;");
    lines.push('  int i = 0;');
    lines.push('  final c0 = s.codeUnitAt(i);');
    lines.push('  if (!((c0 >= 97 && c0 <= 122) || (c0 >= 65 && c0 <= 90) || (c0 >= 48 && c0 <= 57))) return false;');
    lines.push('  i++;');
    lines.push('  while (i < s.length && _isPkgChar(s.codeUnitAt(i))) i++;');
    lines.push("  while (i < s.length && s.codeUnitAt(i) == 58) { // ':'");
    lines.push('    i++;');
    lines.push('    if (i >= s.length) return false;');
    lines.push('    final cc = s.codeUnitAt(i);');
    lines.push('    if (!((cc >= 97 && cc <= 122) || (cc >= 65 && cc <= 90) || (cc >= 48 && cc <= 57))) return false;');
    lines.push('    i++;');
    lines.push('    while (i < s.length && _isPkgChar(s.codeUnitAt(i))) i++;');
    lines.push('  }');
    lines.push('  return i == s.length;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkImetaDim')) {
    lines.push('bool _checkImetaDim(String s) {');
    lines.push('  if (s.length < 7) return false;');
    lines.push('  if (!s.startsWith("dim ")) return false;');
    lines.push('  var i = 4;');
    lines.push('  var dc = 0;');
    lines.push('  while (i < s.length && s.codeUnitAt(i) >= 48 && s.codeUnitAt(i) <= 57) { i++; dc++; }');
    lines.push('  if (dc < 1 || dc > 5) return false;');
    lines.push('  if (i >= s.length || s[i] != \'x\') return false;');
    lines.push('  i++; dc = 0;');
    lines.push('  while (i < s.length && s.codeUnitAt(i) >= 48 && s.codeUnitAt(i) <= 57) { i++; dc++; }');
    lines.push('  if (dc < 1 || dc > 5) return false;');
    lines.push('  return i == s.length;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkDim')) {
    lines.push('bool _checkDim(String s) {');
    lines.push('  if (s.isEmpty) return false;');
    lines.push('  var i = 0;');
    lines.push('  if (s.codeUnitAt(i) < 48 || s.codeUnitAt(i) > 57) return false;');
    lines.push('  while (i < s.length && s.codeUnitAt(i) >= 48 && s.codeUnitAt(i) <= 57) i++;');
    lines.push("  if (i >= s.length || s[i] != 'x') return false;");
    lines.push('  i++;');
    lines.push('  if (i >= s.length || s.codeUnitAt(i) < 48 || s.codeUnitAt(i) > 57) return false;');
    lines.push('  while (i < s.length && s.codeUnitAt(i) >= 48 && s.codeUnitAt(i) <= 57) i++;');
    lines.push('  return i == s.length;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkNoUppercase')) {
    lines.push('bool _checkNoUppercase(String s) {');
    lines.push('  if (s.isEmpty) return false;');
    lines.push('  for (var i = 0; i < s.length; i++) {');
    lines.push('    final c = s.codeUnitAt(i);');
    lines.push('    if (c >= 65 && c <= 90) return false;');
    lines.push('  }');
    lines.push('  return true;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkDottedDigits')) {
    lines.push('bool _checkDottedDigits(String s) {');
    lines.push('  if (s.isEmpty) return false;');
    lines.push('  var i = 0;');
    lines.push('  if (s.codeUnitAt(i) < 48 || s.codeUnitAt(i) > 57) return false;');
    lines.push('  while (i < s.length && s.codeUnitAt(i) >= 48 && s.codeUnitAt(i) <= 57) i++;');
    lines.push("  while (i < s.length && s[i] == '.') {");
    lines.push('    i++;');
    lines.push('    if (i >= s.length || s.codeUnitAt(i) < 48 || s.codeUnitAt(i) > 57) return false;');
    lines.push('    while (i < s.length && s.codeUnitAt(i) >= 48 && s.codeUnitAt(i) <= 57) i++;');
    lines.push('  }');
    lines.push('  return i == s.length;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkSlashSegments')) {
    lines.push('bool _checkSlashSegments(String s, String charset) {');
    lines.push('  if (s.isEmpty) return false;');
    lines.push('  var i = 0;');
    lines.push('  if (!charset.contains(String.fromCharCode(s.codeUnitAt(i)))) return false;');
    lines.push('  while (i < s.length && charset.contains(String.fromCharCode(s.codeUnitAt(i)))) i++;');
    lines.push("  while (i < s.length && s[i] == '/') {");
    lines.push('    i++;');
    lines.push('    if (i >= s.length || !charset.contains(String.fromCharCode(s.codeUnitAt(i)))) return false;');
    lines.push('    while (i < s.length && charset.contains(String.fromCharCode(s.codeUnitAt(i)))) i++;');
    lines.push('  }');
    lines.push('  return i == s.length;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkSpaceSeparatedTokens')) {
    lines.push('bool _checkSpaceSeparatedTokens(String s) {');
    lines.push('  if (s.isEmpty) return false;');
    lines.push('  var i = 0;');
    lines.push('  // first token: 1+ non-whitespace');
    lines.push('  while (i < s.length && !_isEcmaWs(s.codeUnitAt(i))) i++;');
    lines.push('  if (i == 0) return false;');
    lines.push("  while (i < s.length && s.codeUnitAt(i) == 32) { // ' '");
    lines.push('    i++;');
    lines.push('    if (i >= s.length) return false;');
    lines.push('    final tokenStart = i;');
    lines.push('    while (i < s.length && !_isEcmaWs(s.codeUnitAt(i))) i++;');
    lines.push('    if (i == tokenStart) return false;');
    lines.push('  }');
    lines.push('  return i == s.length;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkStartsWithCharset')) {
    lines.push('bool _checkStartsWithCharset(String s, String charset) {');
    lines.push('  if (s.isEmpty) return false;');
    lines.push('  return charset.contains(String.fromCharCode(s.codeUnitAt(0)));');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_isB64Char') || helpers.has('_checkBase64') || helpers.has('_checkNip04Encrypted') || helpers.has('_checkBase642Pad')) {
    lines.push('bool _isB64Char(int c) {');
    lines.push('  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c == 43 || c == 47;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkBase64')) {
    lines.push('bool _checkBase64(String s) {');
    lines.push('  final l = s.length;');
    lines.push('  if (l == 0) return true;');
    lines.push('  if (l % 4 != 0) return false;');
    lines.push('  var i = 0;');
    lines.push('  while (i < l) {');
    lines.push('    if (s.codeUnitAt(i) == 61) break; // \'=\'');
    lines.push('    if (!_isB64Char(s.codeUnitAt(i))) return false;');
    lines.push('    i++;');
    lines.push('  }');
    lines.push('  final dataLen = i;');
    lines.push('  final padLen = l - dataLen;');
    lines.push('  if (padLen > 2) return false;');
    lines.push('  if (padLen == 1 && dataLen % 4 != 3) return false;');
    lines.push('  if (padLen == 2 && dataLen % 4 != 2) return false;');
    lines.push('  while (i < l) {');
    lines.push('    if (s.codeUnitAt(i) != 61) return false; // \'=\'');
    lines.push('    i++;');
    lines.push('  }');
    lines.push('  return true;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkBase642Pad')) {
    lines.push('// strict base64 with mandatory 2-char padding');
    lines.push('bool _checkBase642Pad(String s) {');
    lines.push('  final l = s.length;');
    lines.push('  if (l < 4 || l % 4 != 0) return false;');
    lines.push("  if (s.codeUnitAt(l - 1) != 61 || s.codeUnitAt(l - 2) != 61) return false; // '='");
    lines.push('  for (var i = 0; i < l - 2; i++) {');
    lines.push('    if (!_isB64Char(s.codeUnitAt(i))) return false;');
    lines.push('  }');
    lines.push('  return true;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkNostrUri')) {
    lines.push('bool _checkNostrUri(String s) {');
    lines.push("  if (!s.startsWith('nostr:')) return false;");
    lines.push('  final p = s.substring(6);');
    lines.push('  final rest = p.length;');
    lines.push('  // npub1 or note1 + exactly 58 data chars');
    lines.push("  if (rest == 63 && (p.startsWith('npub1') || p.startsWith('note1'))) {");
    lines.push('    for (var i = 5; i < 63; i++) {');
    lines.push('      if (!_isBech32Char(p.codeUnitAt(i))) return false;');
    lines.push('    }');
    lines.push('    return true;');
    lines.push('  }');
    lines.push('  // nprofile1, nevent1, naddr1 + 1+ data chars');
    lines.push('  var prefixLen = 0;');
    lines.push("  if (p.startsWith('nprofile1')) { prefixLen = 9; }");
    lines.push("  else if (p.startsWith('nevent1')) { prefixLen = 7; }");
    lines.push("  else if (p.startsWith('naddr1')) { prefixLen = 6; }");
    lines.push('  if (prefixLen == 0 || rest <= prefixLen) return false;');
    lines.push('  for (var i = prefixLen; i < rest; i++) {');
    lines.push('    if (!_isBech32Char(p.codeUnitAt(i))) return false;');
    lines.push('  }');
    lines.push('  return true;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkNip04Encrypted')) {
    lines.push('bool _checkNip04Encrypted(String s) {');
    lines.push('  if (s.isEmpty) return false;');
    lines.push("  final sep = s.indexOf('?iv=');");
    lines.push('  if (sep <= 0) return false;');
    lines.push('  if (sep + 4 >= s.length) return false;');
    lines.push('  // check left half: 1+ b64 chars + 0-2 =');
    lines.push('  final left = s.substring(0, sep);');
    lines.push('  var i = 0;');
    lines.push('  while (i < left.length && _isB64Char(left.codeUnitAt(i))) i++;');
    lines.push('  if (i == 0) return false;');
    lines.push('  var eq = 0;');
    lines.push('  while (i < left.length && left.codeUnitAt(i) == 61) { i++; eq++; }');
    lines.push('  if (i != left.length || eq > 2) return false;');
    lines.push('  // check right half');
    lines.push('  final right = s.substring(sep + 4);');
    lines.push('  i = 0;');
    lines.push('  while (i < right.length && _isB64Char(right.codeUnitAt(i))) i++;');
    lines.push('  if (i == 0) return false;');
    lines.push('  eq = 0;');
    lines.push('  while (i < right.length && right.codeUnitAt(i) == 61) { i++; eq++; }');
    lines.push('  return i == right.length && eq <= 2;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkNip05Identifier')) {
    lines.push('bool _isNip05LocalChar(int c) {');
    lines.push('  return c == 95 || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c == 46 || c == 45;');
    lines.push('}');
    lines.push('');
    lines.push('bool _isAlnum(int c) {');
    lines.push('  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57);');
    lines.push('}');
    lines.push('');
    lines.push('bool _isDomainChar(int c) {');
    lines.push('  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c == 45;');
    lines.push('}');
    lines.push('');
    lines.push('bool _checkNip05Identifier(String s) {');
    lines.push('  if (s.isEmpty) return false;');
    lines.push("  final atPos = s.lastIndexOf('@');");
    lines.push('  if (atPos <= 0) return false;');
    lines.push('  // local part: [_A-Za-z0-9.-]+');
    lines.push('  final local = s.substring(0, atPos);');
    lines.push('  for (var i = 0; i < local.length; i++) {');
    lines.push('    if (!_isNip05LocalChar(local.codeUnitAt(i))) return false;');
    lines.push('  }');
    lines.push('  // domain: 2+ dot-separated labels');
    lines.push('  final domain = s.substring(atPos + 1);');
    lines.push('  if (domain.isEmpty) return false;');
    lines.push('  var dotCount = 0;');
    lines.push('  var di = 0;');
    lines.push('  while (di < domain.length) {');
    lines.push('    if (!_isAlnum(domain.codeUnitAt(di))) return false;');
    lines.push('    while (di < domain.length && _isDomainChar(domain.codeUnitAt(di))) di++;');
    lines.push('    if (!_isAlnum(domain.codeUnitAt(di - 1))) return false;');
    lines.push("    if (di < domain.length && domain[di] == '.') {");
    lines.push('      dotCount++;');
    lines.push('      di++;');
    lines.push('    } else if (di < domain.length) {');
    lines.push('      return false;');
    lines.push('    }');
    lines.push('  }');
    lines.push('  return dotCount >= 1 && _isAlnum(domain.codeUnitAt(domain.length - 1));');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkMimeTypeStrict')) {
    lines.push('bool _isMimeStrictChar(int c) {');
    lines.push('  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c == 33 || c == 35 || c == 36 || c == 38 || c == 94 || c == 95 || c == 46 || c == 43 || c == 45;');
    lines.push('}');
    lines.push('');
    lines.push('bool _checkMimeTypeStrict(String s) {');
    lines.push('  if (s.isEmpty) return false;');
    lines.push('  var i = 0;');
    lines.push('  final c0 = s.codeUnitAt(i);');
    lines.push('  if (!((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122) || (c0 >= 48 && c0 <= 57))) return false;');
    lines.push('  i++;');
    lines.push('  while (i < s.length && _isMimeStrictChar(s.codeUnitAt(i))) i++;');
    lines.push("  if (i >= s.length || s.codeUnitAt(i) != 47) return false; // '/'");
    lines.push('  i++;');
    lines.push('  if (i >= s.length) return false;');
    lines.push('  final c1 = s.codeUnitAt(i);');
    lines.push('  if (!((c1 >= 65 && c1 <= 90) || (c1 >= 97 && c1 <= 122) || (c1 >= 48 && c1 <= 57))) return false;');
    lines.push('  i++;');
    lines.push('  while (i < s.length && _isMimeStrictChar(s.codeUnitAt(i))) i++;');
    lines.push('  return i == s.length;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkPrefixDelimRest')) {
    lines.push('bool _checkPrefixDelimRest(String s, String charset, String delimiter) {');
    lines.push('  if (s.isEmpty) return false;');
    lines.push('  var i = 0;');
    lines.push('  if (!charset.contains(String.fromCharCode(s.codeUnitAt(i)))) return false;');
    lines.push('  while (i < s.length && charset.contains(String.fromCharCode(s.codeUnitAt(i)))) i++;');
    lines.push('  if (i + delimiter.length >= s.length) return false;');
    lines.push('  if (s.substring(i, i + delimiter.length) != delimiter) return false;');
    lines.push('  i += delimiter.length;');
    lines.push('  if (i >= s.length) return false;');
    lines.push('  // .+ first char must not be a line terminator (ECMA-262)');
    lines.push('  final c = s.codeUnitAt(i);');
    lines.push('  return c != 0x0A && c != 0x0D && c != 0x2028 && c != 0x2029;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('_checkIdentifier')) {
    if (lines.length > 0) lines.push('');
    lines.push("bool _checkIdentifier(String s, String firstCharset, String restCharset, [String prefix = '']) {");
    lines.push('  var i = 0;');
    lines.push("  if (prefix.isNotEmpty && i < s.length && s[i] == prefix) i++;");
    lines.push('  if (i >= s.length) return false;');
    lines.push('  if (!firstCharset.contains(s[i])) return false;');
    lines.push('  i++;');
    lines.push('  while (i < s.length) {');
    lines.push('    if (!restCharset.contains(s[i])) return false;');
    lines.push('    i++;');
    lines.push('  }');
    lines.push('  return true;');
    lines.push('}');
  }

  if (helpers.has('_checkSpaceSeparatedCharset')) {
    if (lines.length > 0) lines.push('');
    lines.push('bool _checkSpaceSeparatedCharset(String s, String charset) {');
    lines.push('  if (s.isEmpty) return false;');
    lines.push('  var i = 0;');
    lines.push('  if (!charset.contains(s[i])) return false;');
    lines.push('  while (i < s.length && charset.contains(s[i])) i++;');
    lines.push("  while (i < s.length && s[i] == ' ') {");
    lines.push('    i++;');
    lines.push('    if (i >= s.length || !charset.contains(s[i])) return false;');
    lines.push('    while (i < s.length && charset.contains(s[i])) i++;');
    lines.push('  }');
    lines.push('  return i == s.length;');
    lines.push('}');
  }

  if (helpers.has('_checkUriScheme')) {
    if (lines.length > 0) lines.push('');
    lines.push('bool _checkUriScheme(String s) {');
    lines.push('  if (s.length < 4) return false;');
    lines.push('  var c = s.codeUnitAt(0);');
    lines.push('  if (!((c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A))) return false;');
    lines.push('  var i = 1;');
    lines.push('  while (i < s.length) {');
    lines.push('    c = s.codeUnitAt(i);');
    lines.push('    if ((c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A) || (c >= 0x30 && c <= 0x39) || c == 0x2B || c == 0x2E || c == 0x2D) { i++; }');
    lines.push('    else { break; }');
    lines.push('  }');
    lines.push('  if (i + 3 > s.length) return false;');
    lines.push("  return s[i] == ':' && s[i+1] == '/' && s[i+2] == '/';");
    lines.push('}');
  }

  return lines.join('\n');
}
