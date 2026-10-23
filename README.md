# Go dependencies explorer

A VS Code extension that adds a file explorer for quickly accessing resources of Go packages — `.go` files, test files and everything inside the standard library and module dependencies.

![screencast](./screencast.gif)

## Features

- **Standard Library** — browse packages and files of the Go standard library (`GOROOT/src`).
- **External Packages** — browse packages of all modules used in the workspace (`go list -m all` + `GOMODCACHE`).
- **ModulesReplaced** — replaced modules are shown on a separate root.
- Open a dependency file and it is revealed in the tree, marking it read-only in the session so you do not accidentally edit a dependency.
- Commands: refresh, search in all dependency directories, search in a directory, copy path, open in integrated terminal, reveal in OS file explorer, open directory in workspace.
- A git repository accidentally opened inside package directories can be closed automatically (configurable via `go.dependencies.explorer.prevent.open.git.repo`: `ask` / `on` / `off`).

## Requirements

- [Go extension](https://marketplace.visualstudio.com/items?itemName=golang.go) (`golang.go`) — it provides the path of the `go` binary.

## Building

```bash
npm ci
npm run dist        # bundle with esbuild to dist/extension.js
npm run test        # unit tests (node:test)
npm run vscode-test # integration tests, requires a Go toolchain
npm run package     # produce a .vsix via vsce
```

## Architecture (short)

- `src/extension.ts` — activation, commands, git-repository guard.
- `src/goPackageProvider.ts` — builds package trees by walking `GOMODCACHE`/`GOROOT/src` with `fs` and `go list`; fires `onRequestPackages`.
- `src/goDependenciesStateProvider.ts` — keeps three root trees and computes added/removed dirs on refresh.
- `src/treeView.ts` — `TreeDataProvider`, selection sync with active editor, `go.mod`/`go.sum` file watchers.
- `src/pathTree.ts` — path tree building/collapsing utilities (fully covered by unit tests).
- `src/goExec.ts` — wrapper over `go env` / `go list` subprocesses.
