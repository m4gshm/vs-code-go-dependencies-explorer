# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this is

Go Dependencies Explorer — a VS Code extension that adds an explorer view for
browsing Go package resources: the standard library (`GOROOT/src`), external
module packages (`GOMODCACHE` via `go list -m all`) and replaced modules.
It depends on the `golang.go` extension (source of the `go` binary path) and
`vscode.git` (guard against accidentally opening dependency dirs as repos).

## Commands

```bash
npm run compile       # tsc → out/ (required before integration tests)
npm run dist          # esbuild bundle → dist/extension.js (dev build, sourcemaps)
npm run dist -- --production  # minified, no sourcemaps (what gets packaged)
npm run check-types   # tsc --noEmit
npm run test          # unit tests (node:test via tsx, fast, no VS Code)
npm run test:coverage # unit tests + V8 coverage report
npm run vscode-test   # integration tests via @vscode/test-electron (needs a Go toolchain)
npm run lint          # eslint src
npm run build         # clean + integration + unit + lint (what CI runs)
npm run package       # prepublish chain (clean, check-types, lint, production dist) + vsce package
```

Run `check-types` and `test` after every change; they are quick. On Windows
(PowerShell) do not chain commands with `&&`.

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
| `goExec.ts` | Sync subprocess wrapper over `go env -json` / `go list` (env result is cached per instance) |
| `goDirs.ts` | `GOROOT/src` and `GOMODCACHE` resolution from go env |
| `goPackageProvider.ts` | Walks std-lib and module dirs, builds `PathTree`s, fires `onRequestPackages` |
| `goDependenciesStateProvider.ts` | Holds the three root trees (StdLib / Modules / ModulesReplaced), computes added/removed dir diffs on `refresh(calcChanges)` |
| `pathTree.ts` | Path-tree building, subtree collapsing, win-drive normalization; fully unit-covered |
| `treeView.ts` | `GoTreeDataProvider` + view wiring: selection ↔ active editor sync, read-only marking of dependency files, `go.mod`/`go.sum` watchers |
| `gitExtension.ts`, `goExtension.ts` | Minimal API typings for the extension dependencies |

Key invariants:

- `GoDependenciesStateProvider.refresh(false)` updates state silently;
  `refresh(true)` additionally returns removed/added dirs which
  `GoTreeDataProvider.refresh` uses to prune stale tree items. Do not fire
  `onDidChangeTreeData` without updating that state.
- Dependency files opened from the tree are set read-only for the session;
  paths are normalized with `normalizeWinPath` (lower-cased drive letter) —
  never compare raw `fsPath` strings with go-env paths directly.
- `goExec` calls are synchronous (`spawnSync`): keep refresh rare and cheap;
  `getEnv` is cached, reuse it instead of spawning again.

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
- TypeScript strict mode, CommonJS sources bundled by esbuild; no build step
  for unit tests (`tsx` runs them directly).
- Prefer keeping pure logic (trees, diffs, parsing) in `vscode`-free modules
  (`pathTree`, `goDependenciesStateProvider`) so it stays unit-testable;
  integration tests are the last resort because they are slow.
- Errors from `go list` for a workspace module are logged, not thrown — the
  view must still render the remaining roots.
- README is English; keep it accurate against `package.json` (commands,
  settings, defaults must match `contributes`).
