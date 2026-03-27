# Three Approaches to Nostr Event Validation

This document compares three approaches for validating Nostr events:

1. **JSON Schema validators** — `schemata-validator-*` packages wrapping AJV, jsonschema, etc.
2. **Code generation** — `schemata-codegen` emitting native validators from the same schemas
3. **Bespoke schema** — fiatjaf's [`registry-of-kinds`](https://github.com/nostr-protocol/registry-of-kinds) with a custom Nostr-specific schema language

All three aim to answer: "Is this Nostr event well-formed?" They differ in where that question gets answered (build time vs. runtime), what schema language defines correctness, and what trade-offs they make between performance, scope, and extensibility.

## Background

[schemata](https://github.com/nostrability/schemata) provides 173 JSON Schema (Draft-07) definitions for Nostr event kinds. Its README anticipated that code generation could eventually replace runtime schema interpretation:

> Generators could be written by the nostr community by forking existing generators [...] The result would negate any requirement for runtime validation via JSON-Schema since the validation would be handled programmatically by the generated Stub and/or Client-SDKs identically.

It also acknowledged fiatjaf's alternative:

> @fiatjaf produced a bespoke schema specification solution [...] its specification is drafted for nostr and so the performance is notably better. [...] A nostr-specific schema validator may prove to be the best long-term solution, with the caveat that it will take extensive development for it to reach maturity.

`schemata-codegen` is the first implementation of the generator vision — reading JSON Schema at build time and emitting native code, aiming to combine schemata's extensibility with the performance of purpose-built validators.

## At a Glance

| | JSON Schema Validators | Codegen Validators | Registry of Kinds |
|---|---|---|---|
| **Schema source** | [schemata](https://github.com/nostrability/schemata) JSON Schema Draft-07 | Same (consumed at build time) | Custom Nostr-specific YAML |
| **Schema files** | ~173 JSON across 65 NIP dirs | Same (consumed once, then discarded) | Single `schema.yaml` |
| **What runs** | JSON Schema engine interprets schemas at runtime | Generated `if`/`else` compiled into the app | Custom per-language validator |
| **Validation scope** | Full event envelope (kind, pubkey, content, tags, sig) | Tag constraints only | Full event (kind-specific) |
| **Dependencies** | JSON Schema library + schema documents | Zero (self-contained output) | Custom validator library |
| **Performance** | Slow (generic schema interpretation) | Fast (compiled native checks) | Fast (purpose-built) |
| **Languages** | 13 (each wrapping a language-specific lib) | 12 (all emitted from one IR) | Hand-written per language |
| **Extensibility** | Add NIP → add schema → all validators work | Add NIP → add schema → re-run codegen | Add to YAML → update every validator |
| **Nostr awareness** | None (generic JSON Schema engine) | Schemata-specific pattern matching | Native (`pubkey`, `relay`, `constrained`) |
| **Maturity** | Production (AJV, jsonschema well-tested) | Production (305 tests, 12 languages) | Early ("extensive development to reach maturity") |
| **Tooling** | Rich (JSON Schema ecosystem) | schemata-codegen CLI | Browser explorer |

## How Each Approach Works

### 1. JSON Schema Validators (`schemata-validator-*`)

The `schemata-validator-*` packages ([VALIDATORS.md](https://github.com/nostrability/schemata/blob/master/VALIDATORS.md)) wrap language-specific JSON Schema libraries to provide Nostr-aware methods:

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ Application │────>│ schemata-validator│────>│ JSON Schema Lib  │
│             │     │   validateNote() │     │ (AJV, jsonschema, │
│             │     │   validateNip11()│     │  json_schemer...) │
│             │     │   validateMsg()  │     │                  │
└─────────────┘     └──────────────────┘     └──────────────────┘
                           │                         │
                    ┌──────┘                  ┌──────┘
                    │ preprocessing:          │ interprets:
                    │  strip nested $id       │  Draft-07 keywords
                    │  strip nested $schema   │  allOf/anyOf/oneOf
                    │  errorMessage enrichment│  contains, if/then
                    │  additionalProps warn   │  items, pattern, ...
                    └─────────────────────────┘
```

**Reference implementation**: [`@nostrwatch/schemata-js-ajv`](https://www.npmjs.com/package/@nostrwatch/schemata-js-ajv) — AJV-powered validation for JS/TS. Depends on `@nostrability/schemata`, `ajv`, `ajv-errors`, and `nostr-tools`.

**API surface** — up to 5 functions per language:

| Function | Purpose | Coverage |
|----------|---------|----------|
| `validate(schema, data)` | Validate arbitrary JSON against any schema | 12/13 languages |
| `validateNote(event)` | Validate a Nostr event against its kind schema | 13/13 |
| `validateNip11(doc)` | Validate relay info document (NIP-11) | 12/13 |
| `validateMessage(msg)` | Validate WebSocket protocol messages | 10/13 |
| `getSchema(key)` | Look up a schema by key from the registry | 12/13 |

**Internal features**:

| Feature | What it does | Coverage |
|---------|-------------|----------|
| Strip nested `$id` | Prevent JSON Schema `$id` resolution conflicts | 11/13 |
| Strip nested `$schema` | Remove nested meta-schema declarations | 9/13 |
| Additional props warnings | Warn about unrecognized fields (soft errors) | 8/13 |
| `errorMessage` enrichment | Replace cryptic schema errors with human-readable messages | 5/13 |

### 2. Codegen Validators (`schemata-codegen`)

`schemata-codegen` reads the schemas once at build time and emits standalone source files:

```
┌────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ schemata dist/  │────>│ schemata-codegen │────>│ validators.{lang}│
│ (JSON schemas) │     │                  │     │                  │
│                │     │  extract-kind.ts │     │  validateKindN() │
│                │     │  plan-validators │     │  validateKindTags│
│                │     │  emit-{lang}.ts  │     │  (zero deps)     │
└────────────────┘     └──────────────────┘     └──────────────────┘
       build time              build time              runtime
```

Three-stage pipeline:

1. **Extract** (`extract-kind.ts`): Pattern-match schemata's JSON Schema structures into `KindShape` objects
2. **Plan** (`plan-validators.ts`): Convert to a language-independent `ValidatorAction[]` IR
3. **Emit** (`emit-{lang}.ts`): Render into idiomatic code for the target language

**Generated code example** (TypeScript, kind 9735 — Zap Receipt):

```typescript
export function validateKind9735Tags(tags: ReadonlyArray<readonly string[]>): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!tags.some(t => t[0] === "p" && t.length >= 2 && /^[a-f0-9]{64}$/.test(t[1] ?? ""))) {
    errors.push({ path: "tags", message: "tags must include a p tag" });
  }
  if (!tags.some(t => t[0] === "bolt11" && t.length >= 2)) {
    errors.push({ path: "tags", message: "tags must include a bolt11 tag" });
  }
  if (!tags.some(t => t[0] === "description" && t.length >= 2)) {
    errors.push({ path: "tags", message: "tags must include a description tag" });
  }
  return errors;
}
```

**Tag constraint checks** (6 action types, all supported by all 12 emitters):

| Check type | Description | Example |
|------------|-------------|---------|
| `require_tag` | Tag must exist matching criteria | "kind 9735 must have a `p` tag with 64-char hex" |
| `check_min_tags` | Minimum number of tags | "kind 777 must have at least 2 tags" |
| `validate_optional_positions` | Validate constrained optional positions | "if `r` tag has position 2, it must be `read` or `write`" |
| `per_item_conditional` | Per-tag: if tag[0] matches, validate rest | "every `e` tag on kind 4 must have hex64 at position 1" |
| `array_level_conditional` | If any tag X exists, require tag Y | "if kind 7 has `e` tags, must also have valid `p` tag" |
| `any_of_group` | At least one of N patterns must match | "kind 777 must have at least one filter tag" |

**Pattern classification** — ~74% of schemata's regex patterns (23/31) are classified into native checks (hex length, digit range, prefix match, character set), avoiding regex dependencies in most generated output.

### 3. Registry of Kinds (fiatjaf)

[`registry-of-kinds`](https://github.com/nostr-protocol/registry-of-kinds) uses a single YAML file with a custom schema language designed specifically for Nostr:

```yaml
10002:
  description: Relay List Metadata
  in_use: true
  content:
    type: empty
  multiple:
    - r
  tags:
    - name: r
      next:
        type: relay
        required: true
        next:
          type: constrained
          either:
            - read
            - write
```

Tags are defined as sequential type chains via `next` properties. Validation types (`pubkey`, `id`, `relay`, `url`, `constrained`, `free`, `timestamp`, etc.) are Nostr-native concepts — no JSON Schema indirection. YAML anchors (`&profile`, `*profile`) provide DRY reuse across kind definitions.

The schema language is concise and readable, and because the type system maps directly to Nostr concepts, validators can be both fast and semantically precise. The trade-off is that validators must be hand-implemented for each target language — there is no generic engine to leverage.

## Strengths and Limitations

### JSON Schema Validators

| Strengths | Limitations |
|-----------|------------|
| Full-envelope validation (kind, pubkey, content, tags, sig) | [Acknowledged as slow](https://github.com/nostrability/schemata#why-json-schema) — "notoriously slow due to the breadth of the specification" |
| 100% schema fidelity — interprets everything Draft-07 can express | Heavy dependencies — JSON Schema library (AJV: 150KB+ minified) + schema documents |
| NIP-11 and WebSocket message validation, not just events | Preprocessing burden — most implementations repeat `$id`/`$schema` stripping |
| Best tool for conformance testing ([sherlock](https://github.com/nostrability/sherlock)) | Not embeddable — impractical for C/embedded, mobile, or WebAssembly |

### Codegen Validators

| Strengths | Limitations |
|-----------|------------|
| Zero dependencies — self-contained generated code | Tag constraints only — no field types, content, sig, NIP-11, messages |
| Native performance — plain `if`/`else`, no schema interpretation | Build step required — must re-run codegen when schemas change |
| 12 languages from one `ValidatorAction[]` IR | Limited to the 6 tag constraint patterns schemata uses |
| Embeddable — works in C, WebAssembly, mobile, anywhere | Inferred error messages (human-authored ones available separately via `--errors`) |
| API adapters for nostrdb (C) and nostr crate (Rust) | |
| Compile-time types (tags.d.ts, kinds.d.ts) for TypeScript | |

### Registry of Kinds

| Strengths | Limitations |
|-----------|------------|
| Purpose-built for Nostr — semantically precise types | Validators must be hand-written for every target language |
| Fast — no generic schema engine overhead | Adding a kind requires updating every validator implementation |
| Single readable YAML file with DRY anchors | No ecosystem tooling (no linting, no IDE support, no off-the-shelf validators) |
| Full event validation (kind-specific) | Early maturity — "extensive development to reach maturity" |

## The Core Trade-off

The three approaches occupy different points on the extensibility-performance spectrum:

```
  Extensibility                                          Performance
  (add NIP, all validators work)                 (fast, minimal overhead)
       │                                                      │
       ▼                                                      ▼
  ┌────────────┐          ┌──────────┐          ┌─────────────────┐
  │ JSON Schema│          │ Codegen  │          │ Registry of     │
  │ Validators │          │          │          │ Kinds            │
  │            │          │ JSON     │          │                 │
  │ Generic    │          │ Schema   │          │ Custom schema   │
  │ engine     │          │ in,      │          │ Custom validator│
  │ interprets │          │ native   │          │ per language    │
  │ at runtime │          │ code out │          │                 │
  └────────────┘          └──────────┘          └─────────────────┘
  Add schema, done.       Add schema,           Add to YAML,
  Slow at runtime.        re-run codegen.       update every validator.
                          Fast. Tags only.      Fast. Full event.
```

- **JSON Schema** trades performance for extensibility. Any JSON Schema library in any language can validate. Adding a NIP means adding a schema file — no validator code changes.

- **Registry of Kinds** trades extensibility for performance. The custom types map directly to Nostr, so validation is fast and precise. But every new kind requires updating every language's validator.

- **Codegen** bridges the gap: extensible input (add a schema, re-run codegen) producing fast output (native code, zero deps). The trade-off is narrower scope — tag constraints only, not full-envelope validation.

## Decision Matrix

| Use case | Recommended | Why |
|----------|-------------|-----|
| **CI conformance testing** | JSON Schema validators | Full-envelope validation catches all spec violations |
| **Relay event ingestion** | JSON Schema validators or Registry | Need to validate pubkey, sig, content — not just tags |
| **Client-side tag validation** | Codegen | Zero deps, fast, works in browser/mobile |
| **Embedded/IoT (nostrdb, C)** | Codegen | No JSON Schema engine available; API adapters for nostrdb |
| **Relay tag filtering (hot path)** | Codegen or Registry | Can't afford schema interpretation overhead |
| **Performance-critical relay** | Registry of Kinds | Full event validation without JSON Schema overhead |
| **SDK / library development** | Codegen + JSON Schema validators | Types + runtime checks in prod; full validation in tests |
| **Generating test fixtures** | JSON Schema validators | Full schema coverage ensures fixture completeness |

## Using Multiple Approaches Together

The approaches are complementary. A typical project might use:

1. **Codegen validators** at runtime — reject malformed tags fast, with zero dependencies
2. **JSON Schema validators** in CI — verify that stored/relayed events fully conform to the spec
3. **Codegen types** (tags.d.ts, kinds.d.ts) at compile time — catch structural mistakes before code runs

Example: [sherlock](https://github.com/nostrability/sherlock) uses codegen-generated `kind-registry.ts` and `error-messages.ts` for display, and AJV with codegen-generated `ajv-schemas/` for conformance validation.

## Ecosystem Map

```
  ┌──────────────────────────────┐   ┌─────────────────────────────┐
  │   schemata (JSON Schema)     │   │  registry-of-kinds (YAML)   │
  │   173 kinds, 65 NIPs         │   │  single schema.yaml         │
  │   Draft-07, language-agnostic│   │  Nostr-native types         │
  └──────────────┬───────────────┘   └──────────────┬──────────────┘
                 │                                   │
    ┌────────────┼────────────┐              ┌───────▼──────────┐
    │            │            │              │ Hand-written     │
    ▼            ▼            ▼              │ validators       │
┌────────┐ ┌─────────┐ ┌──────────┐        │ (per language)   │
│ Data   │ │ Codegen │ │Validator │        └──────────────────┘
│ Pkgs   │ │         │ │ Wrappers │
│        │ │ build-  │ │          │
│ embed  │ │ time    │ │ AJV,     │
│ JSON   │ │ extract │ │jsonschema│
│        │ │ plan    │ │json_     │
│13 langs│ │ emit    │ │schemer...│
└────────┘ └────┬────┘ └──────────┘
           ┌────▼─────────┐
           │ Generated    │
           │ validators   │
           │ (12 langs)   │
           │ + types      │
           │ zero deps    │
           └──────────────┘
```

## Language Coverage

| Language | Data Package | JSON Schema Validator | Codegen Validator |
|----------|:---:|:---:|:---:|
| JavaScript/TypeScript | Y | Y (AJV) | Y |
| Rust | Y | Y (jsonschema) | Y |
| Go | Y | Y (santhosh-tekuri) | Y |
| Python | Y | Y (jsonschema) | Y |
| Kotlin | Y | Y (networknt) | Y |
| Java | Y | Y (networknt) | Y |
| Swift | Y | Y (kylef) | Y |
| Dart | Y | Y (Workiva) | Y |
| PHP | Y | Y (opis) | Y |
| C# | Y | Y (JsonSchema.Net) | Y |
| C++ | Y | Y (valijson) | Y |
| Ruby | Y | Y (json_schemer) | Y |
| C | Y | Y (jsonc-daccord) | Y |

Registry of Kinds does not yet have published validator packages in specific languages.

## Summary

**JSON Schema validators** answer: "Does this event fully conform to the Nostr spec?"
Thorough, authoritative, the right choice for testing and conformance.

**Codegen validators** answer: "Are this event's tags structurally valid?"
Fast, dependency-free, the right choice for runtime validation in production code.

**Registry of Kinds** answers: "Is this event valid per the Nostr protocol?"
Purpose-built, performant, the right choice if a mature validator exists for your language.

Use JSON Schema validators to test. Use codegen to ship. Watch registry-of-kinds as it matures.
