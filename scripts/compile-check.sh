#!/usr/bin/env bash
#
# Cross-language compile check for schemata-codegen generated validators.
#
# Generates all validator output files, then attempts to compile/syntax-check
# each language. Skips languages whose compilers are not installed.
#
# Usage:
#   ./scripts/compile-check.sh [--schemas <path>]
#
# Defaults to ../schemata/dist for schemas path.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Parse arguments
SCHEMAS_DIR=""
prev_arg=""
for arg in "$@"; do
  if [[ "$prev_arg" == "--schemas" ]]; then
    SCHEMAS_DIR="$arg"
  fi
  prev_arg="$arg"
done

if [[ -z "$SCHEMAS_DIR" ]]; then
  SCHEMAS_DIR="$PROJECT_DIR/../schemata/dist"
fi

if [[ ! -d "$SCHEMAS_DIR" ]]; then
  echo "ERROR: Schemas directory not found: $SCHEMAS_DIR"
  echo "Pass --schemas <path> or ensure ../schemata/dist exists."
  exit 1
fi

# Create temp directory for generated files
TMPDIR_GEN="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_GEN"' EXIT

echo "=== schemata-codegen cross-language compile check ==="
echo "Schemas: $SCHEMAS_DIR"
echo "Output:  $TMPDIR_GEN"
echo ""

# Always rebuild to avoid validating stale JS
echo "Building codegen..."
(cd "$PROJECT_DIR" && npm run build)

# Generate all output files into temp directory
echo "Generating all validator files..."
node "$PROJECT_DIR/dist/index.js" \
  --schemas "$SCHEMAS_DIR" \
  --out "$TMPDIR_GEN/tags.d.ts" \
  --kinds "$TMPDIR_GEN/kinds.d.ts" \
  --validators "$TMPDIR_GEN/validators.ts" \
  --registry "$TMPDIR_GEN/kind-registry.ts" \
  --errors "$TMPDIR_GEN/error-messages.ts" \
  --c-validators "$TMPDIR_GEN/validators.c" \
  --rust-validators "$TMPDIR_GEN/validators.rs" \
  --go-validators "$TMPDIR_GEN/validators.go" \
  --python-validators "$TMPDIR_GEN/validators.py" \
  --kotlin-validators "$TMPDIR_GEN/Validators.kt" \
  --java-validators "$TMPDIR_GEN/SchemataValidators.java" \
  --swift-validators "$TMPDIR_GEN/Validators.swift" \
  --dart-validators "$TMPDIR_GEN/validators.dart" \
  --php-validators "$TMPDIR_GEN/validators.php" \
  --csharp-validators "$TMPDIR_GEN/Validators.cs" \
  --cpp-validators "$TMPDIR_GEN/validators.hpp" \
  --ruby-validators "$TMPDIR_GEN/validators.rb"

echo ""
echo "--- Compile checks ---"
echo ""

PASS=0
FAIL=0
SKIP=0

check_result() {
  local lang="$1"
  local status="$2"
  local detail="${3:-}"
  if [[ "$status" == "pass" ]]; then
    echo "  PASS  $lang"
    PASS=$((PASS + 1))
  elif [[ "$status" == "skip" ]]; then
    echo "  SKIP  $lang ($detail)"
    SKIP=$((SKIP + 1))
  else
    echo "  FAIL  $lang"
    if [[ -n "$detail" ]]; then
      echo "$detail" | head -20 | sed 's/^/        /'
    fi
    FAIL=$((FAIL + 1))
  fi
}

# --- C ---
if command -v gcc >/dev/null 2>&1; then
  if gcc -fsyntax-only -std=c11 -I"$TMPDIR_GEN" "$TMPDIR_GEN/validators.c" 2>"$TMPDIR_GEN/c.err"; then
    check_result "C" "pass"
  else
    check_result "C" "fail" "$(cat "$TMPDIR_GEN/c.err")"
  fi
else
  check_result "C" "skip" "gcc not found"
fi

