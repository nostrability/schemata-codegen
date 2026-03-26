# schemata-codegen

Nostr-aware code generator that reads [schemata](https://github.com/nostrability/schemata)'s compiled JSON schemas and produces typed code. Currently generates TypeScript readonly tuple types for all 155 tag schemas.

## How it fits in the schemata ecosystem

| Repo | Role |
|---|---|
| [schemata](https://github.com/nostrability/schemata) | The schemas themselves (YAML source, compiled JSON dist/) |
| schemata-{rs,py,go,...} | Data packages — embed the compiled JSON for a given language |
| schemata-validator-{rs,py,go,...} | Runtime validators — pass/fail a JSON blob against a schema (AJV, jsonschema, etc.) |
| **schemata-codegen** | **Code generator — produces typed language constructs from the schemas** |

The data packages give you access to raw schemas. The validators tell you "is this event valid?" at runtime. The codegen gives you **types you can write code against** — so tags are typed tuples with known positions instead of `string[][]`.

## Why not use an existing JSON Schema code generator?

Every existing generator (quicktype, typify, datamodel-codegen, Zod 4) fails on schemata's schemas. The features that make schemata valuable — tag tuple structure via `items`-as-array, `contains`, `if/then`, `oneOf` + `allOf` composition — are exactly what every generator chokes on. See [findings.md](https://github.com/nostrability/schemata/blob/main/findings.md) for the full assessment.

schemata-codegen takes a different approach: instead of generically parsing JSON Schema, it pattern-matches against the specific structural shapes schemata uses and fails loudly on anything unrecognized.

## Usage

```bash
npm install
npm run build
npm run generate          # reads ../schemata/dist, writes tags.d.ts

# or point at a different dist/ location:
node dist/index.js --schemas /path/to/schemata/dist --out tags.d.ts
```

## What it generates (v0.1 — tag tuples)

155 tag schemas classified into 5 patterns:

```typescript
// fixed_tuple (95 tags) — exact length, typed positions
export type AmountTag = readonly ["amount", string];
export type EmojiTag = readonly ["emoji", string, string];

// optional_trailing (8 tags) — union of valid lengths
export type RTag =
  | readonly ["r", string]
  | readonly ["r", string, "read" | "write"];

// open_tail (46 tags) — typed prefix, rest string[]
export type TTag = readonly ["t", string, ...string[]];

// discriminated_union (2 tags) — oneOf with named variants
export type ETagVariant1 =
  | readonly ["e", string, string | "", "reply" | "root"]
  | readonly ["e", string, string | "", "reply" | "root", string];
export type ETagVariant2 =
  | readonly ["e", string]
  | readonly ["e", string, string];
export type ETag = ETagVariant1 | ETagVariant2;

// structured_metadata (4 tags) — open-tail with contains constraints
export type ImetaTag = readonly ["imeta", string, ...string[]];
// Runtime: must contain entries matching: ^url https?://\S+$, ^m (image/...)$
```

The generated `tags.d.ts` compiles clean under `tsc --strict --noEmit`. Zero silent fallbacks to `string[]`.

## Tests

```bash
npm test    # 19 tests — extraction, emission, tsc compilation, coverage
```

## Roadmap

- **v0.2**: Kind event interfaces with literal `kind` constants from `dist/nips/*/kind-*/schema.json`
- **v0.3**: Runtime tag validators generated from `contains` and `if/then` constraints
- **v0.4**: IR abstraction + second language target (when requested)
