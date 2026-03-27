/**
 * C validator emitter: ValidatorAction[] → .c + .h pair
 *
 * Default: generic C — tags are const char*** (array of string arrays),
 * with int* tag_lens (length of each tag) and int num_tags.
 *
 * Optional: --c-api nostrdb targets the nostrdb C API (ndb_iterator, etc.)
 *
 * Error reporting uses a zero-alloc, caller-provided buffer:
 *   struct schemata_error { const char *path; const char *message; };
 *   int schemata_validate_kind_N(..., struct schemata_error *errs, int max_errs);
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

export type CApi = 'generic' | 'nostrdb';

// --- API adapter: abstracts how tags are accessed ---

interface CApiAdapter {
  /** #include needed in header */
  headerInclude: string;
  /** Function parameter for a kind validator */
  fnParams: string;
  /** Function parameter for the dispatch function */
  dispatchParams: string;
  /** Expression to get kind number (for dispatch switch) */
  kindExpr: string;
  /** Open a for-loop iterating tags; yields tag variable name and tag-len expression */
  forEachTag: (body: string[]) => string[];
  /** Expression: get string at position `index` within current tag */
  tagStr: (index: number) => string;
  /** Expression: number of elements in current tag */
  tagCount: () => string;
  /** Expression: check if tag name equals `name` (position 0) */
  tagNameCheck: (name: string) => string;
  /** Expression: total number of tags */
  numTags: () => string;
  /** Statements to count total tags into a variable */
  countTags: (varName: string) => string[];
  /** Forward-declare the per-kind function */
  fnDecl: (kindNumber: number) => string[];
  /** Dispatch forward-declare */
  dispatchDecl: () => string[];
}

function genericAdapter(): CApiAdapter {
  return {
    headerInclude: '',
    fnParams: 'const char *const *const *tags, const int *tag_lens, int num_tags,\n                                  struct schemata_error *errs, int max_errs',
    dispatchParams: 'int kind, const char *const *const *tags, const int *tag_lens, int num_tags,\n                      struct schemata_error *errs, int max_errs',
    kindExpr: 'kind',
    forEachTag: (body) => {
      const lines: string[] = [];
      lines.push('        for (int _i = 0; _i < num_tags; _i++) {');
      lines.push('            const char *const *_tag = tags[_i];');
      lines.push('            int _tag_len = tag_lens[_i];');
      for (const l of body) lines.push('        ' + l);
      lines.push('        }');
      return lines;
    },
    tagStr: (index) => `_tag[${index}]`,
    tagCount: () => '_tag_len',
    tagNameCheck: (name) => `_tag && _tag_len > 0 && _tag[0] && strcmp(_tag[0], ${JSON.stringify(name)}) == 0`,
    numTags: () => 'num_tags',
    countTags: (varName) => [`    int ${varName} = num_tags;`],
    fnDecl: (kindNumber) => [
      `int schemata_validate_kind_${kindNumber}(const char *const *const *tags, const int *tag_lens, int num_tags,`,
      `                                  struct schemata_error *errs, int max_errs);`,
    ],
    dispatchDecl: () => [
      'int schemata_validate(int kind, const char *const *const *tags, const int *tag_lens, int num_tags,',
      '                      struct schemata_error *errs, int max_errs);',
    ],
  };
}

function nostrdbAdapter(): CApiAdapter {
  return {
    headerInclude: '#include "nostrdb.h"',
    fnParams: 'const struct ndb_note *note,\n                                  struct schemata_error *errs, int max_errs',
    dispatchParams: 'const struct ndb_note *note,\n                      struct schemata_error *errs, int max_errs',
    kindExpr: 'ndb_note_kind(note)',
    forEachTag: (body) => {
      const lines: string[] = [];
      lines.push('        struct ndb_iterator _it;');
      lines.push('        ndb_tags_iterate_start(note, &_it);');
      lines.push('        while (ndb_tags_iterate_next(&_it)) {');
      for (const l of body) lines.push('        ' + l);
      lines.push('        }');
      return lines;
    },
    tagStr: (index) => `ndb_iter_tag_str(&_it, ${index})`,
    tagCount: () => 'ndb_tag_count(_it.tag)',
    tagNameCheck: (name) => {
      const t0 = `ndb_iter_tag_str(&_it, 0)`;
      return `(${t0} && strcmp(${t0}, ${JSON.stringify(name)}) == 0)`;
    },
    numTags: () => '/* count via iteration */',
    countTags: (varName) => [
      `    int ${varName} = 0;`,
      '    {',
      '        struct ndb_iterator _cit;',
      '        ndb_tags_iterate_start(note, &_cit);',
      '        while (ndb_tags_iterate_next(&_cit)) ' + varName + '++;',
      '    }',
    ],
    fnDecl: (kindNumber) => [
      `int schemata_validate_kind_${kindNumber}(const struct ndb_note *note,`,
      `                                  struct schemata_error *errs, int max_errs);`,
    ],
    dispatchDecl: () => [
      'int schemata_validate(const struct ndb_note *note,',
      '                      struct schemata_error *errs, int max_errs);',
    ],
  };
}

