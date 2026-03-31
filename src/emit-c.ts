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
    case 'bech32': {
      helpers.add('schemata_check_bech32');
      if (check.dataLen !== undefined) {
        return { expr: `schemata_check_bech32(${varExpr}, ${JSON.stringify(check.hrp + '1')}, ${check.dataLen})`, helpers };
      }
      return { expr: `schemata_check_bech32(${varExpr}, ${JSON.stringify(check.hrp + '1')}, -1)`, helpers };
    }
    case 'regex': {
      helpers.add('schemata_check_regex');
      return { expr: `schemata_check_regex(${varExpr}, ${JSON.stringify(check.pattern)})`, helpers };
    }
    case 'relay_url': {
      helpers.add('schemata_check_relay_url');
      return { expr: `schemata_check_relay_url(${varExpr})`, helpers };
    }
    case 'a_tag': {
      helpers.add('schemata_check_a_tag');
      if (check.kinds && check.kinds.length > 0) {
        const arr = check.kinds.map(k => JSON.stringify(k)).join(', ');
        return { expr: `schemata_check_a_tag(${varExpr}, (const char*[]){${arr}}, ${check.kinds.length})`, helpers };
      }
      return { expr: `schemata_check_a_tag(${varExpr}, NULL, 0)`, helpers };
    }
    case 'date_iso': {
      helpers.add('schemata_check_date_iso');
      return { expr: `schemata_check_date_iso(${varExpr})`, helpers };
    }
    case 'datetime_iso': {
      helpers.add('schemata_check_datetime_iso');
      return { expr: `schemata_check_datetime_iso(${varExpr})`, helpers };
    }
    case 'decimal': {
      helpers.add('schemata_check_decimal');
      return { expr: `schemata_check_decimal(${varExpr})`, helpers };
    }
    case 'exact_values': {
      const checks = check.values.map(v => `strcmp(${varExpr}, ${JSON.stringify(v)}) == 0`);
      return { expr: checks.length === 1 ? checks[0] : `(${checks.join(' || ')})`, helpers };
    }
    case 'prefix_nonempty': {
      helpers.add('schemata_starts_with');
      helpers.add('schemata_check_dot_tail');
      return {
        expr: `(schemata_starts_with(${varExpr}, ${JSON.stringify(check.prefix)}) && schemata_check_dot_tail(${varExpr}, ${check.prefix.length}, strlen(${varExpr})))`,
        helpers,
      };
    }
    case 'wrapped': {
      helpers.add('schemata_check_wrapped');
      return { expr: `schemata_check_wrapped(${varExpr}, ${JSON.stringify(check.prefix)}, ${JSON.stringify(check.suffix)})`, helpers };
    }
    case 'csv_list': {
      helpers.add('schemata_check_csv_list');
      return { expr: `schemata_check_csv_list(${varExpr}, ${JSON.stringify(check.itemCharset)})`, helpers };
    }
    case 'ln_invoice': {
      helpers.add('schemata_check_ln_invoice');
      helpers.add('schemata_check_bech32');
      return { expr: `schemata_check_ln_invoice(${varExpr}, ${JSON.stringify(check.prefix)}, ${check.minHrpLen})`, helpers };
    }
    case 'mime_type': {
      helpers.add('schemata_check_mime_type');
      return { expr: `schemata_check_mime_type(${varExpr})`, helpers };
    }
    case 'http_origin': {
      helpers.add('schemata_check_http_origin');
      return { expr: `schemata_check_http_origin(${varExpr})`, helpers };
    }
    case 'email_like': {
      helpers.add('schemata_check_email_like');
      helpers.add('schemata_is_ecma_ws');
      return { expr: `schemata_check_email_like(${varExpr})`, helpers };
    }
    case 'git_clone_url': {
      helpers.add('schemata_check_git_clone_url');
      helpers.add('schemata_is_ecma_ws');
      return { expr: `schemata_check_git_clone_url(${varExpr})`, helpers };
    }
    case 'content_type': {
      helpers.add('schemata_check_content_type');
      return { expr: `schemata_check_content_type(${varExpr})`, helpers };
    }
    case 'doi': {
      helpers.add('schemata_check_doi');
      return { expr: `schemata_check_doi(${varExpr})`, helpers };
    }
    case 'annotate_user': {
      helpers.add('schemata_check_annotate_user');
      return { expr: `schemata_check_annotate_user(${varExpr})`, helpers };
    }
    case 'prefix_no_whitespace': {
      helpers.add('schemata_starts_with');
      helpers.add('schemata_check_no_ws_tail');
      helpers.add('schemata_is_ecma_ws');
      const checks = check.prefixes.map(p =>
        `(schemata_starts_with(${varExpr}, ${JSON.stringify(p)}) && schemata_check_no_ws_tail(${varExpr}, ${p.length}))`
      );
      return { expr: checks.length === 1 ? checks[0] : `(${checks.join(' || ')})`, helpers };
    }
    case 'external_identity': {
      helpers.add('schemata_check_external_identity');
      return { expr: `schemata_check_external_identity(${varExpr})`, helpers };
    }
    case 'package_id': {
      helpers.add('schemata_check_package_id');
      return { expr: `schemata_check_package_id(${varExpr})`, helpers };
    }
    case 'imeta_dim': {
      helpers.add('schemata_check_imeta_dim');
      return { expr: `schemata_check_imeta_dim(${varExpr})`, helpers };
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
    default: {
      const _exhaustive: never = check;
      throw new Error(`Unhandled PatternCheck op: ${(_exhaustive as any).op}`);
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

        // Optional position checks (inside condTag guard)
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
          lines.push('            {');
          const optLoop = adapter.forEachTag(optBody);
          for (const l of optLoop) lines.push(l);
          lines.push('            }');
        }

        lines.push('        }');
        lines.push('    }');
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
    lines.push("        if (*p < '0' || *p > '9') return 0;");
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
    lines.push("        if (*p < '0' || *p > '9') return 0;");
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

  if (helpers.has('schemata_check_bech32')) {
    lines.push('static int schemata_is_bech32_char(char c) {');
    lines.push("    return (c >= '0' && c <= '9' && c != '1') || (c >= 'a' && c <= 'z' && c != 'b' && c != 'i' && c != 'o');");
    lines.push('}');
    lines.push('');
    lines.push('static int schemata_check_bech32(const char *s, const char *prefix, int data_len) {');
    lines.push('    if (!s) return 0;');
    lines.push('    size_t plen = strlen(prefix);');
    lines.push('    if (strncmp(s, prefix, plen) != 0) return 0;');
    lines.push('    s += plen;');
    lines.push('    int i = 0;');
    lines.push('    for (; s[i]; i++) {');
    lines.push('        if (!schemata_is_bech32_char(s[i])) return 0;');
    lines.push('    }');
    lines.push('    if (data_len >= 0) return i == data_len;');
    lines.push('    return i > 0;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_date_iso')) {
    lines.push('static int schemata_check_date_iso(const char *s) {');
    lines.push('    if (!s) return 0;');
    lines.push('    int len = 0;');
    lines.push('    for (const char *p = s; *p; p++) len++;');
    lines.push('    if (len != 10) return 0;');
    lines.push("    if (s[4] != '-' || s[7] != '-') return 0;");
    lines.push("    for (int i = 0; i < 10; i++) {");
    lines.push("        if (i == 4 || i == 7) continue;");
    lines.push("        if (s[i] < '0' || s[i] > '9') return 0;");
    lines.push('    }');
    lines.push('    return 1;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_decimal')) {
    lines.push('static int schemata_check_decimal(const char *s) {');
    lines.push('    if (!s || !*s) return 0;');
    lines.push("    const char *p = s;");
    lines.push("    while (*p >= '0' && *p <= '9') p++;");
    lines.push("    if (p == s) return 0;");
    lines.push("    if (*p == '.') {");
    lines.push('        p++;');
    lines.push("        if (*p < '0' || *p > '9') return 0;");
    lines.push("        while (*p >= '0' && *p <= '9') p++;");
    lines.push('    }');
    lines.push("    return *p == '\\0';");
    lines.push('}');
    lines.push('');
  }

  // Shared dot-tail helper: checks remaining string has >=1 char and no line terminators (regex `.` semantics)
  // C regex `.` excludes only \n
  if (helpers.has('schemata_check_dot_tail') || helpers.has('schemata_check_relay_url') || helpers.has('schemata_check_a_tag') || helpers.has('schemata_check_doi')) {
    lines.push('static int schemata_check_dot_tail(const char *s, size_t pos, size_t len) {');
    lines.push('    if (pos >= len) return 0;');
    lines.push('    for (size_t i = pos; i < len; i++) {');
    lines.push("        if (s[i] == '\\n') return 0;");
    lines.push('    }');
    lines.push('    return 1;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_relay_url')) {
    lines.push('static int schemata_check_relay_url(const char *s) {');
    lines.push('    if (!s) return 0;');
    lines.push('    size_t len = strlen(s);');
    lines.push('    size_t pos = 0;');
    lines.push("    if (len >= 6 && s[0] == 'w' && s[1] == 's' && s[2] == 's' && s[3] == ':' && s[4] == '/' && s[5] == '/') { pos = 6; }");
    lines.push("    else if (len >= 5 && s[0] == 'w' && s[1] == 's' && s[2] == ':' && s[3] == '/' && s[4] == '/') { pos = 5; }");
    lines.push('    else { return 0; }');
    lines.push('    size_t host_start = pos;');
    lines.push('    while (s[pos]) {');
    lines.push("        char c = s[pos];");
    lines.push("        if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '-') { pos++; }");
    lines.push('        else { break; }');
    lines.push('    }');
    lines.push('    if (pos == host_start) return 0;');
    lines.push("    if (s[pos] == ':') {");
    lines.push('        pos++;');
    lines.push('        size_t port_start = pos;');
    lines.push("        while (s[pos] >= '0' && s[pos] <= '9') pos++;");
    lines.push('        if (pos == port_start) return 0;');
    lines.push('    }');
    lines.push("    if (s[pos] == '/') {");
    lines.push('        return schemata_check_dot_tail(s, pos + 1, len) || (pos + 1 == len);');
    lines.push('    }');
    lines.push("    return s[pos] == '\\0';");
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_a_tag')) {
    lines.push('static int schemata_check_a_tag(const char *s, const char **kinds, int num_kinds) {');
    lines.push('    if (!s) return 0;');
    lines.push('    size_t len = strlen(s);');
    lines.push('    if (len < 68) return 0;  /* min: 1 digit + : + 64 hex + : + 1 char */');
    lines.push('    size_t pos = 0;');
    lines.push("    if (s[pos] < '0' || s[pos] > '9') return 0;");
    lines.push('    size_t kind_start = pos;');
    lines.push("    while (pos < len && s[pos] >= '0' && s[pos] <= '9') pos++;");
    lines.push('    size_t kind_len = pos - kind_start;');
    lines.push("    if (pos >= len || s[pos] != ':') return 0;");
    lines.push('    /* reject leading zeros: "0" ok, "0N..." not ok */');
    lines.push("    if (kind_len > 1 && s[kind_start] == '0') return 0;");
    lines.push('    if (kinds && num_kinds > 0) {');
    lines.push('        int found = 0;');
    lines.push('        for (int i = 0; i < num_kinds; i++) {');
    lines.push('            if (strlen(kinds[i]) == kind_len && strncmp(s + kind_start, kinds[i], kind_len) == 0) { found = 1; break; }');
    lines.push('        }');
    lines.push('        if (!found) return 0;');
    lines.push('    }');
    lines.push('    pos++;  /* skip : */');
    lines.push('    if (pos + 64 >= len) return 0;');
    lines.push('    for (size_t i = 0; i < 64; i++) {');
    lines.push("        char c = s[pos + i];");
    lines.push("        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return 0;");
    lines.push('    }');
    lines.push('    pos += 64;');
    lines.push("    if (pos >= len || s[pos] != ':') return 0;");
    lines.push('    pos++;');
    lines.push('    return schemata_check_dot_tail(s, pos, len);');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_datetime_iso')) {
    lines.push('static int schemata_check_datetime_iso(const char *s) {');
    lines.push('    if (!s) return 0;');
    lines.push('    size_t len = strlen(s);');
    lines.push('    if (len < 10) return 0;');
    lines.push('    for (int i = 0; i < 4; i++) if (s[i] < \'0\' || s[i] > \'9\') return 0;');
    lines.push("    if (s[4] != '-') return 0;");
    lines.push('    for (int i = 5; i < 7; i++) if (s[i] < \'0\' || s[i] > \'9\') return 0;');
    lines.push("    if (s[7] != '-') return 0;");
    lines.push('    for (int i = 8; i < 10; i++) if (s[i] < \'0\' || s[i] > \'9\') return 0;');
    lines.push('    if (len == 10) return 1;');
    lines.push("    if (s[10] != 'T' || len < 16) return 0;");
    lines.push('    for (int i = 11; i < 13; i++) if (s[i] < \'0\' || s[i] > \'9\') return 0;');
    lines.push("    if (s[13] != ':') return 0;");
    lines.push('    for (int i = 14; i < 16; i++) if (s[i] < \'0\' || s[i] > \'9\') return 0;');
    lines.push('    size_t pos = 16;');
    lines.push('    if (pos == len) return 1;');
    lines.push("    if (s[pos] == ':') {");
    lines.push('        if (pos + 3 > len) return 0;');
    lines.push('        for (size_t i = pos + 1; i < pos + 3; i++) if (s[i] < \'0\' || s[i] > \'9\') return 0;');
    lines.push('        pos += 3;');
    lines.push('    }');
    lines.push('    if (pos == len) return 1;');
    lines.push("    if (s[pos] == '.') {");
    lines.push('        pos++;');
    lines.push("        if (pos >= len || s[pos] < '0' || s[pos] > '9') return 0;");
    lines.push("        while (pos < len && s[pos] >= '0' && s[pos] <= '9') pos++;");
    lines.push('    }');
    lines.push('    if (pos == len) return 1;');
    lines.push("    if (s[pos] == 'Z') return pos + 1 == len;");
    lines.push("    if (s[pos] == '+' || s[pos] == '-') {");
    lines.push('        if (pos + 6 != len) return 0;');
    lines.push('        for (size_t i = pos + 1; i < pos + 3; i++) if (s[i] < \'0\' || s[i] > \'9\') return 0;');
    lines.push("        if (s[pos + 3] != ':') return 0;");
    lines.push('        for (size_t i = pos + 4; i < pos + 6; i++) if (s[i] < \'0\' || s[i] > \'9\') return 0;');
    lines.push('        return 1;');
    lines.push('    }');
    lines.push('    return 0;');
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

  if (helpers.has('schemata_check_wrapped')) {
    lines.push('static int schemata_check_wrapped(const char *s, const char *prefix, const char *suffix) {');
    lines.push('    if (!s) return 0;');
    lines.push('    size_t slen = strlen(s);');
    lines.push('    size_t plen = strlen(prefix);');
    lines.push('    size_t xlen = strlen(suffix);');
    lines.push('    if (slen < plen + xlen) return 0;');
    lines.push('    if (strncmp(s, prefix, plen) != 0) return 0;');
    lines.push('    if (strcmp(s + slen - xlen, suffix) != 0) return 0;');
    lines.push('    return 1;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_csv_list')) {
    lines.push('static int schemata_check_csv_list(const char *s, const char *charset) {');
    lines.push('    if (!s || !*s) return 0;');
    lines.push('    const char *p = s;');
    lines.push('    while (1) {');
    lines.push('        const char *start = p;');
    lines.push('        while (*p && strchr(charset, *p)) p++;');
    lines.push('        if (p == start) return 0;');
    lines.push('        if (!*p) return 1;');
    lines.push("        if (*p != ',') return 0;");
    lines.push('        p++;');
    lines.push('    }');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_ln_invoice')) {
    lines.push('static int schemata_check_ln_invoice(const char *s, const char *prefix, int min_hrp_len) {');
    lines.push('    if (!s) return 0;');
    lines.push('    size_t slen = strlen(s);');
    lines.push('    size_t plen = strlen(prefix);');
    lines.push('    if (strncmp(s, prefix, plen) != 0) return 0;');
    lines.push("    /* Find last '1' (bech32 separator) */");
    lines.push('    const char *sep = NULL;');
    lines.push('    for (size_t i = slen; i > 0; i--) {');
    lines.push("        if (s[i - 1] == '1') { sep = s + i - 1; break; }");
    lines.push('    }');
    lines.push('    if (!sep) return 0;');
    lines.push('    size_t hrp_len = (size_t)(sep - s);');
    lines.push('    if ((int)hrp_len < min_hrp_len) return 0;');
    lines.push('    /* Verify HRP chars [a-z0-9] */');
    lines.push('    for (size_t i = 0; i < hrp_len; i++) {');
    lines.push('        char c = s[i];');
    lines.push("        if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'))) return 0;");
    lines.push('    }');
    lines.push('    /* Verify data part */');
    lines.push('    const char *data = sep + 1;');
    lines.push('    if (!*data) return 0;');
    lines.push('    for (const char *p = data; *p; p++) {');
    lines.push('        if (!schemata_is_bech32_char(*p)) return 0;');
    lines.push('    }');
    lines.push('    return 1;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_mime_type')) {
    lines.push('static int schemata_check_mime_type(const char *s) {');
    lines.push('    if (!s || !*s) return 0;');
    lines.push('    size_t len = strlen(s);');
    lines.push('    size_t i = 0;');
    lines.push('    /* type: [a-z]+ */');
    lines.push('    size_t start = i;');
    lines.push("    while (i < len && s[i] >= 'a' && s[i] <= 'z') i++;");
    lines.push('    if (i == start) return 0;');
    lines.push("    if (i >= len || s[i] != '/') return 0;");
    lines.push('    i++;');
    lines.push('    /* subtype: [a-z0-9.+-]+ */');
    lines.push('    start = i;');
    lines.push('    while (i < len) {');
    lines.push('        char c = s[i];');
    lines.push("        if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '+' || c == '-') i++;");
    lines.push('        else break;');
    lines.push('    }');
    lines.push('    if (i == start) return 0;');
    lines.push('    return i == len;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_http_origin')) {
    lines.push('static int schemata_check_http_origin(const char *s) {');
    lines.push('    if (!s) return 0;');
    lines.push('    size_t len = strlen(s);');
    lines.push('    size_t i = 0;');
    lines.push('    if (len >= 8 && strncmp(s, "https://", 8) == 0) i = 8;');
    lines.push('    else if (len >= 7 && strncmp(s, "http://", 7) == 0) i = 7;');
    lines.push('    else return 0;');
    lines.push('    /* [^/]+ */');
    lines.push('    size_t start = i;');
    lines.push("    while (i < len && s[i] != '/') i++;");
    lines.push('    if (i == start) return 0;');
    lines.push('    /* optional trailing / */');
    lines.push("    if (i < len && s[i] == '/') i++;");
    lines.push('    return i == len;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_is_ecma_ws')) {
    lines.push('/* ECMAScript \\s semantics: full Unicode whitespace set (UTF-8) */');
    lines.push('static int schemata_is_ecma_ws(const unsigned char *s, size_t len, size_t pos, size_t *advance) {');
    lines.push('    if (pos >= len) return 0;');
    lines.push('    unsigned char c = s[pos];');
    lines.push('    /* ASCII whitespace */');
    lines.push("    if (c == 0x09 || c == 0x0A || c == 0x0B || c == 0x0C || c == 0x0D || c == 0x20) { *advance = 1; return 1; }");
    lines.push('    /* 2-byte UTF-8: U+00A0 (C2 A0) */');
    lines.push('    if (c == 0xC2 && pos + 1 < len && s[pos + 1] == 0xA0) { *advance = 2; return 1; }');
    lines.push('    /* 3-byte UTF-8 */');
    lines.push('    if (c == 0xE1 && pos + 2 < len && s[pos + 1] == 0x9A && s[pos + 2] == 0x80) { *advance = 3; return 1; } /* U+1680 */');
    lines.push('    if (c == 0xE2 && pos + 2 < len) {');
    lines.push('        unsigned char b1 = s[pos + 1], b2 = s[pos + 2];');
    lines.push('        /* U+2000-200A: E2 80 80-8A */');
    lines.push('        if (b1 == 0x80 && b2 >= 0x80 && b2 <= 0x8A) { *advance = 3; return 1; }');
    lines.push('        /* U+2028: E2 80 A8, U+2029: E2 80 A9 */');
    lines.push('        if (b1 == 0x80 && (b2 == 0xA8 || b2 == 0xA9)) { *advance = 3; return 1; }');
    lines.push('        /* U+202F: E2 80 AF */');
    lines.push('        if (b1 == 0x80 && b2 == 0xAF) { *advance = 3; return 1; }');
    lines.push('        /* U+205F: E2 81 9F */');
    lines.push('        if (b1 == 0x81 && b2 == 0x9F) { *advance = 3; return 1; }');
    lines.push('    }');
    lines.push('    if (c == 0xE3 && pos + 2 < len && s[pos + 1] == 0x80 && s[pos + 2] == 0x80) { *advance = 3; return 1; } /* U+3000 */');
    lines.push('    if (c == 0xEF && pos + 2 < len && s[pos + 1] == 0xBB && s[pos + 2] == 0xBF) { *advance = 3; return 1; } /* U+FEFF */');
    lines.push('    return 0;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_email_like')) {
    lines.push('static int schemata_check_email_like(const char *s) {');
    lines.push('    if (!s || !*s) return 0;');
    lines.push('    size_t len = strlen(s);');
    lines.push('    const unsigned char *u = (const unsigned char *)s;');
    lines.push('    size_t i = 0;');
    lines.push('    /* local part: [^\\s@]+ */');
    lines.push('    size_t start = i;');
    lines.push('    size_t adv;');
    lines.push("    while (i < len && !schemata_is_ecma_ws(u, len, i, &adv) && s[i] != '@') i++;");
    lines.push('    if (i == start) return 0;');
    lines.push("    if (i >= len || s[i] != '@') return 0;");
    lines.push('    i++;');
    lines.push('    /* domain: [^\\s@]+ */');
    lines.push('    start = i;');
    lines.push("    while (i < len && !schemata_is_ecma_ws(u, len, i, &adv) && s[i] != '@') i++;");
    lines.push('    if (i == start) return 0;');
    lines.push('    return i == len;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_git_clone_url')) {
    lines.push('static int schemata_check_git_clone_url(const char *s) {');
    lines.push('    if (!s || !*s) return 0;');
    lines.push('    size_t len = strlen(s);');
    lines.push('    const unsigned char *u = (const unsigned char *)s;');
    lines.push('    size_t i = 0;');
    lines.push('    if (len >= 4 && strncmp(s, "git@", 4) == 0) {');
    lines.push('        i = 4;');
    lines.push('    } else {');
    lines.push('        /* scheme: [a-z][a-z0-9+.-]*:// */');
    lines.push("        if (!(s[0] >= 'a' && s[0] <= 'z')) return 0;");
    lines.push('        i = 1;');
    lines.push('        while (i < len) {');
    lines.push('            char c = s[i];');
    lines.push("            if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '+' || c == '.' || c == '-') i++;");
    lines.push('            else break;');
    lines.push('        }');
    lines.push("        if (i + 3 > len || s[i] != ':' || s[i+1] != '/' || s[i+2] != '/') return 0;");
    lines.push('        i += 3;');
    lines.push('    }');
    lines.push('    /* [^\\s]+ (ECMAScript \\s) */');
    lines.push('    if (i >= len) return 0;');
    lines.push('    size_t adv;');
    lines.push('    while (i < len) {');
    lines.push('        if (schemata_is_ecma_ws(u, len, i, &adv)) return 0;');
    lines.push('        i++;');
    lines.push('    }');
    lines.push('    return 1;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_content_type')) {
    lines.push('static int schemata_is_type_char(char c) {');
    lines.push("    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '!' || c == '#' || c == '$' || c == '&' || c == '^' || c == '_' || c == '-';");
    lines.push('}');
    lines.push('');
    lines.push('static int schemata_is_subtype_char(char c) {');
    lines.push("    return schemata_is_type_char(c) || c == '.' || c == '+';");
    lines.push('}');
    lines.push('');
    lines.push('static int schemata_check_content_type(const char *s) {');
    lines.push('    if (!s || !*s) return 0;');
    lines.push('    size_t len = strlen(s);');
    lines.push('    size_t i = 0;');
    lines.push('    /* type: [a-zA-Z][a-zA-Z0-9!#$&^_-]* */');
    lines.push("    if (!((s[i] >= 'a' && s[i] <= 'z') || (s[i] >= 'A' && s[i] <= 'Z'))) return 0;");
    lines.push('    i++;');
    lines.push('    while (i < len && schemata_is_type_char(s[i])) i++;');
    lines.push("    if (i >= len || s[i] != '/') return 0;");
    lines.push('    i++;');
    lines.push('    /* subtype: [a-zA-Z0-9*][a-zA-Z0-9!#$&^_.+-]* */');
    lines.push('    if (i >= len) return 0;');
    lines.push('    char c = s[i];');
    lines.push("    if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '*')) return 0;");
    lines.push('    i++;');
    lines.push('    while (i < len && schemata_is_subtype_char(s[i])) i++;');
    lines.push('    /* params: (\\s*;\\s*token=token)* */');
    lines.push('    while (i < len) {');
    lines.push("        while (i < len && (s[i] == ' ' || s[i] == '\\t')) i++;");
    lines.push('        if (i >= len) return 0;  /* trailing whitespace not allowed */');
    lines.push("        if (s[i] != ';') return 0;");
    lines.push('        i++;');
    lines.push("        while (i < len && (s[i] == ' ' || s[i] == '\\t')) i++;");
    lines.push('        /* param name */');
    lines.push('        size_t start = i;');
    lines.push('        while (i < len && schemata_is_subtype_char(s[i])) i++;');
    lines.push('        if (i == start) return 0;');
    lines.push("        if (i >= len || s[i] != '=') return 0;");
    lines.push('        i++;');
    lines.push('        /* param value */');
    lines.push('        start = i;');
    lines.push('        while (i < len && schemata_is_subtype_char(s[i])) i++;');
    lines.push('        if (i == start) return 0;');
    lines.push('    }');
    lines.push('    return i == len;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_doi')) {
    lines.push('static int schemata_check_doi(const char *s) {');
    lines.push('    if (!s) return 0;');
    lines.push('    size_t len = strlen(s);');
    lines.push('    if (len < 8) return 0;  /* 10.NNNN/x minimum */');
    lines.push("    if (s[0] != '1' || s[1] != '0' || s[2] != '.') return 0;");
    lines.push('    size_t i = 3;');
    lines.push('    size_t start = i;');
    lines.push("    while (i < len && s[i] >= '0' && s[i] <= '9') i++;");
    lines.push('    size_t digit_count = i - start;');
    lines.push('    if (digit_count < 4 || digit_count > 9) return 0;');
    lines.push("    if (i >= len || s[i] != '/') return 0;");
    lines.push('    i++;');
    lines.push('    return schemata_check_dot_tail(s, i, len);');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_annotate_user')) {
    lines.push('static int schemata_check_annotate_user(const char *s) {');
    lines.push('    if (!s) return 0;');
    lines.push('    size_t len = strlen(s);');
    lines.push('    if (len < 82) return 0;  /* "annotate-user " (14) + 64 hex + ":0:0" (4) */');
    lines.push('    if (strncmp(s, "annotate-user ", 14) != 0) return 0;');
    lines.push('    size_t i = 14;');
    lines.push('    /* 64 lowercase hex chars */');
    lines.push('    if (i + 64 > len) return 0;');
    lines.push('    for (size_t j = 0; j < 64; j++) {');
    lines.push('        char c = s[i + j];');
    lines.push("        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return 0;");
    lines.push('    }');
    lines.push('    i += 64;');
    lines.push('    /* :[0-9]+(?:\\.[0-9]+)? twice */');
    lines.push('    for (int round = 0; round < 2; round++) {');
    lines.push("        if (i >= len || s[i] != ':') return 0;");
    lines.push('        i++;');
    lines.push('        size_t start = i;');
    lines.push("        while (i < len && s[i] >= '0' && s[i] <= '9') i++;");
    lines.push('        if (i == start) return 0;');
    lines.push("        if (i < len && s[i] == '.') {");
    lines.push('            i++;');
    lines.push('            start = i;');
    lines.push("            while (i < len && s[i] >= '0' && s[i] <= '9') i++;");
    lines.push('            if (i == start) return 0;');
    lines.push('        }');
    lines.push('    }');
    lines.push('    return i == len;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_no_ws_tail')) {
    lines.push('static int schemata_check_no_ws_tail(const char *s, size_t offset) {');
    lines.push('    if (!s) return 0;');
    lines.push('    size_t len = strlen(s);');
    lines.push('    const unsigned char *u = (const unsigned char *)s;');
    lines.push('    if (offset >= len) return 0;');
    lines.push('    size_t adv;');
    lines.push('    for (size_t i = offset; i < len; ) {');
    lines.push('        if (schemata_is_ecma_ws(u, len, i, &adv)) return 0;');
    lines.push('        i++;');
    lines.push('    }');
    lines.push('    return 1;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_external_identity')) {
    lines.push('static int schemata_check_external_identity(const char *s) {');
    lines.push('    if (!s || !*s) return 0;');
    lines.push('    size_t len = strlen(s);');
    lines.push('    size_t i = 0;');
    lines.push('    /* [a-z0-9._\\-/]+ */');
    lines.push('    while (i < len) {');
    lines.push('        char c = s[i];');
    lines.push("        if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '-' || c == '/') i++;");
    lines.push('        else break;');
    lines.push('    }');
    lines.push('    if (i == 0) return 0;');
    lines.push("    if (i >= len || s[i] != ':') return 0;");
    lines.push('    i++;');
    lines.push('    /* .+ tail: at least one char, no line terminators */');
    lines.push("    if (i >= len) return 0;");
    lines.push("    for (size_t j = i; j < len; j++) {");
    lines.push("        if (s[j] == '\\n') return 0;");
    lines.push("    }");
    lines.push('    return 1;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_package_id')) {
    lines.push('static int schemata_is_pkg_char(char c) {');
    lines.push("    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '+' || c == '-';");
    lines.push('}');
    lines.push('');
    lines.push('static int schemata_check_package_id(const char *s) {');
    lines.push('    if (!s || !*s) return 0;');
    lines.push('    size_t len = strlen(s);');
    lines.push("    if (len == 1 && s[0] == '#') return 1;");
    lines.push('    size_t i = 0;');
    lines.push('    /* first segment: [A-Za-z0-9][A-Za-z0-9._+-]* */');
    lines.push("    if (!((s[i] >= 'a' && s[i] <= 'z') || (s[i] >= 'A' && s[i] <= 'Z') || (s[i] >= '0' && s[i] <= '9'))) return 0;");
    lines.push('    i++;');
    lines.push('    while (i < len && schemata_is_pkg_char(s[i])) i++;');
    lines.push('    /* additional segments: :[A-Za-z0-9][A-Za-z0-9._+-]* */');
    lines.push("    while (i < len && s[i] == ':') {");
    lines.push('        i++;');
    lines.push('        if (i >= len) return 0;');
    lines.push("        if (!((s[i] >= 'a' && s[i] <= 'z') || (s[i] >= 'A' && s[i] <= 'Z') || (s[i] >= '0' && s[i] <= '9'))) return 0;");
    lines.push('        i++;');
    lines.push('        while (i < len && schemata_is_pkg_char(s[i])) i++;');
    lines.push('    }');
    lines.push('    return i == len;');
    lines.push('}');
    lines.push('');
  }

  if (helpers.has('schemata_check_imeta_dim')) {
    lines.push('static int schemata_check_imeta_dim(const char *s) {');
    lines.push('    size_t len = strlen(s);');
    lines.push('    if (len < 7) return 0;');
    lines.push('    if (strncmp(s, "dim ", 4) != 0) return 0;');
    lines.push('    size_t i = 4;');
    lines.push('    int dc = 0;');
    lines.push('    while (i < len && s[i] >= \'0\' && s[i] <= \'9\') { i++; dc++; }');
    lines.push('    if (dc < 1 || dc > 5) return 0;');
    lines.push('    if (i >= len || s[i] != \'x\') return 0;');
    lines.push('    i++; dc = 0;');
    lines.push('    while (i < len && s[i] >= \'0\' && s[i] <= \'9\') { i++; dc++; }');
    lines.push('    if (dc < 1 || dc > 5) return 0;');
    lines.push('    return i == len;');
    lines.push('}');
    lines.push('');
  }

  return lines.join('\n');
}