# --- C++ ---
if command -v g++ >/dev/null 2>&1; then
  if g++ -fsyntax-only -std=c++17 "$TMPDIR_GEN/validators.hpp" 2>"$TMPDIR_GEN/cpp.err"; then
    check_result "C++" "pass"
  else
    check_result "C++" "fail" "$(cat "$TMPDIR_GEN/cpp.err")"
  fi
else
  check_result "C++" "skip" "g++ not found"
fi

# --- Rust ---
# Generated code uses the `regex` crate, so we need a Cargo project.
if command -v cargo >/dev/null 2>&1; then
  RUST_TMPDIR="$(mktemp -d)"
  mkdir -p "$RUST_TMPDIR/src"
  cp "$TMPDIR_GEN/validators.rs" "$RUST_TMPDIR/src/lib.rs"
  cat > "$RUST_TMPDIR/Cargo.toml" << 'CARGO'
[package]
name = "schemata-check"
version = "0.0.0"
edition = "2021"

[dependencies]
regex = "1"
CARGO
  if (cd "$RUST_TMPDIR" && cargo check --quiet) 2>"$TMPDIR_GEN/rust.err"; then
    check_result "Rust" "pass"
  else
    check_result "Rust" "fail" "$(cat "$TMPDIR_GEN/rust.err")"
  fi
  rm -rf "$RUST_TMPDIR"
elif command -v rustc >/dev/null 2>&1; then
  check_result "Rust" "skip" "cargo not found (need cargo for regex dep)"
else
  check_result "Rust" "skip" "rustc/cargo not found"
fi

# --- Go ---
if command -v go >/dev/null 2>&1; then
  GO_TMPDIR="$(mktemp -d)"
  mkdir -p "$GO_TMPDIR/schemata"
  cp "$TMPDIR_GEN/validators.go" "$GO_TMPDIR/schemata/validators.go"
  (cd "$GO_TMPDIR" && go mod init schemata-check >/dev/null 2>&1)
  if (cd "$GO_TMPDIR" && go build ./schemata/...) 2>"$TMPDIR_GEN/go.err"; then
    check_result "Go" "pass"
  else
    check_result "Go" "fail" "$(cat "$TMPDIR_GEN/go.err")"
  fi
  rm -rf "$GO_TMPDIR"
else
  check_result "Go" "skip" "go not found"
fi

# --- Java ---
# Generated code uses `record` (Java 16+)
if command -v javac >/dev/null 2>&1; then
  if javac -source 16 -target 16 -d "$TMPDIR_GEN" "$TMPDIR_GEN/SchemataValidators.java" 2>"$TMPDIR_GEN/java.err"; then
    check_result "Java" "pass"
  else
    check_result "Java" "fail" "$(cat "$TMPDIR_GEN/java.err")"
  fi
else
  check_result "Java" "skip" "javac not found"
fi

# --- Kotlin ---
if command -v kotlinc >/dev/null 2>&1; then
  if kotlinc -nowarn -d "$TMPDIR_GEN/kotlin-out" "$TMPDIR_GEN/Validators.kt" 2>"$TMPDIR_GEN/kotlin.err"; then
    check_result "Kotlin" "pass"
  else
    check_result "Kotlin" "fail" "$(cat "$TMPDIR_GEN/kotlin.err")"
  fi
else
  check_result "Kotlin" "skip" "kotlinc not found"
fi

# --- C# (prefer dotnet for C# 9+ record support, fall back to mcs/csc) ---
if command -v dotnet >/dev/null 2>&1; then
  CSHARP_TMPDIR="$(mktemp -d)"
  cp "$TMPDIR_GEN/Validators.cs" "$CSHARP_TMPDIR/Validators.cs"
  cat > "$CSHARP_TMPDIR/check.csproj" << 'CSPROJ'
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <OutputType>Library</OutputType>
  </PropertyGroup>
</Project>
CSPROJ
  if (cd "$CSHARP_TMPDIR" && dotnet build -nologo -v quiet) 2>"$TMPDIR_GEN/csharp.err"; then
    check_result "C#" "pass"
  else
    check_result "C#" "fail" "$(cat "$TMPDIR_GEN/csharp.err")"
  fi
  rm -rf "$CSHARP_TMPDIR"
