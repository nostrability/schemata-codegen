import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRegex, isNativeCheck, expandCharset, type PatternCheck } from '../src/classify-pattern.js';

describe('classifyRegex', () => {
  // --- Hex fixed-length ---

  it('classifies ^[a-f0-9]{64}$ as hex64 lower', () => {
    const r = classifyRegex('^[a-f0-9]{64}$');
    assert.deepStrictEqual(r, { op: 'hex', len: 64, case: 'lower' });
    assert.ok(isNativeCheck(r));
  });

  it('classifies ^[a-fA-F0-9]{64}$ as hex64 mixed', () => {
    const r = classifyRegex('^[a-fA-F0-9]{64}$');
    assert.deepStrictEqual(r, { op: 'hex', len: 64, case: 'mixed' });
  });

  it('classifies ^[a-f0-9]{128}$ as hex128 lower', () => {
    const r = classifyRegex('^[a-f0-9]{128}$');
    assert.deepStrictEqual(r, { op: 'hex', len: 128, case: 'lower' });
  });

  it('classifies ^[a-f0-9]{40}$ as hex40 lower', () => {
    const r = classifyRegex('^[a-f0-9]{40}$');
    assert.deepStrictEqual(r, { op: 'hex', len: 40, case: 'lower' });
  });

  it('classifies ^[a-fA-F0-9]{40}$ as hex40 mixed', () => {
    const r = classifyRegex('^[a-fA-F0-9]{40}$');
    assert.deepStrictEqual(r, { op: 'hex', len: 40, case: 'mixed' });
  });

  // --- Hex range ---

  it('classifies ^[a-f0-9]{7,40}$ as hex_range', () => {
    const r = classifyRegex('^[a-f0-9]{7,40}$');
    assert.deepStrictEqual(r, { op: 'hex_range', min: 7, max: 40, case: 'lower' });
    assert.ok(isNativeCheck(r));
  });

  // --- Hex prefixed ---

  it('classifies ^0x[0-9a-f]{4}$ as hex_prefixed', () => {
    const r = classifyRegex('^0x[0-9a-f]{4}$');
    assert.deepStrictEqual(r, { op: 'hex_prefixed', prefix: '0x', hexLen: 4, case: 'lower' });
    assert.ok(isNativeCheck(r));
  });

  // --- All digits ---

  it('classifies ^[0-9]+$ as all_digits', () => {
    const r = classifyRegex('^[0-9]+$');
    assert.deepStrictEqual(r, { op: 'all_digits' });
    assert.ok(isNativeCheck(r));
  });

  it('classifies ^\\d+$ as all_digits', () => {
    const r = classifyRegex('^\\d+$');
    assert.deepStrictEqual(r, { op: 'all_digits' });
  });

  it('classifies ^-?[0-9]+$ as all_digits with allowNeg', () => {
    const r = classifyRegex('^-?[0-9]+$');
    assert.deepStrictEqual(r, { op: 'all_digits', allowNeg: true });
  });

  // --- Starts-with prefixes ---

  it('classifies ^(https?://).+$ as starts_with_any', () => {
    const r = classifyRegex('^(https?://).+$');
    assert.strictEqual(r.op, 'starts_with_any');
    assert.ok(r.op === 'starts_with_any');
    assert.ok(r.prefixes.includes('http://'));
    assert.ok(r.prefixes.includes('https://'));
    assert.ok(isNativeCheck(r));
  });

  it('classifies ^(ws://|wss://).+$ as starts_with_any', () => {
    const r = classifyRegex('^(ws://|wss://).+$');
    assert.strictEqual(r.op, 'starts_with_any');
    assert.ok(r.op === 'starts_with_any');
    assert.ok(r.prefixes.includes('ws://'));
    assert.ok(r.prefixes.includes('wss://'));
  });

  it('classifies ^(https?://|rtmp://|ws://|wss://).+$ as starts_with_any', () => {
    const r = classifyRegex('^(https?://|rtmp://|ws://|wss://).+$');
    assert.strictEqual(r.op, 'starts_with_any');
    assert.ok(r.op === 'starts_with_any');
    assert.strictEqual(r.prefixes.length, 5); // http, https, rtmp, ws, wss
  });

  it('classifies ^wss?:// as starts_with_any', () => {
    const r = classifyRegex('^wss?://');
    assert.strictEqual(r.op, 'starts_with_any');
    assert.ok(r.op === 'starts_with_any');
    assert.ok(r.prefixes.includes('ws://'));
    assert.ok(r.prefixes.includes('wss://'));
  });

  it('classifies ^https?://.+$ as starts_with_any', () => {
    const r = classifyRegex('^https?://.+$');
    assert.strictEqual(r.op, 'starts_with_any');
  });

  it('classifies ^/.+ as starts_with_any(["/"])', () => {
    const r = classifyRegex('^/.+');
    assert.deepStrictEqual(r, { op: 'starts_with_any', prefixes: ['/'] });
  });

  // --- chars_in ---

  it('classifies ^[a-z0-9._-]+$ as chars_in with expanded charset', () => {
    const r = classifyRegex('^[a-z0-9._-]+$');
    assert.strictEqual(r.op, 'chars_in');
    assert.ok(r.op === 'chars_in');
    // Charset is now expanded: 'a-z0-9._-' → all individual chars
    assert.ok(r.charset.includes('a'));
    assert.ok(r.charset.includes('z'));
    assert.ok(r.charset.includes('0'));
    assert.ok(r.charset.includes('9'));
    assert.ok(r.charset.includes('.'));
    assert.ok(r.charset.includes('_'));
    assert.ok(r.charset.includes('-'));
    assert.ok(!r.charset.includes('A')); // lowercase only
    assert.strictEqual(r.min, 1);
    assert.ok(isNativeCheck(r));
  });

  it('classifies ^[A-Za-z]{3,}$ as chars_in with unbounded max', () => {
    const r = classifyRegex('^[A-Za-z]{3,}$');
    assert.strictEqual(r.op, 'chars_in');
    assert.ok(r.op === 'chars_in');
    assert.ok(r.charset.includes('A'));
    assert.ok(r.charset.includes('Z'));
    assert.ok(r.charset.includes('a'));
    assert.ok(r.charset.includes('z'));
    assert.strictEqual(r.min, 3);
    assert.strictEqual(r.max, undefined);
    assert.ok(isNativeCheck(r));
  });

  it('classifies ^[A-Za-z]{3,6}$ as chars_in', () => {
    const r = classifyRegex('^[A-Za-z]{3,6}$');
    assert.strictEqual(r.op, 'chars_in');
    assert.ok(r.op === 'chars_in');
    assert.ok(r.charset.includes('A'));
    assert.ok(r.charset.includes('a'));
    assert.strictEqual(r.min, 3);
    assert.strictEqual(r.max, 6);
  });

  it('classifies ^[A-Za-z]+$ as chars_in', () => {
    const r = classifyRegex('^[A-Za-z]+$');
    assert.strictEqual(r.op, 'chars_in');
    assert.ok(r.op === 'chars_in');
    assert.ok(r.charset.includes('A'));
    assert.ok(r.charset.includes('a'));
    assert.strictEqual(r.min, 1);
  });

  it('classifies ^$ as chars_in empty', () => {
    const r = classifyRegex('^$');
    assert.strictEqual(r.op, 'chars_in');
    assert.ok(r.op === 'chars_in');
    assert.strictEqual(r.min, 0);
    assert.strictEqual(r.max, 0);
  });

  // --- Bech32 ---

  it('classifies ^npub1[02-9ac-hj-np-z]{58}$ as bech32 with fixed length', () => {
    const r = classifyRegex('^npub1[02-9ac-hj-np-z]{58}$');
    assert.deepStrictEqual(r, { op: 'bech32', hrp: 'npub', dataLen: 58 });
    assert.ok(isNativeCheck(r));
  });

  it('classifies ^note1[02-9ac-hj-np-z]{58}$ as bech32 with fixed length', () => {
    const r = classifyRegex('^note1[02-9ac-hj-np-z]{58}$');
    assert.deepStrictEqual(r, { op: 'bech32', hrp: 'note', dataLen: 58 });
    assert.ok(isNativeCheck(r));
  });

  it('classifies ^nprofile1[02-9ac-hj-np-z]+$ as bech32 variable length', () => {
    const r = classifyRegex('^nprofile1[02-9ac-hj-np-z]+$');
    assert.deepStrictEqual(r, { op: 'bech32', hrp: 'nprofile', dataLen: undefined });
    assert.ok(isNativeCheck(r));
  });

  it('classifies ^nevent1[02-9ac-hj-np-z]+$ as bech32 variable length', () => {
    const r = classifyRegex('^nevent1[02-9ac-hj-np-z]+$');
    assert.deepStrictEqual(r, { op: 'bech32', hrp: 'nevent', dataLen: undefined });
  });

  it('classifies ^naddr1[02-9ac-hj-np-z]+$ as bech32 variable length', () => {
    const r = classifyRegex('^naddr1[02-9ac-hj-np-z]+$');
    assert.deepStrictEqual(r, { op: 'bech32', hrp: 'naddr', dataLen: undefined });
  });

  it('classifies ^lnurl1[02-9ac-hj-np-z]+$ as bech32 variable length', () => {
    const r = classifyRegex('^lnurl1[02-9ac-hj-np-z]+$');
    assert.deepStrictEqual(r, { op: 'bech32', hrp: 'lnurl', dataLen: undefined });
  });

  // --- date_iso ---

  it('classifies ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ as date_iso', () => {
    const r = classifyRegex('^[0-9]{4}-[0-9]{2}-[0-9]{2}$');
    assert.deepStrictEqual(r, { op: 'date_iso' });
    assert.ok(isNativeCheck(r));
  });

  // --- decimal ---

  it('classifies ^\\d+(?:\\.\\d+)?$ as decimal', () => {
    const r = classifyRegex('^\\d+(?:\\.\\d+)?$');
    assert.deepStrictEqual(r, { op: 'decimal' });
    assert.ok(isNativeCheck(r));
  });

  // --- Relay URL ---

  it('classifies relay URL pattern as relay_url', () => {
    const r = classifyRegex('^wss?://[a-zA-Z0-9._-]+(?::[0-9]+)?(?:/.*)?$');
    assert.deepStrictEqual(r, { op: 'relay_url' });
    assert.ok(isNativeCheck(r));
  });

  // --- wrapped ---

  it('classifies PGP signature as wrapped', () => {
    const r = classifyRegex('^-----BEGIN PGP SIGNATURE-----[\\s\\S]*-----END PGP SIGNATURE-----$');
    assert.deepStrictEqual(r, {
      op: 'wrapped',
      prefix: '-----BEGIN PGP SIGNATURE-----',
      suffix: '-----END PGP SIGNATURE-----',
    });
    assert.ok(isNativeCheck(r));
  });

  // --- exact_values ---

  it('classifies kind enum as exact_values', () => {
    const r = classifyRegex('^(38172|38173)$');
    assert.deepStrictEqual(r, { op: 'exact_values', values: ['38172', '38173'] });
    assert.ok(isNativeCheck(r));
  });

  it('classifies imeta MIME enum as exact_values', () => {
    const r = classifyRegex('^m (image/(apng|avif|gif|jpeg|png|webp))$');
    assert.strictEqual(r.op, 'exact_values');
    assert.ok(r.op === 'exact_values');
    assert.deepStrictEqual(r.values, [
      'm image/apng', 'm image/avif', 'm image/gif',
      'm image/jpeg', 'm image/png', 'm image/webp',
    ]);
  });

  // --- prefix_nonempty ---

  it('classifies ^alt .+$ as prefix_nonempty', () => {
    const r = classifyRegex('^alt .+$');
    assert.deepStrictEqual(r, { op: 'prefix_nonempty', prefix: 'alt ' });
    assert.ok(isNativeCheck(r));
  });

  it('classifies ^blurhash .+$ as prefix_nonempty', () => {
    const r = classifyRegex('^blurhash .+$');
    assert.deepStrictEqual(r, { op: 'prefix_nonempty', prefix: 'blurhash ' });
  });

  // --- csv_list ---

  it('classifies comma-separated IDs as csv_list with expanded charset', () => {
    const r = classifyRegex('^[A-Za-z0-9_]+(,[A-Za-z0-9_]+)*$');
    assert.strictEqual(r.op, 'csv_list');
    assert.ok(r.op === 'csv_list');
    // Expanded: contains actual chars, not range notation
    assert.ok(r.itemCharset.includes('A'));
    assert.ok(r.itemCharset.includes('Z'));
    assert.ok(r.itemCharset.includes('a'));
    assert.ok(r.itemCharset.includes('z'));
    assert.ok(r.itemCharset.includes('0'));
    assert.ok(r.itemCharset.includes('9'));
    assert.ok(r.itemCharset.includes('_'));
    assert.ok(isNativeCheck(r));
  });

  it('classifies comma-separated ints as csv_list with expanded charset', () => {
    const r = classifyRegex('^[0-9]+(,[0-9]+)*$');
    assert.strictEqual(r.op, 'csv_list');
    assert.ok(r.op === 'csv_list');
    assert.ok(r.itemCharset.includes('0'));
    assert.ok(r.itemCharset.includes('9'));
    assert.strictEqual(r.itemCharset.length, 10);
  });

  // --- prefix_no_whitespace ---

  it('classifies imeta URL as prefix_no_whitespace', () => {
    const r = classifyRegex('^url https?://\\S+$');
    assert.strictEqual(r.op, 'prefix_no_whitespace');
    assert.ok(r.op === 'prefix_no_whitespace');
    assert.deepStrictEqual(r.prefixes, ['url http://', 'url https://']);
    assert.ok(isNativeCheck(r));
  });

  it('classifies imeta fallback URL as prefix_no_whitespace', () => {
    const r = classifyRegex('^fallback https?://\\S+$');
    assert.strictEqual(r.op, 'prefix_no_whitespace');
    assert.ok(r.op === 'prefix_no_whitespace');
    assert.deepStrictEqual(r.prefixes, ['fallback http://', 'fallback https://']);
  });

  it('classifies git HEAD ref as prefix_no_whitespace', () => {
    const r = classifyRegex('^ref: refs/heads/[^\\s]+$');
    assert.deepStrictEqual(r, { op: 'prefix_no_whitespace', prefixes: ['ref: refs/heads/'] });
  });

  // --- hex_prefixed (generalized) ---

  it('classifies ^x [a-f0-9]{64}$ as hex_prefixed', () => {
    const r = classifyRegex('^x [a-f0-9]{64}$');
    assert.deepStrictEqual(r, { op: 'hex_prefixed', prefix: 'x ', hexLen: 64, case: 'lower' });
  });

  // --- http_origin ---

  it('classifies HTTP origin as http_origin', () => {
    const r = classifyRegex('^https?://[^/]+/?$');
    assert.deepStrictEqual(r, { op: 'http_origin' });
    assert.ok(isNativeCheck(r));
  });

  // --- git_clone_url ---

  it('classifies git clone URL as git_clone_url', () => {
    const r = classifyRegex('^(([a-z][a-z0-9+\\\\.-]*://)|git@)[^\\s]+$');
    assert.deepStrictEqual(r, { op: 'git_clone_url' });
    assert.ok(isNativeCheck(r));
  });

  // --- ln_invoice ---

  it('classifies BOLT-11 invoice as ln_invoice', () => {
    const r = classifyRegex('^lnbc[a-z0-9]*1[02-9ac-hj-np-z]+$');
    assert.deepStrictEqual(r, { op: 'ln_invoice', prefix: 'lnbc', minHrpLen: 4 });
    assert.ok(isNativeCheck(r));
  });

  it('classifies generic LN bech32 as ln_invoice', () => {
    const r = classifyRegex('^ln[a-z0-9]+[02-9ac-hj-np-z]*1[02-9ac-hj-np-z]+$');
    assert.deepStrictEqual(r, { op: 'ln_invoice', prefix: 'ln', minHrpLen: 3 });
  });

  // --- mime_type ---

  it('classifies simple MIME as mime_type', () => {
    const r = classifyRegex('^[a-z]+/[a-z0-9.+-]+$');
    assert.deepStrictEqual(r, { op: 'mime_type' });
    assert.ok(isNativeCheck(r));
  });

  // --- content_type ---

  it('classifies Content-Type as content_type', () => {
    const r = classifyRegex('^[a-zA-Z][a-zA-Z0-9!#$&^_-]*/[a-zA-Z0-9*][a-zA-Z0-9!#$&^_.+-]*(\\s*;\\s*[a-zA-Z0-9!#$&^_.+-]+=[a-zA-Z0-9!#$&^_.+-]+)*$');
    assert.deepStrictEqual(r, { op: 'content_type' });
    assert.ok(isNativeCheck(r));
  });

  // --- email_like ---

  it('classifies email-like as email_like', () => {
    const r = classifyRegex('^[^\\s@]+@[^\\s@]+$');
    assert.deepStrictEqual(r, { op: 'email_like' });
    assert.ok(isNativeCheck(r));
  });

  // --- doi ---

  it('classifies DOI as doi', () => {
    const r = classifyRegex('^10\\.\\d{4,9}/.+$');
    assert.deepStrictEqual(r, { op: 'doi' });
    assert.ok(isNativeCheck(r));
  });

  // --- annotate_user ---

  it('classifies annotate-user as annotate_user', () => {
    const r = classifyRegex('^annotate-user [a-f0-9]{64}:[0-9]+(?:\\.[0-9]+)?:[0-9]+(?:\\.[0-9]+)?$');
    assert.deepStrictEqual(r, { op: 'annotate_user' });
    assert.ok(isNativeCheck(r));
  });

  // --- external_identity ---

  it('classifies external identity as external_identity', () => {
    const r = classifyRegex('^[a-z0-9._\\-/]+:.+');
    assert.deepStrictEqual(r, { op: 'external_identity' });
    assert.ok(isNativeCheck(r));
  });

  // --- package_id ---

  it('classifies package ID as package_id', () => {
    const r = classifyRegex('^(#|[A-Za-z0-9][A-Za-z0-9._+-]*(?::[A-Za-z0-9][A-Za-z0-9._+-]*)*)$');
    assert.deepStrictEqual(r, { op: 'package_id' });
    assert.ok(isNativeCheck(r));
  });

  it('classifies ISO 8601 datetime as datetime_iso', () => {
    const r = classifyRegex('^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}(:\\d{2})?(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2})?)?$');
    assert.deepStrictEqual(r, { op: 'datetime_iso' });
    assert.ok(isNativeCheck(r));
  });

  // --- a_tag ---

  it('classifies generic event coordinate as a_tag', () => {
    const r = classifyRegex('^\\d+:[a-f0-9]{64}:.+$');
    assert.deepStrictEqual(r, { op: 'a_tag' });
    assert.ok(isNativeCheck(r));
  });

  it('classifies single-kind coordinate as a_tag with string kinds', () => {
    const r = classifyRegex('^30311:[a-f0-9]{64}:.+$');
    assert.deepStrictEqual(r, { op: 'a_tag', kinds: ['30311'] });
    assert.ok(isNativeCheck(r));
  });

  it('classifies multi-kind coordinate as a_tag with string kinds', () => {
    const r = classifyRegex('^(31922|31923):[a-f0-9]{64}:.+$');
    assert.deepStrictEqual(r, { op: 'a_tag', kinds: ['31922', '31923'] });
    assert.ok(isNativeCheck(r));
  });

  it('isNativeCheck returns true for a_tag', () => {
    assert.ok(isNativeCheck({ op: 'a_tag' }));
    assert.ok(isNativeCheck({ op: 'a_tag', kinds: ['30311'] }));
  });

  it('isNativeCheck returns true for datetime_iso', () => {
    assert.ok(isNativeCheck({ op: 'datetime_iso' }));
  });

  // --- dim ---

  it('classifies ^[0-9]+x[0-9]+$ as dim', () => {
    const r = classifyRegex('^[0-9]+x[0-9]+$');
    assert.deepStrictEqual(r, { op: 'dim' });
    assert.ok(isNativeCheck(r));
  });

  it('classifies ^\\d+x\\d+$ as dim (\\d variant)', () => {
    const r = classifyRegex('^\\d+x\\d+$');
    assert.deepStrictEqual(r, { op: 'dim' });
  });

  // --- no_uppercase ---

  it('classifies ^[^A-Z]+$ as no_uppercase', () => {
    const r = classifyRegex('^[^A-Z]+$');
    assert.deepStrictEqual(r, { op: 'no_uppercase' });
    assert.ok(isNativeCheck(r));
  });

  // --- dotted_digits ---

  it('classifies ^[0-9]+(\\.[0-9]+)*$ as dotted_digits', () => {
    const r = classifyRegex('^[0-9]+(\\.[0-9]+)*$');
    assert.deepStrictEqual(r, { op: 'dotted_digits' });
    assert.ok(isNativeCheck(r));
  });

  // --- slash_segments ---

  it('classifies ^[A-Za-z0-9_\\-+]+(?:/[A-Za-z0-9_\\-+]+)*$ as slash_segments', () => {
    const r = classifyRegex('^[A-Za-z0-9_\\-+]+(?:/[A-Za-z0-9_\\-+]+)*$');
    assert.strictEqual(r.op, 'slash_segments');
    assert.ok(isNativeCheck(r));
  });

  it('classifies slash_segments with escaped slashes', () => {
    const r = classifyRegex('^[A-Za-z0-9_\\-+]+(?:\\/[A-Za-z0-9_\\-+]+)*$');
    assert.strictEqual(r.op, 'slash_segments');
  });

  // --- space_separated_tokens ---

  it('classifies ^\\S+( \\S+)*$ as space_separated_tokens', () => {
    const r = classifyRegex('^\\S+( \\S+)*$');
    assert.deepStrictEqual(r, { op: 'space_separated_tokens' });
    assert.ok(isNativeCheck(r));
  });

  // --- starts_with_charset ---

  it('classifies ^[0-9bcdefghjkmnpqrstuvwxyz]+ as starts_with_charset', () => {
    const r = classifyRegex('^[0-9bcdefghjkmnpqrstuvwxyz]+');
    assert.strictEqual(r.op, 'starts_with_charset');
    assert.ok(isNativeCheck(r));
  });

  // --- base64 ---

  it('classifies base64 pattern as base64', () => {
    const r = classifyRegex('^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$');
    assert.deepStrictEqual(r, { op: 'base64' });
    assert.ok(isNativeCheck(r));
  });

  // --- nostr_uri ---

  it('classifies nostr URI pattern as nostr_uri', () => {
    const r = classifyRegex('^nostr:((npub|note)1[02-9ac-hj-np-z]{58}|(nprofile|nevent|naddr)1[02-9ac-hj-np-z]+)$');
    assert.deepStrictEqual(r, { op: 'nostr_uri' });
    assert.ok(isNativeCheck(r));
  });

  // --- nip04_encrypted ---

  it('classifies NIP-04 encrypted pattern as nip04_encrypted', () => {
    const r = classifyRegex('^[A-Za-z0-9+/]+={0,2}\\?iv=[A-Za-z0-9+/]+={0,2}$');
    assert.deepStrictEqual(r, { op: 'nip04_encrypted' });
    assert.ok(isNativeCheck(r));
  });

  // --- nip05_identifier ---

  it('classifies NIP-05 identifier pattern as nip05_identifier', () => {
    const r = classifyRegex('^(([_A-Za-z0-9.-]+)|_)@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$');
    assert.deepStrictEqual(r, { op: 'nip05_identifier' });
    assert.ok(isNativeCheck(r));
  });

  // --- mime_type_strict ---

  it('classifies strict MIME type pattern as mime_type_strict', () => {
    const r = classifyRegex('^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$');
    assert.deepStrictEqual(r, { op: 'mime_type_strict' });
    assert.ok(isNativeCheck(r));
  });

  // --- prefix_delim_rest ---

  it('classifies ^[0-9]+:.+ as prefix_delim_rest', () => {
    const r = classifyRegex('^[0-9]+:.+');
    assert.strictEqual(r.op, 'prefix_delim_rest');
    assert.ok(isNativeCheck(r));
  });

  it('classifies ^[a-zA-Z0-9_-]+: .+ as prefix_delim_rest', () => {
    const r = classifyRegex('^[a-zA-Z0-9_-]+: .+');
    assert.strictEqual(r.op, 'prefix_delim_rest');
    assert.ok(isNativeCheck(r));
  });

  // --- Compound: compressed pubkey ---

  it('classifies ^(02|03)[a-f0-9]{64}$ as compound', () => {
    const r = classifyRegex('^(02|03)[a-f0-9]{64}$');
    assert.strictEqual(r.op, 'compound');
    assert.ok(isNativeCheck(r));
  });

  // --- Existing ops via classifier improvement ---

  it('classifies ^refs/.* as starts_with_any', () => {
    const r = classifyRegex('^refs/.*');
    assert.deepStrictEqual(r, { op: 'starts_with_any', prefixes: ['refs/'] });
  });

  it('classifies ^refs/(heads|tags)/[^\\s]+$ as prefix_no_whitespace', () => {
    const r = classifyRegex('^refs/(heads|tags)/[^\\s]+$');
    assert.deepStrictEqual(r, { op: 'prefix_no_whitespace', prefixes: ['refs/heads/', 'refs/tags/'] });
  });

  it('classifies ^refs/(heads|tags) with escaped slashes', () => {
    const r = classifyRegex('^refs\\/(heads|tags)\\/[^\\s]+$');
    assert.deepStrictEqual(r, { op: 'prefix_no_whitespace', prefixes: ['refs/heads/', 'refs/tags/'] });
  });

  it('classifies ^https?://\\S+$ as prefix_no_whitespace', () => {
    const r = classifyRegex('^https?://\\S+$');
    assert.deepStrictEqual(r, { op: 'prefix_no_whitespace', prefixes: ['http://', 'https://'] });
  });

  // --- errorMessage filter ---

  it('classifies errorMessage strings as regex (not native)', () => {
    const msgs = [
      'server URL must be http(s) and must not include additional path segments',
      'notification types must be space-separated non-whitespace tokens',
      'content must be valid Base64-encoded OpenTimestamps data',
    ];
    for (const msg of msgs) {
      const r = classifyRegex(msg);
      assert.strictEqual(r.op, 'regex', `Expected regex for: ${msg}`);
    }
  });

  // --- Slash normalization ---

  it('normalizes escaped slashes in patterns', () => {
    const r = classifyRegex('^https?:\\/\\/\\S+$');
    assert.deepStrictEqual(r, { op: 'prefix_no_whitespace', prefixes: ['http://', 'https://'] });
  });

  // --- isNativeCheck ---

  it('isNativeCheck returns false for regex', () => {
    assert.ok(!isNativeCheck({ op: 'regex', pattern: 'foo' }));
  });

  it('isNativeCheck returns true for hex', () => {
    assert.ok(isNativeCheck({ op: 'hex', len: 64, case: 'lower' }));
  });

  it('isNativeCheck returns false for compound with regex', () => {
    assert.ok(!isNativeCheck({
      op: 'compound',
      checks: [
        { op: 'starts_with_any', prefixes: ['http://'] },
        { op: 'regex', pattern: 'foo' },
      ],
    }));
  });

  it('isNativeCheck returns true for compound with all native', () => {
    assert.ok(isNativeCheck({
      op: 'compound',
      checks: [
        { op: 'starts_with_any', prefixes: ['http://'] },
        { op: 'all_digits' },
      ],
    }));
  });
});

