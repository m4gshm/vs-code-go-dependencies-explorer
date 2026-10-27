# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this is

Go Dependencies Explorer — a VS Code extension that adds an explorer view for
browsing Go package resources: the standard library (`GOROOT/src`), external
module packages (`GOMODCACHE` via `go list -m all`) and replaced modules.
It depends on the `golang.go` extension (source of the `go` binary path) and
`vscode.git` (guard against accidentally opening dependency dirs as repos).
`goExec` runs `go` asynchronously (`execFile`); full rescans are still
expensive, so keep them rare and debounced.

## Commands

```bash
npm run compile       # esbuild bundle → dist/extension.js (dev build, sourcemaps)
npm run compile -- --production  # minified, no sourcemaps (what gets packaged)
npm run compile-tests # tsc → out/ (required before integration tests)
npm run check-types   # tsc --noEmit
npm run unit          # vitest unit tests (fast, no VS Code)
npm run coverage      # vitest --coverage
npm run test          # unit + bundle + compile-tests + @vscode/test-electron integration
npm run vscode-test   # integration tests only (needs a Go toolchain)
npm run lint          # eslint src
npm run build         # clean + test + lint (what CI runs)
npm run package       # prepublish chain (clean, check-types, lint, production bundle) + vsce package
```

Run `check-types` and `test` after every change; they are quick. On Windows
(PowerShell) do not chain commands with `&&`.

## Launch and debug

Debug with F5 (Run Extension): esbuild's watch is wired through
`npm run watch`. Integration tests require the compiled `out/`
(`npm run compile-tests`) and use the stub Go workspace `goWorkspace/go_stub` —
no real module cache is needed.

Integration tests live in `src/test-vscode/` and require a real VS Code host,
the Go extension and a Go toolchain — they cannot run under plain `node`.
Unit tests live in `src/test/` and must not import `vscode`.

## Architecture

Entry point: `src/extension.ts`. Data flow:
`go binary → GoExec → GoPackageProvider → GoDependenciesStateProvider →
GoTreeDataProvider → tree view`.

| Module | Responsibility |
| --- | --- |
| `extension.ts` | Activation (waits for `golang.go` via `extensions.onDidChange`), command registration, git-repo guard |
| `goModulePath.ts` | Pure helpers deriving Go module / import paths from a dir under `GOMODCACHE` |
| `goExec.ts` | Async subprocess wrapper over `go env -json` / `go list` (env result is cached per instance) |
| `goDirs.ts` | `GOROOT/src` and `GOMODCACHE` resolution from go env |
| `goPackageProvider.ts` | Walks std-lib and module dirs, builds `PathTree`s, fires `onRequestPackages` |
| `goDependenciesStateProvider.ts` | Holds the three root trees (StdLib / Modules / ModulesReplaced), computes added/removed dir diffs on `refresh(calcChanges)` |
| `pathTree.ts` | Path-tree building, subtree collapsing, win-drive normalization; fully unit-covered |
| `treeState.ts` | vscode-free cache of tree elements/children/parents/expand-state; unit-covered |
| `treeModel.ts` | vscode-free tree logic (`GoTreeModel`): nodes, children via injected `readDir`, parent walk, refresh diffs; unit-covered |
| `treeView.ts` | `GoTreeDataProvider` (thin `ModelNode ↔ TreeItem` adapter) + view wiring: selection ↔ active editor sync, read-only marking of dependency files, `go.mod`/`go.sum` watchers |
| `gitExtension.ts`, `goExtension.ts` | Minimal API typings for the extension dependencies |

## Behavioral rules (keep docs in sync!)

When changing behavior, update `README.md` and the setting descriptions in
`package.json` — avoid README/description drift. Key invariants:

- `GoDependenciesStateProvider.refresh(false)` updates state silently;
  `refresh(true)` additionally returns removed/added dirs which
  `GoTreeDataProvider.refresh` uses to prune stale tree items. Do not fire
  `onDidChangeTreeData` without updating that state.
- Dependency files opened from the tree are set read-only for the session;
  paths are normalized with `normalizeWinPath` (lower-cased drive letter) —
  never compare raw `fsPath` strings with go-env paths directly.
- `goExec` calls are asynchronous but full rescans are expensive; keep refresh
  rare and debounced; `getEnv` is cached, reuse it instead of spawning again.
- Scans of std-lib and `GOMODCACHE` dirs are cached per session (`DirScanCache`
  in `GoPackageProvider`) — those trees are immutable; replaced/local dirs are
  never cached. `refresh(force=true)` bypasses and clears the cache, watcher
  and workspace refreshes use it. The cache can be disabled at runtime with
  the `go.dependencies.explorer.use.scan.cache` setting (checked on every
  refresh in `GoTreeDataProvider.refresh`).

## Conventions

- **Comments**: default to **no comments**. Write code that explains itself;
  add a comment only when the code cannot convey non-obvious *why* — invariants,
  workarounds, platform quirks, external-command behavior. Never comment:
  - what the next line obviously does ("//log", "// Trigger event", "// Create X");
  - JSDoc restating parameter names/types on trivial functions;
  - section markers, TODO-free narration, alternatives that were not chosen.
  If a block needs an explaining comment, first try renaming or extracting a
  well-named helper instead. When editing code, delete nearby comments that
  became redundant. Tests follow the same rule: assertion names and structure
  should make the intent clear without commentary.
- TypeScript strict mode, CommonJS sources bundled by esbuild; unit tests run
  directly on TS sources by vitest — no build step for them.
- Prefer keeping pure logic (trees, diffs, parsing) in `vscode`-free modules
  (`pathTree`, `goDependenciesStateProvider`) so it stays unit-testable;
  integration tests are the last resort because they are slow.
- Errors from `go list` for a workspace module are logged, not thrown — the
  view must still render the remaining roots.
- `README.md` is English; keep it accurate against `package.json` (commands,
  defaults, descriptions must match `contributes`).
