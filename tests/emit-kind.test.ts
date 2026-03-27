import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { emitKindsFile, kindInterfaceName } from '../src/emit-kind.js';
import type { KindShape } from '../src/kind-types.js';

describe('kindInterfaceName', () => {
  it('generates correct interface names', () => {
    assert.equal(kindInterfaceName(0), 'Kind0Event');
    assert.equal(kindInterfaceName(1), 'Kind1Event');
    assert.equal(kindInterfaceName(10002), 'Kind10002Event');
    assert.equal(kindInterfaceName(30023), 'Kind30023Event');
  });
});

describe('emitKindsFile', () => {
  const bareKind: KindShape = {
    kindNumber: 0,
    nip: 'nip-01',
    title: 'kind0',
    requiredTags: [],
    perItemConditionals: [],
    arrayLevelConditionals: [],
    anyOfTagGroups: [],
    category: 'bare',
  };

  const containsKind: KindShape = {
    kindNumber: 10002,
    nip: 'nip-65',
    title: 'kind10002',
    description: 'Relay List Metadata',
    requiredTags: [{
      tagName: 'r',
      positions: [
        { index: 0, required: true, constValue: 'r', type: 'string' },
        { index: 1, required: true, type: 'string', pattern: '^(ws://|wss://).+$' },
      ],
      minItems: 2,
      maxItems: 3,
      additionalItems: false,
      errorMessage: 'tags must include at least one r tag',
    }],
    perItemConditionals: [],
    arrayLevelConditionals: [],
    anyOfTagGroups: [],
    category: 'simple-contains',
  };

  it('emits interface with kind literal', () => {
    const output = emitKindsFile([bareKind]);
    assert.ok(output.includes('readonly kind: 0;'));
    assert.ok(output.includes('export interface Kind0Event'));
  });

  it('emits standard event fields', () => {
    const output = emitKindsFile([bareKind]);
    assert.ok(output.includes('readonly content: string;'));
    assert.ok(output.includes('readonly created_at: number;'));
    assert.ok(output.includes('readonly id: string;'));
    assert.ok(output.includes('readonly pubkey: string;'));
    assert.ok(output.includes('readonly sig: string;'));
    assert.ok(output.includes('readonly tags: ReadonlyArray<readonly string[]>;'));
  });

  it('emits JSDoc with required tags', () => {
    const output = emitKindsFile([containsKind]);
    assert.ok(output.includes('Required tags:'));
    assert.ok(output.includes('`r`'));
    assert.ok(output.includes('@nip nip-65'));
  });

  it('emits NostrEvent discriminated union', () => {
    const output = emitKindsFile([bareKind, containsKind]);
    assert.ok(output.includes('export type NostrEvent ='));
    assert.ok(output.includes('Kind0Event'));
    assert.ok(output.includes('Kind10002Event'));
  });

  it('emits KNOWN_KINDS mapping', () => {
    const output = emitKindsFile([bareKind, containsKind]);
    assert.ok(output.includes('export declare const KNOWN_KINDS'));
    assert.ok(output.includes('0: "kind0"'));
    assert.ok(output.includes('10002: "kind10002"'));
  });

  it('sorts kinds by number', () => {
    const output = emitKindsFile([containsKind, bareKind]);
    const kind0Pos = output.indexOf('Kind0Event');
    const kind10002Pos = output.indexOf('Kind10002Event');
    assert.ok(kind0Pos < kind10002Pos, 'Kind0 should come before Kind10002');
  });
});
