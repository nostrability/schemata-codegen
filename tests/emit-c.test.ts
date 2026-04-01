import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { emitCValidators } from '../src/emit-c.js';
import type { KindShape } from '../src/kind-types.js';

const kind9735: KindShape = {
  kindNumber: 9735,
  nip: 'nip-57',
  requiredTags: [
    {
      tagName: 'p',
      positions: [
        { index: 0, required: true, constValue: 'p', type: 'string' },
        { index: 1, required: true, type: 'string', pattern: '^[a-f0-9]{64}$' },
      ],
      minItems: 2,
      additionalItems: false,
    },
    {
      tagName: 'bolt11',
      positions: [
        { index: 0, required: true, constValue: 'bolt11', type: 'string' },
        { index: 1, required: true, type: 'string' },
      ],
      minItems: 2,
      additionalItems: false,
    },
  ],
  perItemConditionals: [],
  arrayLevelConditionals: [],
  anyOfTagGroups: [],
  category: 'multi-contains',
};

const bareKind: KindShape = {
  kindNumber: 1,
  nip: 'nip-01',
  requiredTags: [],
  perItemConditionals: [],
  arrayLevelConditionals: [],
  anyOfTagGroups: [],
  category: 'bare',
};

const conditionalKind: KindShape = {
  kindNumber: 4,
  nip: 'nip-04',
  tagsMinItems: 1,
  requiredTags: [{
    tagName: 'p',
    positions: [
      { index: 0, required: true, constValue: 'p', type: 'string' },
      { index: 1, required: true, type: 'string', pattern: '^[a-f0-9]{64}$' },
    ],
    minItems: 2,
    maxItems: 3,
    additionalItems: false,
  }],
  perItemConditionals: [],
  arrayLevelConditionals: [{
    conditionTagName: 'e',
    requirement: {
      tagName: 'e',
      positions: [
        { index: 0, required: true, constValue: 'e', type: 'string' },
        { index: 1, required: true, type: 'string', pattern: '^[a-f0-9]{64}$' },
      ],
      minItems: 2,
      additionalItems: false,
    },
  }],
  anyOfTagGroups: [],
  category: 'conditional',
};

const kindWithContent: KindShape = {
  kindNumber: 13,
  nip: 'nip-59',
  requiredTags: [],
  perItemConditionals: [],
  arrayLevelConditionals: [],
  anyOfTagGroups: [],
  contentConstraints: { minLength: 1 },
  category: 'bare',
};

describe('emitCValidators (generic, default)', () => {
  it('generates header and source files', () => {
    const { header, source } = emitCValidators([kind9735]);
    assert.ok(header.includes('#ifndef SCHEMATA_VALIDATORS_H'));
    assert.ok(header.includes('#define SCHEMATA_VALIDATORS_H'));
    // Generic mode should NOT include nostrdb.h
    assert.ok(!header.includes('#include "nostrdb.h"'));
    assert.ok(header.includes('struct schemata_error'));
    assert.ok(header.includes('schemata_validate_kind_9735'));
    assert.ok(header.includes('schemata_validate'));

    assert.ok(source.includes('#include "schemata_validators.h"'));
    assert.ok(source.includes('schemata_validate_kind_9735'));
  });

  it('generates generic function signature', () => {
    const { source } = emitCValidators([kind9735]);
    assert.ok(source.includes('const char *const *const *tags'));
    assert.ok(source.includes('const int *tag_lens'));
    assert.ok(source.includes('int num_tags'));
    assert.ok(source.includes('struct schemata_error *errs, int max_errs'));
  });

  it('generates generic for-loop iteration', () => {
    const { source } = emitCValidators([kind9735]);
    assert.ok(source.includes('for (int _i = 0; _i < num_tags; _i++)'));
    assert.ok(source.includes('const char *const *_tag = tags[_i]'));
    assert.ok(source.includes('int _tag_len = tag_lens[_i]'));
  });

  it('generates hex64 check helper', () => {
    const { source } = emitCValidators([kind9735]);
    assert.ok(source.includes('schemata_check_hex64'));
    assert.ok(source.includes("(c >= '0' && c <= '9')"));
    assert.ok(source.includes("(c >= 'a' && c <= 'f')"));
  });

  it('generates error reporting macro', () => {
    const { source } = emitCValidators([kind9735]);
    assert.ok(source.includes('SCHEMATA_EMIT_ERR'));
    assert.ok(source.includes('if ((n) < (max))'));
  });

  it('generates tag search with found flag', () => {
    const { source } = emitCValidators([kind9735]);
    assert.ok(source.includes('int found = 0;'));
    assert.ok(source.includes('found = 1; break;'));
    assert.ok(source.includes('if (!found)'));
  });

  it('generates dispatch switch with kind param', () => {
    const { source } = emitCValidators([kind9735, bareKind]);
    assert.ok(source.includes('switch (kind)'));
    assert.ok(source.includes('case 9735:'));
    // Bare kind should not appear in dispatch
    assert.ok(!source.includes('case 1:'));
  });

  it('skips bare kinds', () => {
    const { source } = emitCValidators([bareKind]);
    assert.ok(!source.includes('schemata_validate_kind_1'));
  });

  it('generates array-level conditional code', () => {
    const { source } = emitCValidators([conditionalKind]);
    assert.ok(source.includes('has_cond'));
  });

  it('generates strcmp for tag name check', () => {
    const { source } = emitCValidators([kind9735]);
    assert.ok(source.includes('strcmp(_tag[0], "p")'));
    assert.ok(source.includes('strcmp(_tag[0], "bolt11")'));
  });
});

