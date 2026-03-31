import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = __dirname.includes('dist-tests')
  ? join(__dirname, '..', '..')
  : join(__dirname, '..');
const schemasDir = join(projectRoot, '..', 'schemata', 'dist');
const schemasAvailable = existsSync(join(schemasDir, '@', 'tag'));

/** Check if a command exists on PATH (cross-platform). */
function hasCommand(cmd: string): boolean {
  const result = spawnSync(cmd, ['--version'], { stdio: 'pipe', timeout: 5_000 });
  return result.error === undefined || (result.error as NodeJS.ErrnoException).code !== 'ENOENT';
}

/** Temp directory for generated files, lazily created once. */
let genDir: string | null = null;

function ensureGenerated(): string {
  if (genDir && existsSync(genDir)) return genDir;

  genDir = join(tmpdir(), `schemata-cross-lang-${Date.now()}`);
  mkdirSync(genDir, { recursive: true });

  execFileSync(process.execPath, [
    join(projectRoot, 'dist', 'index.js'),
    '--schemas', schemasDir,
    '--out', join(genDir, 'tags.d.ts'),
    '--kinds', join(genDir, 'kinds.d.ts'),
    '--validators', join(genDir, 'validators.ts'),
    '--c-validators', join(genDir, 'validators.c'),
    '--rust-validators', join(genDir, 'validators.rs'),
    '--go-validators', join(genDir, 'validators.go'),
    '--python-validators', join(genDir, 'validators.py'),
    '--kotlin-validators', join(genDir, 'Validators.kt'),
    '--java-validators', join(genDir, 'SchemataValidators.java'),
    '--swift-validators', join(genDir, 'Validators.swift'),
    '--dart-validators', join(genDir, 'validators.dart'),
    '--php-validators', join(genDir, 'validators.php'),
    '--csharp-validators', join(genDir, 'Validators.cs'),
    '--cpp-validators', join(genDir, 'validators.hpp'),
    '--ruby-validators', join(genDir, 'validators.rb'),
  ], { cwd: projectRoot, encoding: 'utf-8', timeout: 60_000 });

  return genDir;
}