describe('classifyRegex coverage of schemata patterns', () => {
  // Test all patterns from schemata dist/ to ensure no crashes
  const patterns = [
    '^[a-f0-9]{64}$',
    '^[a-fA-F0-9]{64}$',
    '^[a-f0-9]{128}$',
    '^[a-f0-9]{40}$',
    '^[a-fA-F0-9]{40}$',
    '^[a-f0-9]{7,40}$',
    '^0x[0-9a-f]{4}$',
    '^[0-9]+$',
    '^\\d+$',
    '^-?[0-9]+$',
    '^(https?://).+$',
    '^(ws://|wss://).+$',
    '^wss?://',
    '^https?://',
    '^https?://.+',
    '^https?://.+$',
    '^https?://\\S+$',
    '^/.+',
    '^[a-z0-9._-]+$',
    '^[A-Za-z0-9]+$',
    '^[A-Za-z]+$',
    '^[A-Z]+$',
    '^[A-Za-z]{3,6}$',
    '^$',
    '^\\d+(?:\\.\\d+)?$',
    '^[0-9]{4}-[0-9]{2}-[0-9]{2}$',
    '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$',
    '^-----BEGIN PGP SIGNATURE-----[\\s\\S]*-----END PGP SIGNATURE-----$',
    '^[a-zA-Z][a-zA-Z0-9!#$&^_-]*/[a-zA-Z0-9*][a-zA-Z0-9!#$&^_.+-]*(\\s*;\\s*[a-zA-Z0-9!#$&^_.+-]+=[a-zA-Z0-9!#$&^_.+-]+)*$',
    '^\\d+:[a-f0-9]{64}:.+$',
    '^30311:[a-f0-9]{64}:.+$',
    '^30312:[a-f0-9]{64}:.+$',
    '^(31922|31923):[a-f0-9]{64}:.+$',
    '^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}(:\\d{2})?(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2})?)?$',
    '^[A-Za-z]{3,}$',
    '^npub1[02-9ac-hj-np-z]{58}$',
    '^note1[02-9ac-hj-np-z]{58}$',
    '^nprofile1[02-9ac-hj-np-z]+$',
    '^nevent1[02-9ac-hj-np-z]+$',
    '^naddr1[02-9ac-hj-np-z]+$',
    '^lnurl1[02-9ac-hj-np-z]+$',
    '^wss?://[a-zA-Z0-9._-]+(?::[0-9]+)?(?:/.*)?$',
    // New patterns (PR #25)
    '^alt .+$',
    '^blurhash .+$',
    '^x [a-f0-9]{64}$',
    '^url https?://\\S+$',
    '^fallback https?://\\S+$',
    '^m (image/(apng|avif|gif|jpeg|png|webp))$',
    '^annotate-user [a-f0-9]{64}:[0-9]+(?:\\.[0-9]+)?:[0-9]+(?:\\.[0-9]+)?$',
    '^(([a-z][a-z0-9+\\\\.-]*://)|git@)[^\\s]+$',
    '^lnbc[a-z0-9]*1[02-9ac-hj-np-z]+$',
    '^https?://[^/]+/?$',
    '^ln[a-z0-9]+[02-9ac-hj-np-z]*1[02-9ac-hj-np-z]+$',
    '^[a-z]+/[a-z0-9.+-]+$',
    '^[A-Za-z0-9_]+(,[A-Za-z0-9_]+)*$',
    '^[0-9]+(,[0-9]+)*$',
    '^(38172|38173)$',
    '^(#|[A-Za-z0-9][A-Za-z0-9._+-]*(?::[A-Za-z0-9][A-Za-z0-9._+-]*)*)$',
    '^[^\\s@]+@[^\\s@]+$',
    '^10\\.\\d{4,9}/.+$',
    '^[a-z0-9._\\-/]+:.+',
    '^ref: refs/heads/[^\\s]+$',
    // New patterns (PR #30: eliminate all regex fallbacks)
    '^[0-9]+x[0-9]+$',
    '^\\d+x\\d+$',
    '^[^A-Z]+$',
    '^[0-9]+(\\.[0-9]+)*$',
    '^[A-Za-z0-9_\\-+]+(?:/[A-Za-z0-9_\\-+]+)*$',
    '^\\S+( \\S+)*$',
    '^[0-9bcdefghjkmnpqrstuvwxyz]+',
    '^nostr:((npub|note)1[02-9ac-hj-np-z]{58}|(nprofile|nevent|naddr)1[02-9ac-hj-np-z]+)$',
    '^[A-Za-z0-9+/]+={0,2}\\?iv=[A-Za-z0-9+/]+={0,2}$',
    '^(([_A-Za-z0-9.-]+)|_)@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$',
    '^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$',
    '^[0-9]+:.+',
    '^[a-zA-Z0-9_-]+: .+',
    '^(02|03)[a-f0-9]{64}$',
    '^refs/.*',
    '^refs/(heads|tags)/[^\\s]+$',
    '^https?://\\S+$',
    '^dim [0-9]{1,5}x[0-9]{1,5}$',
  ];

  it('processes all schemata patterns without throwing', () => {
    for (const p of patterns) {
      const result = classifyRegex(p);
      assert.ok(result, `classifyRegex should return for: ${p}`);
      assert.ok(result.op, `result should have op for: ${p}`);
    }
  });

  it('classifies ALL patterns as native (100%)', () => {
    let nativeCount = 0;
    const regexPatterns: string[] = [];
    for (const p of patterns) {
      const r = classifyRegex(p);
      if (isNativeCheck(r)) {
        nativeCount++;
      } else {
        regexPatterns.push(p);
      }
    }
    assert.strictEqual(nativeCount, patterns.length,
      `Expected 100% native, got ${nativeCount}/${patterns.length}. Regex: ${regexPatterns.join(', ')}`);
  });
});