function getAdapter(api: CApi): CApiAdapter {
  return api === 'nostrdb' ? nostrdbAdapter() : genericAdapter();
}

// --- Pattern check helpers (API-independent) ---

function renderPatternCheckC(check: PatternCheck, varExpr: string): { expr: string; helpers: Set<string> } {
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
      return { expr: `${fn}(${varExpr}, ${JSON.stringify(check.prefix)})`, helpers };
    }
    case 'all_digits': {
      const fn = check.allowNeg ? 'schemata_check_signed_int' : 'schemata_check_digits';
      helpers.add(fn);
      return { expr: `${fn}(${varExpr})`, helpers };
    }
    case 'starts_with_any': {
      helpers.add('schemata_starts_with');
      const checks = check.prefixes.map(p => `schemata_starts_with(${varExpr}, ${JSON.stringify(p)})`);
      return { expr: checks.length === 1 ? checks[0] : `(${checks.join(' || ')})`, helpers };
    }
    case 'chars_in': {
      if (check.min === 0 && check.max === 0) {
        return { expr: `(${varExpr}[0] == '\\0')`, helpers };
      }
      const fn = 'schemata_check_chars_in';
      helpers.add(fn);
      return { expr: `${fn}(${varExpr}, ${JSON.stringify(check.charset)}, ${check.min ?? -1}, ${check.max ?? -1})`, helpers };
    }
    case 'regex': {
      helpers.add('schemata_check_regex');
      return { expr: `schemata_check_regex(${varExpr}, ${JSON.stringify(check.pattern)})`, helpers };
    }
    case 'compound': {
      const allHelpers = new Set<string>();
      const parts: string[] = [];
      for (const sub of check.checks) {
        const r = renderPatternCheckC(sub, varExpr);
        parts.push(r.expr);
        for (const h of r.helpers) allHelpers.add(h);
      }
      return { expr: `(${parts.join(' && ')})`, helpers: allHelpers };
    }
  }
}

function renderValueCheckC(check: ValueCheck, adapter: CApiAdapter, index: number): { expr: string; helpers: Set<string> } {
  const helpers = new Set<string>();
  const str = adapter.tagStr(index);
  switch (check.type) {
    case 'const':
      return { expr: `(${str} && strcmp(${str}, ${JSON.stringify(check.value)}) == 0)`, helpers };
    case 'enum': {
      const checks = check.values.map(v => `strcmp(${str}, ${JSON.stringify(v)}) == 0`);
      return { expr: `(${str} && (${checks.join(' || ')}))`, helpers };
    }
    case 'pattern': {
      const r = renderPatternCheckC(check.native, str);
      for (const h of r.helpers) helpers.add(h);
      return { expr: `(${str} && ${r.expr})`, helpers };
    }
    case 'anyOf': {
      const parts: string[] = [];
      for (const alt of check.alternatives) {
        const r = renderValueCheckC(alt, adapter, index);
        parts.push(r.expr);
        for (const h of r.helpers) helpers.add(h);
      }
      return { expr: `(${parts.join(' || ')})`, helpers };
    }
  }
}

