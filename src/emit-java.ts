/**
 * Java validator emitter: ValidatorAction[] → .java file
 *
 * Expression-oriented: uses Java streams (.stream().anyMatch(t -> ...))
 * for tag searching. Generated code is idiomatic modern Java (17+).
 *
 * Tag access model:
 *   - tags: List<List<String>>
 *   - t.get(i) with t.size() > i guard
 *   - Safe null: t.size() > i ? t.get(i) : null
 *   - Tag name: !t.isEmpty() && "name".equals(t.get(0))  (literal first for NPE safety)
 *   - String comparison: .equals() (not ==)
 *
 * Pattern helpers as private static methods: checkHex64, checkDigits, etc.
 * Imports java.util.regex.Pattern only if regex fallback is used.
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

function renderPatternCheckJava(check: PatternCheck, varExpr: string): { expr: string; helpers: Set<string> } {
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
      const checks = check.prefixes.map(p => `${varExpr} != null && ${varExpr}.startsWith(${JSON.stringify(p)})`);
      return { expr: checks.length === 1 ? checks[0] : `(${checks.join(' || ')})`, helpers };
    }
    case 'chars_in': {
      if (check.min === 0 && check.max === 0) {
        return { expr: `${varExpr} != null && ${varExpr}.isEmpty()`, helpers };
      }
      helpers.add('checkCharsIn');
      const maxVal = check.max !== undefined ? String(check.max) : 'Integer.MAX_VALUE';
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
      return { expr: `checkBech32(${varExpr}, ${JSON.stringify(check.hrp + '1')}, -1)`, helpers };
    }
    case 'regex': {
      helpers.add('regex');
      return { expr: `Pattern.matches(${JSON.stringify(check.pattern)}, ${varExpr})`, helpers };
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
        const r = renderPatternCheckJava(sub, varExpr);
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

/**
 * Render a value check for tag matching context (stream lambda).
 * Uses t.size() > i guard and t.get(i) access.
 */
function renderValueCheckJava(
  check: ValueCheck,
  tagVar: string,
  index: number,
): { expr: string; helpers: Set<string> } {
  const helpers = new Set<string>();
  const sizeGuard = `${tagVar}.size() > ${index}`;
  const access = `${tagVar}.get(${index})`;

  switch (check.type) {
    case 'const':
      return { expr: `${sizeGuard} && ${JSON.stringify(check.value)}.equals(${access})`, helpers };
    case 'enum': {
      const vals = check.values.map(v => JSON.stringify(v));
      return {
        expr: `${sizeGuard} && List.of(${vals.join(', ')}).contains(${access})`,
        helpers,
      };
    }
    case 'pattern': {
      const r = renderPatternCheckJava(check.native, access);
      for (const h of r.helpers) helpers.add(h);
      return {
        expr: `${sizeGuard} && ${r.expr}`,
        helpers,
      };
    }
    case 'anyOf': {
      const parts: string[] = [];
      for (const alt of check.alternatives) {
        const r = renderValueCheckJava(alt, tagVar, index);
        parts.push(`(${r.expr})`);
        for (const h of r.helpers) helpers.add(h);
      }
      return { expr: `(${parts.join(' || ')})`, helpers };
    }
  }
}

/**
 * Render a value check for optional position validation context.
 * Here we already know t.size() > index, so no size guard on the access.
 */