describe('check_decimal behavioral correctness', () => {
  // Reference implementation matching the emitted code logic across all 12 languages.
  // This mirrors the fixed check_decimal: requires at least one leading digit
  // before the optional dot branch.
  function checkDecimal(s: string): boolean {
    if (s.length === 0) return false;
    let i = 0;
    while (i < s.length && s[i] >= '0' && s[i] <= '9') i++;
    if (i === 0) return false; // must have leading digits
    if (i < s.length && s[i] === '.') {
      i++;
      if (i >= s.length || s[i] < '0' || s[i] > '9') return false;
      while (i < s.length && s[i] >= '0' && s[i] <= '9') i++;
    }
    return i === s.length;
  }

  it('accepts integer', () => assert.ok(checkDecimal('1')));
  it('accepts multi-digit integer', () => assert.ok(checkDecimal('123')));
  it('accepts decimal', () => assert.ok(checkDecimal('1.5')));
  it('accepts long decimal', () => assert.ok(checkDecimal('123.456')));
  it('rejects leading dot', () => assert.ok(!checkDecimal('.5')));
  it('rejects empty', () => assert.ok(!checkDecimal('')));
  it('rejects alpha', () => assert.ok(!checkDecimal('a')));
  it('rejects trailing dot', () => assert.ok(!checkDecimal('1.')));
  it('rejects multiple dots', () => assert.ok(!checkDecimal('1.2.3')));
});