function describePositionConstraintC(pc: PositionCheck, tagName: string): string {
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

// --- Tag search block ---

function renderTagSearchC(
  matcher: TagMatcher,
  errorMsg: string,
  indent: string,
  adapter: CApiAdapter,
): { code: string; helpers: Set<string> } {
  const helpers = new Set<string>();

  const innerBody: string[] = [];
  innerBody.push(`    if (!(${adapter.tagNameCheck(matcher.tagName)})) continue;`);
  innerBody.push(`    if (${adapter.tagCount()} < ${matcher.minItems}) continue;`);
  if (matcher.maxItems !== undefined) {
    innerBody.push(`    if (${adapter.tagCount()} > ${matcher.maxItems}) continue;`);
  }
  for (const pc of matcher.positionChecks) {
    const r = renderValueCheckC(pc.check, adapter, pc.index);
    for (const h of r.helpers) helpers.add(h);
    innerBody.push(`    if (!${r.expr}) continue;`);
  }
  innerBody.push('    found = 1; break;');

  const lines: string[] = [];
  lines.push(`${indent}{`);
  lines.push(`${indent}    int found = 0;`);
  const loopLines = adapter.forEachTag(innerBody);
  for (const l of loopLines) lines.push(`${indent}${l}`);
  lines.push(`${indent}    if (!found) SCHEMATA_EMIT_ERR(errs, n, max_errs, "tags", ${JSON.stringify(errorMsg)});`);
  lines.push(`${indent}}`);

  return { code: lines.join('\n'), helpers };
}

// --- Main emitter ---

export function emitCValidators(
  kindShapes: KindShape[],
  api: CApi = 'generic',
  headerFileName: string = 'schemata_validators.h',
): { header: string; source: string } {
  const adapter = getAdapter(api);
  const allHelpers = new Set<string>();
  const fnBodies: string[] = [];
  const constrainedKinds: { kindNumber: number; nip: string }[] = [];

  for (const shape of [...kindShapes].sort((a, b) => a.kindNumber - b.kindNumber)) {
    const actions = planKindValidator(shape);
    if (!actions) continue;

    constrainedKinds.push({ kindNumber: shape.kindNumber, nip: shape.nip });
    const { code, helpers } = emitKindFunctionC(shape.kindNumber, shape.nip, actions, adapter);
    fnBodies.push(code);
    for (const h of helpers) allHelpers.add(h);
  }

  const header = emitHeaderFile(constrainedKinds, adapter);
  const source = emitSourceFile(fnBodies, constrainedKinds, allHelpers, adapter, api, headerFileName);

  return { header, source };
}

function emitKindFunctionC(
  kindNumber: number,
  nip: string,
  actions: ValidatorAction[],
  adapter: CApiAdapter,
): { code: string; helpers: Set<string> } {
  const helpers = new Set<string>();
  const lines: string[] = [];

  lines.push(`/* Validate tags for kind ${kindNumber} (${nip}) */`);
  lines.push(`int schemata_validate_kind_${kindNumber}(${adapter.fnParams}) {`);
  lines.push('    int n = 0;');

  for (const action of actions) {
    switch (action.type) {
      case 'check_min_tags': {
        const countLines = adapter.countTags('_count');
        for (const l of countLines) lines.push(l);
        lines.push(`    if (_count < ${action.min}) SCHEMATA_EMIT_ERR(errs, n, max_errs, "tags", "tags must have at least ${action.min} item(s)");`);
        break;
      }

      case 'require_tag': {
        const r = renderTagSearchC(action.matcher, action.errorMsg, '    ', adapter);
        lines.push(r.code);
        for (const h of r.helpers) helpers.add(h);
        break;
      }

      case 'validate_optional_positions': {
        const innerBody: string[] = [];
        innerBody.push(`    if (!(${adapter.tagNameCheck(action.tagName)})) continue;`);
        for (const pc of action.checks) {
          const r = renderValueCheckC(pc.check, adapter, pc.index);
          for (const h of r.helpers) helpers.add(h);
          const msg = describePositionConstraintC(pc, action.tagName);
          innerBody.push(`    if (${adapter.tagCount()} > ${pc.index} && !(${r.expr})) {`);
          innerBody.push(`        SCHEMATA_EMIT_ERR(errs, n, max_errs, "tags", ${JSON.stringify(msg)});`);
          innerBody.push('    }');
        }

        lines.push('    {');
        const loopLines = adapter.forEachTag(innerBody);
        for (const l of loopLines) lines.push(l);
        lines.push('    }');
        break;
      }

      case 'per_item_conditional': {
        const innerBody: string[] = [];
        innerBody.push(`    if (!(${adapter.tagNameCheck(action.condTag)})) continue;`);

        // Build matcher condition checks
        const matchChecks: string[] = [];
        matchChecks.push(`${adapter.tagCount()} >= ${action.matcher.minItems}`);
        if (action.matcher.maxItems !== undefined) {
          matchChecks.push(`${adapter.tagCount()} <= ${action.matcher.maxItems}`);
        }
        for (const pc of action.matcher.positionChecks) {
          const r = renderValueCheckC(pc.check, adapter, pc.index);
          for (const h of r.helpers) helpers.add(h);
          matchChecks.push(r.expr);
        }

        innerBody.push(`    if (!(${matchChecks.join(' && ')})) {`);
        innerBody.push(`        SCHEMATA_EMIT_ERR(errs, n, max_errs, "tags", ${JSON.stringify(action.errorMsg)});`);
        innerBody.push('    }');

        for (const pc of action.optChecks) {
          const r = renderValueCheckC(pc.check, adapter, pc.index);
          for (const h of r.helpers) helpers.add(h);
          const msg = describePositionConstraintC(pc, action.condTag);
          innerBody.push(`    if (${adapter.tagCount()} > ${pc.index} && !(${r.expr})) {`);
          innerBody.push(`        SCHEMATA_EMIT_ERR(errs, n, max_errs, "tags", ${JSON.stringify(msg)});`);
          innerBody.push('    }');
        }

        lines.push('    {');
        const loopLines = adapter.forEachTag(innerBody);
        for (const l of loopLines) lines.push(l);
        lines.push('    }');
        break;
      }

      case 'array_level_conditional': {
        // First pass: check if condition tag exists
        const condBody: string[] = [];
        condBody.push(`    if (${adapter.tagNameCheck(action.condTag)}) { has_cond = 1; break; }`);

        lines.push('    {');
        lines.push('        int has_cond = 0;');
        const condLoop = adapter.forEachTag(condBody);
        for (const l of condLoop) lines.push(l);
        lines.push('        if (has_cond) {');

        const r = renderTagSearchC(action.matcher, action.errorMsg, '            ', adapter);
        lines.push(r.code);
        for (const h of r.helpers) helpers.add(h);

        lines.push('        }');
        lines.push('    }');

        // Optional position checks
        if (action.optChecks.length > 0) {
          const optBody: string[] = [];
          optBody.push(`    if (!(${adapter.tagNameCheck(action.matcher.tagName)})) continue;`);
          for (const pc of action.optChecks) {
            const rv = renderValueCheckC(pc.check, adapter, pc.index);
            for (const h of rv.helpers) helpers.add(h);
            const msg = describePositionConstraintC(pc, action.matcher.tagName);
            optBody.push(`    if (${adapter.tagCount()} > ${pc.index} && !(${rv.expr})) {`);
            optBody.push(`        SCHEMATA_EMIT_ERR(errs, n, max_errs, "tags", ${JSON.stringify(msg)});`);
            optBody.push('    }');
          }
          lines.push('    {');
          const optLoop = adapter.forEachTag(optBody);
          for (const l of optLoop) lines.push(l);
          lines.push('    }');
        }
        break;
      }

      case 'any_of_group': {
        lines.push('    {');
        lines.push('        int found_any = 0;');
        for (const matcher of action.matchers) {
          const innerBody: string[] = [];
          innerBody.push(`    if (!(${adapter.tagNameCheck(matcher.tagName)})) continue;`);
          innerBody.push(`    if (${adapter.tagCount()} < ${matcher.minItems}) continue;`);
          if (matcher.maxItems !== undefined) {
            innerBody.push(`    if (${adapter.tagCount()} > ${matcher.maxItems}) continue;`);
          }
          for (const pc of matcher.positionChecks) {
            const r = renderValueCheckC(pc.check, adapter, pc.index);
            for (const h of r.helpers) helpers.add(h);
            innerBody.push(`    if (!${r.expr}) continue;`);
          }
          innerBody.push('    found_any = 1; break;');

          lines.push('        if (!found_any) {');
          const loopLines = adapter.forEachTag(innerBody);
          for (const l of loopLines) lines.push('    ' + l);
          lines.push('        }');
        }
        lines.push(`        if (!found_any) SCHEMATA_EMIT_ERR(errs, n, max_errs, "tags", ${JSON.stringify(action.errorMsg)});`);
        lines.push('    }');
        break;
      }
    }
  }

  lines.push('    return n;');
  lines.push('}');

  return { code: lines.join('\n'), helpers };
}

// --- File generation ---

function emitHeaderFile(
  constrainedKinds: { kindNumber: number; nip: string }[],
  adapter: CApiAdapter,
): string {
  const lines: string[] = [
    '/* Auto-generated by @nostrability/schemata-codegen */',
    '/* Do not edit manually. */',
    '',
    '#ifndef SCHEMATA_VALIDATORS_H',
    '#define SCHEMATA_VALIDATORS_H',
    '',
  ];

  if (adapter.headerInclude) {
    lines.push(adapter.headerInclude);
    lines.push('');
  }

  lines.push('#ifdef __cplusplus');
  lines.push('extern "C" {');
  lines.push('#endif');
  lines.push('');
  lines.push('struct schemata_error {');
  lines.push('    const char *path;');
  lines.push('    const char *message;');
  lines.push('};');
  lines.push('');

  for (const k of constrainedKinds) {
    lines.push(`/* ${k.nip} */`);
    for (const l of adapter.fnDecl(k.kindNumber)) lines.push(l);
    lines.push('');
  }

  lines.push('/* Dispatch: validate by kind number */');
  for (const l of adapter.dispatchDecl()) lines.push(l);
  lines.push('');
  lines.push('#ifdef __cplusplus');
  lines.push('}');
  lines.push('#endif');
  lines.push('');
  lines.push('#endif /* SCHEMATA_VALIDATORS_H */');
  lines.push('');

  return lines.join('\n');
}

function emitSourceFile(
  fnBodies: string[],
  constrainedKinds: { kindNumber: number; nip: string }[],
  helpers: Set<string>,
  adapter: CApiAdapter,
  api: CApi,
  headerFileName: string,
): string {
  const lines: string[] = [
    '/* Auto-generated by @nostrability/schemata-codegen */',
    '/* Do not edit manually. */',
    '',
    `#include "${headerFileName}"`,
    '#include <string.h>',
    '#include <ctype.h>',
    '',
  ];

  lines.push('#define SCHEMATA_EMIT_ERR(errs, n, max, path_str, msg_str) \\');
  lines.push('    do { if ((n) < (max)) { (errs)[(n)].path = (path_str); (errs)[(n)].message = (msg_str); } (n)++; } while(0)');
  lines.push('');

  lines.push(emitHelperFunctions(helpers));

  for (const fn of fnBodies) {
    lines.push(fn);
    lines.push('');
  }

  lines.push('/* Dispatch: validate by kind number */');
  lines.push(`int schemata_validate(${adapter.dispatchParams}) {`);
  lines.push(`    switch (${adapter.kindExpr}) {`);
  for (const k of constrainedKinds) {
    if (api === 'nostrdb') {
      lines.push(`        case ${k.kindNumber}: return schemata_validate_kind_${k.kindNumber}(note, errs, max_errs);`);
    } else {
      lines.push(`        case ${k.kindNumber}: return schemata_validate_kind_${k.kindNumber}(tags, tag_lens, num_tags, errs, max_errs);`);
    }
  }
  lines.push('        default: return 0;');
  lines.push('    }');
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

function emitHelperFunctions(helpers: Set<string>): string {
  const lines: string[] = [];

  if (helpers.has('schemata_starts_with')) {
    lines.push('static int schemata_starts_with(const char *s, const char *prefix) {');
    lines.push('    return strncmp(s, prefix, strlen(prefix)) == 0;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_digits')) {
    lines.push('static int schemata_check_digits(const char *s) {');
    lines.push('    if (!s || !*s) return 0;');
    lines.push('    for (const char *p = s; *p; p++) {');
    lines.push('        if (!isdigit((unsigned char)*p)) return 0;');
    lines.push('    }');
    lines.push('    return 1;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_signed_int')) {
    lines.push('static int schemata_check_signed_int(const char *s) {');
    lines.push('    if (!s || !*s) return 0;');
    lines.push('    if (*s == \'-\') s++;');
    lines.push('    if (!*s) return 0;');
    lines.push('    for (const char *p = s; *p; p++) {');
    lines.push('        if (!isdigit((unsigned char)*p)) return 0;');
    lines.push('    }');
    lines.push('    return 1;');
    lines.push('}');
    lines.push('');
  }

  const hexLengths = new Set<number>();
  const hexMixedLengths = new Set<number>();
  for (const h of helpers) {
    const m = h.match(/^schemata_check_hex(\d+)$/);
    if (m) hexLengths.add(parseInt(m[1], 10));
    const mm = h.match(/^schemata_check_hex(\d+)_mixed$/);
    if (mm) hexMixedLengths.add(parseInt(mm[1], 10));
  }

  for (const len of [...hexLengths].sort((a, b) => a - b)) {
    lines.push(`static int schemata_check_hex${len}(const char *s) {`);
    lines.push('    if (!s) return 0;');
    lines.push('    int i;');
    lines.push(`    for (i = 0; i < ${len} && s[i]; i++) {`);
    lines.push("        char c = s[i];");
    lines.push("        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return 0;");
    lines.push('    }');
    lines.push(`    return i == ${len} && s[i] == '\\0';`);
    lines.push('}');
    lines.push('');
  }

  for (const len of [...hexMixedLengths].sort((a, b) => a - b)) {
    lines.push(`static int schemata_check_hex${len}_mixed(const char *s) {`);
    lines.push('    if (!s) return 0;');
    lines.push('    int i;');
    lines.push(`    for (i = 0; i < ${len} && s[i]; i++) {`);
    lines.push('        if (!isxdigit((unsigned char)s[i])) return 0;');
    lines.push('    }');
    lines.push(`    return i == ${len} && s[i] == '\\0';`);
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_hex_range')) {
    lines.push('static int schemata_check_hex_range(const char *s, int min_len, int max_len) {');
    lines.push('    if (!s) return 0;');
    lines.push('    int len = 0;');
    lines.push('    for (const char *p = s; *p; p++, len++) {');
    lines.push("        char c = *p;");
    lines.push("        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return 0;");
    lines.push('    }');
    lines.push('    return len >= min_len && len <= max_len;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_hex_range_mixed')) {
    lines.push('static int schemata_check_hex_range_mixed(const char *s, int min_len, int max_len) {');
    lines.push('    if (!s) return 0;');
    lines.push('    int len = 0;');
    lines.push('    for (const char *p = s; *p; p++, len++) {');
    lines.push('        if (!isxdigit((unsigned char)*p)) return 0;');
    lines.push('    }');
    lines.push('    return len >= min_len && len <= max_len;');
    lines.push('}');
    lines.push('');
  }

  for (const h of helpers) {
    const m = h.match(/^schemata_check_hex_prefixed_(\d+)$/);
    if (m) {
      const hexLen = parseInt(m[1], 10);
      lines.push(`static int schemata_check_hex_prefixed_${hexLen}(const char *s, const char *prefix) {`);
      lines.push('    if (!s) return 0;');
      lines.push('    size_t plen = strlen(prefix);');
      lines.push('    if (strncmp(s, prefix, plen) != 0) return 0;');
      lines.push('    s += plen;');
      lines.push('    int i;');
      lines.push(`    for (i = 0; i < ${hexLen} && s[i]; i++) {`);
      lines.push("        char c = s[i];");
      lines.push("        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return 0;");
      lines.push('    }');
      lines.push(`    return i == ${hexLen} && s[i] == '\\0';`);
      lines.push('}');
      lines.push('');
    }
  }

  if (helpers.has('schemata_check_chars_in')) {
    lines.push('static int schemata_check_chars_in(const char *s, const char *charset, int min_len, int max_len) {');
    lines.push('    if (!s) return 0;');
    lines.push('    int len = 0;');
    lines.push('    for (const char *p = s; *p; p++, len++) {');
    lines.push("        if (!strchr(charset, *p)) return 0;");
    lines.push('    }');
    lines.push('    if (min_len >= 0 && len < min_len) return 0;');
    lines.push('    if (max_len >= 0 && len > max_len) return 0;');
    lines.push('    return 1;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_regex')) {
    lines.push('#include <regex.h>');
    lines.push('');
    lines.push('static int schemata_check_regex(const char *s, const char *pattern) {');
    lines.push('    if (!s) return 0;');
    lines.push('    regex_t re;');
    lines.push('    if (regcomp(&re, pattern, REG_EXTENDED | REG_NOSUB) != 0) return 0;');
    lines.push('    int result = regexec(&re, s, 0, NULL, 0) == 0;');
    lines.push('    regfree(&re);');
    lines.push('    return result;');
    lines.push('}');
    lines.push('');
  }

  return lines.join('\n');
}