describe('emitCValidators (nostrdb)', () => {
  it('uses nostrdb iterator pattern', () => {
    const { source } = emitCValidators([kind9735], 'nostrdb');
    assert.ok(source.includes('ndb_tags_iterate_start'));
    assert.ok(source.includes('ndb_tags_iterate_next'));
    assert.ok(source.includes('ndb_iter_tag_str'));
    assert.ok(source.includes('ndb_tag_count'));
  });

  it('includes nostrdb.h in header', () => {
    const { header } = emitCValidators([kind9735], 'nostrdb');
    assert.ok(header.includes('#include "nostrdb.h"'));
  });

  it('generates nostrdb function signature', () => {
    const { source } = emitCValidators([kind9735], 'nostrdb');
    assert.ok(source.includes('const struct ndb_note *note'));
  });

  it('generates dispatch with ndb_note_kind', () => {
    const { source } = emitCValidators([kind9735, bareKind], 'nostrdb');
    assert.ok(source.includes('switch (ndb_note_kind(note))'));
  });
});

describe('emitCValidators full run', () => {
  it('generates C code for all provided kinds without crashing', () => {
    const kinds: KindShape[] = [kind9735, bareKind, conditionalKind];
    const { header, source } = emitCValidators(kinds);
    assert.ok(header.length > 100);
    assert.ok(source.length > 500);
  });
});

describe('validateEvent (generic)', () => {
  it('generates schemata_validate_event in header', () => {
    const result = emitCValidators([kindWithContent]);
    assert.ok(result.header.includes('schemata_validate_event'));
  });

  it('generates schemata_validate_event in source', () => {
    const result = emitCValidators([kindWithContent]);
    assert.ok(result.source.includes('schemata_validate_event'));
  });

  it('validates hex fields in generic mode', () => {
    const result = emitCValidators([kindWithContent]);
    assert.ok(result.source.includes('schemata_check_hex64'));
    assert.ok(result.source.includes('schemata_check_hex128'));
  });

  it('validates content for constrained kinds', () => {
    const result = emitCValidators([kindWithContent]);
    assert.ok(result.source.includes('schemata_utf8_char_count'));
  });

  it('dispatches to schemata_validate', () => {
    const result = emitCValidators([kindWithContent]);
    assert.ok(result.source.includes('schemata_validate('));
  });
});

describe('validateEvent (nostrdb)', () => {
  it('generates schemata_validate_event in nostrdb mode', () => {
    const result = emitCValidators([kindWithContent], 'nostrdb');
    assert.ok(result.source.includes('schemata_validate_event'));
    assert.ok(result.source.includes('ndb_note_id'));
    assert.ok(result.source.includes('ndb_note_content'));
  });
});