describe('check_relay_url behavioral correctness', () => {
  // Reference implementation using JS semantics (. excludes \n AND \r).
  // NOTE: \r handling is language-specific — see AGENTS.md. JS/Java/Kotlin/Swift/Dart/C++
  // exclude \r from `.`; Python/Ruby/C/C#/Go/Rust/PHP do not. Each emitter matches its
  // target language's regex engine. This reference impl + equivalence test verify JS only.
  // Algorithm:
  //   1. Check starts with "wss://" (pos=6) or "ws://" (pos=5), else fail
  //   2. Hostname: consume [a-zA-Z0-9._-]+, must have >=1 char
  //   3. Optional port: if ':', consume [0-9]+, must have >=1 digit
  //   4. Optional path: if '/', scan remainder rejecting \n and \r (JS regex . semantics)
  //   5. Must be at end of string
  function checkRelayUrl(s: string): boolean {
    let i = 0;
    if (s.startsWith('wss://')) {
      i = 6;
    } else if (s.startsWith('ws://')) {
      i = 5;
    } else {
      return false;
    }
    // Hostname: [a-zA-Z0-9._-]+
    const hostStart = i;
    while (i < s.length) {
      const c = s[i];
      if (
        (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
        (c >= '0' && c <= '9') || c === '.' || c === '_' || c === '-'
      ) {
        i++;
      } else {
        break;
      }
    }
    if (i === hostStart) return false; // must have >=1 hostname char
    // Optional port
    if (i < s.length && s[i] === ':') {
      i++;
      const portStart = i;
      while (i < s.length && s[i] >= '0' && s[i] <= '9') i++;
      if (i === portStart) return false; // colon but no digits
    }
    // Optional path: '/' followed by chars matching JS regex `.` (excludes JS LineTerminators)
    if (i < s.length && s[i] === '/') {
      for (let j = i + 1; j < s.length; j++) {
        const c = s[j];
        if (c === '\n' || c === '\r' || c === '\u2028' || c === '\u2029') return false;
      }
      return true;
    }
    return i === s.length;
  }

  // --- Valid URLs ---
  it('accepts wss://relay.example.com', () => assert.ok(checkRelayUrl('wss://relay.example.com')));
  it('accepts ws://relay.example.com', () => assert.ok(checkRelayUrl('ws://relay.example.com')));
  it('accepts wss://localhost', () => assert.ok(checkRelayUrl('wss://localhost')));
  it('accepts wss://relay.example.com:8080', () => assert.ok(checkRelayUrl('wss://relay.example.com:8080')));
  it('accepts wss://relay.example.com/', () => assert.ok(checkRelayUrl('wss://relay.example.com/')));
  it('accepts wss://relay.example.com/path', () => assert.ok(checkRelayUrl('wss://relay.example.com/path')));
  it('accepts wss://relay.example.com:443/path/to', () => assert.ok(checkRelayUrl('wss://relay.example.com:443/path/to')));
  it('accepts wss://a', () => assert.ok(checkRelayUrl('wss://a'))); // minimal hostname
  it('accepts ws://192.168.1.1', () => assert.ok(checkRelayUrl('ws://192.168.1.1')));
  it('accepts wss://relay-test_01.nostr.com', () => assert.ok(checkRelayUrl('wss://relay-test_01.nostr.com')));
  it('accepts wss://relay.example.com:8080/', () => assert.ok(checkRelayUrl('wss://relay.example.com:8080/')));
  it('accepts wss://relay.example.com/path with spaces after slash', () => assert.ok(checkRelayUrl('wss://relay.example.com/path with stuff')));

  // --- Invalid URLs ---
  it('rejects empty string', () => assert.ok(!checkRelayUrl('')));
  it('rejects http://relay.example.com', () => assert.ok(!checkRelayUrl('http://relay.example.com')));
  it('rejects https://relay.example.com', () => assert.ok(!checkRelayUrl('https://relay.example.com')));
  it('rejects wss:// (empty hostname)', () => assert.ok(!checkRelayUrl('wss://')));
  it('rejects ws:// (empty hostname)', () => assert.ok(!checkRelayUrl('ws://')));
  it('rejects wss://relay.example.com: (colon no port)', () => assert.ok(!checkRelayUrl('wss://relay.example.com:')));
  it('rejects wss://relay.example.com:abc (non-digit port)', () => assert.ok(!checkRelayUrl('wss://relay.example.com:abc')));
  it('rejects plain text', () => assert.ok(!checkRelayUrl('not a url')));
  it('rejects wss (no colon-slash-slash)', () => assert.ok(!checkRelayUrl('wss')));
  it('rejects wss://relay.example.com/\\npath (newline in path)', () => assert.ok(!checkRelayUrl('wss://relay.example.com/\npath')));
  // \r rejection is JS-specific; Python/Ruby/C/C#/Go/Rust/PHP accept \r (their . matches it)
  it('rejects wss://relay.example.com/path\\r\\n (CRLF in path, JS semantics)', () => assert.ok(!checkRelayUrl('wss://relay.example.com/path\r\n')));
  it('rejects wss://relay.example.com/\\u2028path (LS in path)', () => assert.ok(!checkRelayUrl('wss://relay.example.com/\u2028path')));
  it('rejects wss://relay.example.com/\\u2029path (PS in path)', () => assert.ok(!checkRelayUrl('wss://relay.example.com/\u2029path')));
  // \u0085 is NOT a JS LineTerminator — JS . matches it (but Java/Kotlin/Swift reject it)
  it('accepts wss://relay.example.com/\\u0085path (NEL, valid in JS)', () => assert.ok(checkRelayUrl('wss://relay.example.com/\u0085path')));

  // --- Regex-vs-native equivalence ---
  it('reference implementation matches regex on all test inputs', () => {
    const regex = new RegExp('^wss?://[a-zA-Z0-9._-]+(?::[0-9]+)?(?:/.*)?$');
    const inputs = [
      // Valid
      'wss://relay.example.com',
      'ws://relay.example.com',
      'wss://localhost',
      'wss://relay.example.com:8080',
      'wss://relay.example.com/',
      'wss://relay.example.com/path',
      'wss://relay.example.com:443/path/to',
      'wss://a',
      'ws://192.168.1.1',
      'wss://relay-test_01.nostr.com',
      'wss://relay.example.com:8080/',
      'wss://relay.example.com/path with stuff',
      // Invalid
      '',
      'http://relay.example.com',
      'https://relay.example.com',
      'wss://',
      'ws://',
      'wss://relay.example.com:',
      'wss://relay.example.com:abc',
      'not a url',
      'wss',
      'wss://relay.example.com:8080?query',
      'wss:///path',
      'WSS://RELAY.EXAMPLE.COM',
      'wss://relay.example.com/\npath',
      'wss://relay.example.com/path\r\n',
      'wss://relay.example.com/\rpath',
      'wss://relay.example.com/\u2028path',
      'wss://relay.example.com/\u2029path',
      'wss://relay.example.com/\u0085path',  // NEL: JS . matches, Java/Swift . does not
    ];
    for (const input of inputs) {
      const regexResult = regex.test(input);
      const nativeResult = checkRelayUrl(input);
      assert.strictEqual(nativeResult, regexResult,
        `Mismatch for "${input}": native=${nativeResult}, regex=${regexResult}`);
    }
  });
});

describe('check_a_tag behavioral correctness', () => {
  // Reference implementation matching JS regex semantics.
  // Pattern: ^\d+:[a-f0-9]{64}:.+$
  // JS . excludes \n, \r, \u2028, \u2029 but NOT \u0085 (NEL)
  function checkATag(s: string, kinds?: number[]): boolean {
    if (s.length < 68) return false;
    let pos = 0;
    if (s[pos] < '0' || s[pos] > '9') return false;
    let kind = 0;
    while (pos < s.length && s[pos] >= '0' && s[pos] <= '9') {
      kind = kind * 10 + (s.charCodeAt(pos) - 0x30);
      pos++;
    }
    if (pos >= s.length || s[pos] !== ':') return false;
    if (kinds && kinds.length > 0 && !kinds.includes(kind)) return false;
    pos++;
    if (pos + 64 >= s.length) return false;
    for (let i = 0; i < 64; i++) {
      const c = s[pos + i];
      if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
    }
    pos += 64;
    if (pos >= s.length || s[pos] !== ':') return false;
    pos++;
    // .+ means >=1 char, no JS line terminators
    if (pos >= s.length) return false;
    for (let j = pos; j < s.length; j++) {
      const c = s[j];
      if (c === '\n' || c === '\r' || c === '\u2028' || c === '\u2029') return false;
    }
    return true;
  }

  const hex64 = 'a'.repeat(64);

  // --- Valid ---
  it('accepts generic coordinate', () => assert.ok(checkATag(`1:${hex64}:d-id`)));
  it('accepts kind 30023', () => assert.ok(checkATag(`30023:${hex64}:slug`)));
  it('accepts single char d-id', () => assert.ok(checkATag(`0:${hex64}:x`)));
  it('accepts d-id with spaces', () => assert.ok(checkATag(`1:${hex64}:hello world`)));
  it('accepts d-id with special chars', () => assert.ok(checkATag(`1:${hex64}:a/b?c=1&d=2`)));
  it('accepts d-id with NEL (valid in JS)', () => assert.ok(checkATag(`1:${hex64}:\u0085id`)));
  it('accepts with kinds filter matching', () => assert.ok(checkATag(`30311:${hex64}:test`, [30311])));
  it('accepts with multi-kinds filter', () => assert.ok(checkATag(`31922:${hex64}:test`, [31922, 31923])));

  // --- Invalid ---
  it('rejects empty string', () => assert.ok(!checkATag('')));
  it('rejects too short', () => assert.ok(!checkATag('1:abc:d')));
  it('rejects missing kind digits', () => assert.ok(!checkATag(`:${hex64}:d-id`)));
  it('rejects non-digit kind', () => assert.ok(!checkATag(`abc:${hex64}:d-id`)));
  it('rejects missing first colon', () => assert.ok(!checkATag(`1${hex64}:d-id`)));
  it('rejects short hex', () => assert.ok(!checkATag(`1:${'a'.repeat(63)}:d-id`)));
  it('rejects uppercase hex', () => assert.ok(!checkATag(`1:${'A'.repeat(64)}:d-id`)));
  it('rejects missing second colon', () => assert.ok(!checkATag(`1:${hex64}d-id`)));
  it('rejects empty d-id', () => assert.ok(!checkATag(`1:${hex64}:`)));
  it('rejects newline in d-id', () => assert.ok(!checkATag(`1:${hex64}:d\nid`)));
  it('rejects \\r in d-id', () => assert.ok(!checkATag(`1:${hex64}:d\rid`)));
  it('rejects wrong kind with filter', () => assert.ok(!checkATag(`30312:${hex64}:test`, [30311])));
  it('rejects wrong kind with multi-filter', () => assert.ok(!checkATag(`30000:${hex64}:test`, [31922, 31923])));

  // --- Regex equivalence ---
  it('reference matches regex for generic pattern', () => {
    const regex = new RegExp('^\\d+:[a-f0-9]{64}:.+$');
    const inputs = [
      `1:${hex64}:d-id`,
      `30023:${hex64}:slug`,
      `0:${hex64}:x`,
      `030311:${hex64}:slug`,
      `00042:${hex64}:test`,
      `1:${hex64}:hello world`,
      '',
      'short',
      `:${hex64}:d-id`,
      `abc:${hex64}:d-id`,
      `1:${hex64}:`,
      `1:${hex64}:d\nid`,
      `1:${hex64}:d\rid`,
      `1:${hex64}:\u0085id`,
      `1:${'A'.repeat(64)}:d-id`,
      `1:${'a'.repeat(63)}:d-id`,
    ];
    for (const input of inputs) {
      const regexResult = regex.test(input);
      const nativeResult = checkATag(input);
      assert.strictEqual(nativeResult, regexResult,
        `Mismatch for ${JSON.stringify(input)}: native=${nativeResult}, regex=${regexResult}`);
    }
  });
});

describe('check_datetime_iso behavioral correctness', () => {
  // Reference implementation matching the regex:
  // ^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$
  function checkDatetimeIso(s: string): boolean {
    if (s.length < 10) return false;
    for (let i = 0; i < 4; i++) if (s[i] < '0' || s[i] > '9') return false;
    if (s[4] !== '-') return false;
    for (let i = 5; i < 7; i++) if (s[i] < '0' || s[i] > '9') return false;
    if (s[7] !== '-') return false;
    for (let i = 8; i < 10; i++) if (s[i] < '0' || s[i] > '9') return false;
    if (s.length === 10) return true;
    if (s[10] !== 'T' || s.length < 16) return false;
    for (let i = 11; i < 13; i++) if (s[i] < '0' || s[i] > '9') return false;
    if (s[13] !== ':') return false;
    for (let i = 14; i < 16; i++) if (s[i] < '0' || s[i] > '9') return false;
    let pos = 16;
    if (pos === s.length) return true;
    if (s[pos] === ':') {
      if (pos + 3 > s.length) return false;
      if (s[pos + 1] < '0' || s[pos + 1] > '9' || s[pos + 2] < '0' || s[pos + 2] > '9') return false;
      pos += 3;
    }
    if (pos === s.length) return true;
    if (s[pos] === '.') {
      pos++;
      if (pos >= s.length || s[pos] < '0' || s[pos] > '9') return false;
      while (pos < s.length && s[pos] >= '0' && s[pos] <= '9') pos++;
    }
    if (pos === s.length) return true;
    if (s[pos] === 'Z') return pos + 1 === s.length;
    if (s[pos] === '+' || s[pos] === '-') {
      if (pos + 6 !== s.length) return false;
      if (s[pos + 1] < '0' || s[pos + 1] > '9' || s[pos + 2] < '0' || s[pos + 2] > '9') return false;
      if (s[pos + 3] !== ':') return false;
      return s[pos + 4] >= '0' && s[pos + 4] <= '9' && s[pos + 5] >= '0' && s[pos + 5] <= '9';
    }
    return false;
  }

  // --- Valid ---
  it('accepts date only', () => assert.ok(checkDatetimeIso('2024-01-15')));
  it('accepts date + time', () => assert.ok(checkDatetimeIso('2024-01-15T10:30')));
  it('accepts date + time + seconds', () => assert.ok(checkDatetimeIso('2024-01-15T10:30:45')));
  it('accepts date + time + fractional', () => assert.ok(checkDatetimeIso('2024-01-15T10:30:45.123')));
  it('accepts date + time + Z', () => assert.ok(checkDatetimeIso('2024-01-15T10:30Z')));
  it('accepts date + time + seconds + Z', () => assert.ok(checkDatetimeIso('2024-01-15T10:30:45Z')));
  it('accepts date + time + fractional + Z', () => assert.ok(checkDatetimeIso('2024-01-15T10:30:45.123Z')));
  it('accepts positive offset', () => assert.ok(checkDatetimeIso('2024-01-15T10:30+05:30')));
  it('accepts negative offset', () => assert.ok(checkDatetimeIso('2024-01-15T10:30:45-08:00')));
  it('accepts fractional + offset', () => assert.ok(checkDatetimeIso('2024-01-15T10:30:45.9+00:00')));
  it('accepts long fractional', () => assert.ok(checkDatetimeIso('2024-01-15T10:30:45.123456789Z')));

  // --- Invalid ---
  it('rejects empty', () => assert.ok(!checkDatetimeIso('')));
  it('rejects too short', () => assert.ok(!checkDatetimeIso('2024-01-1')));
  it('rejects alpha in year', () => assert.ok(!checkDatetimeIso('20X4-01-15')));
  it('rejects wrong separator', () => assert.ok(!checkDatetimeIso('2024/01/15')));
  it('rejects T without time', () => assert.ok(!checkDatetimeIso('2024-01-15T')));
  it('rejects T with incomplete time', () => assert.ok(!checkDatetimeIso('2024-01-15T10')));
  it('rejects T with partial time', () => assert.ok(!checkDatetimeIso('2024-01-15T10:3')));
  it('rejects trailing garbage', () => assert.ok(!checkDatetimeIso('2024-01-15X')));
  it('rejects incomplete seconds', () => assert.ok(!checkDatetimeIso('2024-01-15T10:30:4')));
  it('rejects dot without digits', () => assert.ok(!checkDatetimeIso('2024-01-15T10:30:45.')));
  it('rejects incomplete offset', () => assert.ok(!checkDatetimeIso('2024-01-15T10:30+05')));
  it('rejects offset wrong format', () => assert.ok(!checkDatetimeIso('2024-01-15T10:30+0530')));
  it('rejects Z with trailing', () => assert.ok(!checkDatetimeIso('2024-01-15T10:30Zx')));

  // --- Regex equivalence ---
  it('reference matches regex on all test inputs', () => {
    const regex = new RegExp('^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}(:\\d{2})?(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2})?)?$');
    const inputs = [
      '2024-01-15',
      '2024-01-15T10:30',
      '2024-01-15T10:30:45',
      '2024-01-15T10:30:45.123',
      '2024-01-15T10:30Z',
      '2024-01-15T10:30:45Z',
      '2024-01-15T10:30:45.123Z',
      '2024-01-15T10:30+05:30',
      '2024-01-15T10:30:45-08:00',
      '2024-01-15T10:30:45.9+00:00',
      '2024-01-15T10:30:45.123456789Z',
      '',
      '2024-01-1',
      '20X4-01-15',
      '2024/01/15',
      '2024-01-15T',
      '2024-01-15T10',
      '2024-01-15T10:3',
      '2024-01-15X',
      '2024-01-15T10:30:4',
      '2024-01-15T10:30:45.',
      '2024-01-15T10:30+05',
      '2024-01-15T10:30+0530',
      '2024-01-15T10:30Zx',
      '2024-01-15T10:30:45.Z',
      '2024-01-15T10:30:45+25:00',
    ];
    for (const input of inputs) {
      const regexResult = regex.test(input);
      const nativeResult = checkDatetimeIso(input);
      assert.strictEqual(nativeResult, regexResult,
        `Mismatch for "${input}": native=${nativeResult}, regex=${regexResult}`);
    }
  });
});

// --- Behavioral correctness tests for new ops ---

describe('check_csv_list behavioral correctness', () => {
  function checkCsvList(s: string, charset: string): boolean {
    if (s.length === 0) return false;
    let i = 0;
    while (true) {
      const start = i;
      while (i < s.length && charset.includes(s[i])) i++;
      if (i === start) return false;
      if (i === s.length) return true;
      if (s[i] !== ',') return false;
      i++;
    }
  }
  // Expand charset ranges for matching
  function expandCharset(cs: string): string {
    let result = '';
    let i = 0;
    while (i < cs.length) {
      if (i + 2 < cs.length && cs[i + 1] === '-') {
        const from = cs.charCodeAt(i);
        const to = cs.charCodeAt(i + 2);
        for (let c = from; c <= to; c++) result += String.fromCharCode(c);
        i += 3;
      } else {
        result += cs[i];
        i++;
      }
    }
    return result;
  }

  const idChars = expandCharset('A-Za-z0-9_');
  const digitChars = expandCharset('0-9');

  it('accepts single item', () => assert.ok(checkCsvList('abc', idChars)));
  it('accepts multiple items', () => assert.ok(checkCsvList('a,b,c', idChars)));
  it('accepts digits', () => assert.ok(checkCsvList('1,2,3', digitChars)));
  it('accepts single digit', () => assert.ok(checkCsvList('42', digitChars)));
  it('rejects empty string', () => assert.ok(!checkCsvList('', idChars)));
  it('rejects trailing comma', () => assert.ok(!checkCsvList('a,', idChars)));
  it('rejects leading comma', () => assert.ok(!checkCsvList(',a', idChars)));
  it('rejects double comma', () => assert.ok(!checkCsvList('a,,b', idChars)));
  it('rejects invalid chars', () => assert.ok(!checkCsvList('a b', idChars)));
  it('rejects space in digit list', () => assert.ok(!checkCsvList('1, 2', digitChars)));

  it('matches regex for ID pattern', () => {
    const regex = /^[A-Za-z0-9_]+(,[A-Za-z0-9_]+)*$/;
    const inputs = ['a', 'a,b', 'abc_123,DEF', '', ',', 'a,', ',a', 'a,,b', 'a b', 'a, b'];
    for (const input of inputs) {
      assert.strictEqual(checkCsvList(input, idChars), regex.test(input),
        `Mismatch for "${input}"`);
    }
  });
});

describe('check_mime_type behavioral correctness', () => {
  function checkMimeType(s: string): boolean {
    let i = 0;
    while (i < s.length && s[i] >= 'a' && s[i] <= 'z') i++;
    if (i === 0 || i >= s.length || s[i] !== '/') return false;
    i++;
    const start = i;
    while (i < s.length) {
      const c = s[i];
      if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '.' || c === '+' || c === '-') i++;
      else break;
    }
    return i > start && i === s.length;
  }

  it('accepts image/png', () => assert.ok(checkMimeType('image/png')));
  it('accepts application/json', () => assert.ok(checkMimeType('application/json')));
  it('accepts text/vnd.abc+xml', () => assert.ok(checkMimeType('text/vnd.abc+xml')));
  it('accepts audio/ogg', () => assert.ok(checkMimeType('audio/ogg')));
  it('rejects empty', () => assert.ok(!checkMimeType('')));
  it('rejects no slash', () => assert.ok(!checkMimeType('image')));
  it('rejects uppercase', () => assert.ok(!checkMimeType('Image/png')));
  it('rejects trailing slash', () => assert.ok(!checkMimeType('image/')));
  it('rejects leading slash', () => assert.ok(!checkMimeType('/png')));

  it('matches regex', () => {
    const regex = /^[a-z]+\/[a-z0-9.+-]+$/;
    const inputs = ['image/png', 'text/html', 'application/octet-stream', '', 'image', 'Image/png', 'image/', '/png', 'a/1'];
    for (const input of inputs) {
      assert.strictEqual(checkMimeType(input), regex.test(input), `Mismatch for "${input}"`);
    }
  });
});

describe('check_http_origin behavioral correctness', () => {
  function checkHttpOrigin(s: string): boolean {
    let i = 0;
    if (s.startsWith('https://')) i = 8;
    else if (s.startsWith('http://')) i = 7;
    else return false;
    const start = i;
    while (i < s.length && s[i] !== '/') i++;
    if (i === start) return false;
    if (i < s.length && s[i] === '/') i++;
    return i === s.length;
  }

  it('accepts http://example.com', () => assert.ok(checkHttpOrigin('http://example.com')));
  it('accepts https://example.com', () => assert.ok(checkHttpOrigin('https://example.com')));
  it('accepts https://example.com/', () => assert.ok(checkHttpOrigin('https://example.com/')));
  it('accepts https://localhost:8080', () => assert.ok(checkHttpOrigin('https://localhost:8080')));
  it('accepts https://localhost:8080/', () => assert.ok(checkHttpOrigin('https://localhost:8080/')));
  it('rejects empty', () => assert.ok(!checkHttpOrigin('')));
  it('rejects path', () => assert.ok(!checkHttpOrigin('https://example.com/path')));
  it('rejects ws://', () => assert.ok(!checkHttpOrigin('ws://example.com')));
  it('rejects empty host', () => assert.ok(!checkHttpOrigin('https://')));
  it('rejects double slash path', () => assert.ok(!checkHttpOrigin('https://example.com//')));

  it('matches regex', () => {
    const regex = /^https?:\/\/[^/]+\/?$/;
    const inputs = [
      'http://example.com', 'https://example.com', 'https://example.com/',
      'https://localhost:8080', '', 'https://example.com/path',
      'ws://example.com', 'https://', 'https://a',
    ];
    for (const input of inputs) {
      assert.strictEqual(checkHttpOrigin(input), regex.test(input), `Mismatch for "${input}"`);
    }
  });
});

describe('check_email_like behavioral correctness', () => {
  function isAsciiWs(c: string): boolean {
    return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\x0B' || c === '\x0C';
  }
  function checkEmailLike(s: string): boolean {
    let i = 0;
    const start = i;
    while (i < s.length && !isAsciiWs(s[i]) && s[i] !== '@') i++;
    if (i === start || i >= s.length || s[i] !== '@') return false;
    i++;
    const dstart = i;
    while (i < s.length && !isAsciiWs(s[i]) && s[i] !== '@') i++;
    return i > dstart && i === s.length;
  }

  it('accepts user@domain', () => assert.ok(checkEmailLike('user@domain')));
  it('accepts a@b', () => assert.ok(checkEmailLike('a@b')));
  it('accepts user+tag@example.com', () => assert.ok(checkEmailLike('user+tag@example.com')));
  it('rejects empty', () => assert.ok(!checkEmailLike('')));
  it('rejects no @', () => assert.ok(!checkEmailLike('user')));
  it('rejects empty local', () => assert.ok(!checkEmailLike('@domain')));
  it('rejects empty domain', () => assert.ok(!checkEmailLike('user@')));
  it('rejects space in local', () => assert.ok(!checkEmailLike('us er@domain')));
  it('rejects double @', () => assert.ok(!checkEmailLike('user@@domain')));

  it('matches regex (JS \\s)', () => {
    // Note: JS \s is broader than ASCII ws, but for typical inputs they agree
    const regex = /^[^\s@]+@[^\s@]+$/;
    const inputs = ['user@domain', 'a@b', 'user+tag@example.com', '', 'user', '@domain', 'user@', 'us er@domain', 'user@@domain'];
    for (const input of inputs) {
      assert.strictEqual(checkEmailLike(input), regex.test(input), `Mismatch for "${input}"`);
    }
  });

  it('diverges from regex on Unicode whitespace (known limitation)', () => {
    // isAsciiWs only checks ASCII whitespace; JS \s includes NBSP, BOM, LS, PS
    const regex = /^[^\s@]+@[^\s@]+$/;
    const unicodeWsInputs = [
      'user\u00A0@domain',   // NBSP in local part
      'user\uFEFF@domain',   // BOM/ZWNBSP in local part
      'user\u2028@domain',   // Line Separator in local part
      'user\u2029@domain',   // Paragraph Separator in local part
    ];
    for (const input of unicodeWsInputs) {
      // Native checker accepts (doesn't know about Unicode ws), regex rejects
      assert.strictEqual(checkEmailLike(input), true, `native should accept "${input}"`);
      assert.strictEqual(regex.test(input), false, `regex should reject "${input}"`);
    }
  });
});

