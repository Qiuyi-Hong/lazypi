# LazyPi

LazyPi is a LazyVim-inspired enhancement layer for Pi: a terminal package-manager popup with curated suggestions, built on vanilla Pi rather than a fork or a new package format.

## Install

```bash
pi install npm:@qiuyihong/lazypi
```

> Until `@qiuyihong/lazypi` is published to npm, develop locally with `npm install` and `pi --extension ./extensions/lazypi.ts`.

Tested against Pi 0.87.1; tests use Node.js 24's TypeScript stripping. Runtime Node requirements follow your Pi installation. Curated Pi packages are **not** npm dependencies of LazyPi.

## Use

Open `/lazypi`, `/lazypi installed`, `/lazypi enabled`, `/lazypi disabled`, or `/lazypi core` in an interactive Pi session (`/lazypi catalog` remains an alias). Tab switches sections; ↑/↓ or j/k select; Enter shows details; `/` searches; `i` installs; `e` enables; `d` disables; Space toggles; `x` removes; `u` updates; `r` refreshes; Esc closes. Every change shows a confirmation and reloads Pi afterward; reopen `/lazypi` for another operation.

**Core** is the predetermined baseline: `npm:pi-mcp-adapter`, `npm:pi-subagents`, and `npm:pi-web-access`. They remain three independent Pi packages, not dependencies of `@qiuyihong/lazypi`. On your first `/lazypi`, setup recognizes packages already installed through Pi (user and trusted project scope), including disabled packages, and shows a confirmation plan for **only the missing Core packages**. Accepting installs them sequentially as normal Pi packages (User scope by default, or the original scope when repairing a configured-but-missing package); already installed packages and filters are not changed. Choose **Later** to defer setup until next time, or **Skip setup** to opt out. If all Core packages are already installed, setup completes without prompting. After installation, Pi reloads and you can reopen `/lazypi` to see the updated inventory. `i` also accepts a direct Pi `npm:`, `git:`, or `https://` package source. Choose User or Project scope when the project is trusted; project scope uses `.pi/settings.json` and user scope uses your Pi agent directory's `settings.json` (normally `~/.pi/agent/settings.json`). Uncurated installs are identified as such: third-party extensions execute with your user permissions.

## Philosophy

- Pi remains usable without LazyPi. `pi remove npm:pi-subagents` or `pi uninstall npm:pi-subagents` works on a package installed here.
- Installed means configured as a Pi package; Enabled means all its resources load by Pi's defaults; Disabled means the package stays installed with all four resource types filtered out. Disabling is **not** uninstalling.
- Pi also permits _partial resource filters_, represented as **custom** in LazyPi; manage those with `pi config` rather than a destructive whole-package toggle. A user package overridden by a project package is **shadowed**, not falsely reported active.
- Core is the three-package baseline above; Extras will be modular optional bundles, and Community will be separate and unverified. Setup never forces existing installed-but-disabled Core packages to become enabled.
- No profiles, resource-level toggles, surprise postinstall, or duplicate package-state database.

## Status

This repository implements Phase 1: native package inventory, user/project scope, whole-package enable/disable via Pi settings, the Core package list, install/remove/update actions, a popup and package details. The Updates list/latest-version checks, Extras and ownership planning, Community discovery/cache, health, sync, settings UI and rollback are **not implemented yet**. First-run setup stores only a completion marker in `<agent-dir>/lazypi.json`, not duplicate package state. If a Core package is removed after setup, use the Core tab to reinstall it; automatic reconciliation belongs to future sync. A Core package present only in one trusted project counts as installed there but does not automatically become user-global in other projects. `/lazypi extras`, `/lazypi community`, `/lazypi updates`, `/lazypi sync` and `/lazypi health` are not advertised as working commands.

See [architecture and Pi API findings](docs/architecture.md). For development run `npm install`, `npm run format:check`, `npm run typecheck`, `npm test`, and `npm pack --dry-run`. Tests use temporary Pi settings and injected package actions; they never install packages in your real Pi environment.
