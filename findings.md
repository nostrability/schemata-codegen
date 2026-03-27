# Code Generation Feasibility Assessment

Deep dive into [#95](https://github.com/nostrability/schemata/issues/95) — can existing JSON Schema code generators produce useful typed code from schemata schemas?

## TL;DR

**No existing tool can generate useful typed code from schemata schemas.** The schemas' most valuable features (tag tuple structure, required tag presence, conditional validation) are exactly the features every generator fails on. The situation has improved in 2025-2026 for simple tuples, but schemata's specific patterns remain beyond what any tool handles.

---

## 1. Schema Pattern Analysis

Schemata uses Draft-07 exclusively. Tags are encoded as positional arrays via `items`-as-array (NOT `prefixItems` from Draft 2020-12).

### Five Tag Structural Patterns

| Pattern | Description | Example | Complexity |
|---------|-------------|---------|------------|
| **Fixed-length tuple** | `minItems == maxItems`, `additionalItems: false` | `["amount", "<digits>"]` | Medium |
| **Open-tail tuple** | Typed prefix, `additionalItems: true` or typed tail | `["t", "<hashtag>", ...]` | Medium |
| **Optional trailing** | `minItems < maxItems`, enumerated positions | `["r", "<wss://url>", "read"\|"write"?]` | Medium |
| **Discriminated union** | `oneOf` with same position-0 discriminator | `["e", ...]` — marked vs positional variants | Hard |
| **Structured metadata** | Key-value pairs as strings, validated by regex | `["imeta", "url https://...", "m image/png"]` | Hard |

### Three Kind Schema Tiers

| Tier | Description | JSON Schema Features | Count |
|------|-------------|---------------------|-------|
| **Tier 1** | Pin kind number only | `allOf` + `const` | ~30 |
| **Tier 2** | Required tags | `allOf` + `contains` (existential quantifier) | ~137 |
| **Tier 3** | Conditional tag validation | `if/then` ("if tag X present, validate it") | ~43 |

### String Constraints Used

| Constraint | Usage | Example |
|---|---|---|
| `const` | Every tag (position 0 discriminator) | `const: "e"` |
| `pattern` | Hex, URLs, numbers-as-strings | `^[a-f0-9]{64}$`, `^(ws://\|wss://).+$` |
| `enum` | Closed sets | `enum: ["reply", "root"]` |
| `$ref` | Reusable types | `$ref: "@/secp256k1.yaml"` |
| `format` | Rare (~5 schemas) | `format: uri` |

---

## 2. Generator Test Results

### quicktype (15+ languages)

Tested against kind-1, kind-3, kind-9734, NIP-11, filter, and tag schemas across TypeScript, Rust, Go, Swift, Kotlin, Python, and Zod.

**kind-1 TypeScript output:**
```typescript
export interface Schema {
    content: string;
    created_at: number;
    id: string;        // pattern "^[a-f0-9]{64}$" LOST
    kind: number;      // const 1 LOST
    pubkey: string;    // pattern LOST
    sig: string;       // pattern LOST
    tags: Array<string[]>;  // ALL tuple structure LOST
}
```

**kind-9734 (zap request):** Identical output to kind-1. All `contains` constraints (must have `relays` tag, must have `p` tag) completely invisible.

**NIP-11:** Best result — generates full nested types (Fees, Limitation, Retention) because it's a regular object schema.

**Tag schemas:** Complete failure. `["amount", "<digits>"]` → `string[]`. Zod output for tags is literally just `import * as z from "zod";` — empty.

**Filter:** `patternProperties` for `#e`/`#p` tag filters completely lost.

| Feature | Preserved? |
|---|---|
| Field names & types | YES |
| Required/optional | YES |
| Descriptions | YES |
| Nested objects | YES (NIP-11) |
| `pattern` (regex) | **NO** |
| `const` values | **NO** |
| Tuple `items` | **NO** |
| `contains` | **NO** |
| `if/then` | **NO** |
| `additionalItems` | **NO** |
| `patternProperties` | **NO** |

**Verdict:** quicktype is a shape generator, not a validator generator. Output is equivalent to hand-writing `{ id: string, pubkey: string, tags: string[][] }`.

### typify v0.6.1 (Rust, Oxide Computer)

Tested against 19 representative schemas from the compiled `dist/` output.

| Schema | Result | Failure Mode |
|--------|--------|-------------|
| kind-0 (metadata) | OK | — |
| kind-1 (text note) | OK | — |
| kind-3 (contacts) | **FAIL** | Panic (`unwrap()` on `None`) |
| kind-4 (DM) | **FAIL** | "unhandled array validation" |
| kind-5 (delete) | **FAIL** | "unhandled array validation" |
| kind-6 (repost) | **FAIL** | Tag constraints |
| kind-7 (reaction) | **FAIL** | Tag constraints |
| kind-40 (channel) | OK | — |
| kind-1059 (gift wrap) | OK | — |
| kind-5000 (DVM) | OK | — |
| kind-9734 (zap) | **FAIL** | Panic |
| kind-10002 (relay list) | **FAIL** | "unhandled array validation" |
| ...14 others | **FAIL** | Various |

**Pass rate: 5/19 (26%)** — only the simplest schemas (no tag constraints) succeed.

**Two failure modes:**
1. **Panic** at `type_entry.rs:290` — triggered by `items`-as-array (tuple) inside `allOf` compositions. typify hits `unwrap()` on `None` instead of returning a graceful error.
2. **"Unhandled array validation"** — triggered by the `contains` keyword. typify has zero support for `contains`.

**What works well:** String patterns get newtype wrappers with runtime regex validation:
```rust
#[derive(Serialize, Clone, Debug)]
#[serde(transparent)]
pub struct Kind1Id(String);

impl FromStr for Kind1Id {
    fn from_str(value: &str) -> Result<Self, ConversionError> {
        static PATTERN: LazyLock<regress::Regex> =
            LazyLock::new(|| regress::Regex::new("^[a-f0-9]{64}$").unwrap());
        if PATTERN.find(value).is_none() {
            return Err("doesn't match pattern".into());
        }
        Ok(Self(value.to_string()))
    }
}
```

**What doesn't:** Tags are always `Vec<Vec<String>>` — identical to hand-written types. No type deduplication across schemas (`Kind1Id` and `Kind1Pubkey` share the same `^[a-f0-9]{64}$` pattern but get separate newtypes).

**Verdict:** typify has theoretical tuple support but crashes on schemata's real schemas. The 5 passing schemas produce structurally identical types differing only in the `kind` constant — no different from hand-writing a generic `NostrEvent` struct.

### datamodel-code-generator v0.45.0 (Python/Pydantic)

Tested against 10 representative schemas using Pydantic v2 BaseModel output.

**kind-0 / kind-1 Pydantic output:**
```python
class Id(BaseModel):
    pass  # allOf chain collapsed — hex64 pattern LOST

class Pubkey(BaseModel):
    pass  # allOf chain collapsed — hex64 pattern LOST

class Tag(BaseModel):
    pass  # tuple structure LOST

class Kind0(BaseModel):
    content: str = Field(..., description='The content of the note')
    created_at: int = Field(...)
    id: Id  # should be constr(pattern='^[a-f0-9]{64}$')
    kind: int  # const: 0 LOST
    pubkey: Pubkey  # should be constr(pattern='^[a-f0-9]{64}$')
    sig: constr(pattern=r'^[a-f0-9]{128}$')  # this one survives
    tags: List[Tag]
```

**Critical bug — nested `allOf` collapse:** Schemata uses `allOf: [allOf: [{type: string, pattern: ...}]]` for shared `$ref` definitions (id, pubkey). The tool cannot resolve these nested chains and emits empty models (`class Id: pass`, `class Pubkey: pass`). This destroys hex64 pattern validation on the two most important fields.

**`const` universally ignored:** Every kind schema uses `const: N` to lock the kind field. All dropped — kind-0 and kind-1 generate identical models that accept any integer.

**Tag schemas produce empty output:** Tag schemas are root-level arrays with positional `items`. The tool cannot represent these as Pydantic models at all:
```python
# e-tag and amount-tag both produce:
class Model(BaseModel):
    pass
```

**NIP-11 — best result:** Standard object schema without heavy composition produced genuinely useful code with correct types, nested structures (Limitation, Fees), `constr(pattern=...)` for URLs, `ConfigDict(extra='forbid')` for `additionalProperties: false`, and `Union[constr, constr]` for `anyOf`. Lost: `if/then` conditionals, pubkey hex pattern (same nested allOf issue), `number` mapped to `float` instead of `int`.

**Filter — good result:** Preserved hex64 patterns via `constr(pattern=...)`, `conint(ge=...)` for minimums, all descriptions. Lost: `patternProperties` for dynamic `#e`/`#p` keys.

| Schema | Status | Key Losses |
|--------|--------|------------|
| kind-0/1 (simple event) | Partial (~30%) | `const`, id/pubkey patterns (allOf collapse), tag structure |
| kind-3 (contacts) | Partial (~20%) | All of above + p-tag tuple constraints |
| kind-9734 (zap) | Partial (~20%) | All of above + `contains` (relays/p tag requirements) |
| kind-5 (deletion) | Partial (~20%) | All of above + `contains`, `enum` on tag positions |
| kind-10002 (relay list) | Partial (~20%) | All of above + r-tag tuple, min/maxItems |
| NIP-11 | Good (~75%) | pubkey pattern, `if/then`, number→float |
| e-tag | **Failed** (0%) | Everything (array root type → empty model) |
| amount-tag | **Failed** (0%) | Everything (array root type → empty model) |
| filter | Good (~70%) | `patternProperties` for `#`-tags |

**Verdict:** Works well for flat object schemas (NIP-11, filter) at ~70-75% fidelity. Event schemas lose ~70-80% of validation semantics due to nested `allOf` collapse and missing `const`/`contains` support. Tag schemas produce zero useful output. Dataclass output mode loses even more (no `constr`, no descriptions).

### Zod 4.3.6 (TypeScript)

Tested `z.fromJSONSchema()` against 7 representative schemas. Also tested `json-schema-to-zod` 2.7.0 as an alternative.

**amount-tag — the one success:**
```typescript
// z.fromJSONSchema() produces:
z.intersection(
  z.array(z.string()),
  z.tuple([z.literal("amount"), z.string().regex(/^[0-9]+$/)])
)
// ✅ Valid ["amount", "21000"] → pass
// ✅ Invalid ["amount", "abc"] → fail
// ✅ Extra items ["amount", "21000", "x"] → fail
// ✅ Wrong prefix ["amt", "21000"] → fail
```

**kind-1 — mostly works but leaks:**
```typescript
// Valid event → pass ✅
// Bad hex id → fail ✅ (pattern enforced)
// Wrong kind → fail ✅ (const enforced)
// Extra unknown field → pass ❌ (additionalProperties: false LOST through nested allOf)
```

**kind-9734 (zap) — dangerously permissive:**
```typescript
// Valid zap request → pass ✅
// Missing required relays tag → pass ❌ (contains SILENTLY IGNORED)
// Missing required p tag → pass ❌ (contains SILENTLY IGNORED)
```

**kind-3 (contacts) — false negatives:**
```typescript
// Valid ["p", hex64] tags → fail ❌
// Error: "tags.0.2: Invalid input: expected string, received undefined"
// Cause: minItems: 2 means petname (position 2) is optional,
//        but Zod treats ALL tuple positions as required
```

**NIP-11 — crashes:**
```
Error: Conditional schemas (if/then/else) are not supported
```

**e-tag — silently broken:**
```typescript
// z.fromJSONSchema() produces: z.array(z.string())
// Schema uses allOf + oneOf at same level
// Zod processes allOf (→ array<string>) and COMPLETELY IGNORES oneOf
// Result: accepts anything — wrong prefix, bad hex, wrong markers, too many items
```

| Feature | Schemata Usage | Zod 4 Support | Behavior |
|---------|---------------|---------------|----------|
| `allOf` (object merge) | Heavy, nested | YES | Works for object shapes |
| `const` | Kind values, tag prefixes | YES | Correctly enforced |
| `pattern` | Hex, URLs | YES | Works including complex regex |
| `required` | All events | YES | Works |
| `additionalProperties: false` | Events | PARTIAL | Lost through nested `allOf` |
| `additionalItems: false` | Tag tuples | PARTIAL | Converted to `maxItems`, works for fixed-size |
| `oneOf` alongside `allOf` | e-tag variants | **NO** | **`oneOf` completely dropped** |
| `if/then/else` | NIP-11 | **NO** | **Hard crash** |
| `contains` | Required tags | **NO** | **Silently ignored** |
| `patternProperties` | Filter `#`-tags | **NO** | **Silently ignored** |
| Optional trailing items | p-tag petname | **NO** | All positions treated as required |

**`json-schema-to-zod` 2.7.0** (alternative, generates Zod source code strings): slightly better at `additionalProperties` (generates `.strict()`) but equally bad at composition keywords. NIP-11 doesn't crash but skips `if/then` entirely. e-tag collapses to `z.array(z.string())` — even worse than native.

**Verdict:** Dangerously permissive for real-world use. `contains` silently ignored means required tags aren't enforced. `oneOf` dropped means tag variant validation is gone. `if/then` crashes. Only simple fixed-length tuple tags (like amount) work correctly. The silent failures are worse than explicit crashes — code appears to work but accepts invalid data.

---

## 3. Generator Ecosystem Summary

| Tool | Languages | Tuple Support | `contains` | `if/then` | `pattern` | Schemata Result |
|---|---|---|---|---|---|---|
| **quicktype** | 15+ | **NO** ([#1172](https://github.com/glideapps/quicktype/issues/1172), open since 2019) | NO | NO | NO | Tags → `string[][]`, shape only |
| **typify** | Rust | YES (simple), crashes on schemata | NO | NO | YES (newtypes) | 5/19 pass (26%), panics on tag constraints |
| **datamodel-code-generator** | Python | YES (fixed-length), empty on array roots | NO | NO | YES (Pydantic `constr`) | Events ~20-30%, NIP-11 ~75%, tags 0% |
| **Zod 4 `fromJSONSchema`** | TypeScript | YES (fixed-length only) | **NO** (silent) | **NO** (crash) | YES | Amount tag works, rest broken or permissive |
| **json-schema-to-zod** | TypeScript | YES (fixed-length only) | **NO** (silent) | NO (skipped) | YES | Slightly better `additionalProperties`, same gaps |
| **OpenAPI Generator** | 40+ | **NO** ([crashes](https://github.com/OpenAPITools/openapi-generator/issues/18911)) | NO | NO | Partial | Not tested (known issues) |
| **jsonschema2pojo** | Java | **NO** ([#296](https://github.com/joelittlejohn/jsonschema2pojo/issues/296), open since 2015) | NO | NO | YES (JSR-303) | Not tested (no tuple support) |

---

## 4. The Fundamental Blockers

### `contains` has no type-level equivalent
"Tags must include at least one p-tag" is an existential quantifier. No type system can express "this `Vec` contains at least one element matching schema X." It's inherently a runtime check.

### `if/then` conditionals are runtime-only
"If a tag named X exists, validate it against schema Y" requires runtime inspection of array contents. Cannot be encoded in static types.

### Deeply nested `allOf` chains break every generator differently
Schemata's `$ref` resolution produces 3-4 levels of `allOf` nesting. Each tool fails in its own way: typify panics, quicktype silently flattens, datamodel-codegen collapses to empty models, and Zod loses `additionalProperties` enforcement. When `oneOf` appears alongside `allOf` (e-tag variants), Zod drops `oneOf` entirely.

### The core tension
Tags are `string[]` at the JSON level but typed tuples at the schema level. Generators that output `Vec<Vec<String>>` are technically correct but semantically useless. Generators that try to output typed tag enums need to handle `contains`, `oneOf`, and `additionalItems` together — and none do.

---

## 5. Chosen Path: schemata-codegen

Every generator above fails on the same three features: `contains`, `if/then`, and deeply nested `allOf` with tuple `items`. These aren't edge cases — they encode the core semantics of nostr events (which tags are required, how each tag is structured, conditional validation). No amount of schema simplification can recover them because they have no static type-level equivalent. They require runtime code generation.

[schemata-codegen](https://github.com/nostrability/schemata-codegen) is a custom nostr-aware generator that reads schemata's compiled `dist/` schemas and produces typed TypeScript. Instead of generically parsing JSON Schema, it pattern-matches against the five tag structural patterns and five kind constraint patterns documented above, and fails loudly on anything unrecognized.

### What it generates

| Output | Coverage | What the generic generators couldn't do |
|--------|----------|----------------------------------------|
| **Tag tuple types** (`tags.d.ts`) | 156/156 tags (100%) | Typed positional tuples for all 5 patterns — fixed, optional trailing, open-tail, discriminated union, structured metadata. No `string[]` fallbacks. |
| **Kind event interfaces** (`kinds.d.ts`) | 177/177 kinds (100%) | Literal `kind` discriminant per interface, `NostrEvent` discriminated union, `KNOWN_KINDS` mapping. |
| **Runtime validators** (`validators.ts`) | 132 kind validators, 3 tag validators | `contains` → existence checks. `if/then` → per-item and array-level conditionals. `anyOf` → optional-but-constrained and any-of-group patterns. `additionalItems: false` → maxItems inference. Optional position constraints (enum, pattern) validated. |
| **AJV-ready schemas** (`ajv-schemas/`) | 177 schemas | Pre-stripped `$schema`, `$id`, `errorMessage` — load directly into `ajv.compile()`. |
| **Kind registry** (`kind-registry.ts`) | 177 kinds | Human-readable names, NIP, required tags, category. |
| **Error messages** (`error-messages.ts`) | 175 kinds | Extracted from schema `errorMessage` fields. |

### How it addresses the fundamental blockers

**`contains` has no type-level equivalent** — Correct. schemata-codegen generates runtime `tags.some(t => ...)` existence checks instead of trying to encode existential quantifiers in the type system. The type layer (`kinds.d.ts`) documents required tags in JSDoc; the runtime layer (`validators.ts`) enforces them.

**`if/then` conditionals are runtime-only** — Correct. schemata-codegen extracts per-item conditionals ("if tag[0] === X, validate against schema Y") and array-level conditionals ("if tags contain X, then must also contain Y") and emits them as runtime loops with inline checks.

**Deeply nested `allOf` chains** — schemata-codegen recursively unwraps allOf chains (3-5 levels deep) to find the structural layer, instead of trying to merge them generically. This is why typify panics, datamodel-codegen collapses to empty models, and Zod loses `additionalProperties` — they all attempt generic allOf merging and fail on schemata's specific nesting patterns.

### Zero dependencies

The generated `validators.ts` is plain TypeScript — no AJV, no Zod, no runtime schema processing. Works in any environment that runs JavaScript. The validators are ~2200 lines of generated `if`/`for`/`some` checks that a bundler can tree-shake per kind.
