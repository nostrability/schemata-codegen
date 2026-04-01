/**
 * Swift validator emitter: ValidatorAction[] → .swift file
 *
 * Generates Swift source code with per-kind validation functions that
 * check Nostr event tags against schemata constraints.
 *
 * Tags are [[String]] (array of string arrays). Tag search uses
 * `.contains(where:)` which is idiomatic Swift.
 *
 * Pattern checks use native Swift string operations where possible
 * (Character.isHexDigit, hasPrefix, range(of:options:.regularExpression)).
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

function renderPatternCheckSwift(check: PatternCheck, varExpr: string): { expr: string; helpers: Set<string> } {
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
      const checks = check.prefixes.map(p => `${varExpr}.hasPrefix(${JSON.stringify(p)})`);
      return { expr: checks.length === 1 ? checks[0] : `(${checks.join(' || ')})`, helpers };
    }
    case 'chars_in': {
      if (check.min === 0 && check.max === 0) {
        return { expr: `${varExpr}.isEmpty`, helpers };
      }
      helpers.add('checkCharsIn');
      const maxVal = check.max ?? 'Int.max';
      return {
        expr: `checkCharsIn(${varExpr}, ${JSON.stringify(check.charset)}, ${check.min ?? 0}, ${maxVal})`,
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
        return { expr: `checkATag(${varExpr}, [${arr}])`, helpers };
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
      const len = check.prefix.length;
      helpers.add('checkDotTail');
      return {
        expr: `(${varExpr}.hasPrefix(${JSON.stringify(check.prefix)}) && ${varExpr}.count > ${len} && checkDotTail(Array(${varExpr}.utf8), ${len}))`,
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
      helpers.add('isEcmaWs');
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
      helpers.add('isEcmaWs');
      const checks = check.prefixes.map(p =>
        `(${varExpr}.hasPrefix(${JSON.stringify(p)}) && checkNoWsTail(${varExpr}, ${p.length}))`
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
    case 'dim': {
      helpers.add('checkDim');
      return { expr: `checkDim(${varExpr})`, helpers };
    }
    case 'no_uppercase': {
      helpers.add('checkNoUppercase');
      return { expr: `checkNoUppercase(${varExpr})`, helpers };
    }
    case 'dotted_digits': {
      helpers.add('checkDottedDigits');
      return { expr: `checkDottedDigits(${varExpr})`, helpers };
    }
    case 'slash_segments': {
      helpers.add('checkSlashSegments');
      return { expr: `checkSlashSegments(${varExpr}, ${JSON.stringify(check.charset)})`, helpers };
    }
    case 'space_separated_tokens': {
      helpers.add('checkSpaceSeparatedTokens');
      helpers.add('isEcmaWs');
      return { expr: `checkSpaceSeparatedTokens(${varExpr})`, helpers };
    }
    case 'starts_with_charset': {
      helpers.add('checkStartsWithCharset');
      return { expr: `checkStartsWithCharset(${varExpr}, ${JSON.stringify(check.charset)})`, helpers };
    }
    case 'base64': {
      helpers.add('checkBase64');
      return { expr: `checkBase64(${varExpr})`, helpers };
    }
    case 'hex_alternation': {
      const fns = check.lengths.map(len => {
        const fn = check.case === 'lower' ? `checkHex${len}` : `checkHex${len}Mixed`;
        helpers.add(fn);
        return `${fn}(${varExpr})`;
      });
      return { expr: `(${fns.join(' || ')})`, helpers };
    }
    case 'base64_2pad': {
      helpers.add('checkBase642Pad');
      helpers.add('checkBase64'); // for isB64Char
      return { expr: `checkBase642Pad(${varExpr})`, helpers };
    }
    case 'nostr_uri': {
      helpers.add('checkNostrUri');
      helpers.add('checkBech32'); // triggers isBech32Char
      return { expr: `checkNostrUri(${varExpr})`, helpers };
    }
    case 'nip04_encrypted': {
      helpers.add('checkNip04Encrypted');
      helpers.add('checkBase64'); // triggers isB64Char
      return { expr: `checkNip04Encrypted(${varExpr})`, helpers };
    }
    case 'nip05_identifier': {
      helpers.add('checkNip05Identifier');
      helpers.add('isAlnumByte');
      return { expr: `checkNip05Identifier(${varExpr})`, helpers };
    }
    case 'mime_type_strict': {
      helpers.add('checkMimeTypeStrict');
      helpers.add('isAlnumByte');
      return { expr: `checkMimeTypeStrict(${varExpr})`, helpers };
    }
    case 'prefix_delim_rest': {
      helpers.add('checkPrefixDelimRest');
      return { expr: `checkPrefixDelimRest(${varExpr}, ${JSON.stringify(check.charset)}, ${JSON.stringify(check.delimiter)})`, helpers };
    }
    case 'compound': {
      const allHelpers = new Set<string>();
      const parts: string[] = [];
      for (const sub of check.checks) {
        const r = renderPatternCheckSwift(sub, varExpr);
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

function renderValueCheckSwift(
  check: ValueCheck,
  tagVar: string,
  index: number,
): { expr: string; helpers: Set<string> } {
  const helpers = new Set<string>();

  switch (check.type) {
    case 'const':
      return { expr: `${tagVar}.count > ${index} && ${tagVar}[${index}] == ${JSON.stringify(check.value)}`, helpers };
    case 'enum': {
      const vals = check.values.map(v => JSON.stringify(v));
      return {
        expr: `${tagVar}.count > ${index} && [${vals.join(', ')}].contains(${tagVar}[${index}])`,
        helpers,
      };
    }
    case 'pattern': {
      const r = renderPatternCheckSwift(check.native, 'v');
      for (const h of r.helpers) helpers.add(h);
      return {
        expr: `${tagVar}.count > ${index} && { let v = ${tagVar}[${index}]; return ${r.expr} }()`,
        helpers,
      };
    }
    case 'anyOf': {
      const parts: string[] = [];
      for (const alt of check.alternatives) {
        const r = renderValueCheckSwift(alt, tagVar, index);
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

function renderTagMatcherSwift(
  matcher: TagMatcher,
  tagVar: string,
  helpers: Set<string>,
): string {
  const checks: string[] = [];

  checks.push(`!${tagVar}.isEmpty && ${tagVar}[0] == ${JSON.stringify(matcher.tagName)}`);
  checks.push(`${tagVar}.count >= ${matcher.minItems}`);
  if (matcher.maxItems !== undefined) {
    checks.push(`${tagVar}.count <= ${matcher.maxItems}`);
  }

  for (const pc of matcher.positionChecks) {
    const r = renderValueCheckSwift(pc.check, tagVar, pc.index);
    for (const h of r.helpers) helpers.add(h);
    checks.push(r.expr);
  }

  return checks.join(' && ');
}

// --- Main emitter ---

export function emitSwiftValidators(kindShapes: KindShape[]): string {
  const allHelpers = new Set<string>();
  const fnBodies: string[] = [];
  const constrainedKinds: { kindNumber: number; nip: string }[] = [];

  for (const shape of [...kindShapes].sort((a, b) => a.kindNumber - b.kindNumber)) {
    const actions = planKindValidator(shape);
    if (!actions) continue;

    constrainedKinds.push({ kindNumber: shape.kindNumber, nip: shape.nip });
    const { code, helpers } = emitKindFunctionSwift(shape.kindNumber, shape.nip, actions);
    fnBodies.push(code);
    for (const h of helpers) allHelpers.add(h);
  }

  return emitSwiftFile(fnBodies, constrainedKinds, allHelpers);
}

function emitKindFunctionSwift(
  kindNumber: number,
  nip: string,
  actions: ValidatorAction[],
): { code: string; helpers: Set<string> } {
  const helpers = new Set<string>();
  const lines: string[] = [];

  lines.push(`/// Validate tags for kind ${kindNumber} (${nip})`);
  lines.push(`public func validateKind${kindNumber}(tags: [[String]]) -> [ValidationError] {`);
  lines.push('    var errors: [ValidationError] = []');

  for (const action of actions) {
    switch (action.type) {
      case 'check_min_tags':
        lines.push(`    if tags.count < ${action.min} {`);
        lines.push(`        errors.append(ValidationError(path: "tags", message: "tags must have at least ${action.min} item(s)"))`);
        lines.push('    }');
        break;

      case 'require_tag': {
        const matcherExpr = renderTagMatcherSwift(action.matcher, 't', helpers);
        lines.push(`    if !tags.contains(where: { t in ${matcherExpr} }) {`);
        lines.push(`        errors.append(ValidationError(path: "tags", message: ${JSON.stringify(action.errorMsg)}))`);
        lines.push('    }');
        break;
      }

      case 'validate_optional_positions': {
        lines.push('    for t in tags {');
        lines.push(`        if !t.isEmpty && t[0] == ${JSON.stringify(action.tagName)} {`);
        for (const pc of action.checks) {
          const r = renderValueCheckSwift(pc.check, 't', pc.index);
          for (const h of r.helpers) helpers.add(h);
          const msg = describePositionConstraint(pc, action.tagName);
          lines.push(`            if t.count > ${pc.index} && !(${r.expr}) {`);
          lines.push(`                errors.append(ValidationError(path: "tags", message: ${JSON.stringify(msg)}))`);
          lines.push('            }');
        }
        lines.push('        }');
        lines.push('    }');
        break;
      }

      case 'per_item_conditional': {
        const matcherExpr = renderTagMatcherSwift(action.matcher, 't', helpers);
        lines.push('    for t in tags {');
        lines.push(`        if !t.isEmpty && t[0] == ${JSON.stringify(action.condTag)} && !(${matcherExpr}) {`);
        lines.push(`            errors.append(ValidationError(path: "tags", message: ${JSON.stringify(action.errorMsg)}))`);
        lines.push('        }');
        if (action.optChecks.length > 0) {
          lines.push(`        if !t.isEmpty && t[0] == ${JSON.stringify(action.condTag)} {`);
          for (const pc of action.optChecks) {
            const r = renderValueCheckSwift(pc.check, 't', pc.index);
            for (const h of r.helpers) helpers.add(h);
            const msg = describePositionConstraint(pc, action.condTag);
            lines.push(`            if t.count > ${pc.index} && !(${r.expr}) {`);
            lines.push(`                errors.append(ValidationError(path: "tags", message: ${JSON.stringify(msg)}))`);
            lines.push('            }');
          }
          lines.push('        }');
        }
        lines.push('    }');
        break;
      }

      case 'array_level_conditional': {
        lines.push(`    if tags.contains(where: { t in !t.isEmpty && t[0] == ${JSON.stringify(action.condTag)} }) {`);
        const matcherExpr = renderTagMatcherSwift(action.matcher, 't', helpers);
        lines.push(`        if !tags.contains(where: { t in ${matcherExpr} }) {`);
        lines.push(`            errors.append(ValidationError(path: "tags", message: ${JSON.stringify(action.errorMsg)}))`);
        lines.push('        }');
        if (action.optChecks.length > 0) {
          lines.push('        for t in tags {');
          lines.push(`            if !t.isEmpty && t[0] == ${JSON.stringify(action.matcher.tagName)} {`);
          for (const pc of action.optChecks) {
            const r = renderValueCheckSwift(pc.check, 't', pc.index);
            for (const h of r.helpers) helpers.add(h);
            const msg = describePositionConstraint(pc, action.matcher.tagName);
            lines.push(`                if t.count > ${pc.index} && !(${r.expr}) {`);
            lines.push(`                    errors.append(ValidationError(path: "tags", message: ${JSON.stringify(msg)}))`);
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
          const expr = renderTagMatcherSwift(m, 't', helpers);
          return `tags.contains(where: { t in ${expr} })`;
        });
        lines.push(`    if !(${matchers.join(' || ')}) {`);
        lines.push(`        errors.append(ValidationError(path: "tags", message: ${JSON.stringify(action.errorMsg)}))`);
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

function emitSwiftFile(
  fnBodies: string[],
  constrainedKinds: { kindNumber: number; nip: string }[],
  helpers: Set<string>,
): string {
  const needsFoundation = helpers.has('regex');

  const lines: string[] = [
    '// Auto-generated by @nostrability/schemata-codegen',
    '// Do not edit manually.',
    '//',
    '// Runtime validators for Nostr event tag constraints',
    '',
  ];

  if (needsFoundation) {
    lines.push('import Foundation');
    lines.push('');
  }

  lines.push('public struct ValidationError {');
  lines.push('    public let path: String');
  lines.push('    public let message: String');
  lines.push('    public init(path: String, message: String) {');
  lines.push('        self.path = path');
  lines.push('        self.message = message');
  lines.push('    }');
  lines.push('}');
  lines.push('');

  lines.push(emitSwiftHelpers(helpers));

  for (const fn of fnBodies) {
    lines.push(fn);
    lines.push('');
  }

  lines.push('/// Validate tags for a given kind number.');
  lines.push('/// Returns empty array if kind has no constraints or is unknown.');
  lines.push('public func validateKindTags(kind: Int, tags: [[String]]) -> [ValidationError] {');
  lines.push('    switch kind {');
  for (const k of constrainedKinds) {
    lines.push(`    case ${k.kindNumber}: return validateKind${k.kindNumber}(tags: tags)`);
  }
  lines.push('    default: return []');
  lines.push('    }');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

function emitSwiftHelpers(helpers: Set<string>): string {
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
    lines.push(`private func checkHex${len}(_ s: String) -> Bool {`);
    lines.push(`    s.count == ${len} && s.allSatisfy { $0.isHexDigit && ($0.isLowercase || $0.isNumber) }`);
    lines.push('}');
    lines.push('');
  }

  for (const len of [...hexMixedLengths].sort((a, b) => a - b)) {
    lines.push(`private func checkHex${len}Mixed(_ s: String) -> Bool {`);
    lines.push(`    s.count == ${len} && s.allSatisfy { $0.isHexDigit }`);
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkHexRange')) {
    lines.push('private func checkHexRange(_ s: String, _ min: Int, _ max: Int) -> Bool {');
    lines.push('    let len = s.count');
    lines.push('    return len >= min && len <= max && s.allSatisfy { $0.isHexDigit && ($0.isLowercase || $0.isNumber) }');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkHexRangeMixed')) {
    lines.push('private func checkHexRangeMixed(_ s: String, _ min: Int, _ max: Int) -> Bool {');
    lines.push('    let len = s.count');
    lines.push('    return len >= min && len <= max && s.allSatisfy { $0.isHexDigit }');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkHexPrefixed')) {
    lines.push('private func checkHexPrefixed(_ s: String, _ prefix: String, _ hexLen: Int) -> Bool {');
    lines.push('    guard s.hasPrefix(prefix) else { return false }');
    lines.push('    let rest = s.dropFirst(prefix.count)');
    lines.push('    return rest.count == hexLen && rest.allSatisfy { $0.isHexDigit && ($0.isLowercase || $0.isNumber) }');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkDigits')) {
    lines.push('private func checkDigits(_ s: String) -> Bool {');
    lines.push('    !s.isEmpty && s.unicodeScalars.allSatisfy { $0.value >= 48 && $0.value <= 57 }');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkSignedInt')) {
    lines.push('private func checkSignedInt(_ s: String) -> Bool {');
    lines.push('    let str = s.hasPrefix("-") ? String(s.dropFirst()) : s');
    lines.push('    return !str.isEmpty && str.unicodeScalars.allSatisfy { $0.value >= 48 && $0.value <= 57 }');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkCharsIn')) {
    lines.push('private func checkCharsIn(_ s: String, _ charset: String, _ min: Int, _ max: Int) -> Bool {');
    lines.push('    let len = s.count');
    lines.push('    return len >= min && len <= max && s.allSatisfy { charset.contains($0) }');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkBech32')) {
    lines.push('private func isBech32Char(_ c: Character) -> Bool {');
    lines.push('    let s = c.asciiValue ?? 0');
    lines.push('    return (s >= 48 && s <= 57 && s != 49) || (s >= 97 && s <= 122 && s != 98 && s != 105 && s != 111)');
    lines.push('}');
    lines.push('');
    lines.push('private func checkBech32(_ s: String, _ prefix: String, _ dataLen: Int? = nil) -> Bool {');
    lines.push('    guard s.hasPrefix(prefix) else { return false }');
    lines.push('    let data = s.dropFirst(prefix.count)');
    lines.push('    guard !data.isEmpty, data.allSatisfy({ isBech32Char($0) }) else { return false }');
    lines.push('    if let dataLen = dataLen { return data.count == dataLen }');
    lines.push('    return true');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkDateIso')) {
    lines.push('private func checkDateIso(_ s: String) -> Bool {');
    lines.push('    guard s.count == 10 else { return false }');
    lines.push('    let chars = Array(s)');
    lines.push("    guard chars[4] == Character(\"-\") && chars[7] == Character(\"-\") else { return false }");
    lines.push('    for i in 0..<10 {');
    lines.push('        if i == 4 || i == 7 { continue }');
    lines.push('        if !chars[i].isNumber { return false }');
    lines.push('    }');
    lines.push('    return true');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkDecimal')) {
    lines.push('private func checkDecimal(_ s: String) -> Bool {');
    lines.push('    if s.isEmpty { return false }');
    lines.push('    let chars = Array(s)');
    lines.push('    var i = 0');
    lines.push('    while i < chars.count && chars[i].isNumber { i += 1 }');
    lines.push('    guard i > 0 else { return false }');
    lines.push("    if i < chars.count && chars[i] == Character(\".\") {");
    lines.push('        i += 1');
    lines.push('        if i >= chars.count || !chars[i].isNumber { return false }');
    lines.push('        while i < chars.count && chars[i].isNumber { i += 1 }');
    lines.push('    }');
    lines.push('    return i == chars.count');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkRelayUrl') || helpers.has('checkATag') || helpers.has('checkDotTail') || helpers.has('checkExternalIdentity')) {
    lines.push('// Swift . excludes \\n, \\r, NEL (\\u{0085}), LS (\\u{2028}), PS (\\u{2029})');
    lines.push('private func checkDotTail(_ u: [UInt8], _ pos: Int) -> Bool {');
    lines.push('    if pos >= u.count { return false }');
    lines.push('    var j = pos');
    lines.push('    while j < u.count {');
    lines.push('        let b = u[j]');
    lines.push('        if b == 0x0A || b == 0x0D { return false }');
    lines.push('        if b == 0xC2 && j + 1 < u.count && u[j + 1] == 0x85 { return false }');
    lines.push('        if b == 0xE2 && j + 2 < u.count && u[j + 1] == 0x80 && (u[j + 2] == 0xA8 || u[j + 2] == 0xA9) { return false }');
    lines.push('        j += 1');
    lines.push('    }');
    lines.push('    return true');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkRelayUrl')) {
    lines.push('private func checkRelayUrl(_ s: String) -> Bool {');
    lines.push('    let u = Array(s.utf8)');
    lines.push('    var pos = 0');
    lines.push('    if u.count >= 6 && u[0] == 0x77 && u[1] == 0x73 && u[2] == 0x73 && u[3] == 0x3A && u[4] == 0x2F && u[5] == 0x2F { pos = 6 }');
    lines.push('    else if u.count >= 5 && u[0] == 0x77 && u[1] == 0x73 && u[2] == 0x3A && u[3] == 0x2F && u[4] == 0x2F { pos = 5 }');
    lines.push('    else { return false }');
    lines.push('    let hostStart = pos');
    lines.push('    while pos < u.count {');
    lines.push('        let c = u[pos]');
    lines.push('        if (c >= 0x61 && c <= 0x7A) || (c >= 0x41 && c <= 0x5A) || (c >= 0x30 && c <= 0x39) || c == 0x2E || c == 0x5F || c == 0x2D { pos += 1 }');
    lines.push('        else { break }');
    lines.push('    }');
    lines.push('    if pos == hostStart { return false }');
    lines.push('    if pos < u.count && u[pos] == 0x3A {');
    lines.push('        pos += 1');
    lines.push('        let portStart = pos');
    lines.push('        while pos < u.count && u[pos] >= 0x30 && u[pos] <= 0x39 { pos += 1 }');
    lines.push('        if pos == portStart { return false }');
    lines.push('    }');
    lines.push('    if pos < u.count && u[pos] == 0x2F {');
    lines.push('        return checkDotTail(u, pos + 1) || pos + 1 == u.count');
    lines.push('    }');
    lines.push('    return pos == u.count');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkATag')) {
    lines.push('private func checkATag(_ s: String, _ kinds: [String]?) -> Bool {');
    lines.push('    let u = Array(s.utf8)');
    lines.push('    if u.count < 68 { return false }');
    lines.push('    var pos = 0');
    lines.push('    if u[pos] < 0x30 || u[pos] > 0x39 { return false }');
    lines.push('    let kindStart = pos');
    lines.push('    while pos < u.count && u[pos] >= 0x30 && u[pos] <= 0x39 { pos += 1 }');
    lines.push('    let kindLen = pos - kindStart');
    lines.push('    if pos >= u.count || u[pos] != 0x3A { return false }');
    lines.push('    if let ks = kinds {');
    lines.push('        let kindStr = String(s[s.index(s.startIndex, offsetBy: kindStart)..<s.index(s.startIndex, offsetBy: pos)])');
    lines.push('        if !ks.contains(kindStr) { return false }');
    lines.push('    }');
    lines.push('    pos += 1');
    lines.push('    if pos + 64 >= u.count { return false }');
    lines.push('    for i in 0..<64 {');
    lines.push('        let c = u[pos + i]');
    lines.push('        if !((c >= 0x30 && c <= 0x39) || (c >= 0x61 && c <= 0x66)) { return false }');
    lines.push('    }');
    lines.push('    pos += 64');
    lines.push('    if pos >= u.count || u[pos] != 0x3A { return false }');
    lines.push('    pos += 1');
    lines.push('    return checkDotTail(u, pos)');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkDatetimeIso')) {
    lines.push('private func checkDatetimeIso(_ s: String) -> Bool {');
    lines.push('    let u = Array(s.utf8)');
    lines.push('    if u.count < 10 { return false }');
    lines.push('    for i in 0..<4 { if u[i] < 0x30 || u[i] > 0x39 { return false } }');
    lines.push('    if u[4] != 0x2D { return false }');
    lines.push('    for i in 5..<7 { if u[i] < 0x30 || u[i] > 0x39 { return false } }');
    lines.push('    if u[7] != 0x2D { return false }');
    lines.push('    for i in 8..<10 { if u[i] < 0x30 || u[i] > 0x39 { return false } }');
    lines.push('    if u.count == 10 { return true }');
    lines.push('    if u[10] != 0x54 || u.count < 16 { return false }');
    lines.push('    for i in 11..<13 { if u[i] < 0x30 || u[i] > 0x39 { return false } }');
    lines.push('    if u[13] != 0x3A { return false }');
    lines.push('    for i in 14..<16 { if u[i] < 0x30 || u[i] > 0x39 { return false } }');
    lines.push('    var pos = 16');
    lines.push('    if pos == u.count { return true }');
    lines.push('    if u[pos] == 0x3A {');
    lines.push('        if pos + 3 > u.count { return false }');
    lines.push('        if u[pos+1] < 0x30 || u[pos+1] > 0x39 || u[pos+2] < 0x30 || u[pos+2] > 0x39 { return false }');
    lines.push('        pos += 3');
    lines.push('    }');
    lines.push('    if pos == u.count { return true }');
    lines.push('    if u[pos] == 0x2E {');
    lines.push('        pos += 1');
    lines.push('        if pos >= u.count || u[pos] < 0x30 || u[pos] > 0x39 { return false }');
    lines.push('        while pos < u.count && u[pos] >= 0x30 && u[pos] <= 0x39 { pos += 1 }');
    lines.push('    }');
    lines.push('    if pos == u.count { return true }');
    lines.push('    if u[pos] == 0x5A { return pos + 1 == u.count }');
    lines.push('    if u[pos] == 0x2B || u[pos] == 0x2D {');
    lines.push('        if pos + 6 != u.count { return false }');
    lines.push('        if u[pos+1] < 0x30 || u[pos+1] > 0x39 || u[pos+2] < 0x30 || u[pos+2] > 0x39 { return false }');
    lines.push('        if u[pos+3] != 0x3A { return false }');
    lines.push('        return u[pos+4] >= 0x30 && u[pos+4] <= 0x39 && u[pos+5] >= 0x30 && u[pos+5] <= 0x39');
    lines.push('    }');
    lines.push('    return false');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('regex')) {
    lines.push('private func checkRegex(_ s: String, _ pattern: String) -> Bool {');
    lines.push('    s.range(of: pattern, options: .regularExpression) != nil');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('isEcmaWs')) {
    lines.push('private func isEcmaWs(_ c: Character) -> Bool {');
    lines.push('    switch c {');
    lines.push('    case "\\t", "\\n", "\\u{000B}", "\\u{000C}", "\\r", " ",');
    lines.push('         "\\u{00A0}", "\\u{1680}",');
    lines.push('         "\\u{2000}"..."\\u{200A}",');
    lines.push('         "\\u{2028}", "\\u{2029}", "\\u{202F}", "\\u{205F}",');
    lines.push('         "\\u{3000}", "\\u{FEFF}":');
    lines.push('        return true');
    lines.push('    default:');
    lines.push('        return false');
    lines.push('    }');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkWrapped')) {
    lines.push('private func checkWrapped(_ s: String, _ prefix: String, _ suffix: String) -> Bool {');
    lines.push('    s.count >= prefix.count + suffix.count && s.hasPrefix(prefix) && s.hasSuffix(suffix)');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkCsvList')) {
    lines.push('private func checkCsvList(_ s: String, _ charset: String) -> Bool {');
    lines.push('    if s.isEmpty { return false }');
    lines.push('    let u = Array(s.utf8)');
    lines.push('    let cs = Array(charset.utf8)');
    lines.push('    var i = 0');
    lines.push('    while true {');
    lines.push('        let start = i');
    lines.push('        while i < u.count && cs.contains(u[i]) { i += 1 }');
    lines.push('        if i == start { return false }');
    lines.push('        if i == u.count { return true }');
    lines.push('        if u[i] != 0x2C { return false }');
    lines.push('        i += 1');
    lines.push('    }');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkLnInvoice')) {
    lines.push('private func checkLnInvoice(_ s: String, _ prefix: String, _ minHrpLen: Int) -> Bool {');
    lines.push('    guard s.hasPrefix(prefix) else { return false }');
    lines.push('    let u = Array(s.utf8)');
    lines.push('    var sep = -1');
    lines.push('    for j in stride(from: u.count - 1, through: 0, by: -1) {');
    lines.push('        if u[j] == 0x31 { sep = j; break }');
    lines.push('    }');
    lines.push('    if sep < 0 { return false }');
    lines.push('    if sep < minHrpLen { return false }');
    lines.push('    for j in 0..<sep {');
    lines.push('        let c = u[j]');
    lines.push('        if !((c >= 0x61 && c <= 0x7A) || (c >= 0x30 && c <= 0x39)) { return false }');
    lines.push('    }');
    lines.push('    if sep + 1 >= u.count { return false }');
    lines.push('    for j in (sep + 1)..<u.count {');
    lines.push('        if !isBech32Char(Character(UnicodeScalar(u[j]))) { return false }');
    lines.push('    }');
    lines.push('    return true');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkMimeType')) {
    lines.push('private func checkMimeType(_ s: String) -> Bool {');
    lines.push('    let u = Array(s.utf8)');
    lines.push('    var i = 0');
    lines.push('    if i >= u.count || u[i] < 0x61 || u[i] > 0x7A { return false }');
    lines.push('    while i < u.count && u[i] >= 0x61 && u[i] <= 0x7A { i += 1 }');
    lines.push('    if i >= u.count || u[i] != 0x2F { return false }');
    lines.push('    i += 1');
    lines.push('    let subStart = i');
    lines.push('    while i < u.count {');
    lines.push('        let c = u[i]');
    lines.push('        if (c >= 0x61 && c <= 0x7A) || (c >= 0x30 && c <= 0x39) || c == 0x2E || c == 0x2B || c == 0x2D { i += 1 }');
    lines.push('        else { break }');
    lines.push('    }');
    lines.push('    if i == subStart { return false }');
    lines.push('    return i == u.count');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkHttpOrigin')) {
    lines.push('private func checkHttpOrigin(_ s: String) -> Bool {');
    lines.push('    let u = Array(s.utf8)');
    lines.push('    var pos = 0');
    lines.push('    if u.count >= 8 && u[0] == 0x68 && u[1] == 0x74 && u[2] == 0x74 && u[3] == 0x70 && u[4] == 0x73 && u[5] == 0x3A && u[6] == 0x2F && u[7] == 0x2F { pos = 8 }');
    lines.push('    else if u.count >= 7 && u[0] == 0x68 && u[1] == 0x74 && u[2] == 0x74 && u[3] == 0x70 && u[4] == 0x3A && u[5] == 0x2F && u[6] == 0x2F { pos = 7 }');
    lines.push('    else { return false }');
    lines.push('    let hostStart = pos');
    lines.push('    while pos < u.count && u[pos] != 0x2F { pos += 1 }');
    lines.push('    if pos == hostStart { return false }');
    lines.push('    if pos < u.count && u[pos] == 0x2F { pos += 1 }');
    lines.push('    return pos == u.count');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkEmailLike')) {
    lines.push('private func checkEmailLike(_ s: String) -> Bool {');
    lines.push('    let chars = Array(s)');
    lines.push('    var i = 0');
    lines.push('    while i < chars.count && !isEcmaWs(chars[i]) && chars[i] != "@" { i += 1 }');
    lines.push('    if i == 0 { return false }');
    lines.push('    if i >= chars.count || chars[i] != "@" { return false }');
    lines.push('    i += 1');
    lines.push('    let afterAt = i');
    lines.push('    while i < chars.count && !isEcmaWs(chars[i]) && chars[i] != "@" { i += 1 }');
    lines.push('    if i == afterAt { return false }');
    lines.push('    return i == chars.count');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkGitCloneUrl')) {
    lines.push('private func checkGitCloneUrl(_ s: String) -> Bool {');
    lines.push('    let u = Array(s.utf8)');
    lines.push('    var pos = 0');
    lines.push('    if u.count >= 4 && u[0] == 0x67 && u[1] == 0x69 && u[2] == 0x74 && u[3] == 0x40 { pos = 4 }');
    lines.push('    else {');
    lines.push('        if u.isEmpty || u[0] < 0x61 || u[0] > 0x7A { return false }');
    lines.push('        pos = 1');
    lines.push('        while pos < u.count {');
    lines.push('            let c = u[pos]');
    lines.push('            if (c >= 0x61 && c <= 0x7A) || (c >= 0x30 && c <= 0x39) || c == 0x2B || c == 0x2E || c == 0x2D { pos += 1 }');
    lines.push('            else { break }');
    lines.push('        }');
    lines.push('        if pos + 3 > u.count || u[pos] != 0x3A || u[pos+1] != 0x2F || u[pos+2] != 0x2F { return false }');
    lines.push('        pos += 3');
    lines.push('    }');
    lines.push('    if pos >= u.count { return false }');
    lines.push('    // pos is a byte offset but prefix is all ASCII so it equals character offset');
    lines.push('    let tail = s[s.index(s.startIndex, offsetBy: pos)...]');
    lines.push('    for c in tail {');
    lines.push('        if isEcmaWs(c) { return false }');
    lines.push('    }');
    lines.push('    return true');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkContentType')) {
    lines.push('private func isTypeChar(_ c: UInt8) -> Bool {');
    lines.push('    (c >= 0x61 && c <= 0x7A) || (c >= 0x41 && c <= 0x5A) || (c >= 0x30 && c <= 0x39) || c == 0x21 || c == 0x23 || c == 0x24 || c == 0x26 || c == 0x5E || c == 0x5F || c == 0x2D');
    lines.push('}');
    lines.push('');
    lines.push('private func isSubtypeChar(_ c: UInt8) -> Bool {');
    lines.push('    isTypeChar(c) || c == 0x2E || c == 0x2B');
    lines.push('}');
    lines.push('');
    lines.push('private func checkContentType(_ s: String) -> Bool {');
    lines.push('    let u = Array(s.utf8)');
    lines.push('    var i = 0');
    lines.push('    if i >= u.count || !((u[i] >= 0x61 && u[i] <= 0x7A) || (u[i] >= 0x41 && u[i] <= 0x5A)) { return false }');
    lines.push('    i += 1');
    lines.push('    while i < u.count && isTypeChar(u[i]) { i += 1 }');
    lines.push('    if i >= u.count || u[i] != 0x2F { return false }');
    lines.push('    i += 1');
    lines.push('    if i >= u.count || !((u[i] >= 0x61 && u[i] <= 0x7A) || (u[i] >= 0x41 && u[i] <= 0x5A) || (u[i] >= 0x30 && u[i] <= 0x39) || u[i] == 0x2A) { return false }');
    lines.push('    i += 1');
    lines.push('    while i < u.count && isSubtypeChar(u[i]) { i += 1 }');
    lines.push('    let utf8 = s.utf8');
    lines.push('    while i < u.count {');
    lines.push('        let byteIdx = utf8.index(utf8.startIndex, offsetBy: i)');
    lines.push('        guard let ci = byteIdx.samePosition(in: s) else { break }');
    lines.push('        if !isEcmaWs(s[ci]) && s[ci] != ";" { break }');
    lines.push('        // skip OWS before semicolon');
    lines.push('        while i < u.count {');
    lines.push('            let bi = utf8.index(utf8.startIndex, offsetBy: i)');
    lines.push('            guard let si = bi.samePosition(in: s), isEcmaWs(s[si]) else { break }');
    lines.push('            i = utf8.distance(from: utf8.startIndex, to: s.index(after: si))');
    lines.push('        }');
    lines.push('        if i >= u.count || u[i] != 0x3B { return false }');
    lines.push('        i += 1');
    lines.push('        // skip OWS after semicolon');
    lines.push('        while i < u.count {');
    lines.push('            let bi = utf8.index(utf8.startIndex, offsetBy: i)');
    lines.push('            guard let si = bi.samePosition(in: s), isEcmaWs(s[si]) else { break }');
    lines.push('            i = utf8.distance(from: utf8.startIndex, to: s.index(after: si))');
    lines.push('        }');
    lines.push('        let paramStart = i');
    lines.push('        while i < u.count && isSubtypeChar(u[i]) { i += 1 }');
    lines.push('        if i == paramStart { return false }');
    lines.push('        if i >= u.count || u[i] != 0x3D { return false }');
    lines.push('        i += 1');
    lines.push('        let valStart = i');
    lines.push('        while i < u.count && isSubtypeChar(u[i]) { i += 1 }');
    lines.push('        if i == valStart { return false }');
    lines.push('    }');
    lines.push('    return i == u.count');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkDoi')) {
    lines.push('private func checkDoi(_ s: String) -> Bool {');
    lines.push('    let u = Array(s.utf8)');
    lines.push('    if u.count < 8 || u[0] != 0x31 || u[1] != 0x30 || u[2] != 0x2E { return false }');
    lines.push('    var i = 3');
    lines.push('    let digitStart = i');
    lines.push('    while i < u.count && u[i] >= 0x30 && u[i] <= 0x39 { i += 1 }');
    lines.push('    let digitCount = i - digitStart');
    lines.push('    if digitCount < 4 || digitCount > 9 { return false }');
    lines.push('    if i >= u.count || u[i] != 0x2F { return false }');
    lines.push('    i += 1');
    lines.push('    return checkDotTail(u, i)');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkAnnotateUser')) {
    lines.push('private func checkAnnotateUser(_ s: String) -> Bool {');
    lines.push('    let u = Array(s.utf8)');
    lines.push('    // "annotate-user " (14 bytes) + 64 hex + ":" + digit + ":" + digit = min 82');
    lines.push('    if u.count < 82 { return false }');
    lines.push('    let pfx: [UInt8] = Array("annotate-user ".utf8)');
    lines.push('    for j in 0..<pfx.count { if u[j] != pfx[j] { return false } }');
    lines.push('    for j in 14..<78 {');
    lines.push('        let c = u[j]');
    lines.push('        if !((c >= 0x30 && c <= 0x39) || (c >= 0x61 && c <= 0x66)) { return false }');
    lines.push('    }');
    lines.push('    var pos = 78');
    lines.push('    for _ in 0..<2 {');
    lines.push('        if pos >= u.count || u[pos] != 0x3A { return false }');
    lines.push('        pos += 1');
    lines.push('        let dstart = pos');
    lines.push('        while pos < u.count && u[pos] >= 0x30 && u[pos] <= 0x39 { pos += 1 }');
    lines.push('        if pos == dstart { return false }');
    lines.push('        if pos < u.count && u[pos] == 0x2E {');
    lines.push('            pos += 1');
    lines.push('            let fstart = pos');
    lines.push('            while pos < u.count && u[pos] >= 0x30 && u[pos] <= 0x39 { pos += 1 }');
    lines.push('            if pos == fstart { return false }');
    lines.push('        }');
    lines.push('    }');
    lines.push('    return pos == u.count');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkNoWsTail')) {
    lines.push('private func checkNoWsTail(_ s: String, _ offset: Int) -> Bool {');
    lines.push('    if offset >= s.count { return false }');
    lines.push('    let tail = s[s.index(s.startIndex, offsetBy: offset)...]');
    lines.push('    for c in tail {');
    lines.push('        if isEcmaWs(c) { return false }');
    lines.push('    }');
    lines.push('    return true');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkExternalIdentity')) {
    lines.push('private func checkExternalIdentity(_ s: String) -> Bool {');
    lines.push('    let u = Array(s.utf8)');
    lines.push('    var i = 0');
    lines.push('    while i < u.count {');
    lines.push('        let c = u[i]');
    lines.push('        if (c >= 0x61 && c <= 0x7A) || (c >= 0x30 && c <= 0x39) || c == 0x2E || c == 0x5F || c == 0x2D || c == 0x2F { i += 1 }');
    lines.push('        else { break }');
    lines.push('    }');
    lines.push('    if i == 0 { return false }');
    lines.push('    if i >= u.count || u[i] != 0x3A { return false }');
    lines.push('    return checkDotTail(u, i + 1)');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkImetaDim')) {
    lines.push('private func checkImetaDim(_ s: String) -> Bool {');
    lines.push('    let u = Array(s.utf8)');
    lines.push('    // "dim " + at least 1 digit + "x" + at least 1 digit = min 7');
    lines.push('    if u.count < 7 || u[0] != 0x64 || u[1] != 0x69 || u[2] != 0x6D || u[3] != 0x20 { return false }');
    lines.push('    var i = 4');
    lines.push('    let d1 = i');
    lines.push('    while i < u.count && u[i] >= 0x30 && u[i] <= 0x39 { i += 1 }');
    lines.push('    let d1len = i - d1');
    lines.push('    if d1len < 1 || d1len > 5 { return false }');
    lines.push('    if i >= u.count || u[i] != 0x78 { return false }');
    lines.push('    i += 1');
    lines.push('    let d2 = i');
    lines.push('    while i < u.count && u[i] >= 0x30 && u[i] <= 0x39 { i += 1 }');
    lines.push('    let d2len = i - d2');
    lines.push('    if d2len < 1 || d2len > 5 { return false }');
    lines.push('    return i == u.count');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkPackageId')) {
    lines.push('private func isPkgIdChar(_ c: UInt8) -> Bool {');
    lines.push('    (c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A) || (c >= 0x30 && c <= 0x39) || c == 0x2E || c == 0x5F || c == 0x2B || c == 0x2D');
    lines.push('}');
    lines.push('');
    lines.push('private func checkPackageId(_ s: String) -> Bool {');
    lines.push('    let u = Array(s.utf8)');
    lines.push('    if u.isEmpty { return false }');
    lines.push('    if u.count == 1 && u[0] == 0x23 { return true }');
    lines.push('    var i = 0');
    lines.push('    if !((u[i] >= 0x41 && u[i] <= 0x5A) || (u[i] >= 0x61 && u[i] <= 0x7A) || (u[i] >= 0x30 && u[i] <= 0x39)) { return false }');
    lines.push('    i += 1');
    lines.push('    while i < u.count && isPkgIdChar(u[i]) { i += 1 }');
    lines.push('    while i < u.count && u[i] == 0x3A {');
    lines.push('        i += 1');
    lines.push('        if i >= u.count || !((u[i] >= 0x41 && u[i] <= 0x5A) || (u[i] >= 0x61 && u[i] <= 0x7A) || (u[i] >= 0x30 && u[i] <= 0x39)) { return false }');
    lines.push('        i += 1');
    lines.push('        while i < u.count && isPkgIdChar(u[i]) { i += 1 }');
    lines.push('    }');
    lines.push('    return i == u.count');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkDim')) {
    lines.push('// ^[0-9]+x[0-9]+$');
    lines.push('private func checkDim(_ s: String) -> Bool {');
    lines.push('    let u = Array(s.utf8)');
    lines.push('    if u.isEmpty { return false }');
    lines.push('    var i = 0');
    lines.push('    if u[i] < 0x30 || u[i] > 0x39 { return false }');
    lines.push('    while i < u.count && u[i] >= 0x30 && u[i] <= 0x39 { i += 1 }');
    lines.push('    if i >= u.count || u[i] != 0x78 { return false }');
    lines.push('    i += 1');
    lines.push('    if i >= u.count || u[i] < 0x30 || u[i] > 0x39 { return false }');
    lines.push('    while i < u.count && u[i] >= 0x30 && u[i] <= 0x39 { i += 1 }');
    lines.push('    return i == u.count');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkNoUppercase')) {
    lines.push('// ^[^A-Z]+$');
    lines.push('private func checkNoUppercase(_ s: String) -> Bool {');
    lines.push('    if s.isEmpty { return false }');
    lines.push('    let u = Array(s.utf8)');
    lines.push('    for b in u {');
    lines.push('        if b >= 0x41 && b <= 0x5A { return false }');
    lines.push('    }');
    lines.push('    return true');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkDottedDigits')) {
    lines.push('// ^[0-9]+(\\.[0-9]+)*$');
    lines.push('private func checkDottedDigits(_ s: String) -> Bool {');
    lines.push('    let u = Array(s.utf8)');
    lines.push('    if u.isEmpty { return false }');
    lines.push('    var i = 0');
    lines.push('    if u[i] < 0x30 || u[i] > 0x39 { return false }');
    lines.push('    while i < u.count && u[i] >= 0x30 && u[i] <= 0x39 { i += 1 }');
    lines.push('    while i < u.count && u[i] == 0x2E {');
    lines.push('        i += 1');
    lines.push('        if i >= u.count || u[i] < 0x30 || u[i] > 0x39 { return false }');
    lines.push('        while i < u.count && u[i] >= 0x30 && u[i] <= 0x39 { i += 1 }');
    lines.push('    }');
    lines.push('    return i == u.count');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkSlashSegments')) {
    lines.push('// ^[charset]+(/[charset]+)*$');
    lines.push('private func checkSlashSegments(_ s: String, _ charset: String) -> Bool {');
    lines.push('    let u = Array(s.utf8)');
    lines.push('    let cs = Array(charset.utf8)');
    lines.push('    if u.isEmpty { return false }');
    lines.push('    var i = 0');
    lines.push('    if !cs.contains(u[i]) { return false }');
    lines.push('    while i < u.count && cs.contains(u[i]) { i += 1 }');
    lines.push('    while i < u.count && u[i] == 0x2F {');
    lines.push('        i += 1');
    lines.push('        if i >= u.count || !cs.contains(u[i]) { return false }');
    lines.push('        while i < u.count && cs.contains(u[i]) { i += 1 }');
    lines.push('    }');
    lines.push('    return i == u.count');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkSpaceSeparatedTokens')) {
    lines.push('// ^\\S+( \\S+)*$');
    lines.push('private func checkSpaceSeparatedTokens(_ s: String) -> Bool {');
    lines.push('    if s.isEmpty { return false }');
    lines.push('    let chars = Array(s)');
    lines.push('    var i = 0');
    lines.push('    // first token: 1+ non-whitespace');
    lines.push('    while i < chars.count && !isEcmaWs(chars[i]) { i += 1 }');
    lines.push('    if i == 0 { return false }');
    lines.push('    while i < chars.count && chars[i] == Character(" ") {');
    lines.push('        i += 1');
    lines.push('        if i >= chars.count || isEcmaWs(chars[i]) { return false }');
    lines.push('        while i < chars.count && !isEcmaWs(chars[i]) { i += 1 }');
    lines.push('    }');
    lines.push('    return i == chars.count');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkStartsWithCharset')) {
    lines.push('// ^[charset]+ (no end anchor)');
    lines.push('private func checkStartsWithCharset(_ s: String, _ charset: String) -> Bool {');
    lines.push('    if s.isEmpty { return false }');
    lines.push('    let cs = Array(charset.utf8)');
    lines.push('    let u = Array(s.utf8)');
    lines.push('    return cs.contains(u[0])');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkBase64')) {
    lines.push('private func isB64Char(_ b: UInt8) -> Bool {');
    lines.push('    (b >= 0x41 && b <= 0x5A) || (b >= 0x61 && b <= 0x7A) || (b >= 0x30 && b <= 0x39) || b == 0x2B || b == 0x2F');
    lines.push('}');
    lines.push('');
    lines.push('// standard base64');
    lines.push('private func checkBase64(_ s: String) -> Bool {');
    lines.push('    let u = Array(s.utf8)');
    lines.push('    let len = u.count');
    lines.push('    if len == 0 { return true }');
    lines.push('    if len % 4 != 0 { return false }');
    lines.push('    var i = 0');
    lines.push('    while i < len {');
    lines.push('        if u[i] == 0x3D { break }');
    lines.push('        if !isB64Char(u[i]) { return false }');
    lines.push('        i += 1');
    lines.push('    }');
    lines.push('    let dataLen = i');
    lines.push('    let padLen = len - dataLen');
    lines.push('    if padLen > 2 { return false }');
    lines.push('    if padLen == 1 && dataLen % 4 != 3 { return false }');
    lines.push('    if padLen == 2 && dataLen % 4 != 2 { return false }');
    lines.push('    while i < len {');
    lines.push('        if u[i] != 0x3D { return false }');
    lines.push('        i += 1');
    lines.push('    }');
    lines.push('    return true');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkBase642Pad')) {
    lines.push('// strict base64 with mandatory 2-char padding');
    lines.push('private func checkBase642Pad(_ s: String) -> Bool {');
    lines.push('    let u = Array(s.utf8)');
    lines.push('    let len = u.count');
    lines.push('    if len < 4 || len % 4 != 0 { return false }');
    lines.push('    if u[len - 1] != 0x3D || u[len - 2] != 0x3D { return false }');
    lines.push('    for i in 0..<len - 2 {');
    lines.push('        if !isB64Char(u[i]) { return false }');
    lines.push('    }');
    lines.push('    return true');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkNostrUri')) {
    lines.push('private func isNostrBech32DataChar(_ b: UInt8) -> Bool {');
    lines.push('    (b >= 0x30 && b <= 0x39 && b != 0x31) || (b >= 0x61 && b <= 0x7A && b != 0x62 && b != 0x69 && b != 0x6F)');
    lines.push('}');
    lines.push('');
    lines.push('// ^nostr:((npub|note)1[bech32]{58}|(nprofile|nevent|naddr)1[bech32]+)$');
    lines.push('private func checkNostrUri(_ s: String) -> Bool {');
    lines.push('    guard s.hasPrefix("nostr:") else { return false }');
    lines.push('    let u = Array(s.utf8)');
    lines.push('    let rest = u.count - 6');
    lines.push('    // npub1 or note1 + exactly 58 data chars = 63');
    lines.push('    if rest == 63 {');
    lines.push('        let p = Array(u[6...])');
    lines.push('        if (p[0] == 0x6E && p[1] == 0x70 && p[2] == 0x75 && p[3] == 0x62 && p[4] == 0x31) ||');
    lines.push('           (p[0] == 0x6E && p[1] == 0x6F && p[2] == 0x74 && p[3] == 0x65 && p[4] == 0x31) {');
    lines.push('            for j in 5..<63 {');
    lines.push('                if !isNostrBech32DataChar(p[j]) { return false }');
    lines.push('            }');
    lines.push('            return true');
    lines.push('        }');
    lines.push('    }');
    lines.push('    // nprofile1, nevent1, naddr1 + 1+ data chars');
    lines.push('    let p = Array(u[6...])');
    lines.push('    var prefixLen = 0');
    lines.push('    if rest > 9 && p[0] == 0x6E && p[1] == 0x70 && p[2] == 0x72 && p[3] == 0x6F && p[4] == 0x66 && p[5] == 0x69 && p[6] == 0x6C && p[7] == 0x65 && p[8] == 0x31 { prefixLen = 9 }');
    lines.push('    else if rest > 7 && p[0] == 0x6E && p[1] == 0x65 && p[2] == 0x76 && p[3] == 0x65 && p[4] == 0x6E && p[5] == 0x74 && p[6] == 0x31 { prefixLen = 7 }');
    lines.push('    else if rest > 6 && p[0] == 0x6E && p[1] == 0x61 && p[2] == 0x64 && p[3] == 0x64 && p[4] == 0x72 && p[5] == 0x31 { prefixLen = 6 }');
    lines.push('    if prefixLen == 0 || rest <= prefixLen { return false }');
    lines.push('    for j in prefixLen..<rest {');
    lines.push('        if !isNostrBech32DataChar(p[j]) { return false }');
    lines.push('    }');
    lines.push('    return true');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkNip04Encrypted')) {
    lines.push('// ^[A-Za-z0-9+/]+={0,2}\\?iv=[A-Za-z0-9+/]+={0,2}$');
    lines.push('private func checkNip04Encrypted(_ s: String) -> Bool {');
    lines.push('    let u = Array(s.utf8)');
    lines.push('    if u.isEmpty { return false }');
    lines.push('    // find "?iv=" separator');
    lines.push('    var sep = -1');
    lines.push('    for j in 0..<(u.count < 4 ? 0 : u.count - 3) {');
    lines.push('        if u[j] == 0x3F && u[j+1] == 0x69 && u[j+2] == 0x76 && u[j+3] == 0x3D {');
    lines.push('            sep = j');
    lines.push('            break');
    lines.push('        }');
    lines.push('    }');
    lines.push('    if sep <= 0 { return false }');
    lines.push('    if sep + 4 >= u.count { return false }');
    lines.push('    // check left half: 1+ b64 chars + 0-2 =');
    lines.push('    var i = 0');
    lines.push('    while i < sep && isB64Char(u[i]) { i += 1 }');
    lines.push('    if i == 0 { return false }');
    lines.push('    var eq = 0');
    lines.push('    while i < sep && u[i] == 0x3D { i += 1; eq += 1 }');
    lines.push('    if i != sep || eq > 2 { return false }');
    lines.push('    // check right half');
    lines.push('    i = sep + 4');
    lines.push('    let dataStart = i');
    lines.push('    while i < u.count && isB64Char(u[i]) { i += 1 }');
    lines.push('    if i == dataStart { return false }');
    lines.push('    eq = 0');
    lines.push('    while i < u.count && u[i] == 0x3D { i += 1; eq += 1 }');
    lines.push('    return i == u.count && eq <= 2');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('isAlnumByte')) {
    lines.push('private func isAlnumByte(_ b: UInt8) -> Bool {');
    lines.push('    (b >= 0x41 && b <= 0x5A) || (b >= 0x61 && b <= 0x7A) || (b >= 0x30 && b <= 0x39)');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkNip05Identifier')) {
    lines.push('private func isNip05LocalChar(_ b: UInt8) -> Bool {');
    lines.push('    b == 0x5F || (b >= 0x41 && b <= 0x5A) || (b >= 0x61 && b <= 0x7A) || (b >= 0x30 && b <= 0x39) || b == 0x2E || b == 0x2D');
    lines.push('}');
    lines.push('');
    lines.push('private func isDomainChar(_ b: UInt8) -> Bool {');
    lines.push('    (b >= 0x41 && b <= 0x5A) || (b >= 0x61 && b <= 0x7A) || (b >= 0x30 && b <= 0x39) || b == 0x2D');
    lines.push('}');
    lines.push('');
    lines.push('// NIP-05: local@domain.tld');
    lines.push('private func checkNip05Identifier(_ s: String) -> Bool {');
    lines.push('    let u = Array(s.utf8)');
    lines.push('    if u.isEmpty { return false }');
    lines.push('    // find last @');
    lines.push('    var atPos = -1');
    lines.push('    for j in 0..<u.count {');
    lines.push('        if u[j] == 0x40 { atPos = j }');
    lines.push('    }');
    lines.push('    if atPos <= 0 { return false }');
    lines.push('    // local part: [_A-Za-z0-9.-]+');
    lines.push('    for j in 0..<atPos {');
    lines.push('        if !isNip05LocalChar(u[j]) { return false }');
    lines.push('    }');
    lines.push('    // domain: 2+ dot-separated labels');
    lines.push('    let dStart = atPos + 1');
    lines.push('    let dLen = u.count - dStart');
    lines.push('    if dLen == 0 { return false }');
    lines.push('    var dotCount = 0');
    lines.push('    var di = dStart');
    lines.push('    while di < u.count {');
    lines.push('        if !isAlnumByte(u[di]) { return false }');
    lines.push('        while di < u.count && isDomainChar(u[di]) { di += 1 }');
    lines.push('        if !isAlnumByte(u[di - 1]) { return false }');
    lines.push('        if di < u.count && u[di] == 0x2E { dotCount += 1; di += 1 }');
    lines.push('        else if di < u.count { return false }');
    lines.push('    }');
    lines.push('    return dotCount >= 1 && isAlnumByte(u[u.count - 1])');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkMimeTypeStrict')) {
    lines.push('private func isMimeStrictChar(_ b: UInt8) -> Bool {');
    lines.push('    (b >= 0x41 && b <= 0x5A) || (b >= 0x61 && b <= 0x7A) || (b >= 0x30 && b <= 0x39) || b == 0x21 || b == 0x23 || b == 0x24 || b == 0x26 || b == 0x5E || b == 0x5F || b == 0x2E || b == 0x2B || b == 0x2D');
    lines.push('}');
    lines.push('');
    lines.push('// ^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$');
    lines.push('private func checkMimeTypeStrict(_ s: String) -> Bool {');
    lines.push('    let u = Array(s.utf8)');
    lines.push('    if u.isEmpty { return false }');
    lines.push('    var i = 0');
    lines.push('    if !isAlnumByte(u[i]) { return false }');
    lines.push('    i += 1');
    lines.push('    while i < u.count && isMimeStrictChar(u[i]) { i += 1 }');
    lines.push('    if i >= u.count || u[i] != 0x2F { return false }');
    lines.push('    i += 1');
    lines.push('    if i >= u.count || !isAlnumByte(u[i]) { return false }');
    lines.push('    i += 1');
    lines.push('    while i < u.count && isMimeStrictChar(u[i]) { i += 1 }');
    lines.push('    return i == u.count');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkPrefixDelimRest')) {
    lines.push('// ^[charset]+<delim>.+ (no end anchor)');
    lines.push('private func checkPrefixDelimRest(_ s: String, _ charset: String, _ delimiter: String) -> Bool {');
    lines.push('    let u = Array(s.utf8)');
    lines.push('    let cs = Array(charset.utf8)');
    lines.push('    let del = Array(delimiter.utf8)');
    lines.push('    if u.isEmpty { return false }');
    lines.push('    var i = 0');
    lines.push('    if !cs.contains(u[i]) { return false }');
    lines.push('    while i < u.count && cs.contains(u[i]) { i += 1 }');
    lines.push('    if i + del.count >= u.count { return false }');
    lines.push('    for j in 0..<del.count {');
    lines.push('        if u[i + j] != del[j] { return false }');
    lines.push('    }');
    lines.push('    i += del.count');
    lines.push('    if i >= u.count { return false }');
    lines.push('    // .+ first char must not be a line terminator (Swift . excludes \\n, \\r, NEL, LS, PS)');
    lines.push('    if u[i] == 0x0A || u[i] == 0x0D { return false }');
    lines.push('    if u[i] == 0xC2 && i + 1 < u.count && u[i+1] == 0x85 { return false }');
    lines.push('    if u[i] == 0xE2 && i + 2 < u.count && u[i+1] == 0x80 && (u[i+2] == 0xA8 || u[i+2] == 0xA9) { return false }');
    lines.push('    return true');
    lines.push('}');
    lines.push('');
  }

  return lines.join('\n');
}