describe('check_doi behavioral correctness', () => {
  function checkDoi(s: string): boolean {
    if (!s.startsWith('10.')) return false;
    let i = 3;
    const start = i;
    while (i < s.length && s[i] >= '0' && s[i] <= '9') i++;
    const digitCount = i - start;
    if (digitCount < 4 || digitCount > 9) return false;
    if (i >= s.length || s[i] !== '/') return false;
    i++;
    if (i >= s.length) return false;
    // .+ tail — JS semantics: reject line terminators
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (c === '\n' || c === '\r' || c === '\u2028' || c === '\u2029') return false;
    }
    return true;
  }

  it('accepts 10.1000/test', () => assert.ok(checkDoi('10.1000/test')));
  it('accepts 10.12345/abc.def', () => assert.ok(checkDoi('10.12345/abc.def')));
  it('accepts 10.123456789/x', () => assert.ok(checkDoi('10.123456789/x')));
  it('rejects empty', () => assert.ok(!checkDoi('')));
  it('rejects wrong prefix', () => assert.ok(!checkDoi('11.1000/test')));
  it('rejects too few digits', () => assert.ok(!checkDoi('10.123/test')));
  it('rejects too many digits', () => assert.ok(!checkDoi('10.1234567890/test')));
  it('rejects no slash', () => assert.ok(!checkDoi('10.1234')));
  it('rejects empty suffix', () => assert.ok(!checkDoi('10.1234/')));

  it('matches regex', () => {
    const regex = /^10\.\d{4,9}\/.+$/;
    const inputs = ['10.1000/test', '10.12345/abc.def', '10.123456789/x', '', '11.1000/test', '10.123/test', '10.1234567890/test', '10.1234', '10.1234/'];
    for (const input of inputs) {
      assert.strictEqual(checkDoi(input), regex.test(input), `Mismatch for "${input}"`);
    }
  });
});

describe('check_external_identity behavioral correctness', () => {
  function checkExternalIdentity(s: string): boolean {
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '.' || c === '_' || c === '-' || c === '/') i++;
      else break;
    }
    if (i === 0 || i >= s.length || s[i] !== ':') return false;
    return i + 1 < s.length; // at least 1 char after ':'
  }

  it('accepts github:user', () => assert.ok(checkExternalIdentity('github:user')));
  it('accepts twitter:handle', () => assert.ok(checkExternalIdentity('twitter:handle')));
  it('accepts dns/example.com:proof', () => assert.ok(checkExternalIdentity('dns/example.com:proof')));
  it('rejects empty', () => assert.ok(!checkExternalIdentity('')));
  it('rejects no colon', () => assert.ok(!checkExternalIdentity('github')));
  it('rejects empty value', () => assert.ok(!checkExternalIdentity('github:')));
  it('rejects uppercase', () => assert.ok(!checkExternalIdentity('GitHub:user')));
  it('rejects space in prefix', () => assert.ok(!checkExternalIdentity('git hub:user')));
});

