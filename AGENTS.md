# AGENTS.md — READ THIS BEFORE MAKING CHANGES

## Repository Overview

Code generator that reads [schemata](https://github.com/nostrability/schemata)'s compiled JSON schemas (`dist/`) and produces typed code for 13 languages. Zero runtime dependencies — Node builtins only.

**This repo does NOT define schemas.** Schema authoring rules live in [schemata/AGENTS.md](https://github.com/nostrability/schemata/blob/master/AGENTS.md). This repo consumes `dist/*.json` as read-only input.

## Architecture

### Pipeline

```text
schemata dist/*.json
    ↓
extract-tag.ts / extract-kind.ts    → TagShape[] / KindShape[]
    ↓
classify-pattern.ts                  → PatternCheck intermediate representation (regex → native ops)
    ↓
plan-validators.ts / plan-builders.ts → ValidatorAction[] / BuilderAction[]
    ↓
emit-*.ts (12 languages + TS)       → source files (.ts, .c, .rs, .go, ...)
```

### Key abstractions

| Abstraction | File | Purpose |
|---|---|---|
| `PatternCheck` | `classify-pattern.ts` | Language-independent intermediate representation for regex patterns (40+ ops including hex, all_digits, starts_with_any, chars_in, bech32, relay_url, a_tag, datetime_iso, content_type, external_identity, base64, nip05_identifier, prefix_delim_rest, etc.) |
| `ValidatorAction` | `plan-validators.ts` | Language-independent validation step (require_tag, check_pattern, etc.) |
| `BuilderAction` | `plan-builders.ts` | Language-independent tag construction step |
| `KindShape` | `kind-types.ts` | Extracted kind metadata (kind number, NIP spec reference, tag constraints) |
| `TagShape` | `patterns.ts` | Extracted tag metadata (positions, types, constraints) |

### Language emitters

Each language has its own `emit-*.ts` file that renders `ValidatorAction[]` into idiomatic code:

| File | Language | Helper naming |
|---|---|---|
| `emit-c.ts` | C | `schemata_check_*` |
| `emit-rust.ts` | Rust | `check_*` |
| `emit-cpp.ts` | C++ | `check_*` |
| `emit-csharp.ts` | C# | `Check*` (PascalCase) |
| `emit-go.ts` | Go | `check*` (camelCase) |
| `emit-java.ts` | Java | `check*` (camelCase) |
| `emit-kotlin.ts` | Kotlin | `check*` (camelCase) |
| `emit-swift.ts` | Swift | `check*` (camelCase) |
| `emit-dart.ts` | Dart | `_check*` (private) |
| `emit-python.ts` | Python | `_check_*` (private) |
| `emit-php.ts` | PHP | `schemata_check_*` |
| `emit-ruby.ts` | Ruby | `check_*` |
| `emit-validators.ts` | TypeScript | Uses regex directly (no PatternCheck rendering) |

## Critical Rules — MUST follow

### 1. NEVER update only some emitters — ALL 12 language emitters MUST stay in sync

Every `renderPatternCheck*()` function has a `switch (check.op)` that MUST handle all `PatternCheck` ops. When adding a new op, you MUST complete ALL of these steps:

1. Add the op to the `PatternCheck` type union in `classify-pattern.ts`
2. Add classification logic in `classifyRegex()`
3. Add `case` to `isNativeCheck()` (return `true` if no regex needed)
4. Add `case` to `renderPatternCheck*()` in **ALL 12** emit files
5. Add helper implementation in **ALL 12** `emit*Helpers()` functions
6. Add tests in `classify-pattern.test.ts`

**Past incident (bech32):** The `bech32` op was added to all 12 `renderPatternCheck*()` functions but helper implementations were only added to 2 (C, Rust). The other 10 emitted calls to undefined functions → generated code failed to compile in 10 languages. No test caught this.

**Past incident (a_tag/content_type):** The `a_tag` op added an unconditional leading-zero rejection (`kindLen > 1 && kindStr[0] == '0'`) that is correct for fixed-kind patterns but WRONG for the generic `^\d+:...` pattern which accepts `01:<hex>:x`. Similarly, the `content_type` op narrowed `\s*` to just ASCII space/tab, but the schema regex uses ECMAScript `\s` which matches 23 codepoints including `\u00A0`, `\n`, etc. Both bugs affected ALL 12 emitters simultaneously because agents copied the same incorrect pattern to each file.

**Past incident (relay_url):** The `relay_url` op translated `(?:/.*)?$` as "if slash, accept remainder" — but regex `.` does not match `\n`/`\r`, so `wss://relay.example.com/\npath` passed the native check but failed the regex. Also: the C helper read `s[0]..s[5]` without a length guard (unsafe on short non-null-terminated buffers), and the Python helper used `str.isdigit()` which accepts Unicode numerals instead of ASCII-only `[0-9]`. All three bugs were caught in review, not by tests, because the equivalence test only used well-formed URLs.

**Past incident (prefix_delim_rest):** The `prefix_delim_rest` op (for `^[0-9]+:.+` and similar unanchored patterns) checked "at least 1 char after delimiter" but never verified the first char wasn't a line terminator — so `"123:\n"` passed the native check but failed the regex. The bug was copied identically into all 12 emitters. The fuzz-equivalence test ALSO encoded the same broken logic as its oracle (checking `s.length > i` instead of comparing against the regex), AND its seeded inputs (`'123:hello', '0:x', '', '123:', 'abc:def'`) never included `\n`, `\r`, `\u2028`, or `\u2029`, so it could not detect the regression.

### 2. EVERY `helpers.add()` MUST have a matching `emit*Helpers()` implementation

In each emitter:
1. `renderPatternCheck*()` calls `helpers.add('helperName')` and returns an expression referencing it
2. `emit*Helpers()` checks `if (helpers.has('helperName'))` and emits the function body

If step 1 exists without step 2, generated code will reference undefined functions. There is NO automated check for this.

### 3. Changes to the planner affect ALL languages simultaneously

`plan-validators.ts` produces `ValidatorAction[]` consumed by all emitters. Changing action types or semantics affects 12+ languages. ALWAYS test with `--all` after planner changes.

### 4. ALWAYS export public functions

Any function used by test files or other modules MUST be `export`ed. A missing `export` on `emitTupleType` once caused 4 test files to cascade-fail.

### 5. Schema extraction MUST use recursive unwrap, not fixed depth

Schemata uses `allOf` nesting 3-5 levels deep. Extraction code (`extract-kind.ts`, `extract-tag.ts`) MUST recursively unwrap. NEVER assume a fixed depth.

## Anti-patterns

### NEVER:

- **NEVER assume helpers exist** — adding a `case` in `renderPatternCheck*()` is NOT enough; you MUST also add the helper body in `emit*Helpers()`
- **NEVER update only some emitters** — if you touch `renderPatternCheck*()` in one emitter, you MUST touch all 12
- **NEVER use bare leaf keywords for AJV (JSON Schema validator) error enrichment** — keywords like `pattern`, `items`, `contains` collide with unrelated schema paths; only match path-like keywords containing `properties` (e.g., `allOf[1].properties.kind`)
- **NEVER double-collect tag constraints** — `unwrapTagSchema` already merges `structural.allOf` contains into `extraAllOf`
- **NEVER skip constrained optional positions in validation** — `emitTagMatcher` skips optional positions for existence checks, but constrained optional positions need a separate `validate_optional_positions` action
- **NEVER flatten anyOf groups** — `collectKindTags()` flattens anyOf groups into individual entries; the planner MUST consult `shape.anyOfTagGroups` directly to preserve group semantics
- **NEVER treat regex `.` as "any character"** — `.` excludes line terminators. Each emitter must match its **target language's regex engine**, not a uniform set. A native shortcut like "if slash, accept remainder" or "check `i < s.length`" silently widens the accepted set.
  - **`checkDotTail`** is for **non-empty** tails (`.+$`) — it requires `pos < len` and scans ALL remaining chars. For **`.*$`** (zero-or-more), callers must add `|| pos == len` to accept the empty-tail case before delegating to `checkDotTail`.
  - **`prefix_delim_rest`** (unanchored `.+`, no `$`) — only the FIRST character after the delimiter matters. `.+` greedily matches non-terminator chars; since there's no `$`, later terminators don't prevent the match (e.g., `"123:a\nb"` matches `^[0-9]+:.+` because `.+` matches `"a"`).
  - **Both helpers must reject the same terminator set** within each emitter:
    - C, Rust, Go, PHP: `\n` only
    - C++: `\n`, `\r`
    - C#, Python, Ruby: `\n` only
    - Dart: `\n`, `\r`, `\u2028`, `\u2029`
    - Java, Kotlin: `\n`, `\r`, `\u0085`, `\u2028`, `\u2029`
    - Swift: `\n`, `\r`, `\u0085` (NEL), `\u2028`, `\u2029` (byte-level: `0xC2 0x85`, `0xE2 0x80 0xA8/0xA9`)
- **NEVER use the native implementation as the fuzz-test oracle** — the `buildNativeChecker` in `fuzz-equivalence.test.ts` MUST compare against the actual regex (`new RegExp(pattern)`), not a reimplementation of the native check. If the oracle encodes the same bug as the implementation (as happened with `prefix_delim_rest`), the test can never detect the regression. Seeded inputs MUST include adversarial line terminators (`\n`, `\r`, `\u2028`, `\u2029`) for any op that deals with `.`/`.+`/`.*`.
- **NEVER use locale-dependent stdlib functions for ASCII pattern checks** — `str.isdigit()` (Python), `ctype_alnum()` (PHP), `Character.isLetter` (Swift), `=~` (Ruby) all accept Unicode beyond ASCII. Always use explicit range checks: `'0' <= c <= '9'`, `c >= 'a' && c <= 'z'`, etc.
- **NEVER skip bounds checking in C helpers** — even with `&&` short-circuit, callers may pass non-null-terminated buffers. Always `strlen()` or `strncmp()` before indexed access like `s[0]..s[5]`.
- **NEVER add runtime dependencies** — zero dependencies (Node builtins only)
- **NEVER narrow `\s` to ASCII space/tab** — ECMAScript `\s` matches 23 codepoints (space, tab, `\n`, `\r`, `\v`, `\f`, `\u00A0`, `\u1680`, `\u2000`–`\u200A`, `\u2028`, `\u2029`, `\u202F`, `\u205F`, `\u3000`, `\uFEFF`). When a schema regex uses `\s*` (e.g., content_type OWS around semicolons), native helpers MUST use the full set via the per-emitter `isEcmaWs` helper — not just `' '||'\t'`.
- **NEVER add unconditional constraints that only apply in filtered mode** — Example: `checkATag` validates `^\d+:[a-f0-9]{64}:.+$`. A leading-zero rejection is correct when comparing against a specific kind string (`"030311" !== "30311"`), but `\d+` itself accepts leading zeros. The check must only fire when a `kinds` filter is active — or not at all, since string equality already handles it.
- **NEVER skip the minimum-count check on optional group bodies** — Regex `(\.\d+)?` means: IF the dot is present, 1+ digits MUST follow. When translating to native code, consuming the dot and running a digit loop is not enough — you MUST verify at least one digit was consumed (save position before loop, compare after). This applies to any optional group with an internal `+` or `{n,}` quantifier.

### ALWAYS:

- **ALWAYS follow existing helper naming conventions** per language (see emitter table above)
- **ALWAYS test with `--all` flag** to generate all languages and catch cross-language regressions
- **ALWAYS run `npm test`** — 910+ tests covering extraction, emission, compilation, fuzz equivalence, and runtime validation
- **ALWAYS check `isNativeCheck()`** returns `true` for any new op that doesn't need regex fallback
- **Use `--dump-plan`** to inspect the `ValidatorAction[]` plan when debugging validator output

## Common Tasks

### Adding a new PatternCheck op

1. Add the op type to the `PatternCheck` union in `classify-pattern.ts`
2. Add detection logic in `classifyRegex()` — order matters (check before regex fallback)
3. Update `isNativeCheck()` to return `true`
4. For each of the 12 `emit-*.ts` files:
   - Add `case '<op>':` to `renderPatternCheck*()`
   - Add `helpers.add('<helperName>')` with appropriate naming
   - Add `if (helpers.has('<helperName>'))` block in `emit*Helpers()` with the implementation
5. Add tests in `classify-pattern.test.ts`:
   - Classification test (pattern → expected op)
   - Add pattern to the coverage array
   - TypeScript reference implementation of the native algorithm
   - **Regex-vs-native equivalence test with adversarial inputs** — include empty strings, 1-char strings, embedded `\n`/`\r`, Unicode where ASCII is expected, strings that exercise every metacharacter edge case (`.` vs newlines, `$` anchoring, character class boundaries). Well-formed happy-path inputs alone are insufficient.
   - **Test BOTH filtered and unfiltered modes** for ops that accept optional constraints (e.g., `a_tag` with and without a `kinds` filter). Include inputs like leading zeros that are valid unfiltered but invalid filtered.
   - **Anchor test regex to match validator semantics** — generated validators check full strings (implicitly end-anchored). Test reference regexes MUST include `$` or the equivalence comparison will miss cases where unanchored regex accepts a prefix but native code rejects.
6. Run `npm test` and `--all` to verify

### Adding a new language emitter

1. Create `src/emit-<lang>.ts` following the pattern of existing emitters
2. Implement: `renderPatternCheck<Lang>()`, `renderValueCheck<Lang>()`, `renderTagMatcher<Lang>()`, `emitKindFunction<Lang>()`, `emit<Lang>Helpers()`, `emit<Lang>File()`
3. Handle ALL `PatternCheck` ops in `renderPatternCheck<Lang>()`
4. Handle ALL `ValidatorAction` types in `emitKindFunction<Lang>()`
5. Add CLI flag in `src/index.ts`
6. Add test file `tests/emit-<lang>.test.ts`
7. Typical size: ~260 lines for `renderPatternCheck` + `emit*Helpers` + CLI glue

### Debugging validator output

```bash
# Generate ALL languages at once (use after planner changes)
node dist/index.js --schemas ../schemata/dist --all

# Dump the action plan for inspection
node dist/index.js --schemas ../schemata/dist --dump-plan > plan.json

# Generate a specific language to inspect
node dist/index.js --schemas ../schemata/dist --go-validators validators.go
```

## Testing

```bash
npm run build    # TypeScript → dist/
npm test         # Run all tests (910+ pass)
```

Test structure:
- `classify-pattern.test.ts` — PatternCheck classification from regex strings
- `extract-tag.test.ts` / `extract-kind.test.ts` — schema extraction
- `plan-validators.test.ts` — action planning
- `emit-*.test.ts` — per-language output verification
- `validators-runtime.test.ts` — generated TS validators executed against sample data
- `fuzz-equivalence.test.ts` — property-based regex-vs-native equivalence testing with adversarial inputs
- `compile-check.test.ts` — TypeScript compilation of generated outputs


## File Map

```text
schemata-codegen/
├── src/
│   ├── index.ts                # CLI entry point
│   ├── classify-pattern.ts     # Regex → PatternCheck intermediate representation
│   ├── patterns.ts             # TagShape extraction
│   ├── extract-tag.ts          # Tag schema → TagShape
│   ├── extract-kind.ts         # Kind schema → KindShape
│   ├── kind-types.ts           # KindShape type definition
│   ├── plan-validators.ts      # KindShape → ValidatorAction[]
│   ├── plan-builders.ts        # KindShape → BuilderAction[]
│   ├── emit-typescript.ts      # Tags/kinds type emission
│   ├── emit-kind.ts            # Kind interface emission
│   ├── emit-validators.ts      # TypeScript validators (uses regex directly)
│   ├── emit-builders.ts        # TypeScript builder functions
│   ├── emit-c.ts               # C validators (nostrdb API support)
│   ├── emit-rust.ts            # Rust validators (nostr/nostrdb API support)
│   ├── emit-cpp.ts             # C++ validators (header-only)
│   ├── emit-go.ts              # Go validators
│   ├── emit-java.ts            # Java validators
│   ├── emit-kotlin.ts          # Kotlin validators
│   ├── emit-swift.ts           # Swift validators
│   ├── emit-dart.ts            # Dart validators
│   ├── emit-python.ts          # Python validators
│   ├── emit-php.ts             # PHP validators
│   ├── emit-csharp.ts          # C# validators
│   ├── emit-ruby.ts            # Ruby validators
│   ├── emit-registry.ts        # Kind metadata registry
│   ├── emit-errors.ts          # Error message extraction
│   └── emit-ajv.ts             # AJV (JSON Schema validator) schema preprocessing
├── tests/                       # Node test runner (node --test)
├── dist/                        # Compiled JS (git-ignored)
└── AGENTS.md                    # This file
```
