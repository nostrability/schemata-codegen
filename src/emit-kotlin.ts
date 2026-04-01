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
  planContentChecks,
  type ValidatorAction,
  type ContentAction,
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
        const arr = check.kinds.map(k => JSON.stringify(k)).join(', ');
        return { expr: `checkATag(${varExpr}, arrayOf(${arr}))`, helpers };
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
      helpers.add('checkDotTail');
      return {
        expr: `(${varExpr}.startsWith(${JSON.stringify(check.prefix)}) && checkDotTail(${varExpr}, ${len}))`,
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

// --- Content validation ---

function renderContentActionsKotlin(
  actions: ContentAction[],
  helpers: Set<string>,
): string[] {
  const lines: string[] = [];
  for (const action of actions) {
    switch (action.type) {
      case 'check_content_min_length':
        lines.push(`            if (content.length < ${action.min}) {`);
        lines.push(`                errors.add(ValidationError("content", "content must be at least ${action.min} character(s)"))`);
        lines.push('            }');
        break;
      case 'check_content_max_length':
        lines.push(`            if (content.length > ${action.max}) {`);
        lines.push(`                errors.add(ValidationError("content", "content must be at most ${action.max} character(s)"))`);
        lines.push('            }');
        break;
      case 'check_content_pattern': {
        const r = renderPatternCheckKotlin(action.native, 'content');
        for (const h of r.helpers) helpers.add(h);
        lines.push(`            if (!(${r.expr})) {`);
        lines.push(`                errors.add(ValidationError("content", "content must match pattern " + ${JSON.stringify(action.regex)}))`);
        lines.push('            }');
        break;
      }
      case 'check_content_enum': {
        const checks = action.values.map(v => `content == ${JSON.stringify(v)}`).join(' || ');
        lines.push(`            if (!(${checks})) {`);
        lines.push(`                errors.add(ValidationError("content", "content must be one of: " + ${JSON.stringify(action.values.join(', '))}))`);
        lines.push('            }');
        break;
      }
    }
  }
  return lines;
}

// --- Event validation ---

function emitEventDispatchKotlin(
  constrainedKinds: { kindNumber: number; nip: string }[],
  contentPlans: Map<number, ContentAction[]>,
  helpers: Set<string>,
): string {
  const sorted = [...constrainedKinds].sort((a, b) => a.kindNumber - b.kindNumber);
  const contentKinds = [...contentPlans.entries()].sort((a, b) => a[0] - b[0]);

  const lines: string[] = [];
  lines.push('/** Validate an event\'s base fields, content constraints, and tag structure. */');
  lines.push('fun validateEvent(event: Map<String, Any?>): List<ValidationError> {');
  lines.push('    val errors = mutableListOf<ValidationError>()');
  lines.push('    val kindRaw = event["kind"]');
  lines.push('    val kind: Int = when (kindRaw) {');
  lines.push('        is Int -> kindRaw');
  lines.push('        is Long -> kindRaw.toInt()');
  lines.push('        else -> {');
  lines.push('            errors.add(ValidationError("kind", "kind must be an integer"))');
  lines.push('            return errors');
  lines.push('        }');
  lines.push('    }');

  helpers.add('checkHex64');
  helpers.add('checkHex128');

  lines.push('    val id = event["id"]');
  lines.push('    if (id !is String || !checkHex64(id)) {');
  lines.push('        errors.add(ValidationError("id", "id must be a 64-char lowercase hex string"))');
  lines.push('    }');
  lines.push('    val pubkey = event["pubkey"]');
  lines.push('    if (pubkey !is String || !checkHex64(pubkey)) {');
  lines.push('        errors.add(ValidationError("pubkey", "pubkey must be a 64-char lowercase hex string"))');
  lines.push('    }');
  lines.push('    val sig = event["sig"]');
  lines.push('    if (sig !is String || !checkHex128(sig)) {');
  lines.push('        errors.add(ValidationError("sig", "sig must be a 128-char lowercase hex string"))');
  lines.push('    }');
  lines.push('    val createdAt = event["created_at"]');
  lines.push('    if (!((createdAt is Int && createdAt >= 0) || (createdAt is Long && createdAt >= 0L))) {');
  lines.push('        errors.add(ValidationError("created_at", "created_at must be a non-negative integer"))');
  lines.push('    }');

  lines.push('    if (!event.containsKey("content")) {');
  lines.push('        errors.add(ValidationError("content", "content is required"))');
  lines.push('    } else {');
  lines.push('        val contentRaw = event["content"]');
  lines.push('        if (contentRaw is String) {');
  if (contentKinds.length > 0) {
    lines.push('            val content = contentRaw');
    lines.push('            when (kind) {');
    for (const [kindNumber, actions] of contentKinds) {
      lines.push(`                ${kindNumber} -> {`);
      lines.push(...renderContentActionsKotlin(actions, helpers));
      lines.push('                }');
    }
    lines.push('            }');
  }
  lines.push('        } else {');
  lines.push('            errors.add(ValidationError("content", "content must be a string"))');
  lines.push('        }');
  lines.push('    }');

  lines.push('    if (!event.containsKey("tags")) {');
  lines.push('        errors.add(ValidationError("tags", "tags is required"))');
  lines.push('    } else {');
  lines.push('        val tagsRaw = event["tags"]');
  lines.push('        if (tagsRaw is List<*>) {');
  lines.push('            val tags = mutableListOf<List<String>>()');
  lines.push('            for ((i, t) in tagsRaw.withIndex()) {');
  lines.push('                if (t is List<*> && t.all { it is String }) {');
  lines.push('                    @Suppress("UNCHECKED_CAST")');
  lines.push('                    tags.add(t as List<String>)');
  lines.push('                } else {');
  lines.push('                    errors.add(ValidationError("tags[$i]", "tags[$i] must be a list of strings"))');
  lines.push('                    tags.add(emptyList())');
  lines.push('                }');
  lines.push('            }');
  lines.push('            errors.addAll(validateKindTags(kind, tags))');
  lines.push('        } else {');
  lines.push('            errors.add(ValidationError("tags", "tags must be a list"))');
  lines.push('        }');
  lines.push('    }');

  lines.push('    return errors');
  lines.push('}');
  return lines.join('\n');
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

  const contentPlans = new Map<number, ContentAction[]>();
  for (const shape of kindShapes) {
    const contentActions = planContentChecks(shape);
    if (contentActions) contentPlans.set(shape.kindNumber, contentActions);
  }

  return emitKotlinFile(fnBodies, constrainedKinds, allHelpers, contentPlans);
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
  contentPlans: Map<number, ContentAction[]>,
): string {
  const eventDispatchCode = emitEventDispatchKotlin(constrainedKinds, contentPlans, helpers);

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

  if (eventDispatchCode) {
    lines.push(eventDispatchCode);
    lines.push('');
  }

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

  if (helpers.has('checkRelayUrl') || helpers.has('checkATag') || helpers.has('checkDotTail')) {
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
    lines.push('private fun checkATag(s: String, kinds: Array<String>?): Boolean {');
    lines.push('    if (s.length < 68) return false');
    lines.push('    var pos = 0');
    lines.push("    if (s[pos] < '0' || s[pos] > '9') return false");
    lines.push("    while (pos < s.length && s[pos] in '0'..'9') pos++");
    lines.push("    if (pos >= s.length || s[pos] != ':') return false");
    lines.push('    val kindStr = s.substring(0, pos)');
    lines.push('    if (kinds != null && kindStr !in kinds) return false');
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

  if (helpers.has('isEcmaWs')) {
    lines.push('private fun isEcmaWs(c: Char): Boolean = when (c) {');
    lines.push("    '\\t', '\\n', '\\u000B', '\\u000C', '\\r', ' ',");
    lines.push("    '\\u00A0', '\\u1680',");
    lines.push("    in '\\u2000'..'\\u200A',");
    lines.push("    '\\u2028', '\\u2029', '\\u202F', '\\u205F',");
    lines.push("    '\\u3000', '\\uFEFF' -> true");
    lines.push('    else -> false');
    lines.push('}');
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
    lines.push("    while (i < s.length && !isEcmaWs(s[i]) && s[i] != '@') i++");
    lines.push('    if (i == 0) return false');
    lines.push("    if (i >= s.length || s[i] != '@') return false");
    lines.push('    i++');
    lines.push('    val afterAt = i');
    lines.push("    while (i < s.length && !isEcmaWs(s[i]) && s[i] != '@') i++");
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
    lines.push('        if (isEcmaWs(s[j])) return false');
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
    lines.push("    while (i < s.length && (isEcmaWs(s[i]) || s[i] == ';')) {");
    lines.push("        while (i < s.length && isEcmaWs(s[i])) i++");
    lines.push("        if (i >= s.length || s[i] != ';') return false");
    lines.push('        i++');
    lines.push("        while (i < s.length && isEcmaWs(s[i])) i++");
    lines.push('        if (i >= s.length) return false');
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
    lines.push('    // "annotate-user " (14 chars) + 64 hex + ":" + digit + ":" + digit = min 82');
    lines.push('    if (s.length < 82 || !s.startsWith("annotate-user ")) return false');
    lines.push('    for (j in 14 until 78) {');
    lines.push('        val c = s[j]');
    lines.push("        if (!((c in '0'..'9') || (c in 'a'..'f'))) return false");
    lines.push('    }');
    lines.push('    var pos = 78');
    lines.push('    for (coord in 0 until 2) {');
    lines.push("        if (pos >= s.length || s[pos] != ':') return false");
    lines.push('        pos++');
    lines.push('        val dstart = pos');
    lines.push("        while (pos < s.length && s[pos] in '0'..'9') pos++");
    lines.push('        if (pos == dstart) return false');
    lines.push("        if (pos < s.length && s[pos] == '.') {");
    lines.push('            pos++');
    lines.push('            val fstart = pos');
    lines.push("            while (pos < s.length && s[pos] in '0'..'9') pos++");
    lines.push('            if (pos == fstart) return false');
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
    lines.push('        if (isEcmaWs(s[j])) return false');
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
    lines.push('    i++');
    lines.push('    if (i >= s.length) return false');
    lines.push('    for (j in i until s.length) {');
    lines.push('        val c2 = s[j]');
    lines.push("        if (c2 == '\\n' || c2 == '\\r' || c2 == '\\u0085' || c2 == '\\u2028' || c2 == '\\u2029') return false");
    lines.push('    }');
    lines.push('    return true');
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

  if (helpers.has('checkDim')) {
    lines.push('/* ^[0-9]+x[0-9]+$ */');
    lines.push('private fun checkDim(s: String): Boolean {');
    lines.push('    if (s.isEmpty()) return false');
    lines.push('    var i = 0');
    lines.push("    if (s[i] !in '0'..'9') return false");
    lines.push("    while (i < s.length && s[i] in '0'..'9') i++");
    lines.push("    if (i >= s.length || s[i] != 'x') return false");
    lines.push('    i++');
    lines.push("    if (i >= s.length || s[i] !in '0'..'9') return false");
    lines.push("    while (i < s.length && s[i] in '0'..'9') i++");
    lines.push('    return i == s.length');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkNoUppercase')) {
    lines.push('/* ^[^A-Z]+$ */');
    lines.push('private fun checkNoUppercase(s: String): Boolean =');
    lines.push("    s.isNotEmpty() && s.none { it in 'A'..'Z' }");
    lines.push('');
  }

  if (helpers.has('checkDottedDigits')) {
    lines.push('/* ^[0-9]+(\\.[0-9]+)*$ */');
    lines.push('private fun checkDottedDigits(s: String): Boolean {');
    lines.push('    if (s.isEmpty()) return false');
    lines.push('    var i = 0');
    lines.push("    if (s[i] !in '0'..'9') return false");
    lines.push("    while (i < s.length && s[i] in '0'..'9') i++");
    lines.push("    while (i < s.length && s[i] == '.') {");
    lines.push('        i++');
    lines.push("        if (i >= s.length || s[i] !in '0'..'9') return false");
    lines.push("        while (i < s.length && s[i] in '0'..'9') i++");
    lines.push('    }');
    lines.push('    return i == s.length');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkSlashSegments')) {
    lines.push('/* ^[charset]+(/[charset]+)*$ */');
    lines.push('private fun checkSlashSegments(s: String, charset: String): Boolean {');
    lines.push('    if (s.isEmpty()) return false');
    lines.push('    var i = 0');
    lines.push('    if (s[i] !in charset) return false');
    lines.push('    while (i < s.length && s[i] in charset) i++');
    lines.push("    while (i < s.length && s[i] == '/') {");
    lines.push('        i++');
    lines.push('        if (i >= s.length || s[i] !in charset) return false');
    lines.push('        while (i < s.length && s[i] in charset) i++');
    lines.push('    }');
    lines.push('    return i == s.length');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkSpaceSeparatedTokens')) {
    lines.push('/* ^\\S+( \\S+)*$ */');
    lines.push('private fun checkSpaceSeparatedTokens(s: String): Boolean {');
    lines.push('    if (s.isEmpty()) return false');
    lines.push('    var i = 0');
    lines.push('    /* first token: 1+ non-whitespace chars */');
    lines.push('    if (isEcmaWs(s[i])) return false');
    lines.push('    while (i < s.length && !isEcmaWs(s[i])) i++');
    lines.push("    while (i < s.length && s[i] == ' ') {");
    lines.push('        i++');
    lines.push('        if (i >= s.length || isEcmaWs(s[i])) return false');
    lines.push('        while (i < s.length && !isEcmaWs(s[i])) i++');
    lines.push('    }');
    lines.push('    return i == s.length');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkStartsWithCharset')) {
    lines.push('/* ^[charset]+ (no end anchor, just check first char) */');
    lines.push('private fun checkStartsWithCharset(s: String, charset: String): Boolean =');
    lines.push('    s.isNotEmpty() && s[0] in charset');
    lines.push('');
  }

  if (helpers.has('checkBase64')) {
    lines.push('private fun isB64Char(c: Char): Boolean =');
    lines.push("    c in 'A'..'Z' || c in 'a'..'z' || c in '0'..'9' || c == '+' || c == '/'");
    lines.push('');
    lines.push('/* ^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$ */');
    lines.push('private fun checkBase64(s: String): Boolean {');
    lines.push('    if (s.isEmpty()) return true');
    lines.push('    if (s.length % 4 != 0) return false');
    lines.push('    var i = 0');
    lines.push("    while (i < s.length && s[i] != '=') {");
    lines.push('        if (!isB64Char(s[i])) return false');
    lines.push('        i++');
    lines.push('    }');
    lines.push('    val dataLen = i');
    lines.push('    val padLen = s.length - dataLen');
    lines.push('    if (padLen > 2) return false');
    lines.push('    if (padLen == 1 && dataLen % 4 != 3) return false');
    lines.push('    if (padLen == 2 && dataLen % 4 != 2) return false');
    lines.push("    while (i < s.length) { if (s[i] != '=') return false; i++ }");
    lines.push('    return true');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkNostrUri')) {
    lines.push('/* ^nostr:((npub|note)1[bech32]{58}|(nprofile|nevent|naddr)1[bech32]+)$ */');
    lines.push('private fun checkNostrUri(s: String): Boolean {');
    lines.push('    if (!s.startsWith("nostr:")) return false');
    lines.push('    val p = s.substring(6)');
    lines.push('    /* npub1 or note1 + exactly 58 data chars */');
    lines.push('    if (p.length == 63 && (p.startsWith("npub1") || p.startsWith("note1"))) {');
    lines.push('        for (i in 5 until 63) if (!isBech32Char(p[i])) return false');
    lines.push('        return true');
    lines.push('    }');
    lines.push('    /* nprofile1, nevent1, naddr1 + 1+ data chars */');
    lines.push('    val prefixLen: Int');
    lines.push('    if (p.startsWith("nprofile1")) prefixLen = 9');
    lines.push('    else if (p.startsWith("nevent1")) prefixLen = 7');
    lines.push('    else if (p.startsWith("naddr1")) prefixLen = 6');
    lines.push('    else return false');
    lines.push('    if (p.length <= prefixLen) return false');
    lines.push('    for (i in prefixLen until p.length) if (!isBech32Char(p[i])) return false');
    lines.push('    return true');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkNip04Encrypted')) {
    lines.push('/* ^[A-Za-z0-9+/]+={0,2}\\?iv=[A-Za-z0-9+/]+={0,2}$ */');
    lines.push('private fun checkNip04Encrypted(s: String): Boolean {');
    lines.push('    if (s.isEmpty()) return false');
    lines.push('    val sep = s.indexOf("?iv=")');
    lines.push('    if (sep <= 0) return false');
    lines.push('    val rightStart = sep + 4');
    lines.push('    if (rightStart >= s.length) return false');
    lines.push('    /* check left half: 1+ b64 chars + 0-2 = */');
    lines.push('    var i = 0');
    lines.push('    while (i < sep && isB64Char(s[i])) i++');
    lines.push('    if (i == 0) return false');
    lines.push('    var eq = 0');
    lines.push("    while (i < sep && s[i] == '=') { i++; eq++ }");
    lines.push('    if (i != sep || eq > 2) return false');
    lines.push('    /* check right half */');
    lines.push('    i = rightStart');
    lines.push('    val dataStart = i');
    lines.push('    while (i < s.length && isB64Char(s[i])) i++');
    lines.push('    if (i == dataStart) return false');
    lines.push('    eq = 0');
    lines.push("    while (i < s.length && s[i] == '=') { i++; eq++ }");
    lines.push('    return i == s.length && eq <= 2');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkNip05Identifier')) {
    lines.push('private fun isNip05LocalChar(c: Char): Boolean =');
    lines.push("    c == '_' || c in 'A'..'Z' || c in 'a'..'z' || c in '0'..'9' || c == '.' || c == '-'");
    lines.push('');
    lines.push('private fun isDomainChar(c: Char): Boolean =');
    lines.push("    c in 'A'..'Z' || c in 'a'..'z' || c in '0'..'9' || c == '-'");
    lines.push('');
    lines.push('private fun isAlnum(c: Char): Boolean =');
    lines.push("    c in 'A'..'Z' || c in 'a'..'z' || c in '0'..'9'");
    lines.push('');
    lines.push('/* NIP-05: local@domain.tld */');
    lines.push('private fun checkNip05Identifier(s: String): Boolean {');
    lines.push('    if (s.isEmpty()) return false');
    lines.push("    val at = s.lastIndexOf('@')");
    lines.push('    if (at <= 0) return false');
    lines.push('    /* local part */');
    lines.push('    for (i in 0 until at) {');
    lines.push('        if (!isNip05LocalChar(s[i])) return false');
    lines.push('    }');
    lines.push('    /* domain: 2+ dot-separated labels */');
    lines.push('    val d = s.substring(at + 1)');
    lines.push('    if (d.isEmpty()) return false');
    lines.push('    var dotCount = 0');
    lines.push('    var di = 0');
    lines.push('    while (di < d.length) {');
    lines.push('        if (!isAlnum(d[di])) return false');
    lines.push('        while (di < d.length && isDomainChar(d[di])) di++');
    lines.push('        if (di > 0 && !isAlnum(d[di - 1])) return false');
    lines.push("        if (di < d.length && d[di] == '.') { dotCount++; di++ }");
    lines.push('        else if (di < d.length) return false');
    lines.push('    }');
    lines.push('    return dotCount >= 1 && isAlnum(d[d.length - 1])');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkMimeTypeStrict')) {
    lines.push('private fun isMimeStrictChar(c: Char): Boolean =');
    lines.push("    c in 'A'..'Z' || c in 'a'..'z' || c in '0'..'9' || c == '!' || c == '#' || c == '$' || c == '&' || c == '^' || c == '_' || c == '.' || c == '+' || c == '-'");
    lines.push('');
    lines.push('/* ^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$ */');
    lines.push('private fun checkMimeTypeStrict(s: String): Boolean {');
    lines.push('    if (s.isEmpty()) return false');
    lines.push('    var i = 0');
    lines.push("    if (!(s[i] in 'A'..'Z' || s[i] in 'a'..'z' || s[i] in '0'..'9')) return false");
    lines.push('    i++');
    lines.push('    while (i < s.length && isMimeStrictChar(s[i])) i++');
    lines.push("    if (i >= s.length || s[i] != '/') return false");
    lines.push('    i++');
    lines.push("    if (i >= s.length || !(s[i] in 'A'..'Z' || s[i] in 'a'..'z' || s[i] in '0'..'9')) return false");
    lines.push('    i++');
    lines.push('    while (i < s.length && isMimeStrictChar(s[i])) i++');
    lines.push('    return i == s.length');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('checkPrefixDelimRest')) {
    lines.push('/* ^[charset]+<delim>.+ (no end anchor) */');
    lines.push('private fun checkPrefixDelimRest(s: String, charset: String, delimiter: String): Boolean {');
    lines.push('    if (s.isEmpty()) return false');
    lines.push('    var i = 0');
    lines.push('    if (s[i] !in charset) return false');
    lines.push('    while (i < s.length && s[i] in charset) i++');
    lines.push('    if (i + delimiter.length >= s.length) return false');
    lines.push('    if (s.substring(i, i + delimiter.length) != delimiter) return false');
    lines.push('    i += delimiter.length');
    lines.push('    if (i >= s.length) return false');
    lines.push('    /* .+ first char must not be a line terminator (Kotlin . excludes \\n, \\r, NEL, LS, PS) */');
    lines.push("    val c = s[i]");
    lines.push("    return c != '\\n' && c != '\\r' && c != '\\u0085' && c != '\\u2028' && c != '\\u2029'");
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