describe('check_package_id behavioral correctness', () => {
  function isPkgChar(c: string): boolean {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '.' || c === '_' || c === '+' || c === '-';
  }
  function checkPackageId(s: string): boolean {
    if (s === '#') return true;
    if (s.length === 0) return false;
    let i = 0;
    if (!((s[i] >= 'a' && s[i] <= 'z') || (s[i] >= 'A' && s[i] <= 'Z') || (s[i] >= '0' && s[i] <= '9'))) return false;
    i++;
    while (i < s.length && isPkgChar(s[i])) i++;
    while (i < s.length && s[i] === ':') {
      i++;
      if (i >= s.length) return false;
      if (!((s[i] >= 'a' && s[i] <= 'z') || (s[i] >= 'A' && s[i] <= 'Z') || (s[i] >= '0' && s[i] <= '9'))) return false;
      i++;
      while (i < s.length && isPkgChar(s[i])) i++;
    }
    return i === s.length;
  }

  it('accepts #', () => assert.ok(checkPackageId('#')));
  it('accepts simple id', () => assert.ok(checkPackageId('mypackage')));
  it('accepts dotted id', () => assert.ok(checkPackageId('com.example.pkg')));
  it('accepts colon-separated', () => assert.ok(checkPackageId('group:artifact')));
  it('accepts multi-colon', () => assert.ok(checkPackageId('a:b:c')));
  it('accepts with special chars', () => assert.ok(checkPackageId('pkg-1.0+beta_2')));
  it('rejects empty', () => assert.ok(!checkPackageId('')));
  it('rejects trailing colon', () => assert.ok(!checkPackageId('a:')));
  it('rejects double colon', () => assert.ok(!checkPackageId('a::b')));
  it('rejects leading dot', () => assert.ok(!checkPackageId('.pkg')));
  it('rejects space', () => assert.ok(!checkPackageId('a b')));

  it('matches regex', () => {
    const regex = /^(#|[A-Za-z0-9][A-Za-z0-9._+-]*(?::[A-Za-z0-9][A-Za-z0-9._+-]*)*)$/;
    const inputs = ['#', 'mypackage', 'com.example.pkg', 'group:artifact', 'a:b:c', '', 'a:', 'a::b', '.pkg', 'a b'];
    for (const input of inputs) {
      assert.strictEqual(checkPackageId(input), regex.test(input), `Mismatch for "${input}"`);
    }
  });
});

describe('check_annotate_user behavioral correctness', () => {
  function checkAnnotateUser(s: string): boolean {
    if (s.length < 82) return false; // "annotate-user " (14) + 64 hex + ":" + "0" + ":" + "0"
    if (!s.startsWith('annotate-user ')) return false;
    let i = 14; // "annotate-user " is 14 chars
    if (i + 64 > s.length) return false;
    for (let j = 0; j < 64; j++) {
      const c = s[i + j];
      if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
    }
    i += 64;
    for (let round = 0; round < 2; round++) {
      if (i >= s.length || s[i] !== ':') return false;
      i++;
      const start = i;
      while (i < s.length && s[i] >= '0' && s[i] <= '9') i++;
      if (i === start) return false;
      if (i < s.length && s[i] === '.') {
        i++;
        const ds = i;
        while (i < s.length && s[i] >= '0' && s[i] <= '9') i++;
        if (i === ds) return false;
      }
    }
    return i === s.length;
  }

  const hex64 = 'a'.repeat(64);

  it('accepts valid annotation', () => assert.ok(checkAnnotateUser(`annotate-user ${hex64}:10:20`)));
  it('accepts with decimals', () => assert.ok(checkAnnotateUser(`annotate-user ${hex64}:10.5:20.3`)));
  it('accepts minimal', () => assert.ok(checkAnnotateUser(`annotate-user ${hex64}:0:0`)));
  it('rejects empty', () => assert.ok(!checkAnnotateUser('')));
  it('rejects wrong prefix', () => assert.ok(!checkAnnotateUser(`annotate_user ${hex64}:0:0`)));
  it('rejects short hex', () => assert.ok(!checkAnnotateUser(`annotate-user ${'a'.repeat(63)}:0:0`)));
  it('rejects uppercase hex', () => assert.ok(!checkAnnotateUser(`annotate-user ${'A'.repeat(64)}:0:0`)));
  it('rejects missing coord', () => assert.ok(!checkAnnotateUser(`annotate-user ${hex64}:0`)));
  it('rejects trailing dot', () => assert.ok(!checkAnnotateUser(`annotate-user ${hex64}:0.:0`)));

  it('matches regex', () => {
    const regex = /^annotate-user [a-f0-9]{64}:[0-9]+(?:\.[0-9]+)?:[0-9]+(?:\.[0-9]+)?$/;
    const inputs = [
      `annotate-user ${hex64}:10:20`,
      `annotate-user ${hex64}:10.5:20.3`,
      `annotate-user ${hex64}:0:0`,
      '',
      `annotate-user ${'a'.repeat(63)}:0:0`,
      `annotate-user ${hex64}:0`,
      `annotate-user ${hex64}:0.:0`,
    ];
    for (const input of inputs) {
      assert.strictEqual(checkAnnotateUser(input), regex.test(input), `Mismatch for "${input}"`);
    }
  });
});

describe('check_ln_invoice behavioral correctness', () => {
  function isBech32Data(c: string): boolean {
    return (c >= '0' && c <= '9' && c !== '1') || (c >= 'a' && c <= 'z' && c !== 'b' && c !== 'i' && c !== 'o');
  }
  function checkLnInvoice(s: string, prefix: string, minHrpLen: number): boolean {
    if (!s.startsWith(prefix)) return false;
    const sep = s.lastIndexOf('1');
    if (sep < 0) return false;
    const hrp = s.slice(0, sep);
    if (hrp.length < minHrpLen) return false;
    for (const c of hrp) {
      if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'))) return false;
    }
    const data = s.slice(sep + 1);
    if (data.length === 0) return false;
    for (const c of data) {
      if (!isBech32Data(c)) return false;
    }
    return true;
  }

  it('accepts lnbc1...', () => assert.ok(checkLnInvoice('lnbc1qqqq', 'lnbc', 4)));
  it('accepts lnbc500n1...', () => assert.ok(checkLnInvoice('lnbc500n1qqqqq', 'lnbc', 4)));
  it('accepts lntb1...', () => assert.ok(checkLnInvoice('lntb1qqqqq', 'ln', 3)));
  it('rejects empty', () => assert.ok(!checkLnInvoice('', 'lnbc', 4)));
  it('rejects wrong prefix', () => assert.ok(!checkLnInvoice('btc1qqqq', 'lnbc', 4)));
  it('rejects no separator', () => assert.ok(!checkLnInvoice('lnbcqqqq', 'lnbc', 4)));
  it('rejects empty data', () => assert.ok(!checkLnInvoice('lnbc1', 'lnbc', 4)));
  it('rejects invalid data char b', () => assert.ok(!checkLnInvoice('lnbc1b', 'lnbc', 4)));
  it('rejects invalid data char i', () => assert.ok(!checkLnInvoice('lnbc1i', 'lnbc', 4)));
  it('rejects invalid data char o', () => assert.ok(!checkLnInvoice('lnbc1o', 'lnbc', 4)));
  it('rejects data char 1', () => assert.ok(!checkLnInvoice('lnbc11', 'lnbc', 4)));
});

describe('isNativeCheck for new ops', () => {
  it('returns true for exact_values', () => assert.ok(isNativeCheck({ op: 'exact_values', values: ['a'] })));
  it('returns true for prefix_nonempty', () => assert.ok(isNativeCheck({ op: 'prefix_nonempty', prefix: 'x' })));
  it('returns true for wrapped', () => assert.ok(isNativeCheck({ op: 'wrapped', prefix: 'a', suffix: 'b' })));
  it('returns true for csv_list', () => assert.ok(isNativeCheck({ op: 'csv_list', itemCharset: '0-9' })));
  it('returns true for ln_invoice', () => assert.ok(isNativeCheck({ op: 'ln_invoice', prefix: 'lnbc', minHrpLen: 4 })));
  it('returns true for mime_type', () => assert.ok(isNativeCheck({ op: 'mime_type' })));
  it('returns true for http_origin', () => assert.ok(isNativeCheck({ op: 'http_origin' })));
  it('returns true for email_like', () => assert.ok(isNativeCheck({ op: 'email_like' })));
  it('returns true for git_clone_url', () => assert.ok(isNativeCheck({ op: 'git_clone_url' })));
  it('returns true for content_type', () => assert.ok(isNativeCheck({ op: 'content_type' })));
  it('returns true for doi', () => assert.ok(isNativeCheck({ op: 'doi' })));
  it('returns true for annotate_user', () => assert.ok(isNativeCheck({ op: 'annotate_user' })));
  it('returns true for prefix_no_whitespace', () => assert.ok(isNativeCheck({ op: 'prefix_no_whitespace', prefixes: ['x'] })));
  it('returns true for external_identity', () => assert.ok(isNativeCheck({ op: 'external_identity' })));
  it('returns true for package_id', () => assert.ok(isNativeCheck({ op: 'package_id' })));
  it('returns true for dim', () => assert.ok(isNativeCheck({ op: 'dim' })));
  it('returns true for no_uppercase', () => assert.ok(isNativeCheck({ op: 'no_uppercase' })));
  it('returns true for dotted_digits', () => assert.ok(isNativeCheck({ op: 'dotted_digits' })));
  it('returns true for slash_segments', () => assert.ok(isNativeCheck({ op: 'slash_segments', charset: 'abc' })));
  it('returns true for space_separated_tokens', () => assert.ok(isNativeCheck({ op: 'space_separated_tokens' })));
  it('returns true for starts_with_charset', () => assert.ok(isNativeCheck({ op: 'starts_with_charset', charset: '0-9' })));
  it('returns true for base64', () => assert.ok(isNativeCheck({ op: 'base64' })));
  it('returns true for nostr_uri', () => assert.ok(isNativeCheck({ op: 'nostr_uri' })));
  it('returns true for nip04_encrypted', () => assert.ok(isNativeCheck({ op: 'nip04_encrypted' })));
  it('returns true for nip05_identifier', () => assert.ok(isNativeCheck({ op: 'nip05_identifier' })));
  it('returns true for mime_type_strict', () => assert.ok(isNativeCheck({ op: 'mime_type_strict' })));
  it('returns true for prefix_delim_rest', () => assert.ok(isNativeCheck({ op: 'prefix_delim_rest', charset: '0-9', delimiter: ':' })));
});

// --- B11: Missing equivalence tests for new ops ---

describe('expandCharset', () => {
  it('expands A-Z', () => {
    const r = expandCharset('A-Z');
    assert.strictEqual(r.length, 26);
    assert.ok(r.startsWith('A'));
    assert.ok(r.endsWith('Z'));
    assert.ok(r.includes('M'));
  });

  it('expands 0-9', () => {
    const r = expandCharset('0-9');
    assert.strictEqual(r, '0123456789');
  });

  it('expands mixed ranges and literals', () => {
    const r = expandCharset('A-Za-z0-9_');
    assert.strictEqual(r.length, 63); // 26 + 26 + 10 + 1
    assert.ok(r.includes('A'));
    assert.ok(r.includes('z'));
    assert.ok(r.includes('0'));
    assert.ok(r.includes('_'));
  });

  it('passes through non-range chars', () => {
    const r = expandCharset('._-');
    assert.strictEqual(r, '._-');
  });
});

describe('check_prefix_nonempty behavioral correctness (B4)', () => {
  // Reference: ^<prefix>.+$ — prefix + >=1 char matching JS `.` (no line terminators)
  function checkPrefixNonempty(s: string, prefix: string): boolean {
    if (!s.startsWith(prefix)) return false;
    if (s.length <= prefix.length) return false;
    // .+ means >=1 char, no JS line terminators in tail
    for (let i = prefix.length; i < s.length; i++) {
      const c = s[i];
      if (c === '\n' || c === '\r' || c === '\u2028' || c === '\u2029') return false;
    }
    return true;
  }

  it('accepts prefix + content', () => assert.ok(checkPrefixNonempty('alt hello', 'alt ')));
  it('accepts prefix + single char', () => assert.ok(checkPrefixNonempty('alt x', 'alt ')));
  it('accepts prefix + special chars', () => assert.ok(checkPrefixNonempty('alt !@#$%', 'alt ')));
  it('accepts prefix + NEL (valid in JS)', () => assert.ok(checkPrefixNonempty('alt \u0085x', 'alt ')));
  it('rejects prefix only', () => assert.ok(!checkPrefixNonempty('alt ', 'alt ')));
  it('rejects wrong prefix', () => assert.ok(!checkPrefixNonempty('foo bar', 'alt ')));
  it('rejects empty', () => assert.ok(!checkPrefixNonempty('', 'alt ')));
  it('rejects newline in tail', () => assert.ok(!checkPrefixNonempty('alt hel\nlo', 'alt ')));
  it('rejects \\r in tail', () => assert.ok(!checkPrefixNonempty('alt hel\rlo', 'alt ')));
  it('rejects LS in tail', () => assert.ok(!checkPrefixNonempty('alt hel\u2028lo', 'alt ')));
  it('rejects PS in tail', () => assert.ok(!checkPrefixNonempty('alt hel\u2029lo', 'alt ')));

  it('matches regex for ^alt .+$', () => {
    const regex = new RegExp('^alt .+$');
    const inputs = [
      'alt hello', 'alt x', 'alt !@#$%', 'alt ', '', 'foo bar',
      'alt hel\nlo', 'alt hel\rlo', 'alt \u0085x',
      'alt hel\u2028lo', 'alt hel\u2029lo',
    ];
    for (const input of inputs) {
      assert.strictEqual(checkPrefixNonempty(input, 'alt '), regex.test(input),
        `Mismatch for ${JSON.stringify(input)}`);
    }
  });
});

describe('check_wrapped behavioral correctness', () => {
  function checkWrapped(s: string, prefix: string, suffix: string): boolean {
    return s.length >= prefix.length + suffix.length && s.startsWith(prefix) && s.endsWith(suffix);
  }

  const pfx = '-----BEGIN PGP SIGNATURE-----';
  const sfx = '-----END PGP SIGNATURE-----';

  it('accepts prefix+suffix only', () => assert.ok(checkWrapped(pfx + sfx, pfx, sfx)));
  it('accepts with content between', () => assert.ok(checkWrapped(pfx + '\ndata\n' + sfx, pfx, sfx)));
  it('rejects empty', () => assert.ok(!checkWrapped('', pfx, sfx)));
  it('rejects prefix only', () => assert.ok(!checkWrapped(pfx, pfx, sfx)));
  it('rejects suffix only', () => assert.ok(!checkWrapped(sfx, pfx, sfx)));
  it('rejects wrong prefix', () => assert.ok(!checkWrapped('XXX' + sfx, pfx, sfx)));

  it('matches regex', () => {
    const regex = /^-----BEGIN PGP SIGNATURE-----[\s\S]*-----END PGP SIGNATURE-----$/;
    const inputs = [pfx + sfx, pfx + '\ndata\n' + sfx, '', pfx, sfx, 'XXX' + sfx];
    for (const input of inputs) {
      assert.strictEqual(checkWrapped(input, pfx, sfx), regex.test(input),
        `Mismatch for ${JSON.stringify(input.slice(0, 40))}...`);
    }
  });
});

describe('check_content_type behavioral correctness (B6)', () => {
  // Reference: ^[a-zA-Z][a-zA-Z0-9!#$&^_-]*/[a-zA-Z0-9*][a-zA-Z0-9!#$&^_.+-]*(\s*;\s*[a-zA-Z0-9!#$&^_.+-]+=[a-zA-Z0-9!#$&^_.+-]+)*$
  // \s* around semicolons uses full ECMAScript whitespace set
  function isTypeChar(c: string): boolean {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
           '!#$&^_-'.includes(c);
  }
  function isSubtypeChar(c: string): boolean {
    return isTypeChar(c) || c === '.' || c === '+';
  }
  function isEcmaWsCt(c: string): boolean {
    return /\s/.test(c);
  }
  function checkContentType(s: string): boolean {
    if (s.length === 0) return false;
    let i = 0;
    if (!((s[i] >= 'a' && s[i] <= 'z') || (s[i] >= 'A' && s[i] <= 'Z'))) return false;
    i++;
    while (i < s.length && isTypeChar(s[i])) i++;
    if (i >= s.length || s[i] !== '/') return false;
    i++;
    if (i >= s.length) return false;
    if (!((s[i] >= 'a' && s[i] <= 'z') || (s[i] >= 'A' && s[i] <= 'Z') || (s[i] >= '0' && s[i] <= '9') || s[i] === '*')) return false;
    i++;
    while (i < s.length && isSubtypeChar(s[i])) i++;
    // params: (\s*;\s*token=token)*
    while (i < s.length) {
      while (i < s.length && isEcmaWsCt(s[i])) i++;
      if (i >= s.length) return false; // B6: trailing OWS must fail (not break)
      if (s[i] !== ';') return false;
      i++;
      while (i < s.length && isEcmaWsCt(s[i])) i++;
      const start = i;
      while (i < s.length && isSubtypeChar(s[i])) i++;
      if (i === start) return false;
      if (i >= s.length || s[i] !== '=') return false;
      i++;
      const vstart = i;
      while (i < s.length && isSubtypeChar(s[i])) i++;
      if (i === vstart) return false;
    }
    return i === s.length;
  }

  it('accepts text/plain', () => assert.ok(checkContentType('text/plain')));
  it('accepts text/html', () => assert.ok(checkContentType('text/html')));
  it('accepts application/json', () => assert.ok(checkContentType('application/json')));
  it('accepts text/plain;charset=utf-8', () => assert.ok(checkContentType('text/plain;charset=utf-8')));
  it('accepts text/plain ; charset=utf-8', () => assert.ok(checkContentType('text/plain ; charset=utf-8')));
  it('accepts with multiple params', () => assert.ok(checkContentType('text/plain;charset=utf-8;boundary=something')));
  it('accepts with * subtype', () => assert.ok(checkContentType('text/*')));
  it('accepts NBSP around semicolon', () => assert.ok(checkContentType('text/plain\u00A0;\u00A0charset=utf-8')));
  it('accepts newline before semicolon', () => assert.ok(checkContentType('text/plain\n;charset=utf-8')));
  it('rejects empty', () => assert.ok(!checkContentType('')));
  it('rejects no subtype', () => assert.ok(!checkContentType('text/')));
  it('rejects no slash', () => assert.ok(!checkContentType('textplain')));
  it('B6: rejects trailing space', () => assert.ok(!checkContentType('text/plain ')));
  it('B6: rejects trailing tab', () => assert.ok(!checkContentType('text/plain\t')));
  it('B6: rejects trailing NBSP', () => assert.ok(!checkContentType('text/plain\u00A0')));
  it('B6: rejects trailing OWS after param', () => assert.ok(!checkContentType('text/plain;charset=utf-8 ')));

  it('matches regex', () => {
    const regex = new RegExp('^[a-zA-Z][a-zA-Z0-9!#$&^_-]*/[a-zA-Z0-9*][a-zA-Z0-9!#$&^_.+-]*(\\s*;\\s*[a-zA-Z0-9!#$&^_.+-]+=[a-zA-Z0-9!#$&^_.+-]+)*$');
    const inputs = [
      'text/plain', 'text/html', 'application/json',
      'text/plain;charset=utf-8', 'text/plain ; charset=utf-8',
      'text/plain;charset=utf-8;boundary=something',
      'text/*', '', 'text/', 'textplain',
      'text/plain ', 'text/plain\t', 'text/plain;charset=utf-8 ',
      'text/plain\u00A0;\u00A0charset=utf-8',
      'text/plain\n;charset=utf-8',
      'text/plain\u00A0',
    ];
    for (const input of inputs) {
      assert.strictEqual(checkContentType(input), regex.test(input),
        `Mismatch for ${JSON.stringify(input)}`);
    }
  });
});

describe('check_prefix_no_whitespace behavioral correctness (B9)', () => {
  // Reference: ^<prefix>\S+$ where \S is ECMAScript non-whitespace
  // \s in JS matches: \t \n \v \f \r space \u00A0 \u1680 \u2000-\u200A \u2028 \u2029 \u202F \u205F \u3000 \uFEFF
  function isEcmaWs(c: string): boolean {
    const cp = c.codePointAt(0)!;
    return cp === 0x09 || cp === 0x0A || cp === 0x0B || cp === 0x0C || cp === 0x0D || cp === 0x20 ||
           cp === 0xA0 || cp === 0x1680 ||
           (cp >= 0x2000 && cp <= 0x200A) ||
           cp === 0x2028 || cp === 0x2029 || cp === 0x202F || cp === 0x205F ||
           cp === 0x3000 || cp === 0xFEFF;
  }
  function checkPrefixNoWhitespace(s: string, prefixes: string[]): boolean {
    for (const p of prefixes) {
      if (s.startsWith(p)) {
        if (p.length >= s.length) return false;
        for (let i = p.length; i < s.length; i++) {
          if (isEcmaWs(s[i])) return false;
        }
        return true;
      }
    }
    return false;
  }

  it('accepts url http://example.com', () => assert.ok(checkPrefixNoWhitespace('url http://example.com', ['url http://', 'url https://'])));
  it('accepts url https://example.com', () => assert.ok(checkPrefixNoWhitespace('url https://example.com', ['url http://', 'url https://'])));
  it('rejects prefix only', () => assert.ok(!checkPrefixNoWhitespace('url http://', ['url http://', 'url https://'])));
  it('rejects with space in tail', () => assert.ok(!checkPrefixNoWhitespace('url http://example .com', ['url http://', 'url https://'])));
  it('rejects with tab in tail', () => assert.ok(!checkPrefixNoWhitespace('url http://\texample', ['url http://', 'url https://'])));
  it('B9: rejects with NBSP in tail', () => assert.ok(!checkPrefixNoWhitespace('url http://\u00A0example', ['url http://', 'url https://'])));
  it('B9: rejects with FEFF in tail', () => assert.ok(!checkPrefixNoWhitespace('url http://\uFEFFexample', ['url http://', 'url https://'])));

  it('matches regex for ^url https?://\\S+$', () => {
    const regex = new RegExp('^url https?://\\S+$');
    const inputs = [
      'url http://example.com', 'url https://example.com',
      'url http://', 'url https://',
      'url http://example .com', 'url http://\texample',
      'url http://\u00A0example', 'url http://\uFEFFexample',
      '', 'url ftp://example.com',
    ];
    for (const input of inputs) {
      assert.strictEqual(checkPrefixNoWhitespace(input, ['url http://', 'url https://']), regex.test(input),
        `Mismatch for ${JSON.stringify(input)}`);
    }
  });
});

describe('check_git_clone_url behavioral correctness (B9)', () => {
  function isEcmaWs(c: string): boolean {
    const cp = c.codePointAt(0)!;
    return cp === 0x09 || cp === 0x0A || cp === 0x0B || cp === 0x0C || cp === 0x0D || cp === 0x20 ||
           cp === 0xA0 || cp === 0x1680 ||
           (cp >= 0x2000 && cp <= 0x200A) ||
           cp === 0x2028 || cp === 0x2029 || cp === 0x202F || cp === 0x205F ||
           cp === 0x3000 || cp === 0xFEFF;
  }
  function checkGitCloneUrl(s: string): boolean {
    if (s.length === 0) return false;
    let i: number;
    if (s.startsWith('git@')) {
      i = 4;
    } else {
      if (!(s[0] >= 'a' && s[0] <= 'z')) return false;
      i = 1;
      while (i < s.length && ((s[i] >= 'a' && s[i] <= 'z') || (s[i] >= '0' && s[i] <= '9') || s[i] === '+' || s[i] === '.' || s[i] === '-')) i++;
      if (i + 3 > s.length || s[i] !== ':' || s[i+1] !== '/' || s[i+2] !== '/') return false;
      i += 3;
    }
    if (i >= s.length) return false;
    for (let j = i; j < s.length; j++) {
      if (isEcmaWs(s[j])) return false;
    }
    return true;
  }

  it('accepts https://github.com/user/repo.git', () => assert.ok(checkGitCloneUrl('https://github.com/user/repo.git')));
  it('accepts git@github.com:user/repo.git', () => assert.ok(checkGitCloneUrl('git@github.com:user/repo.git')));
  it('accepts ssh://git@example.com/repo', () => assert.ok(checkGitCloneUrl('ssh://git@example.com/repo')));
  it('rejects empty', () => assert.ok(!checkGitCloneUrl('')));
  it('rejects no path after scheme', () => assert.ok(!checkGitCloneUrl('https://')));
  it('rejects no path after git@', () => assert.ok(!checkGitCloneUrl('git@')));
  it('B9: rejects NBSP in URL', () => assert.ok(!checkGitCloneUrl('https://\u00A0example.com')));

  it('matches regex', () => {
    const regex = new RegExp('^(([a-z][a-z0-9+\\.-]*://)|git@)[^\\s]+$');
    const inputs = [
      'https://github.com/user/repo.git', 'git@github.com:user/repo.git',
      'ssh://git@example.com/repo', '', 'https://', 'git@',
      'https://\u00A0example.com', 'https://example.com',
    ];
    for (const input of inputs) {
      assert.strictEqual(checkGitCloneUrl(input), regex.test(input),
        `Mismatch for ${JSON.stringify(input)}`);
    }
  });
});

describe('check_imeta_dim behavioral correctness', () => {
  function checkImetaDim(s: string): boolean {
    if (s.length < 7) return false;
    if (!s.startsWith('dim ')) return false;
    let i = 4;
    let dc = 0;
    while (i < s.length && s[i] >= '0' && s[i] <= '9') { i++; dc++; }
    if (dc < 1 || dc > 5) return false;
    if (i >= s.length || s[i] !== 'x') return false;
    i++; dc = 0;
    while (i < s.length && s[i] >= '0' && s[i] <= '9') { i++; dc++; }
    if (dc < 1 || dc > 5) return false;
    return i === s.length;
  }

  it('accepts dim 100x200', () => assert.ok(checkImetaDim('dim 100x200')));
  it('accepts dim 1x1', () => assert.ok(checkImetaDim('dim 1x1')));
  it('accepts dim 99999x99999', () => assert.ok(checkImetaDim('dim 99999x99999')));
  it('rejects empty', () => assert.ok(!checkImetaDim('')));
  it('rejects no dim prefix', () => assert.ok(!checkImetaDim('100x200')));
  it('rejects missing x', () => assert.ok(!checkImetaDim('dim 100200')));
  it('rejects 0 digits width', () => assert.ok(!checkImetaDim('dim x200')));
  it('rejects 6 digits width', () => assert.ok(!checkImetaDim('dim 123456x200')));
  it('rejects trailing chars', () => assert.ok(!checkImetaDim('dim 100x200px')));

  it('matches regex', () => {
    const regex = /^dim [0-9]{1,5}x[0-9]{1,5}$/;
    const inputs = [
      'dim 100x200', 'dim 1x1', 'dim 99999x99999', '',
      '100x200', 'dim 100200', 'dim x200', 'dim 123456x200',
      'dim 100x200px', 'dim 0x0',
    ];
    for (const input of inputs) {
      assert.strictEqual(checkImetaDim(input), regex.test(input),
        `Mismatch for ${JSON.stringify(input)}`);
    }
  });

  it('classifies pattern as imeta_dim', () => {
    const r = classifyRegex('^dim [0-9]{1,5}x[0-9]{1,5}$');
    assert.deepStrictEqual(r, { op: 'imeta_dim' });
    assert.ok(isNativeCheck(r));
  });

  it('regex-vs-native equivalence with adversarial inputs', () => {
    const regex = /^dim [0-9]{1,5}x[0-9]{1,5}$/;
    const inputs = [
      '', 'x', 'dim', 'dim ', 'dim 1', 'dim 1x', 'dim 1x1',
      'dim 100x200', 'dim 99999x99999',
      'dim 0x0', 'dim 00000x00000',
      'dim 123456x200', 'dim 200x123456', // 6 digits
      'dim 100x200px', 'dim 100x200\n', 'dim 100x200\r',
      'dim \n100x200', 'dim 100\nx200',
      '100x200', 'DIM 100x200', 'Dim 100x200',
      'dim 100X200', // uppercase X
      'dim  100x200', // double space
      'dim 100x200 ', // trailing space
      ' dim 100x200', // leading space
      'dim -1x200', 'dim 1x-200',
      'dim 1.5x200',
    ];
    for (const input of inputs) {
      assert.strictEqual(checkImetaDim(input), regex.test(input),
        `Mismatch for ${JSON.stringify(input)}`);
    }
  });
});

describe('check_a_tag string kinds (B1/B2)', () => {
  // Reference: string-based kind comparison, no integer overflow
  // Leading zeros are allowed by the generic \d+ pattern; string equality
  // naturally rejects "030311" !== "30311" when a kinds filter is active.
  function checkATagStr(s: string, kinds?: string[]): boolean {
    if (s.length < 68) return false;
    let pos = 0;
    if (s[pos] < '0' || s[pos] > '9') return false;
    const kindStart = pos;
    while (pos < s.length && s[pos] >= '0' && s[pos] <= '9') pos++;
    const kindStr = s.slice(kindStart, pos);
    if (pos >= s.length || s[pos] !== ':') return false;
    if (kinds && kinds.length > 0 && !kinds.includes(kindStr)) return false;
    pos++;
    if (pos + 64 >= s.length) return false;
    for (let i = 0; i < 64; i++) {
      const c = s[pos + i];
      if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
    }
    pos += 64;
    if (pos >= s.length || s[pos] !== ':') return false;
    pos++;
    if (pos >= s.length) return false;
    for (let j = pos; j < s.length; j++) {
      const c = s[j];
      if (c === '\n' || c === '\r' || c === '\u2028' || c === '\u2029') return false;
    }
    return true;
  }

  const hex64 = 'a'.repeat(64);

  // B1: Leading zeros — "030311" must NOT match kind "30311"
  it('B1: rejects leading-zero kind with filter', () => {
    assert.ok(!checkATagStr(`030311:${hex64}:test`, ['30311']));
  });

  it('B1: accepts exact kind match without leading zeros', () => {
    assert.ok(checkATagStr(`30311:${hex64}:test`, ['30311']));
  });

  // B2: Overflow — extremely long digit strings don't cause issues
  it('B2: handles very long kind number gracefully', () => {
    const longKind = '9'.repeat(100);
    // Should accept when no kinds filter
    assert.ok(checkATagStr(`${longKind}:${hex64}:test`));
    // Should reject when kinds filter doesn't include the long number
    assert.ok(!checkATagStr(`${longKind}:${hex64}:test`, ['30311']));
    // Should accept when kinds filter includes the exact string
    assert.ok(checkATagStr(`${longKind}:${hex64}:test`, [longKind]));
  });

  it('B2: handles max-JS-int kind', () => {
    const bigKind = '9007199254740992'; // > Number.MAX_SAFE_INTEGER
    assert.ok(checkATagStr(`${bigKind}:${hex64}:test`));
    assert.ok(checkATagStr(`${bigKind}:${hex64}:test`, [bigKind]));
    // Would fail with integer comparison due to precision loss
    assert.ok(!checkATagStr(`${bigKind}:${hex64}:test`, ['9007199254740993']));
  });
});

describe('check_external_identity dot-tail (B10)', () => {
  // Reference: ^[a-z0-9._\-/]+:.+ — the .+ means >=1 char after colon,
  // and the first char after colon must not be a line terminator
  function checkExternalIdentity(s: string): boolean {
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '.' || c === '_' || c === '-' || c === '/') i++;
      else break;
    }
    if (i === 0 || i >= s.length || s[i] !== ':') return false;
    i++;
    // .+ tail — at least 1 char, no line terminators (JS . semantics)
    if (i >= s.length) return false;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (c === '\n' || c === '\r' || c === '\u2028' || c === '\u2029') return false;
    }
    return true;
  }

  it('accepts github:user', () => assert.ok(checkExternalIdentity('github:user')));
  it('accepts github: followed by space', () => assert.ok(checkExternalIdentity('github: user')));
  it('B10: rejects github: followed by newline', () => assert.ok(!checkExternalIdentity('github:\nuser')));
  it('B10: rejects github: followed by \\r', () => assert.ok(!checkExternalIdentity('github:\ruser')));
  it('B10: rejects github: followed by LS', () => assert.ok(!checkExternalIdentity('github:\u2028user')));

  it('matches regex (anchored — validators check full string)', () => {
    // Generated validators check the full string, so $ anchor matches native behavior
    const regex = new RegExp('^[a-z0-9._\\-/]+:.+$');
    const inputs = [
      'github:user', 'github:', 'github:\nuser', 'github:\ruser',
      'github:\u2028user', 'github: user', '', 'github:user\nrest',
    ];
    for (const input of inputs) {
      assert.strictEqual(checkExternalIdentity(input), regex.test(input),
        `Mismatch for ${JSON.stringify(input)}`);
    }
  });
});