elif command -v mcs >/dev/null 2>&1; then
  if mcs -target:library -out:"$TMPDIR_GEN/Validators.dll" "$TMPDIR_GEN/Validators.cs" 2>"$TMPDIR_GEN/csharp.err"; then
    check_result "C#" "pass"
  else
    check_result "C#" "fail" "$(cat "$TMPDIR_GEN/csharp.err")"
  fi
elif command -v csc >/dev/null 2>&1; then
  if csc -target:library -out:"$TMPDIR_GEN/Validators.dll" "$TMPDIR_GEN/Validators.cs" 2>"$TMPDIR_GEN/csharp.err"; then
    check_result "C#" "pass"
  else
    check_result "C#" "fail" "$(cat "$TMPDIR_GEN/csharp.err")"
  fi
else
  check_result "C#" "skip" "dotnet/mcs/csc not found"
fi

# --- Swift ---
if command -v swiftc >/dev/null 2>&1; then
  if swiftc -parse "$TMPDIR_GEN/Validators.swift" 2>"$TMPDIR_GEN/swift.err"; then
    check_result "Swift" "pass"
  else
    check_result "Swift" "fail" "$(cat "$TMPDIR_GEN/swift.err")"
  fi
else
  check_result "Swift" "skip" "swiftc not found"
fi

# --- Dart ---
if command -v dart >/dev/null 2>&1; then
  DART_TMPDIR="$(mktemp -d)"
  mkdir -p "$DART_TMPDIR/lib"
  cp "$TMPDIR_GEN/validators.dart" "$DART_TMPDIR/lib/validators.dart"
  cat > "$DART_TMPDIR/pubspec.yaml" << 'PUBSPEC'
name: schemata_check
environment:
  sdk: ">=3.0.0 <4.0.0"
PUBSPEC
  cat > "$DART_TMPDIR/analysis_options.yaml" << 'ANALYSIS'
analyzer:
  errors:
    unused_local_variable: ignore
ANALYSIS
  if (cd "$DART_TMPDIR" && dart analyze --fatal-warnings lib/validators.dart) 2>"$TMPDIR_GEN/dart.err"; then
    check_result "Dart" "pass"
  else
    check_result "Dart" "fail" "$(cat "$TMPDIR_GEN/dart.err")"
  fi
  rm -rf "$DART_TMPDIR"
else
  check_result "Dart" "skip" "dart not found"
fi

# --- Python ---
if command -v python3 >/dev/null 2>&1; then
  if python3 -c "import py_compile; py_compile.compile('$TMPDIR_GEN/validators.py', doraise=True)" 2>"$TMPDIR_GEN/python.err"; then
    check_result "Python" "pass"
  else
    check_result "Python" "fail" "$(cat "$TMPDIR_GEN/python.err")"
  fi
else
  check_result "Python" "skip" "python3 not found"
fi

# --- Ruby ---
if command -v ruby >/dev/null 2>&1; then
  if ruby -c "$TMPDIR_GEN/validators.rb" 2>"$TMPDIR_GEN/ruby.err" >/dev/null; then
    check_result "Ruby" "pass"
  else
    check_result "Ruby" "fail" "$(cat "$TMPDIR_GEN/ruby.err")"
  fi
else
  check_result "Ruby" "skip" "ruby not found"
fi

# --- PHP ---
if command -v php >/dev/null 2>&1; then
  if php -l "$TMPDIR_GEN/validators.php" 2>"$TMPDIR_GEN/php.err" >/dev/null; then
    check_result "PHP" "pass"
  else
    check_result "PHP" "fail" "$(cat "$TMPDIR_GEN/php.err")"
  fi
else
  check_result "PHP" "skip" "php not found"
fi

# --- TypeScript ---
if command -v npx >/dev/null 2>&1; then
  if npx tsc --strict --noEmit --target ES2022 --module Node16 --moduleResolution Node16 \
       "$TMPDIR_GEN/validators.ts" 2>"$TMPDIR_GEN/ts.err"; then
    check_result "TypeScript" "pass"
  else
    check_result "TypeScript" "fail" "$(cat "$TMPDIR_GEN/ts.err")"
  fi
else
  check_result "TypeScript" "skip" "npx not found"
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed, $SKIP skipped ==="

if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