function renderValueCheckJavaNoGuard(
  check: ValueCheck,
  tagVar: string,
  index: number,
): { expr: string; helpers: Set<string> } {
  const helpers = new Set<string>();
  const access = `${tagVar}.get(${index})`;

  switch (check.type) {
    case 'const':
      return { expr: `${JSON.stringify(check.value)}.equals(${access})`, helpers };
    case 'enum': {
      const vals = check.values.map(v => JSON.stringify(v));
      return {
        expr: `List.of(${vals.join(', ')}).contains(${access})`,
        helpers,
      };
    }
    case 'pattern': {
      const r = renderPatternCheckJava(check.native, access);
      for (const h of r.helpers) helpers.add(h);
      return {
        expr: r.expr,
        helpers,
      };
    }
    case 'anyOf': {
      const parts: string[] = [];
      for (const alt of check.alternatives) {
        const r = renderValueCheckJavaNoGuard(alt, tagVar, index);
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

// --- Tag matcher rendering (stream lambda) ---

function renderTagMatcherJava(
  matcher: TagMatcher,
  tagVar: string,
  helpers: Set<string>,
): string {
  const checks: string[] = [];

  checks.push(`!${tagVar}.isEmpty() && ${JSON.stringify(matcher.tagName)}.equals(${tagVar}.get(0))`);
  checks.push(`${tagVar}.size() >= ${matcher.minItems}`);
  if (matcher.maxItems !== undefined) {
    checks.push(`${tagVar}.size() <= ${matcher.maxItems}`);
  }

  for (const pc of matcher.positionChecks) {
    const r = renderValueCheckJava(pc.check, tagVar, pc.index);
    for (const h of r.helpers) helpers.add(h);
    checks.push(r.expr);
  }

  return checks.join(' && ');
}

// --- Main emitter ---

export function emitJavaValidators(kindShapes: KindShape[]): string {
  const allHelpers = new Set<string>();
  const fnBodies: string[] = [];
  const constrainedKinds: { kindNumber: number; nip: string }[] = [];

  for (const shape of [...kindShapes].sort((a, b) => a.kindNumber - b.kindNumber)) {
    const actions = planKindValidator(shape);
    if (!actions) continue;

    constrainedKinds.push({ kindNumber: shape.kindNumber, nip: shape.nip });
    const { code, helpers } = emitKindFunctionJava(shape.kindNumber, shape.nip, actions);
    fnBodies.push(code);
    for (const h of helpers) allHelpers.add(h);
  }

  return emitJavaFile(fnBodies, constrainedKinds, allHelpers);
}

function emitKindFunctionJava(
  kindNumber: number,
  nip: string,
  actions: ValidatorAction[],
): { code: string; helpers: Set<string> } {
  const helpers = new Set<string>();
  const lines: string[] = [];

  lines.push(`    /** Validate tags for kind ${kindNumber} (${nip}). */`);
  lines.push(`    public static List<ValidationError> validateKind${kindNumber}(List<List<String>> tags) {`);
  lines.push('        List<ValidationError> errors = new ArrayList<>();');

  for (const action of actions) {
    switch (action.type) {
      case 'check_min_tags':
        lines.push(`        if (tags.size() < ${action.min}) {`);
        lines.push(`            errors.add(new ValidationError("tags", "tags must have at least ${action.min} item(s)"));`);
        lines.push('        }');
        break;

      case 'require_tag': {
        const matcherExpr = renderTagMatcherJava(action.matcher, 't', helpers);
        lines.push(`        if (tags.stream().noneMatch(t -> ${matcherExpr})) {`);
        lines.push(`            errors.add(new ValidationError("tags", ${JSON.stringify(action.errorMsg)}));`);
        lines.push('        }');
        break;
      }

      case 'validate_optional_positions': {
        lines.push('        for (List<String> t : tags) {');
        lines.push(`            if (!t.isEmpty() && ${JSON.stringify(action.tagName)}.equals(t.get(0))) {`);
        for (const pc of action.checks) {
          const r = renderValueCheckJavaNoGuard(pc.check, 't', pc.index);
          for (const h of r.helpers) helpers.add(h);
          const msg = describePositionConstraint(pc, action.tagName);
          lines.push(`                if (t.size() > ${pc.index} && !(${r.expr})) {`);
          lines.push(`                    errors.add(new ValidationError("tags", ${JSON.stringify(msg)}));`);
          lines.push('                }');
        }
        lines.push('            }');
        lines.push('        }');
        break;
      }

      case 'per_item_conditional': {
        const matcherExpr = renderTagMatcherJava(action.matcher, 't', helpers);
        lines.push('        for (List<String> t : tags) {');
        lines.push(`            if (!t.isEmpty() && ${JSON.stringify(action.condTag)}.equals(t.get(0)) && !(${matcherExpr})) {`);
        lines.push(`                errors.add(new ValidationError("tags", ${JSON.stringify(action.errorMsg)}));`);
        lines.push('            }');
        if (action.optChecks.length > 0) {
          lines.push(`            if (!t.isEmpty() && ${JSON.stringify(action.condTag)}.equals(t.get(0))) {`);
          for (const pc of action.optChecks) {
            const r = renderValueCheckJavaNoGuard(pc.check, 't', pc.index);
            for (const h of r.helpers) helpers.add(h);
            const msg = describePositionConstraint(pc, action.condTag);
            lines.push(`                if (t.size() > ${pc.index} && !(${r.expr})) {`);
            lines.push(`                    errors.add(new ValidationError("tags", ${JSON.stringify(msg)}));`);
            lines.push('                }');
          }
          lines.push('            }');
        }
        lines.push('        }');
        break;
      }

      case 'array_level_conditional': {
        lines.push(`        if (tags.stream().anyMatch(t -> !t.isEmpty() && ${JSON.stringify(action.condTag)}.equals(t.get(0)))) {`);
        const matcherExpr = renderTagMatcherJava(action.matcher, 't', helpers);
        lines.push(`            if (tags.stream().noneMatch(t -> ${matcherExpr})) {`);
        lines.push(`                errors.add(new ValidationError("tags", ${JSON.stringify(action.errorMsg)}));`);
        lines.push('            }');
        if (action.optChecks.length > 0) {
          lines.push('            for (List<String> t : tags) {');
          lines.push(`                if (!t.isEmpty() && ${JSON.stringify(action.matcher.tagName)}.equals(t.get(0))) {`);
          for (const pc of action.optChecks) {
            const r = renderValueCheckJavaNoGuard(pc.check, 't', pc.index);
            for (const h of r.helpers) helpers.add(h);
            const msg = describePositionConstraint(pc, action.matcher.tagName);
            lines.push(`                    if (t.size() > ${pc.index} && !(${r.expr})) {`);
            lines.push(`                        errors.add(new ValidationError("tags", ${JSON.stringify(msg)}));`);
            lines.push('                    }');
          }
          lines.push('                }');
          lines.push('            }');
        }
        lines.push('        }');
        break;
      }

      case 'any_of_group': {
        const matchers = action.matchers.map(m => {
          const expr = renderTagMatcherJava(m, 't', helpers);
          return `tags.stream().anyMatch(t -> ${expr})`;
        });
        lines.push(`        if (!(${matchers.join(' || ')})) {`);
        lines.push(`            errors.add(new ValidationError("tags", ${JSON.stringify(action.errorMsg)}));`);
        lines.push('        }');
        break;
      }
    }
  }

  lines.push('        return errors;');
  lines.push('    }');

  return { code: lines.join('\n'), helpers };
}

// --- File generation ---

function emitJavaFile(
  fnBodies: string[],
  constrainedKinds: { kindNumber: number; nip: string }[],
  helpers: Set<string>,
): string {
  const lines: string[] = [
    '// Auto-generated by @nostrability/schemata-codegen',
    '// Do not edit manually.',
    '//',
    '// Runtime validators for Nostr event tag constraints.',
    '',
    'import java.util.ArrayList;',
    'import java.util.List;',
  ];

  if (helpers.has('regex')) {
    lines.push('import java.util.regex.Pattern;');
  }

  lines.push('');
  lines.push('public final class SchemataValidators {');
  lines.push('');
  lines.push('    public record ValidationError(String path, String message) {}');
  lines.push('');
  lines.push('    private SchemataValidators() {}');
  lines.push('');

  // Helper functions
  const helperCode = emitJavaHelpers(helpers);
  if (helperCode) {
    lines.push(helperCode);
  }

  // Per-kind functions
  for (const fn of fnBodies) {
    lines.push(fn);
    lines.push('');
  }

  // Dispatch function
  lines.push('    /** Validate tags for a given kind number. Returns empty list if kind has no constraints or is unknown. */');
  lines.push('    public static List<ValidationError> validateKindTags(int kind, List<List<String>> tags) {');
  lines.push('        switch (kind) {');
  for (const k of constrainedKinds) {
    lines.push(`            case ${k.kindNumber}: return validateKind${k.kindNumber}(tags);`);
  }
  lines.push('            default: return List.of();');
  lines.push('        }');
  lines.push('    }');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

function emitJavaHelpers(helpers: Set<string>): string {
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
    lines.push(`    private static boolean checkHex${len}(String s) {`);
    lines.push(`        return s != null && s.length() == ${len} && s.chars().allMatch(c -> (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'));`);
    lines.push('    }');
    lines.push('');
  }

  for (const len of [...hexMixedLengths].sort((a, b) => a - b)) {
    lines.push(`    private static boolean checkHex${len}Mixed(String s) {`);
    lines.push(`        return s != null && s.length() == ${len} && s.chars().allMatch(c -> (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'));`);
    lines.push('    }');
    lines.push('');
  }

  if (helpers.has('checkHexRange')) {
    lines.push('    private static boolean checkHexRange(String s, int min, int max) {');
    lines.push('        if (s == null) return false;');
    lines.push('        int len = s.length();');
    lines.push("        return len >= min && len <= max && s.chars().allMatch(c -> (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'));");
    lines.push('    }');
    lines.push('');
  }

  if (helpers.has('checkHexRangeMixed')) {
    lines.push('    private static boolean checkHexRangeMixed(String s, int min, int max) {');
    lines.push('        if (s == null) return false;');
    lines.push('        int len = s.length();');
    lines.push("        return len >= min && len <= max && s.chars().allMatch(c -> (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'));");
    lines.push('    }');
    lines.push('');
  }

  if (helpers.has('checkHexPrefixed')) {
    lines.push('    private static boolean checkHexPrefixed(String s, String prefix, int hexLen) {');
    lines.push('        if (s == null || !s.startsWith(prefix)) return false;');
    lines.push('        String rest = s.substring(prefix.length());');
    lines.push("        return rest.length() == hexLen && rest.chars().allMatch(c -> (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'));");
    lines.push('    }');
    lines.push('');
  }

  if (helpers.has('checkDigits')) {
    lines.push('    private static boolean checkDigits(String s) {');
    lines.push("        return s != null && !s.isEmpty() && s.chars().allMatch(c -> c >= '0' && c <= '9');");
    lines.push('    }');
    lines.push('');
  }

  if (helpers.has('checkSignedInt')) {
    lines.push('    private static boolean checkSignedInt(String s) {');
    lines.push('        if (s == null || s.isEmpty()) return false;');
    lines.push("        String digits = s.startsWith(\"-\") ? s.substring(1) : s;");
    lines.push("        return !digits.isEmpty() && digits.chars().allMatch(c -> c >= '0' && c <= '9');");
    lines.push('    }');
    lines.push('');
  }

  if (helpers.has('checkCharsIn')) {
    lines.push('    private static boolean checkCharsIn(String s, String charset, int min, int max) {');
    lines.push('        if (s == null) return false;');
    lines.push('        int len = s.length();');
    lines.push('        return len >= min && len <= max && s.chars().allMatch(c -> charset.indexOf(c) >= 0);');
    lines.push('    }');
    lines.push('');
  }

  if (helpers.has('checkDateIso')) {
    lines.push('    private static boolean checkDateIso(String s) {');
    lines.push("        if (s == null || s.length() != 10 || s.charAt(4) != '-' || s.charAt(7) != '-') return false;");
    lines.push('        for (int i = 0; i < 10; i++) {');
    lines.push('            if (i == 4 || i == 7) continue;');
    lines.push("            char c = s.charAt(i);");
    lines.push("            if (c < '0' || c > '9') return false;");
    lines.push('        }');
    lines.push('        return true;');
    lines.push('    }');
    lines.push('');
  }

  if (helpers.has('checkDecimal')) {
    lines.push('    private static boolean checkDecimal(String s) {');
    lines.push('        if (s == null || s.isEmpty()) return false;');
    lines.push('        int i = 0;');
    lines.push("        while (i < s.length() && s.charAt(i) >= '0' && s.charAt(i) <= '9') i++;");
    lines.push("        if (i == 0) return false;");
    lines.push("        if (i < s.length() && s.charAt(i) == '.') {");
    lines.push('            i++;');
    lines.push("            if (i >= s.length() || s.charAt(i) < '0' || s.charAt(i) > '9') return false;");
    lines.push("            while (i < s.length() && s.charAt(i) >= '0' && s.charAt(i) <= '9') i++;");
    lines.push('        }');
    lines.push('        return i == s.length();');
    lines.push('    }');
    lines.push('');
  }

  if (helpers.has('checkRelayUrl')) {
    lines.push('    private static boolean checkRelayUrl(String s) {');
    lines.push('        if (s == null) return false;');
    lines.push('        int pos;');
    lines.push('        if (s.startsWith("wss://")) { pos = 6; }');
    lines.push('        else if (s.startsWith("ws://")) { pos = 5; }');
    lines.push('        else { return false; }');
    lines.push('        int hostStart = pos;');
    lines.push('        while (pos < s.length()) {');
    lines.push('            char c = s.charAt(pos);');
    lines.push("            if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '-') { pos++; }");
    lines.push('            else { break; }');
    lines.push('        }');
    lines.push('        if (pos == hostStart) return false;');
    lines.push("        if (pos < s.length() && s.charAt(pos) == ':') {");
    lines.push('            pos++;');
    lines.push('            int portStart = pos;');
    lines.push("            while (pos < s.length() && s.charAt(pos) >= '0' && s.charAt(pos) <= '9') pos++;");
    lines.push('            if (pos == portStart) return false;');
    lines.push('        }');
    lines.push("        if (pos < s.length() && s.charAt(pos) == '/') {");
    lines.push('            for (int j = pos + 1; j < s.length(); j++) {');
    lines.push("                char ch = s.charAt(j);");
    lines.push("                if (ch == '\\n' || ch == '\\r') return false;");
    lines.push('            }');
    lines.push('            return true;');
    lines.push('        }');
    lines.push('        return pos == s.length();');
    lines.push('    }');
    lines.push('');
  }

  if (helpers.has('checkBech32')) {
    lines.push('    private static boolean isBech32Char(char c) {');
    lines.push("        return (c >= '0' && c <= '9' && c != '1') || (c >= 'a' && c <= 'z' && c != 'b' && c != 'i' && c != 'o');");
    lines.push('    }');
    lines.push('');
    lines.push('    private static boolean checkBech32(String s, String prefix, int dataLen) {');
    lines.push('        if (s == null || !s.startsWith(prefix)) return false;');
    lines.push('        String data = s.substring(prefix.length());');
    lines.push('        if (data.isEmpty() || !data.chars().allMatch(c -> isBech32Char((char) c))) return false;');
    lines.push('        if (dataLen >= 0) return data.length() == dataLen;');
    lines.push('        return true;');
    lines.push('    }');
    lines.push('');
  }

  return lines.join('\n');
}