// ========== New op behavioral correctness + regex equivalence tests ==========

describe('check_dim behavioral correctness', () => {
  function checkDim(s: string): boolean {
    if (s.length === 0) return false;
    let i = 0;
    if (s[i] < '0' || s[i] > '9') return false;
    while (i < s.length && s[i] >= '0' && s[i] <= '9') i++;
    if (i >= s.length || s[i] !== 'x') return false;
    i++;
    if (i >= s.length || s[i] < '0' || s[i] > '9') return false;
    while (i < s.length && s[i] >= '0' && s[i] <= '9') i++;
    return i === s.length;
  }

  it('accepts 1920x1080', () => assert.ok(checkDim('1920x1080')));
  it('accepts 1x1', () => assert.ok(checkDim('1x1')));
  it('accepts 0x0', () => assert.ok(checkDim('0x0')));
  it('rejects empty', () => assert.ok(!checkDim('')));
  it('rejects x1080', () => assert.ok(!checkDim('x1080')));
  it('rejects 1920x', () => assert.ok(!checkDim('1920x')));
  it('rejects 1920X1080', () => assert.ok(!checkDim('1920X1080')));
  it('rejects 1920x1080x', () => assert.ok(!checkDim('1920x1080x')));

  it('matches regex ^[0-9]+x[0-9]+$', () => {
    const regex = /^[0-9]+x[0-9]+$/;
    const inputs = ['1920x1080', '1x1', '0x0', '', 'x1080', '1920x', '1920X1080', 'axb', '1920x1080x'];
    for (const input of inputs) {
      assert.strictEqual(checkDim(input), regex.test(input), `Mismatch for ${JSON.stringify(input)}`);
    }
  });
});

describe('check_no_uppercase behavioral correctness', () => {
  function checkNoUppercase(s: string): boolean {
    if (s.length === 0) return false;
    for (let i = 0; i < s.length; i++) {
      if (s[i] >= 'A' && s[i] <= 'Z') return false;
    }
    return true;
  }

  it('accepts lowercase', () => assert.ok(checkNoUppercase('abc')));
  it('accepts digits', () => assert.ok(checkNoUppercase('123')));
  it('accepts mixed lower+digits+special', () => assert.ok(checkNoUppercase('abc-123_foo')));
  it('rejects empty', () => assert.ok(!checkNoUppercase('')));
  it('rejects uppercase', () => assert.ok(!checkNoUppercase('ABC')));
  it('rejects mixed case', () => assert.ok(!checkNoUppercase('abcDef')));

  it('matches regex ^[^A-Z]+$', () => {
    const regex = /^[^A-Z]+$/;
    const inputs = ['abc', '123', 'abc-123_foo', '', 'ABC', 'abcDef', ' ', '\n'];
    for (const input of inputs) {
      assert.strictEqual(checkNoUppercase(input), regex.test(input), `Mismatch for ${JSON.stringify(input)}`);
    }
  });
});

describe('check_dotted_digits behavioral correctness', () => {
  function checkDottedDigits(s: string): boolean {
    if (s.length === 0) return false;
    let i = 0;
    if (s[i] < '0' || s[i] > '9') return false;
    while (i < s.length && s[i] >= '0' && s[i] <= '9') i++;
    while (i < s.length && s[i] === '.') {
      i++;
      if (i >= s.length || s[i] < '0' || s[i] > '9') return false;
      while (i < s.length && s[i] >= '0' && s[i] <= '9') i++;
    }
    return i === s.length;
  }

  it('accepts 1', () => assert.ok(checkDottedDigits('1')));
  it('accepts 1.2', () => assert.ok(checkDottedDigits('1.2')));
  it('accepts 1.2.3', () => assert.ok(checkDottedDigits('1.2.3')));
  it('accepts 10.20.30', () => assert.ok(checkDottedDigits('10.20.30')));
  it('rejects empty', () => assert.ok(!checkDottedDigits('')));
  it('rejects leading dot', () => assert.ok(!checkDottedDigits('.1')));
  it('rejects trailing dot', () => assert.ok(!checkDottedDigits('1.')));
  it('rejects consecutive dots', () => assert.ok(!checkDottedDigits('1..2')));
  it('rejects letters', () => assert.ok(!checkDottedDigits('1.2a')));

  it('matches regex ^[0-9]+(\\.[0-9]+)*$', () => {
    const regex = /^[0-9]+(\.[0-9]+)*$/;
    const inputs = ['1', '1.2', '1.2.3', '10.20.30', '', '.1', '1.', '1..2', '1.2a', '0', '00.00'];
    for (const input of inputs) {
      assert.strictEqual(checkDottedDigits(input), regex.test(input), `Mismatch for ${JSON.stringify(input)}`);
    }
  });
});

describe('check_slash_segments behavioral correctness', () => {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-+';
  function checkSlashSegments(s: string): boolean {
    if (s.length === 0) return false;
    let i = 0;
    if (!charset.includes(s[i])) return false;
    while (i < s.length && charset.includes(s[i])) i++;
    while (i < s.length && s[i] === '/') {
      i++;
      if (i >= s.length || !charset.includes(s[i])) return false;
      while (i < s.length && charset.includes(s[i])) i++;
    }
    return i === s.length;
  }

  it('accepts single segment', () => assert.ok(checkSlashSegments('foo')));
  it('accepts two segments', () => assert.ok(checkSlashSegments('foo/bar')));
  it('accepts three segments', () => assert.ok(checkSlashSegments('a/b/c')));
  it('accepts special chars', () => assert.ok(checkSlashSegments('foo-bar_baz+qux')));
  it('rejects empty', () => assert.ok(!checkSlashSegments('')));
  it('rejects leading slash', () => assert.ok(!checkSlashSegments('/foo')));
  it('rejects trailing slash', () => assert.ok(!checkSlashSegments('foo/')));
  it('rejects consecutive slashes', () => assert.ok(!checkSlashSegments('foo//bar')));

  it('matches regex ^[A-Za-z0-9_\\-+]+(?:/[A-Za-z0-9_\\-+]+)*$', () => {
    const regex = /^[A-Za-z0-9_\-+]+(?:\/[A-Za-z0-9_\-+]+)*$/;
    const inputs = ['foo', 'foo/bar', 'a/b/c', 'foo-bar_baz+qux', '', '/foo', 'foo/', 'foo//bar', 'a b'];
    for (const input of inputs) {
      assert.strictEqual(checkSlashSegments(input), regex.test(input), `Mismatch for ${JSON.stringify(input)}`);
    }
  });
});

describe('check_space_separated_tokens behavioral correctness', () => {
  const WS = new Set([
    '\t', '\n', '\x0B', '\x0C', '\r', ' ', '\xA0',
    '\u1680', '\u2000', '\u2001', '\u2002', '\u2003', '\u2004',
    '\u2005', '\u2006', '\u2007', '\u2008', '\u2009', '\u200A',
    '\u2028', '\u2029', '\u202F', '\u205F', '\u3000', '\uFEFF',
  ]);
  function checkSpaceSepTokens(s: string): boolean {
    if (s.length === 0) return false;
    let i = 0;
    if (WS.has(s[i])) return false;
    while (i < s.length && !WS.has(s[i])) i++;
    while (i < s.length && s[i] === ' ') {
      i++;
      if (i >= s.length || WS.has(s[i])) return false;
      while (i < s.length && !WS.has(s[i])) i++;
    }
    return i === s.length;
  }

  it('accepts single token', () => assert.ok(checkSpaceSepTokens('hello')));
  it('accepts two tokens', () => assert.ok(checkSpaceSepTokens('hello world')));
  it('accepts three tokens', () => assert.ok(checkSpaceSepTokens('a b c')));
  it('rejects empty', () => assert.ok(!checkSpaceSepTokens('')));
  it('rejects leading space', () => assert.ok(!checkSpaceSepTokens(' hello')));
  it('rejects trailing space', () => assert.ok(!checkSpaceSepTokens('hello ')));
  it('rejects consecutive spaces', () => assert.ok(!checkSpaceSepTokens('hello  world')));
  it('rejects tab', () => assert.ok(!checkSpaceSepTokens('hello\tworld')));

  it('matches regex ^\\S+( \\S+)*$', () => {
    const regex = /^\S+( \S+)*$/;
    const inputs = ['hello', 'hello world', 'a b c', '', ' hello', 'hello ', 'hello  world', 'hello\tworld'];
    for (const input of inputs) {
      assert.strictEqual(checkSpaceSepTokens(input), regex.test(input), `Mismatch for ${JSON.stringify(input)}`);
    }
  });
});

