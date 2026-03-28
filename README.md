# schemata-codegen

Nostr-aware code generator that reads [schemata](https://github.com/nostrability/schemata)'s compiled JSON schemas and produces typed code for 13 languages. Schemata-codegen includes tag tuple types, kind event interfaces, runtime validators, kind metadata, and error messages. 

Unlike the [validator approach](https://github.com/nostrability/schemata?tab=readme-ov-file#validators), no "heavy" validator is needed (e.g. AJV etc.), and code is run natively. For the real world practitioner, this means that schemata-codegen can be deployed to production, and not just constrained to CI. 

The above said, schemata-codegen is complementary to the schemata validator approach.

## How it fits in the schemata ecosystem

| Repo | Role |
|---|---|
| [schemata](https://github.com/nostrability/schemata) | The schemas themselves (YAML source, compiled JSON dist/) |
| schemata-{rs,py,go,...} | Data packages — embed the compiled JSON for a given language |
| schemata-validator-{rs,py,go,...} | Runtime validators — pass/fail a JSON blob against a schema (AJV, jsonschema, etc.) |
| **schemata-codegen** | **Code generator — produces typed language constructs from the schemas** |

The data packages give you access to raw schemas. The validators check whether a JSON blob conforms to a schema (pass/fail — useful for conformance testing, which is what [sherlock](https://github.com/nostrability/sherlock) does against live relay data). The codegen produces **typed language constructs** — so when you're writing code that builds or reads tags, the compiler catches structural mistakes (wrong position, missing field, bad marker value) that `string[][]` silently accepts.

## Direct comparison schemata-codegen vs schemata-validator approach

| Phase | schemata-js-ajv | schemata-codegen |                                                                                          
  |-------|-----------------|------------------|                                                                                                                           
  | **Write code** (authoring) | Nothing / no types | IDE autocomplete, type errors at compile time |                                                                      
  | **Build** (compile) | Nothing | Type checker catches wrong field names, missing tags |                                                                                 
  | **Construct event** (runtime) | Nothing until event is finished | Lightweight tag validator can check before signing |                                                 
  | **Validate finished event** | Full JSON Schema validation via AJV | Could also validate, but AJV is more thorough |                                                    
  | **Display to user** | Cryptic error paths | KIND_NAMES for UI, human-friendly error messages |             

## Why not use an existing JSON Schema code generator?

Every existing generator ([quicktype](https://quicktype.io/), [typify](https://github.com/oxidecomputer/typify), [datamodel-codegen](https://github.com/koxudaxi/datamodel-code-generator), [Zod 4](https://zod.dev/)) fails on schemata's schemas. The features that make schemata valuable — tag tuple structure via `items`-as-array, `contains`, `if/then`, `oneOf` + `allOf` composition — are exactly what every generator chokes on. See [findings.md](findings.md) for the full assessment.

schemata-codegen takes a different approach: instead of generically parsing JSON Schema, it pattern-matches against the specific structural shapes schemata uses and fails loudly on anything unrecognized.

## Usage

```bash
npm install
npm run build

# Generate all outputs:
node dist/index.js --schemas ../schemata/dist --all

# Or pick specific outputs:
node dist/index.js --schemas ../schemata/dist --out tags.d.ts --kinds kinds.d.ts --validators validators.ts
```

## CLI flags

### TypeScript outputs

| Flag | Output | Description |
|------|--------|-------------|
| `--out` | `tags.d.ts` | Tag tuple types (always generated) |
| `--kinds` | `kinds.d.ts` | Kind event interfaces with literal discriminants |
| `--validators` | `validators.ts` | Zero-dependency runtime tag validators |
| `--registry` | `kind-registry.ts` | Kind metadata (name, NIP, required tags, category) |
| `--errors` | `error-messages.ts` | Human-friendly error messages from schema errorMessage fields |
| `--ajv-schemas` | `ajv-schemas/` | AJV-ready JSON schemas (see [AJV schemas](#ajv-ready-schemas-ajv-schemas) below) |

### Multi-language validators

| Flag | Output | API option |
|------|--------|------------|
| `--c-validators` | `validators.c` + `validators.h` | `--c-api generic\|nostrdb` |
| `--rust-validators` | `validators.rs` | `--rust-api generic\|nostr\|nostrdb` |
| `--go-validators` | `validators.go` | |
| `--python-validators` | `validators.py` | |
| `--kotlin-validators` | `Validators.kt` | |
| `--java-validators` | `SchemataValidators.java` | |
| `--swift-validators` | `Validators.swift` | |
| `--dart-validators` | `validators.dart` | |
| `--php-validators` | `validators.php` | |
| `--csharp-validators` | `Validators.cs` | |
| `--cpp-validators` | `validators.hpp` | |
| `--ruby-validators` | `validators.rb` | |

### Other

| Flag | Description |
|------|-------------|
| `--all` | Generate all outputs |
| `--dump-plan` | Dump ValidatorAction[] plan as JSON |

**No generated outputs are committed.** Run `--all` or individual flags to produce them locally. Tests verify correctness by generating and compiling the outputs during CI.

## Generated outputs

### Tag tuple types (`tags.d.ts`)

156 tag schemas classified into 5 patterns:

```typescript
// fixed_tuple (96 tags) — exact length, typed positions
export type AmountTag = readonly ["amount", string];
export type EmojiTag = readonly ["emoji", string, string];

// optional_trailing (8 tags) — union of valid lengths
export type RTag =
  | readonly ["r", string]
  | readonly ["r", string, "read" | "write"];

// open_tail (46 tags) — typed prefix, rest string[]
export type TTag = readonly ["t", string, ...string[]];

// discriminated_union (2 tags) — oneOf with named variants
export type ETag = ETagVariant1 | ETagVariant2;

// structured_metadata (4 tags) — open-tail with contains constraints
export type ImetaTag = readonly ["imeta", string, ...string[]];
// Runtime: must contain entries matching: ^url https?://\S+$, ^m (image/...)$
```

### Kind event interfaces (`kinds.d.ts`)

177 per-kind interfaces with literal `kind` discriminants, a `NostrEvent` discriminated union, and `KNOWN_KINDS` mapping.

```typescript
export interface Kind10002Event {
  readonly kind: 10002;
  readonly content: string;
  readonly tags: string[][];
  // ...
}

export type NostrEvent = Kind0Event | Kind1Event | ... | Kind40000Event;
```

### Runtime validators (`validators.ts`)

136 kind-level validators and 3 tag-level validators. Zero dependencies — plain functions on `string[][]`. Works in any TypeScript/JavaScript environment without AJV. The same 136 validators are also generated for C, Rust, Go, Python, Kotlin, Java, Swift, Dart, PHP, C#, C++, and Ruby.

```typescript
import { validateKind9735Tags, validateKindTags } from './validators.js';

const errors = validateKind9735Tags(event.tags);
// Or dispatch by kind number:
const errors = validateKindTags(event.kind, event.tags);
```

### Kind registry (`kind-registry.ts`)

Structured metadata for all 177 kinds — kind number, NIP, human-readable name, required tags, category.

```typescript
import { KIND_NAMES, KIND_REGISTRY } from './kind-registry.js';

KIND_NAMES[9735]  // "Zap Receipt (NIP-57)"
KIND_REGISTRY[9735].requiredTags  // ["p", "bolt11", "description"]
```

### Error messages (`error-messages.ts`)

Human-friendly error messages extracted from schema `errorMessage` fields. Base field messages (shared across all kinds) and per-kind messages.

```typescript
import { BASE_ERROR_MESSAGES, KIND_ERROR_MESSAGES } from './error-messages.js';

BASE_ERROR_MESSAGES["pubkey"]  // "pubkey must be a secp256k1 public key"
KIND_ERROR_MESSAGES[7]  // [{ keyword: "...", message: "kind must equal 7" }, ...]
```

### AJV-ready schemas (`ajv-schemas/`)

Pre-processed JSON schemas with nested `$schema`, `$id`, and `errorMessage` fields stripped at build time. These can be passed directly to `ajv.compile()` without runtime preprocessing.

Consumers who use AJV (sherlock, nostr-watch, nostria) can generate these once and load them instead of stripping fields at runtime.

```bash
node dist/index.js --schemas ../schemata/dist --ajv-schemas ./ajv-schemas

# Then in your code:
import kind7Schema from './ajv-schemas/kind-7.json';
const validate = ajv.compile(kind7Schema);  // No preprocessing needed
```

## Tests

```bash
npm test    # 317 tests — extraction, emission, tsc compilation, runtime validation
```
