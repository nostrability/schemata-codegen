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
    case 'date_iso': {
      helpers.add('checkDateIso');
      return { expr: `checkDateIso(${varExpr})`, helpers };
    }
    case 'decimal': {
      helpers.add('checkDecimal');
      return { expr: `checkDecimal(${varExpr})`, helpers };
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
    lines.push('    if pos < u.count && u[pos] == 0x2F { return true }');
    lines.push('    return pos == u.count');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('regex')) {
    lines.push('private func checkRegex(_ s: String, _ pattern: String) -> Bool {');
    lines.push('    s.range(of: pattern, options: .regularExpression) != nil');
    lines.push('}');
    lines.push('');
  }

  return lines.join('\n');
}