describe('cross-language compile checks', () => {
  before(() => {
    if (!schemasAvailable) return;
    ensureGenerated();
  });

  // --- C ---
  it('C: gcc -fsyntax-only', () => {
    if (!schemasAvailable) { console.log('Skipping: schemas not available'); return; }
    if (!hasCommand('gcc')) { console.log('Skipping: gcc not found'); return; }
    const dir = ensureGenerated();
    execSync(`gcc -fsyntax-only -std=c11 -I"${dir}" "${join(dir, 'validators.c')}"`, {
      encoding: 'utf-8', stdio: 'pipe',
    });
  });

  // --- C++ ---
  it('C++: g++ -fsyntax-only', () => {
    if (!schemasAvailable) { console.log('Skipping: schemas not available'); return; }
    if (!hasCommand('g++')) { console.log('Skipping: g++ not found'); return; }
    const dir = ensureGenerated();
    execSync(`g++ -fsyntax-only -std=c++17 "${join(dir, 'validators.hpp')}"`, {
      encoding: 'utf-8', stdio: 'pipe',
    });
  });

  // --- Rust ---
  it('Rust: cargo check', () => {
    if (!schemasAvailable) { console.log('Skipping: schemas not available'); return; }
    if (!hasCommand('cargo')) { console.log('Skipping: cargo not found'); return; }
    const dir = ensureGenerated();
    const rustDir = join(dir, 'rust-project');
    mkdirSync(join(rustDir, 'src'), { recursive: true });
    writeFileSync(join(rustDir, 'Cargo.toml'), [
      '[package]',
      'name = "schemata-check"',
      'version = "0.0.0"',
      'edition = "2021"',
      '',
      '[dependencies]',
      'regex = "1"',
      '',
    ].join('\n'));
    copyFileSync(join(dir, 'validators.rs'), join(rustDir, 'src', 'lib.rs'));
    execSync('cargo check --quiet', {
      cwd: rustDir, encoding: 'utf-8', stdio: 'pipe', timeout: 120_000,
    });
  });

  // --- Go ---
  it('Go: go build', () => {
    if (!schemasAvailable) { console.log('Skipping: schemas not available'); return; }
    if (!hasCommand('go')) { console.log('Skipping: go not found'); return; }
    const dir = ensureGenerated();
    const goDir = join(dir, 'go-project');
    mkdirSync(join(goDir, 'schemata'), { recursive: true });
    copyFileSync(join(dir, 'validators.go'), join(goDir, 'schemata', 'validators.go'));
    execSync('go mod init schemata-check', {
      cwd: goDir, encoding: 'utf-8', stdio: 'pipe',
    });
    execSync('go build ./schemata/...', {
      cwd: goDir, encoding: 'utf-8', stdio: 'pipe',
    });
  });

  // --- Java ---
  it('Java: javac (Java 16+ for record)', () => {
    if (!schemasAvailable) { console.log('Skipping: schemas not available'); return; }
    if (!hasCommand('javac')) { console.log('Skipping: javac not found'); return; }
    const dir = ensureGenerated();
    execSync(`javac -source 16 -target 16 -d "${dir}" "${join(dir, 'SchemataValidators.java')}"`, {
      encoding: 'utf-8', stdio: 'pipe',
    });
  });

  // --- Kotlin ---
  it('Kotlin: kotlinc', () => {
    if (!schemasAvailable) { console.log('Skipping: schemas not available'); return; }
    if (!hasCommand('kotlinc')) { console.log('Skipping: kotlinc not found'); return; }
    const dir = ensureGenerated();
    const outDir = join(dir, 'kotlin-out');
    mkdirSync(outDir, { recursive: true });
    execSync(`kotlinc -nowarn -d "${outDir}" "${join(dir, 'Validators.kt')}"`, {
      encoding: 'utf-8', stdio: 'pipe', timeout: 120_000,
    });
  });

  // --- C# ---
  it('C#: dotnet build or mcs', () => {
    if (!schemasAvailable) { console.log('Skipping: schemas not available'); return; }
    const dir = ensureGenerated();
    if (hasCommand('dotnet')) {
      const csDir = join(dir, 'csharp-project');
      mkdirSync(csDir, { recursive: true });
      copyFileSync(join(dir, 'Validators.cs'), join(csDir, 'Validators.cs'));
      writeFileSync(join(csDir, 'check.csproj'), [
        '<Project Sdk="Microsoft.NET.Sdk">',
        '  <PropertyGroup>',
        '    <TargetFramework>net8.0</TargetFramework>',
        '    <OutputType>Library</OutputType>',
        '  </PropertyGroup>',
        '</Project>',
      ].join('\n'));
      execSync('dotnet build -nologo -v quiet', {
        cwd: csDir, encoding: 'utf-8', stdio: 'pipe',
      });
    } else {
      console.log('Skipping: dotnet not found');
    }
  });

  // --- Swift ---
  it('Swift: swiftc -typecheck', () => {
    if (!schemasAvailable) { console.log('Skipping: schemas not available'); return; }
    if (!hasCommand('swiftc')) { console.log('Skipping: swiftc not found'); return; }
    const dir = ensureGenerated();
    execSync(`swiftc -typecheck "${join(dir, 'Validators.swift')}"`, {
      encoding: 'utf-8', stdio: 'pipe',
    });
  });

  // --- Dart ---
  it('Dart: dart analyze', () => {
    if (!schemasAvailable) { console.log('Skipping: schemas not available'); return; }
    if (!hasCommand('dart')) { console.log('Skipping: dart not found'); return; }
    const dir = ensureGenerated();
    const dartDir = join(dir, 'dart-project');
    mkdirSync(join(dartDir, 'lib'), { recursive: true });
    copyFileSync(join(dir, 'validators.dart'), join(dartDir, 'lib', 'validators.dart'));
    writeFileSync(join(dartDir, 'pubspec.yaml'), [
      'name: schemata_check',
      'environment:',
      '  sdk: ">=3.0.0 <4.0.0"',
    ].join('\n'));
    writeFileSync(join(dartDir, 'analysis_options.yaml'), [
      'analyzer:',
      '  errors:',
      '    unused_local_variable: ignore',
    ].join('\n'));
    execSync('dart analyze --fatal-warnings lib/validators.dart', {
      cwd: dartDir, encoding: 'utf-8', stdio: 'pipe',
    });
  });

  // --- Python ---
  it('Python: py_compile', () => {
    if (!schemasAvailable) { console.log('Skipping: schemas not available'); return; }
    if (!hasCommand('python3')) { console.log('Skipping: python3 not found'); return; }
    const dir = ensureGenerated();
    execSync(
      `python3 -c "import py_compile; py_compile.compile('${join(dir, 'validators.py')}', doraise=True)"`,
      { encoding: 'utf-8', stdio: 'pipe' }
    );
  });

  // --- Ruby ---
  it('Ruby: ruby -c', () => {
    if (!schemasAvailable) { console.log('Skipping: schemas not available'); return; }
    if (!hasCommand('ruby')) { console.log('Skipping: ruby not found'); return; }
    const dir = ensureGenerated();
    execSync(`ruby -c "${join(dir, 'validators.rb')}"`, {
      encoding: 'utf-8', stdio: 'pipe',
    });
  });

  // --- PHP ---
  it('PHP: php -l', () => {
    if (!schemasAvailable) { console.log('Skipping: schemas not available'); return; }
    if (!hasCommand('php')) { console.log('Skipping: php not found'); return; }
    const dir = ensureGenerated();
    execSync(`php -l "${join(dir, 'validators.php')}"`, {
      encoding: 'utf-8', stdio: 'pipe',
    });
  });

  // --- TypeScript ---
  it('TypeScript: tsc --strict --noEmit', () => {
    if (!schemasAvailable) { console.log('Skipping: schemas not available'); return; }
    if (!hasCommand('npx')) { console.log('Skipping: npx not found'); return; }
    const dir = ensureGenerated();
    execSync(
      `npx tsc --strict --noEmit --target ES2022 --module Node16 --moduleResolution Node16 "${join(dir, 'validators.ts')}"`,
      { encoding: 'utf-8', stdio: 'pipe' }
    );
  });
});