describe('check_starts_with_charset behavioral correctness', () => {
  const charset = '0123456789bcdefghjkmnpqrstuvwxyz';
  function checkStartsWithCharset(s: string): boolean {
    return s.length >= 1 && charset.includes(s[0]);
  }

  it('accepts starting with digit', () => assert.ok(checkStartsWithCharset('9abc')));
  it('accepts starting with bech32 letter', () => assert.ok(checkStartsWithCharset('b123')));
  it('accepts single char', () => assert.ok(checkStartsWithCharset('0')));
  it('accepts with trailing junk (unanchored)', () => assert.ok(checkStartsWithCharset('9XYZ')));
  it('rejects empty', () => assert.ok(!checkStartsWithCharset('')));
  it('rejects starting with A', () => assert.ok(!checkStartsWithCharset('A123')));
  it('rejects starting with a (not in bech32)', () => assert.ok(!checkStartsWithCharset('a123')));

  it('matches regex ^[0-9bcdefghjkmnpqrstuvwxyz]+ (unanchored)', () => {
    const regex = /^[0-9bcdefghjkmnpqrstuvwxyz]+/;
    const inputs = ['9abc', 'b123', '0', '9XYZ', '', 'A123', 'a123'];
    for (const input of inputs) {
      assert.strictEqual(checkStartsWithCharset(input), regex.test(input), `Mismatch for ${JSON.stringify(input)}`);
    }
  });
});

describe('check_base64 behavioral correctness', () => {
  function isB64Char(c: string): boolean {
    return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '+' || c === '/';
  }
  function checkBase64(s: string): boolean {
    if (s.length === 0) return true;
    if (s.length % 4 !== 0) return false;
    let i = 0;
    while (i < s.length && isB64Char(s[i])) i++;
    const dataLen = i;
    const padLen = s.length - dataLen;
    if (padLen > 2) return false;
    if (padLen === 1 && dataLen % 4 !== 3) return false;
    if (padLen === 2 && dataLen % 4 !== 2) return false;
    for (let j = dataLen; j < s.length; j++) {
      if (s[j] !== '=') return false;
    }
    return true;
  }

  it('accepts empty string', () => assert.ok(checkBase64('')));
  it('accepts SGVsbG8=', () => assert.ok(checkBase64('SGVsbG8=')));
  it('accepts SGVsbA==', () => assert.ok(checkBase64('SGVsbA==')));
  it('accepts AAAA', () => assert.ok(checkBase64('AAAA')));
  it('accepts AAAAAAAA', () => assert.ok(checkBase64('AAAAAAAA')));
  it('rejects single char', () => assert.ok(!checkBase64('A')));
  it('rejects odd length', () => assert.ok(!checkBase64('ABC')));
  it('rejects ====', () => assert.ok(!checkBase64('====')));
  it('rejects padding in middle', () => assert.ok(!checkBase64('AA==AAAA')));

  it('matches regex', () => {
    const regex = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
    const inputs = ['', 'SGVsbG8=', 'SGVsbA==', 'AAAA', 'AAAAAAAA', 'A', 'ABC', '====', 'AA==AAAA', '+/+/+/+/'];
    for (const input of inputs) {
      assert.strictEqual(checkBase64(input), regex.test(input), `Mismatch for ${JSON.stringify(input)}`);
    }
  });
});

describe('check_nostr_uri behavioral correctness', () => {
  const BECH32 = '023456789acdefghjklmnpqrstuvwxyz';
  function checkNostrUri(s: string): boolean {
    if (!s.startsWith('nostr:')) return false;
    const p = s.slice(6);
    if (p.length === 0) return false;
    if (p.length === 63 && (p.startsWith('npub1') || p.startsWith('note1'))) {
      for (let i = 5; i < 63; i++) if (!BECH32.includes(p[i])) return false;
      return true;
    }
    let prefixLen = 0;
    if (p.startsWith('nprofile1')) prefixLen = 9;
    else if (p.startsWith('nevent1')) prefixLen = 7;
    else if (p.startsWith('naddr1')) prefixLen = 6;
    if (prefixLen === 0 || p.length <= prefixLen) return false;
    for (let i = prefixLen; i < p.length; i++) if (!BECH32.includes(p[i])) return false;
    return true;
  }

  it('accepts valid npub URI', () => assert.ok(checkNostrUri('nostr:npub1' + '0'.repeat(58))));
  it('accepts valid note URI', () => assert.ok(checkNostrUri('nostr:note1' + '0'.repeat(58))));
  it('accepts valid nprofile URI', () => assert.ok(checkNostrUri('nostr:nprofile1' + '0'.repeat(10))));
  it('accepts valid nevent URI', () => assert.ok(checkNostrUri('nostr:nevent1' + '0'.repeat(10))));
  it('accepts valid naddr URI', () => assert.ok(checkNostrUri('nostr:naddr1' + '0'.repeat(10))));
  it('rejects missing prefix', () => assert.ok(!checkNostrUri('npub1' + '0'.repeat(58))));
  it('rejects empty after nostr:', () => assert.ok(!checkNostrUri('nostr:')));
  it('rejects wrong length for npub', () => assert.ok(!checkNostrUri('nostr:npub1' + '0'.repeat(57))));

  it('matches regex', () => {
    const regex = /^nostr:((npub|note)1[02-9ac-hj-np-z]{58}|(nprofile|nevent|naddr)1[02-9ac-hj-np-z]+)$/;
    const inputs = [
      'nostr:npub1' + '0'.repeat(58),
      'nostr:note1' + '0'.repeat(58),
      'nostr:nprofile1' + '0'.repeat(10),
      'nostr:nevent1' + '0'.repeat(10),
      'nostr:naddr1' + '0'.repeat(10),
      'npub1' + '0'.repeat(58),
      'nostr:',
      'nostr:npub1' + '0'.repeat(57),
      '',
    ];
    for (const input of inputs) {
      assert.strictEqual(checkNostrUri(input), regex.test(input), `Mismatch for ${JSON.stringify(input)}`);
    }
  });
});

describe('check_nip04_encrypted behavioral correctness', () => {
  function isB64Char(c: string): boolean {
    return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '+' || c === '/';
  }
  function checkNip04(s: string): boolean {
    if (s.length === 0) return false;
    const sep = s.indexOf('?iv=');
    if (sep <= 0) return false;
    const rightStart = sep + 4;
    if (rightStart >= s.length) return false;
    let i = 0;
    while (i < sep && isB64Char(s[i])) i++;
    if (i === 0) return false;
    let eq = 0;
    while (i < sep && s[i] === '=') { i++; eq++; }
    if (i !== sep || eq > 2) return false;
    i = rightStart;
    const dataStart = i;
    while (i < s.length && isB64Char(s[i])) i++;
    if (i === dataStart) return false;
    eq = 0;
    while (i < s.length && s[i] === '=') { i++; eq++; }
    return i === s.length && eq <= 2;
  }

  it('accepts valid NIP-04', () => assert.ok(checkNip04('AAAA?iv=BBBB')));
  it('accepts with padding', () => assert.ok(checkNip04('AA==?iv=BB==')));
  it('accepts long data', () => assert.ok(checkNip04('AAAAAA==?iv=BBBB')));
  it('rejects empty', () => assert.ok(!checkNip04('')));
  it('rejects no ?iv=', () => assert.ok(!checkNip04('AAAA')));
  it('rejects empty left', () => assert.ok(!checkNip04('?iv=BBBB')));
  it('rejects empty right', () => assert.ok(!checkNip04('AAAA?iv=')));

  it('matches regex', () => {
    const regex = /^[A-Za-z0-9+/]+={0,2}\?iv=[A-Za-z0-9+/]+={0,2}$/;
    const inputs = ['AAAA?iv=BBBB', 'AA==?iv=BB==', 'AAAAAA==?iv=BBBB', '', 'AAAA', '?iv=BBBB', 'AAAA?iv='];
    for (const input of inputs) {
      assert.strictEqual(checkNip04(input), regex.test(input), `Mismatch for ${JSON.stringify(input)}`);
    }
  });
});

describe('check_nip05_identifier behavioral correctness', () => {
  function isAlnum(c: string): boolean {
    return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');
  }
  function isLocalChar(c: string): boolean {
    return c === '_' || isAlnum(c) || c === '.' || c === '-';
  }
  function isDomainChar(c: string): boolean {
    return isAlnum(c) || c === '-';
  }
  function checkNip05(s: string): boolean {
    if (s.length === 0) return false;
    const at = s.lastIndexOf('@');
    if (at <= 0) return false;
    for (let i = 0; i < at; i++) if (!isLocalChar(s[i])) return false;
    const d = s.slice(at + 1);
    if (d.length === 0) return false;
    let dotCount = 0;
    let di = 0;
    while (di < d.length) {
      if (!isAlnum(d[di])) return false;
      while (di < d.length && isDomainChar(d[di])) di++;
      if (di > 0 && !isAlnum(d[di - 1])) return false;
      if (di < d.length && d[di] === '.') { dotCount++; di++; }
      else if (di < d.length) return false;
    }
    return dotCount >= 1 && isAlnum(d[d.length - 1]);
  }

  it('accepts user@example.com', () => assert.ok(checkNip05('user@example.com')));
  it('accepts _@domain.tld', () => assert.ok(checkNip05('_@domain.tld')));
  it('accepts user.name@sub.domain.com', () => assert.ok(checkNip05('user.name@sub.domain.com')));
  it('rejects empty', () => assert.ok(!checkNip05('')));
  it('rejects no @', () => assert.ok(!checkNip05('user')));
  it('rejects no domain dots', () => assert.ok(!checkNip05('user@localhost')));
  it('rejects trailing hyphen in domain', () => assert.ok(!checkNip05('user@exam-.com')));
  it('rejects leading hyphen in domain', () => assert.ok(!checkNip05('user@-example.com')));

  it('matches regex', () => {
    const regex = /^(([_A-Za-z0-9.-]+)|_)@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
    const inputs = [
      'user@example.com', '_@domain.tld', 'user.name@sub.domain.com',
      '', 'user', 'user@localhost', 'user@exam-.com', 'user@-example.com',
      'a@b.c', '@domain.com',
    ];
    for (const input of inputs) {
      assert.strictEqual(checkNip05(input), regex.test(input), `Mismatch for ${JSON.stringify(input)}`);
    }
  });
});

describe('check_mime_type_strict behavioral correctness', () => {
  function isAlnum(c: string): boolean {
    return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');
  }
  const MIME_EXTRA = '!#$&^_.+-';
  function isMimeChar(c: string): boolean {
    return isAlnum(c) || MIME_EXTRA.includes(c);
  }
  function checkMimeStrict(s: string): boolean {
    if (s.length === 0) return false;
    let i = 0;
    if (!isAlnum(s[i])) return false;
    i++;
    while (i < s.length && isMimeChar(s[i])) i++;
    if (i >= s.length || s[i] !== '/') return false;
    i++;
    if (i >= s.length || !isAlnum(s[i])) return false;
    i++;
    while (i < s.length && isMimeChar(s[i])) i++;
    return i === s.length;
  }

  it('accepts text/plain', () => assert.ok(checkMimeStrict('text/plain')));
  it('accepts application/vnd.api+json', () => assert.ok(checkMimeStrict('application/vnd.api+json')));
  it('accepts image/svg+xml', () => assert.ok(checkMimeStrict('image/svg+xml')));
  it('rejects empty', () => assert.ok(!checkMimeStrict('')));
  it('rejects no slash', () => assert.ok(!checkMimeStrict('text')));
  it('rejects leading special', () => assert.ok(!checkMimeStrict('!text/plain')));
  it('rejects slash at end', () => assert.ok(!checkMimeStrict('text/')));

  it('matches regex', () => {
    const regex = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/;
    const inputs = ['text/plain', 'application/vnd.api+json', 'image/svg+xml', '', 'text', '!text/plain', 'text/', '/json'];
    for (const input of inputs) {
      assert.strictEqual(checkMimeStrict(input), regex.test(input), `Mismatch for ${JSON.stringify(input)}`);
    }
  });
});

describe('check_prefix_delim_rest behavioral correctness', () => {
  function checkPrefixDelimRest(s: string, charset: string, delim: string): boolean {
    if (s.length === 0) return false;
    let i = 0;
    if (!charset.includes(s[i])) return false;
    while (i < s.length && charset.includes(s[i])) i++;
    if (i + delim.length >= s.length) return false;
    if (s.slice(i, i + delim.length) !== delim) return false;
    i += delim.length;
    if (i >= s.length) return false;
    // .+ first char must not be a line terminator (ECMA-262)
    const c = s[i];
    if (c === '\n' || c === '\r' || c === '\u2028' || c === '\u2029') return false;
    return true;
  }

  it('accepts 123:hello', () => assert.ok(checkPrefixDelimRest('123:hello', '0123456789', ':')));
  it('accepts foo: bar', () => assert.ok(checkPrefixDelimRest('foo: bar', 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-', ': ')));
  it('rejects empty', () => assert.ok(!checkPrefixDelimRest('', '0123456789', ':')));
  it('rejects no delimiter', () => assert.ok(!checkPrefixDelimRest('123', '0123456789', ':')));
  it('rejects nothing after delimiter', () => assert.ok(!checkPrefixDelimRest('123:', '0123456789', ':')));
  it('rejects newline after delimiter', () => assert.ok(!checkPrefixDelimRest('123:\n', '0123456789', ':')));
  it('rejects CR after delimiter', () => assert.ok(!checkPrefixDelimRest('123:\r', '0123456789', ':')));
  it('rejects LS after delimiter', () => assert.ok(!checkPrefixDelimRest('123:\u2028', '0123456789', ':')));
  it('rejects PS after delimiter', () => assert.ok(!checkPrefixDelimRest('123:\u2029', '0123456789', ':')));
  it('accepts newline in middle of content', () => assert.ok(checkPrefixDelimRest('123:hello\nmore', '0123456789', ':')));

  it('matches regex ^[0-9]+:.+ (unanchored)', () => {
    const regex = /^[0-9]+:.+/;
    const inputs = ['123:hello', '0:x', '', '123', '123:', 'abc:def', '123:hello\nmore',
      '123:\n', '123:\r', '123:\u2028', '123:\u2029', '123:\nfoo', '123:\rfoo'];
    for (const input of inputs) {
      assert.strictEqual(checkPrefixDelimRest(input, '0123456789', ':'), regex.test(input),
        `Mismatch for ${JSON.stringify(input)}`);
    }
  });
});
