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
    case 'a_tag': {
      helpers.add('checkATag');
      if (check.kinds && check.kinds.length > 0) {
        const arr = check.kinds.map(k => JSON.stringify(k)).join(', ');
        return { expr: `checkATag(${varExpr}, new String[]{${arr}})`, helpers };
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
      const checks = check.values.map(v => `${JSON.stringify(v)}.equals(${varExpr})`);
      return { expr: checks.length === 1 ? checks[0] : `(${checks.join(' || ')})`, helpers };
    }
    case 'prefix_nonempty': {
      helpers.add('checkDotTail');
      return {
        expr: `(${varExpr} != null && ${varExpr}.startsWith(${JSON.stringify(check.prefix)}) && checkDotTail(${varExpr}, ${check.prefix.length}))`,
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
        `(${varExpr} != null && ${varExpr}.startsWith(${JSON.stringify(p)}) && checkNoWsTail(${varExpr}, ${p.length}))`
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
      return { expr: `checkNip05Identifier(${varExpr})`, helpers };
    }
    case 'mime_type_strict': {
      helpers.add('checkMimeTypeStrict');
      return { expr: `checkMimeTypeStrict(${varExpr})`, helpers };
    }
    case 'prefix_delim_rest': {
      helpers.add('checkPrefixDelimRest');
      return { expr: `checkPrefixDelimRest(${varExpr}, ${JSON.stringify(check.charset)}, ${JSON.stringify(check.delimiter)})`, helpers };
    }
    case 'identifier': {
      helpers.add('checkIdentifier');
      return { expr: `checkIdentifier(${varExpr}, ${JSON.stringify(check.firstCharset)}, ${JSON.stringify(check.restCharset)}${check.optionalPrefix ? `, '${check.optionalPrefix}'` : `, (char) 0`})`, helpers };
    }
    case 'space_separated_charset': {
      helpers.add('checkSpaceSeparatedCharset');
      return { expr: `checkSpaceSeparatedCharset(${varExpr}, ${JSON.stringify(check.charset)})`, helpers };
    }
    case 'uri_scheme': {
      helpers.add('checkUriScheme');
      return { expr: `checkUriScheme(${varExpr})`, helpers };
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

  if (helpers.has('checkRelayUrl') || helpers.has('checkATag') || helpers.has('checkDotTail')) {
    lines.push('    private static boolean checkDotTail(String s, int pos) {');
    lines.push('        if (pos >= s.length()) return false;');
    lines.push('        for (int j = pos; j < s.length(); j++) {');
    lines.push("            char ch = s.charAt(j);");
    lines.push("            if (ch == '\\n' || ch == '\\r' || ch == '\\u0085' || ch == '\\u2028' || ch == '\\u2029') return false;");
    lines.push('        }');
    lines.push('        return true;');
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
    lines.push('            return checkDotTail(s, pos + 1) || pos + 1 == s.length();');
    lines.push('        }');
    lines.push('        return pos == s.length();');
    lines.push('    }');
    lines.push('');
  }

  if (helpers.has('checkATag')) {
    lines.push('    private static boolean checkATag(String s, String[] kinds) {');
    lines.push('        if (s == null || s.length() < 68) return false;');
    lines.push('        int kindStart = 0;');
    lines.push("        if (s.charAt(0) < '0' || s.charAt(0) > '9') return false;");
    lines.push('        int pos = 0;');
    lines.push("        while (pos < s.length() && s.charAt(pos) >= '0' && s.charAt(pos) <= '9') pos++;");
    lines.push("        if (pos >= s.length() || s.charAt(pos) != ':') return false;");
    lines.push('        int colonPos = pos;');
    lines.push('        int kindLen = colonPos - kindStart;');
    lines.push('        if (kinds != null) {');
    lines.push('            String kindStr = s.substring(kindStart, colonPos);');
    lines.push('            boolean found = false;');
    lines.push('            for (String k : kinds) { if (kindStr.equals(k)) { found = true; break; } }');
    lines.push('            if (!found) return false;');
    lines.push('        }');
    lines.push('        pos = colonPos + 1;');
    lines.push('        if (pos + 64 >= s.length()) return false;');
    lines.push('        for (int i = 0; i < 64; i++) {');
    lines.push('            char c = s.charAt(pos + i);');
    lines.push("            if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;");
    lines.push('        }');
    lines.push('        pos += 64;');
    lines.push("        if (pos >= s.length() || s.charAt(pos) != ':') return false;");
    lines.push('        pos++;');
    lines.push('        return checkDotTail(s, pos);');
    lines.push('    }');
    lines.push('');
  }

  if (helpers.has('checkDatetimeIso')) {
    lines.push('    private static boolean checkDatetimeIso(String s) {');
    lines.push('        if (s == null || s.length() < 10) return false;');
    lines.push("        for (int i = 0; i < 4; i++) if (s.charAt(i) < '0' || s.charAt(i) > '9') return false;");
    lines.push("        if (s.charAt(4) != '-') return false;");
    lines.push("        for (int i = 5; i < 7; i++) if (s.charAt(i) < '0' || s.charAt(i) > '9') return false;");
    lines.push("        if (s.charAt(7) != '-') return false;");
    lines.push("        for (int i = 8; i < 10; i++) if (s.charAt(i) < '0' || s.charAt(i) > '9') return false;");
    lines.push('        if (s.length() == 10) return true;');
    lines.push("        if (s.charAt(10) != 'T' || s.length() < 16) return false;");
    lines.push("        for (int i = 11; i < 13; i++) if (s.charAt(i) < '0' || s.charAt(i) > '9') return false;");
    lines.push("        if (s.charAt(13) != ':') return false;");
    lines.push("        for (int i = 14; i < 16; i++) if (s.charAt(i) < '0' || s.charAt(i) > '9') return false;");
    lines.push('        int pos = 16;');
    lines.push('        if (pos == s.length()) return true;');
    lines.push("        if (s.charAt(pos) == ':') {");
    lines.push('            if (pos + 3 > s.length()) return false;');
    lines.push("            if (s.charAt(pos+1) < '0' || s.charAt(pos+1) > '9' || s.charAt(pos+2) < '0' || s.charAt(pos+2) > '9') return false;");
    lines.push('            pos += 3;');
    lines.push('        }');
    lines.push('        if (pos == s.length()) return true;');
    lines.push("        if (s.charAt(pos) == '.') {");
    lines.push('            pos++;');
    lines.push("            if (pos >= s.length() || s.charAt(pos) < '0' || s.charAt(pos) > '9') return false;");
    lines.push("            while (pos < s.length() && s.charAt(pos) >= '0' && s.charAt(pos) <= '9') pos++;");
    lines.push('        }');
    lines.push('        if (pos == s.length()) return true;');
    lines.push("        if (s.charAt(pos) == 'Z') return pos + 1 == s.length();");
    lines.push("        if (s.charAt(pos) == '+' || s.charAt(pos) == '-') {");
    lines.push('            if (pos + 6 != s.length()) return false;');
    lines.push("            if (s.charAt(pos+1) < '0' || s.charAt(pos+1) > '9' || s.charAt(pos+2) < '0' || s.charAt(pos+2) > '9') return false;");
    lines.push("            if (s.charAt(pos+3) != ':') return false;");
    lines.push("            return s.charAt(pos+4) >= '0' && s.charAt(pos+4) <= '9' && s.charAt(pos+5) >= '0' && s.charAt(pos+5) <= '9';");
    lines.push('        }');
    lines.push('        return false;');
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

  if (helpers.has('checkWrapped')) {
    lines.push('    private static boolean checkWrapped(String s, String prefix, String suffix) {');
    lines.push('        return s != null && s.length() >= prefix.length() + suffix.length() && s.startsWith(prefix) && s.endsWith(suffix);');
    lines.push('    }');
    lines.push('');
  }

  if (helpers.has('checkCsvList')) {
    lines.push('    private static boolean checkCsvList(String s, String charset) {');
    lines.push('        if (s == null || s.isEmpty()) return false;');
    lines.push('        int i = 0;');
    lines.push('        while (true) {');
    lines.push('            int start = i;');
    lines.push('            while (i < s.length() && charset.indexOf(s.charAt(i)) >= 0) i++;');
    lines.push('            if (i == start) return false;');
    lines.push('            if (i == s.length()) return true;');
    lines.push("            if (s.charAt(i) != ',') return false;");
    lines.push('            i++;');
    lines.push('        }');
    lines.push('    }');
    lines.push('');
  }

  if (helpers.has('isEcmaWs')) {
    lines.push('    private static boolean isEcmaWs(char c) {');
    lines.push("        return c == '\\t' || c == '\\n' || c == '\\u000B' || c == '\\f' || c == '\\r' || c == ' '");
    lines.push("            || c == '\\u00A0' || c == '\\u1680'");
    lines.push("            || (c >= '\\u2000' && c <= '\\u200A')");
    lines.push("            || c == '\\u2028' || c == '\\u2029' || c == '\\u202F' || c == '\\u205F'");
    lines.push("            || c == '\\u3000' || c == '\\uFEFF';");
    lines.push('    }');
    lines.push('');
  }

  if (helpers.has('checkLnInvoice')) {
    lines.push('    private static boolean isBech32Data(char c) {');
    lines.push("        return (c >= '0' && c <= '9' && c != '1') || (c >= 'a' && c <= 'z' && c != 'b' && c != 'i' && c != 'o');");
    lines.push('    }');
    lines.push('');
    lines.push('    private static boolean checkLnInvoice(String s, String prefix, int minHrpLen) {');
    lines.push('        if (s == null || !s.startsWith(prefix)) return false;');
    lines.push("        int sep = s.lastIndexOf('1');");
    lines.push('        if (sep < 0) return false;');
    lines.push('        String hrp = s.substring(0, sep);');
    lines.push('        if (hrp.length() < minHrpLen) return false;');
    lines.push('        for (int i = 0; i < hrp.length(); i++) {');
    lines.push('            char c = hrp.charAt(i);');
    lines.push("            if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'))) return false;");
    lines.push('        }');
    lines.push('        String data = s.substring(sep + 1);');
    lines.push('        if (data.isEmpty()) return false;');
    lines.push('        for (int i = 0; i < data.length(); i++) {');
    lines.push('            if (!isBech32Data(data.charAt(i))) return false;');
    lines.push('        }');
    lines.push('        return true;');
    lines.push('    }');
    lines.push('');
  }

  if (helpers.has('checkMimeType')) {
    lines.push('    private static boolean checkMimeType(String s) {');
    lines.push('        if (s == null || s.isEmpty()) return false;');
    lines.push('        int i = 0;');
    lines.push("        if (s.charAt(i) < 'a' || s.charAt(i) > 'z') return false;");
    lines.push("        while (i < s.length() && s.charAt(i) >= 'a' && s.charAt(i) <= 'z') i++;");
    lines.push("        if (i >= s.length() || s.charAt(i) != '/') return false;");
    lines.push('        i++;');
    lines.push('        if (i >= s.length()) return false;');
    lines.push('        char c = s.charAt(i);');
    lines.push("        if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '+' || c == '-')) return false;");
    lines.push("        while (i < s.length()) { c = s.charAt(i); if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '+' || c == '-') i++; else break; }");
    lines.push('        return i == s.length();');
    lines.push('    }');
    lines.push('');
  }

  if (helpers.has('checkHttpOrigin')) {
    lines.push('    private static boolean checkHttpOrigin(String s) {');
    lines.push('        if (s == null) return false;');
    lines.push('        int pos;');
    lines.push('        if (s.startsWith("https://")) { pos = 8; }');
    lines.push('        else if (s.startsWith("http://")) { pos = 7; }');
    lines.push('        else { return false; }');
    lines.push('        int start = pos;');
    lines.push("        while (pos < s.length() && s.charAt(pos) != '/') pos++;");
    lines.push('        if (pos == start) return false;');
    lines.push("        if (pos < s.length() && s.charAt(pos) == '/') pos++;");
    lines.push('        return pos == s.length();');
    lines.push('    }');
    lines.push('');
  }

  if (helpers.has('checkEmailLike')) {
    lines.push('    private static boolean checkEmailLike(String s) {');
    lines.push('        if (s == null || s.isEmpty()) return false;');
    lines.push('        int i = 0;');
    lines.push("        if (isEcmaWs(s.charAt(i)) || s.charAt(i) == '@') return false;");
    lines.push("        while (i < s.length() && !isEcmaWs(s.charAt(i)) && s.charAt(i) != '@') i++;");
    lines.push("        if (i >= s.length() || s.charAt(i) != '@') return false;");
    lines.push('        i++;');
    lines.push("        if (i >= s.length() || isEcmaWs(s.charAt(i)) || s.charAt(i) == '@') return false;");
    lines.push("        while (i < s.length() && !isEcmaWs(s.charAt(i)) && s.charAt(i) != '@') i++;");
    lines.push('        return i == s.length();');
    lines.push('    }');
    lines.push('');
  }

  if (helpers.has('checkGitCloneUrl')) {
    lines.push('    private static boolean checkGitCloneUrl(String s) {');
    lines.push('        if (s == null || s.isEmpty()) return false;');
    lines.push('        int pos;');
    lines.push('        if (s.startsWith("git@")) {');
    lines.push('            pos = 4;');
    lines.push('        } else {');
    lines.push('            char c0 = s.charAt(0);');
    lines.push("            if (c0 < 'a' || c0 > 'z') return false;");
    lines.push('            pos = 1;');
    lines.push("            while (pos < s.length()) { char c = s.charAt(pos); if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '+' || c == '.' || c == '-') pos++; else break; }");
    lines.push('            if (pos + 3 > s.length() || !s.substring(pos, pos + 3).equals("://")) return false;');
    lines.push('            pos += 3;');
    lines.push('        }');
    lines.push('        if (pos >= s.length()) return false;');
    lines.push('        for (int i = pos; i < s.length(); i++) {');
    lines.push('            if (isEcmaWs(s.charAt(i))) return false;');
    lines.push('        }');
    lines.push('        return true;');
    lines.push('    }');
    lines.push('');
  }

  if (helpers.has('checkContentType')) {
    lines.push('    private static boolean isTypeChar(char c) {');
    lines.push("        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '!' || c == '#' || c == '$' || c == '&' || c == '^' || c == '_' || c == '-';");
    lines.push('    }');
    lines.push('');
    lines.push('    private static boolean isSubtypeChar(char c) {');
    lines.push("        return isTypeChar(c) || c == '.' || c == '+';");
    lines.push('    }');
    lines.push('');
    lines.push('    private static boolean checkContentType(String s) {');
    lines.push('        if (s == null || s.isEmpty()) return false;');
    lines.push('        int i = 0;');
    lines.push("        char c0 = s.charAt(i); if (!((c0 >= 'a' && c0 <= 'z') || (c0 >= 'A' && c0 <= 'Z'))) return false;");
    lines.push('        i++;');
    lines.push('        while (i < s.length() && isTypeChar(s.charAt(i))) i++;');
    lines.push("        if (i >= s.length() || s.charAt(i) != '/') return false;");
    lines.push('        i++;');
    lines.push("        if (i >= s.length()) return false;");
    lines.push("        char sc = s.charAt(i); if (!((sc >= 'a' && sc <= 'z') || (sc >= 'A' && sc <= 'Z') || (sc >= '0' && sc <= '9') || sc == '*')) return false;");
    lines.push('        i++;');
    lines.push('        while (i < s.length() && isSubtypeChar(s.charAt(i))) i++;');
    lines.push('        while (i < s.length()) {');
    lines.push('            int j = i;');
    lines.push("            while (j < s.length() && isEcmaWs(s.charAt(j))) j++;");
    lines.push("            if (j >= s.length() || s.charAt(j) != ';') break;");
    lines.push('            j++;');
    lines.push("            while (j < s.length() && isEcmaWs(s.charAt(j))) j++;");
    lines.push('            if (j >= s.length()) return false;');
    lines.push('            int start = j;');
    lines.push('            while (j < s.length() && isSubtypeChar(s.charAt(j))) j++;');
    lines.push('            if (j == start) break;');
    lines.push("            if (j >= s.length() || s.charAt(j) != '=') break;");
    lines.push('            j++;');
    lines.push('            start = j;');
    lines.push('            while (j < s.length() && isSubtypeChar(s.charAt(j))) j++;');
    lines.push('            if (j == start) break;');
    lines.push('            i = j;');
    lines.push('        }');
    lines.push('        return i == s.length();');
    lines.push('    }');
    lines.push('');
  }

  if (helpers.has('checkDoi')) {
    // doi uses checkDotTail which is emitted when checkRelayUrl, checkATag, or checkDotTail is present
    if (!helpers.has('checkRelayUrl') && !helpers.has('checkATag') && !helpers.has('checkDotTail')) {
      lines.push('    private static boolean checkDotTail(String s, int pos) {');
      lines.push('        if (pos >= s.length()) return false;');
      lines.push('        for (int j = pos; j < s.length(); j++) {');
      lines.push("            char ch = s.charAt(j);");
      lines.push("            if (ch == '\\n' || ch == '\\r' || ch == '\\u0085' || ch == '\\u2028' || ch == '\\u2029') return false;");
      lines.push('        }');
      lines.push('        return true;');
      lines.push('    }');
      lines.push('');
    }
    lines.push('    private static boolean checkDoi(String s) {');
    lines.push('        if (s == null || !s.startsWith("10.")) return false;');
    lines.push('        int i = 3;');
    lines.push('        int count = 0;');
    lines.push("        while (i < s.length() && s.charAt(i) >= '0' && s.charAt(i) <= '9') { count++; i++; }");
    lines.push('        if (count < 4 || count > 9) return false;');
    lines.push("        if (i >= s.length() || s.charAt(i) != '/') return false;");
    lines.push('        i++;');
    lines.push('        return checkDotTail(s, i);');
    lines.push('    }');
    lines.push('');
  }

  if (helpers.has('checkAnnotateUser')) {
    lines.push('    private static boolean checkAnnotateUser(String s) {');
    lines.push('        if (s == null || !s.startsWith("annotate-user ")) return false;');
    lines.push('        int i = 14;');
    lines.push('        if (i + 64 > s.length()) return false;');
    lines.push('        for (int j = 0; j < 64; j++) {');
    lines.push('            char c = s.charAt(i + j);');
    lines.push("            if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;");
    lines.push('        }');
    lines.push('        i += 64;');
    lines.push('        for (int round = 0; round < 2; round++) {');
    lines.push("            if (i >= s.length() || s.charAt(i) != ':') return false;");
    lines.push('            i++;');
    lines.push("            if (i >= s.length() || s.charAt(i) < '0' || s.charAt(i) > '9') return false;");
    lines.push("            while (i < s.length() && s.charAt(i) >= '0' && s.charAt(i) <= '9') i++;");
    lines.push("            if (i < s.length() && s.charAt(i) == '.') {");
    lines.push('                i++;');
    lines.push("                if (i >= s.length() || s.charAt(i) < '0' || s.charAt(i) > '9') return false;");
    lines.push("                while (i < s.length() && s.charAt(i) >= '0' && s.charAt(i) <= '9') i++;");
    lines.push('            }');
    lines.push('        }');
    lines.push('        return i == s.length();');
    lines.push('    }');
    lines.push('');
  }

  if (helpers.has('checkNoWsTail')) {
    lines.push('    private static boolean checkNoWsTail(String s, int offset) {');
    lines.push('        if (s == null || offset >= s.length()) return false;');
    lines.push('        for (int i = offset; i < s.length(); i++) {');
    lines.push('            if (isEcmaWs(s.charAt(i))) return false;');
    lines.push('        }');
    lines.push('        return true;');
    lines.push('    }');
    lines.push('');
  }

  if (helpers.has('checkExternalIdentity')) {
    lines.push('    private static boolean checkExternalIdentity(String s) {');
    lines.push('        if (s == null || s.isEmpty()) return false;');
    lines.push('        int i = 0;');
    lines.push('        char c = s.charAt(i);');
    lines.push("        if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '-' || c == '/')) return false;");
    lines.push("        while (i < s.length()) { c = s.charAt(i); if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '-' || c == '/') i++; else break; }");
    lines.push("        if (i >= s.length() || s.charAt(i) != ':') return false;");
    lines.push('        i++;');
    lines.push('        if (i >= s.length()) return false;');
    lines.push('        for (int j = i; j < s.length(); j++) {');
    lines.push("            char c2 = s.charAt(j);");
    lines.push("            if (c2 == '\\n' || c2 == '\\r' || c2 == '\\u0085' || c2 == '\\u2028' || c2 == '\\u2029') return false;");
    lines.push('        }');
    lines.push('        return true;');
    lines.push('    }');
    lines.push('');
  }

  if (helpers.has('checkImetaDim')) {
    lines.push('    private static boolean checkImetaDim(String s) {');
    lines.push('        if (s == null) return false;');
    lines.push('        if (s.length() < 7) return false;');
    lines.push('        if (!s.startsWith("dim ")) return false;');
    lines.push('        int i = 4;');
    lines.push('        int dc = 0;');
    lines.push("        while (i < s.length() && s.charAt(i) >= '0' && s.charAt(i) <= '9') { i++; dc++; }");
    lines.push('        if (dc < 1 || dc > 5) return false;');
    lines.push("        if (i >= s.length() || s.charAt(i) != 'x') return false;");
    lines.push('        i++; dc = 0;');
    lines.push("        while (i < s.length() && s.charAt(i) >= '0' && s.charAt(i) <= '9') { i++; dc++; }");
    lines.push('        if (dc < 1 || dc > 5) return false;');
    lines.push('        return i == s.length();');
    lines.push('    }');
    lines.push('');
  }

  if (helpers.has('checkDim')) {
    lines.push('    /* ^[0-9]+x[0-9]+$ */');
    lines.push('    private static boolean checkDim(String s) {');
    lines.push('        if (s == null || s.isEmpty()) return false;');
    lines.push('        int i = 0;');
    lines.push("        if (s.charAt(i) < '0' || s.charAt(i) > '9') return false;");
    lines.push("        while (i < s.length() && s.charAt(i) >= '0' && s.charAt(i) <= '9') i++;");
    lines.push("        if (i >= s.length() || s.charAt(i) != 'x') return false;");
    lines.push('        i++;');
    lines.push("        if (i >= s.length() || s.charAt(i) < '0' || s.charAt(i) > '9') return false;");
    lines.push("        while (i < s.length() && s.charAt(i) >= '0' && s.charAt(i) <= '9') i++;");
    lines.push('        return i == s.length();');
    lines.push('    }');
    lines.push('');
  }

  if (helpers.has('checkNoUppercase')) {
    lines.push('    /* ^[^A-Z]+$ */');
    lines.push('    private static boolean checkNoUppercase(String s) {');
    lines.push("        return s != null && !s.isEmpty() && s.chars().noneMatch(c -> c >= 'A' && c <= 'Z');");
    lines.push('    }');
    lines.push('');
  }

  if (helpers.has('checkDottedDigits')) {
    lines.push('    /* ^[0-9]+(\\.[0-9]+)*$ */');
    lines.push('    private static boolean checkDottedDigits(String s) {');
    lines.push('        if (s == null || s.isEmpty()) return false;');
    lines.push('        int i = 0;');
    lines.push("        if (s.charAt(i) < '0' || s.charAt(i) > '9') return false;");
    lines.push("        while (i < s.length() && s.charAt(i) >= '0' && s.charAt(i) <= '9') i++;");
    lines.push("        while (i < s.length() && s.charAt(i) == '.') {");
    lines.push('            i++;');
    lines.push("            if (i >= s.length() || s.charAt(i) < '0' || s.charAt(i) > '9') return false;");
    lines.push("            while (i < s.length() && s.charAt(i) >= '0' && s.charAt(i) <= '9') i++;");
    lines.push('        }');
    lines.push('        return i == s.length();');
    lines.push('    }');
    lines.push('');
  }

  if (helpers.has('checkSlashSegments')) {
    lines.push('    /* ^[charset]+(/[charset]+)*$ */');
    lines.push('    private static boolean checkSlashSegments(String s, String charset) {');
    lines.push('        if (s == null || s.isEmpty()) return false;');
    lines.push('        int i = 0;');
    lines.push('        if (charset.indexOf(s.charAt(i)) < 0) return false;');
    lines.push('        while (i < s.length() && charset.indexOf(s.charAt(i)) >= 0) i++;');
    lines.push("        while (i < s.length() && s.charAt(i) == '/') {");
    lines.push('            i++;');
    lines.push('            if (i >= s.length() || charset.indexOf(s.charAt(i)) < 0) return false;');
    lines.push('            while (i < s.length() && charset.indexOf(s.charAt(i)) >= 0) i++;');
    lines.push('        }');
    lines.push('        return i == s.length();');
    lines.push('    }');
    lines.push('');
  }

  if (helpers.has('checkSpaceSeparatedTokens')) {
    lines.push('    /* ^\\S+( \\S+)*$ */');
    lines.push('    private static boolean checkSpaceSeparatedTokens(String s) {');
    lines.push('        if (s == null || s.isEmpty()) return false;');
    lines.push('        int i = 0;');
    lines.push('        /* first token: 1+ non-whitespace chars */');
    lines.push('        if (isEcmaWs(s.charAt(i))) return false;');
    lines.push('        while (i < s.length() && !isEcmaWs(s.charAt(i))) i++;');
    lines.push("        while (i < s.length() && s.charAt(i) == ' ') {");
    lines.push('            i++;');
    lines.push('            if (i >= s.length() || isEcmaWs(s.charAt(i))) return false;');
    lines.push('            while (i < s.length() && !isEcmaWs(s.charAt(i))) i++;');
    lines.push('        }');
    lines.push('        return i == s.length();');
    lines.push('    }');
    lines.push('');
  }

  if (helpers.has('checkStartsWithCharset')) {
    lines.push('    /* ^[charset]+ (no end anchor) */');
    lines.push('    private static boolean checkStartsWithCharset(String s, String charset) {');
    lines.push('        return s != null && !s.isEmpty() && charset.indexOf(s.charAt(0)) >= 0;');
    lines.push('    }');
    lines.push('');
  }

  if (helpers.has('checkBase64')) {
    lines.push('    private static boolean isB64Char(char c) {');
    lines.push("        return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '+' || c == '/';");
    lines.push('    }');
    lines.push('');
    lines.push('    /* ^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$ */');
    lines.push('    private static boolean checkBase64(String s) {');
    lines.push('        if (s == null) return false;');
    lines.push('        if (s.isEmpty()) return true;');
    lines.push('        if (s.length() % 4 != 0) return false;');
    lines.push('        int i = 0;');
    lines.push("        while (i < s.length() && s.charAt(i) != '=') {");
    lines.push('            if (!isB64Char(s.charAt(i))) return false;');
    lines.push('            i++;');
    lines.push('        }');
    lines.push('        int dataLen = i;');
    lines.push('        int padLen = s.length() - dataLen;');
    lines.push('        if (padLen > 2) return false;');
    lines.push('        if (padLen == 1 && dataLen % 4 != 3) return false;');
    lines.push('        if (padLen == 2 && dataLen % 4 != 2) return false;');
    lines.push("        while (i < s.length()) { if (s.charAt(i) != '=') return false; i++; }");
    lines.push('        return true;');
    lines.push('    }');
    lines.push('');
  }

  if (helpers.has('checkBase642Pad')) {
    lines.push('    /* strict base64 with mandatory 2-char padding */');
    lines.push('    private static boolean checkBase642Pad(String s) {');
    lines.push('        if (s == null) return false;');
    lines.push('        int len = s.length();');
    lines.push('        if (len < 4 || len % 4 != 0) return false;');
    lines.push("        if (s.charAt(len - 1) != '=' || s.charAt(len - 2) != '=') return false;");
    lines.push('        for (int i = 0; i < len - 2; i++) {');
    lines.push('            if (!isB64Char(s.charAt(i))) return false;');
    lines.push('        }');
    lines.push('        return true;');
    lines.push('    }');
    lines.push('');
  }

  if (helpers.has('checkNostrUri')) {
    lines.push('    /* ^nostr:((npub|note)1[bech32]{58}|(nprofile|nevent|naddr)1[bech32]+)$ */');
    lines.push('    private static boolean checkNostrUri(String s) {');
    lines.push('        if (s == null || !s.startsWith("nostr:")) return false;');
    lines.push('        String p = s.substring(6);');
    lines.push('        /* npub1 or note1 + exactly 58 data chars */');
    lines.push('        if (p.length() == 63 && (p.startsWith("npub1") || p.startsWith("note1"))) {');
    lines.push('            for (int i = 5; i < 63; i++) if (!isBech32Char(p.charAt(i))) return false;');
    lines.push('            return true;');
    lines.push('        }');
    lines.push('        /* nprofile1, nevent1, naddr1 + 1+ data chars */');
    lines.push('        int prefixLen;');
    lines.push('        if (p.startsWith("nprofile1")) prefixLen = 9;');
    lines.push('        else if (p.startsWith("nevent1")) prefixLen = 7;');
    lines.push('        else if (p.startsWith("naddr1")) prefixLen = 6;');
    lines.push('        else return false;');
    lines.push('        if (p.length() <= prefixLen) return false;');
    lines.push('        for (int i = prefixLen; i < p.length(); i++) if (!isBech32Char(p.charAt(i))) return false;');
    lines.push('        return true;');
    lines.push('    }');
    lines.push('');
  }

  if (helpers.has('checkNip04Encrypted')) {
    lines.push('    /* ^[A-Za-z0-9+/]+={0,2}\\?iv=[A-Za-z0-9+/]+={0,2}$ */');
    lines.push('    private static boolean checkNip04Encrypted(String s) {');
    lines.push('        if (s == null || s.isEmpty()) return false;');
    lines.push('        int sep = s.indexOf("?iv=");');
    lines.push('        if (sep <= 0) return false;');
    lines.push('        int rightStart = sep + 4;');
    lines.push('        if (rightStart >= s.length()) return false;');
    lines.push('        /* check left half: 1+ b64 chars + 0-2 = */');
    lines.push('        int i = 0;');
    lines.push('        while (i < sep && isB64Char(s.charAt(i))) i++;');
    lines.push('        if (i == 0) return false;');
    lines.push('        int eq = 0;');
    lines.push("        while (i < sep && s.charAt(i) == '=') { i++; eq++; }");
    lines.push('        if (i != sep || eq > 2) return false;');
    lines.push('        /* check right half */');
    lines.push('        i = rightStart;');
    lines.push('        int dataStart = i;');
    lines.push('        while (i < s.length() && isB64Char(s.charAt(i))) i++;');
    lines.push('        if (i == dataStart) return false;');
    lines.push('        eq = 0;');
    lines.push("        while (i < s.length() && s.charAt(i) == '=') { i++; eq++; }");
    lines.push('        return i == s.length() && eq <= 2;');
    lines.push('    }');
    lines.push('');
  }

  if (helpers.has('checkNip05Identifier')) {
    lines.push('    private static boolean isNip05LocalChar(char c) {');
    lines.push("        return c == '_' || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '-';");
    lines.push('    }');
    lines.push('');
    lines.push('    private static boolean isDomainChar(char c) {');
    lines.push("        return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-';");
    lines.push('    }');
    lines.push('');
    lines.push('    private static boolean isAlnum(char c) {');
    lines.push("        return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');");
    lines.push('    }');
    lines.push('');
    lines.push('    /* NIP-05: local@domain.tld */');
    lines.push('    private static boolean checkNip05Identifier(String s) {');
    lines.push('        if (s == null || s.isEmpty()) return false;');
    lines.push("        int at = s.lastIndexOf('@');");
    lines.push('        if (at <= 0) return false;');
    lines.push('        /* local part */');
    lines.push('        for (int i = 0; i < at; i++) {');
    lines.push('            if (!isNip05LocalChar(s.charAt(i))) return false;');
    lines.push('        }');
    lines.push('        /* domain: 2+ dot-separated labels */');
    lines.push('        String d = s.substring(at + 1);');
    lines.push('        if (d.isEmpty()) return false;');
    lines.push('        int dotCount = 0;');
    lines.push('        int di = 0;');
    lines.push('        while (di < d.length()) {');
    lines.push('            if (!isAlnum(d.charAt(di))) return false;');
    lines.push('            while (di < d.length() && isDomainChar(d.charAt(di))) di++;');
    lines.push('            if (di > 0 && !isAlnum(d.charAt(di - 1))) return false;');
    lines.push("            if (di < d.length() && d.charAt(di) == '.') { dotCount++; di++; }");
    lines.push('            else if (di < d.length()) return false;');
    lines.push('        }');
    lines.push('        return dotCount >= 1 && isAlnum(d.charAt(d.length() - 1));');
    lines.push('    }');
    lines.push('');
  }

  if (helpers.has('checkMimeTypeStrict')) {
    lines.push('    private static boolean isMimeStrictChar(char c) {');
    lines.push("        return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '!' || c == '#' || c == '$' || c == '&' || c == '^' || c == '_' || c == '.' || c == '+' || c == '-';");
    lines.push('    }');
    lines.push('');
    lines.push('    /* ^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$ */');
    lines.push('    private static boolean checkMimeTypeStrict(String s) {');
    lines.push('        if (s == null || s.isEmpty()) return false;');
    lines.push('        int i = 0;');
    lines.push("        if (!((s.charAt(i) >= 'A' && s.charAt(i) <= 'Z') || (s.charAt(i) >= 'a' && s.charAt(i) <= 'z') || (s.charAt(i) >= '0' && s.charAt(i) <= '9'))) return false;");
    lines.push('        i++;');
    lines.push('        while (i < s.length() && isMimeStrictChar(s.charAt(i))) i++;');
    lines.push("        if (i >= s.length() || s.charAt(i) != '/') return false;");
    lines.push('        i++;');
    lines.push("        if (i >= s.length() || !((s.charAt(i) >= 'A' && s.charAt(i) <= 'Z') || (s.charAt(i) >= 'a' && s.charAt(i) <= 'z') || (s.charAt(i) >= '0' && s.charAt(i) <= '9'))) return false;");
    lines.push('        i++;');
    lines.push('        while (i < s.length() && isMimeStrictChar(s.charAt(i))) i++;');
    lines.push('        return i == s.length();');
    lines.push('    }');
    lines.push('');
  }

  if (helpers.has('checkPrefixDelimRest')) {
    lines.push('    /* ^[charset]+<delim>.+ (no end anchor) */');
    lines.push('    private static boolean checkPrefixDelimRest(String s, String charset, String delimiter) {');
    lines.push('        if (s == null || s.isEmpty()) return false;');
    lines.push('        int i = 0;');
    lines.push('        if (charset.indexOf(s.charAt(i)) < 0) return false;');
    lines.push('        while (i < s.length() && charset.indexOf(s.charAt(i)) >= 0) i++;');
    lines.push('        if (i + delimiter.length() >= s.length()) return false;');
    lines.push('        if (!s.substring(i, i + delimiter.length()).equals(delimiter)) return false;');
    lines.push('        i += delimiter.length();');
    lines.push('        if (i >= s.length()) return false;');
    lines.push('        /* .+ first char must not be a line terminator (Java . excludes \\n, \\r, NEL, LS, PS) */');
    lines.push("        char c = s.charAt(i);");
    lines.push("        return c != '\\n' && c != '\\r' && c != '\\u0085' && c != '\\u2028' && c != '\\u2029';");
    lines.push('    }');
    lines.push('');
  }

  if (helpers.has('checkIdentifier')) {
    if (lines.length > 0) lines.push('');
    lines.push('    private static boolean checkIdentifier(String s, String firstCharset, String restCharset, char prefix) {');
    lines.push('        int i = 0;');
    lines.push('        if (prefix != 0 && i < s.length() && s.charAt(i) == prefix) i++;');
    lines.push('        if (i >= s.length()) return false;');
    lines.push('        if (firstCharset.indexOf(s.charAt(i)) < 0) return false;');
    lines.push('        i++;');
    lines.push('        for (; i < s.length(); i++) {');
    lines.push('            if (restCharset.indexOf(s.charAt(i)) < 0) return false;');
    lines.push('        }');
    lines.push('        return true;');
    lines.push('    }');
  }

  if (helpers.has('checkSpaceSeparatedCharset')) {
    if (lines.length > 0) lines.push('');
    lines.push('    private static boolean checkSpaceSeparatedCharset(String s, String charset) {');
    lines.push('        if (s.isEmpty()) return false;');
    lines.push('        int i = 0;');
    lines.push('        if (charset.indexOf(s.charAt(i)) < 0) return false;');
    lines.push('        while (i < s.length() && charset.indexOf(s.charAt(i)) >= 0) i++;');
    lines.push("        while (i < s.length() && s.charAt(i) == ' ') {");
    lines.push('            i++;');
    lines.push('            if (i >= s.length() || charset.indexOf(s.charAt(i)) < 0) return false;');
    lines.push('            while (i < s.length() && charset.indexOf(s.charAt(i)) >= 0) i++;');
    lines.push('        }');
    lines.push('        return i == s.length();');
    lines.push('    }');
  }

  if (helpers.has('checkUriScheme')) {
    if (lines.length > 0) lines.push('');
    lines.push('    private static boolean checkUriScheme(String s) {');
    lines.push('        if (s.length() < 4) return false;');
    lines.push('        char c = s.charAt(0);');
    lines.push("        if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'))) return false;");
    lines.push('        int i = 1;');
    lines.push('        while (i < s.length()) {');
    lines.push('            c = s.charAt(i);');
    lines.push("            if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '+' || c == '.' || c == '-') i++;");
    lines.push('            else break;');
    lines.push('        }');
    lines.push('        if (i + 3 > s.length()) return false;');
    lines.push("        return s.charAt(i) == ':' && s.charAt(i+1) == '/' && s.charAt(i+2) == '/';");
    lines.push('    }');
  }

  if (helpers.has('checkPackageId')) {
    lines.push('    private static boolean checkPackageId(String s) {');
    lines.push('        if (s == null || s.isEmpty()) return false;');
    lines.push('        if (s.equals("#")) return true;');
    lines.push('        char c0 = s.charAt(0);');
    lines.push("        if (!((c0 >= 'a' && c0 <= 'z') || (c0 >= 'A' && c0 <= 'Z') || (c0 >= '0' && c0 <= '9'))) return false;");
    lines.push('        int i = 1;');
    lines.push("        while (i < s.length()) { char c = s.charAt(i); if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '+' || c == '-') i++; else break; }");
    lines.push('        while (i < s.length()) {');
    lines.push("            if (s.charAt(i) != ':') return false;");
    lines.push('            i++;');
    lines.push("            if (i >= s.length()) return false;");
    lines.push("            char ci = s.charAt(i); if (!((ci >= 'a' && ci <= 'z') || (ci >= 'A' && ci <= 'Z') || (ci >= '0' && ci <= '9'))) return false;");
    lines.push('            i++;');
    lines.push("            while (i < s.length()) { char c = s.charAt(i); if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '+' || c == '-') i++; else break; }");
    lines.push('        }');
    lines.push('        return i == s.length();');
    lines.push('    }');
    lines.push('');
  }

  return lines.join('\n');
}
