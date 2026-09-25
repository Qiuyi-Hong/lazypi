# LazyPi

LazyPi is a LazyVim-inspired enhancement layer for Pi: a terminal package-manager popup with curated suggestions, built on vanilla Pi rather than a fork or a new package format.

## Install

```bash
pi install npm:@qiuyihong/lazypi
```

Tested against Pi 0.87.1; tests use Node.js 24's TypeScript stripping. Runtime Node requirements follow your Pi installation. Curated Pi packages are **not** npm dependencies of LazyPi.

## Use

Open `/lazypi`, `/lazypi extras`, `/lazypi community`, `/lazypi updates`, `/lazypi settings`, `/lazypi installed`, `/lazypi enabled`, `/lazypi disabled`, or `/lazypi core` in an interactive Pi session (`/lazypi catalog` remains an alias). `/lazypi health` diagnoses local configuration; `/lazypi sync` previews and repairs required Core/selected Extra packages. Tab switches sections; each section shows its uppercase jump key in parentheses (including Community); ↑/↓ or j/k select; Enter shows details; `/` searches; `i` installs/selects; `e` enables; `d` disables; Space toggles; `x` removes/deselects; `u` updates; `U` updates all eligible packages in Updates; `r` refreshes; Esc closes. Pi package changes reload Pi afterward; reopen `/lazypi` for another operation.

**Core** is the predetermined baseline: `npm:pi-mcp-adapter`, `npm:pi-subagents`, and `npm:pi-web-access`. They remain three independent Pi packages, not dependencies of `@qiuyihong/lazypi`. On your first `/lazypi`, setup recognizes packages already installed through Pi (user and trusted project scope), including disabled packages, and shows a confirmation plan for **only the missing Core packages**. Accepting installs them sequentially as normal Pi packages (User scope by default, or the original scope when repairing a configured-but-missing package); already installed packages and filters are not changed. Choose **Later** to defer setup until next time, or **Skip setup** to opt out. If all Core packages are already installed, setup completes without prompting. After installation, Pi reloads and you can reopen `/lazypi` to see the updated inventory. `i` also accepts a direct Pi `npm:`, `git:`, or `https://` package source. Choose User or Project scope when the project is trusted; project scope uses `.pi/settings.json` and user scope uses your Pi agent directory's `settings.json` (normally `~/.pi/agent/settings.json`). Uncurated installs are identified as such: third-party extensions execute with your user permissions.

## Philosophy

- Pi remains usable without LazyPi. `pi remove npm:pi-subagents` or `pi uninstall npm:pi-subagents` works on a package installed here.
- Installed means configured as a Pi package; Enabled means all its resources load by Pi's defaults; Disabled means the package stays installed with all four resource types filtered out. Disabling is **not** uninstalling.
- Pi also permits _partial resource filters_, represented as **custom** in LazyPi; manage those with `pi config` rather than a destructive whole-package toggle. A user package overridden by a project package is **shadowed**, not falsely reported active.
- Core is the three-package baseline above. Extras are optional curated selections. Community searches npm packages tagged `pi-package`, excludes Core/Extras, and labels every result **unverified**. Search metadata is not a security review; inspect third-party code before installing. Setup never forces existing installed-but-disabled Core packages to become enabled.
- Extras are browsed by **purpose** (AI & Agents, Coding, Planning & Workflow, Web & Research, Context & Memory, Models & Providers, Integrations, Safety & Permissions, UI & Experience, Observability & Usage, Tools & Utilities). Enter opens a category; `f` cycles the independent All/Extensions/Skills/Prompts/Themes filter; `/` searches names, descriptions, category names, tags, and sources. Esc returns to categories. Every category contains five distinct installable packages, chosen by primary purpose and Pi gallery monthly download counts (see [curation snapshot](docs/extras-curation.md)); the package-free **Research Workflow** also remains available and requires Subagents and Web Access. Extra rows show installation separately from selection (installed, not installed, or partially installed for workflows). Press `i` to select/install an Extra, or to repair a missing package in an already-selected Extra; Pi's install plan is confirmed before changes. Extra plans show dependency packages, already-installed/disabled packages, and the chosen User or trusted Project scope. User selections require user-scope packages; Project selections may reuse user-scope packages. Broken project declarations must be repaired before a user-wide selection. Extras installed through LazyPi are still normal Pi packages. Selecting an Extra does not override existing Pi resource filters. Deselecting removes only the LazyPi selection, **not** installed packages: an existing Pi declaration cannot prove who originally installed it. Use `pi remove` or LazyPi's explicit package removal if no longer needed.
- Package-backed Extras derive both `id` and visible `name` from the npm source after `npm:` (for example, `@dietrichgebert/ponytail`). The package-free `research-workflow` keeps matching explicit `id`/`name` fields. Older saved Extra IDs are recognized without rewriting files on read and are updated on the next selection change. Desired Extra selections are stored in `<agent-dir>/lazypi.json` (User) or `.pi/lazypi.json` (trusted Project). Pi settings and manifests remain authoritative for installation and resource state. Dependencies are resolved from selections; they are not copied into the saved list. An Extra installed only in one project does not become global elsewhere.
- No profiles, resource-level toggles, surprise postinstall, or duplicate package-state database.

## Community and updates

`/lazypi community` searches npm's `pi-package` keyword (first 30 results per search); press `/` to change the search and Enter to load the selected package's latest published manifest (declared Pi resource types, author, repository and dependencies). `i` proposes a normal scoped `npm:` installation through Pi, with an uncurated-code warning. Cached search results render immediately while a stale search refreshes in the background. `r` forces a registry refresh. Registry metadata is cached in `<agent-dir>/lazypi-cache.json` for one hour; `PI_OFFLINE=1` uses cached results only. An unavailable registry leaves installed packages untouched.

`/lazypi updates` checks installed **unversioned npm** packages in either scope for newer stable versions (four concurrent checks, cached for one hour). The list shows `installed → latest`; `u` confirms and delegates the update to Pi, preserving disabled resource filters. Exact pins and version ranges are excluded from this automatic list: Pi's native updater respects those constraints, while comparing them to npm's unrestricted `latest` tag would be misleading. Git/local sources and prerelease latest tags are not checked here. Individual manual updates from Installed remain available. `r` forces an update check. No npm checks run on ordinary `/lazypi` opening.

## Settings, health and sync

The Settings tab (also available before first-run setup) toggles **Auto-check updates at startup** (off by default; async npm checks notify when available). This preference lives in `<agent-dir>/lazypi.json`, not Pi settings. Community is always visible; the startup check does not block the UI and registry failures are silent.

`/lazypi health` checks readable settings, LazyPi state, missing declarations, malformed package manifests, and unsupported/custom package states without writing files. `/lazypi sync` confirms a plan for missing or disabled Core and selected Extras in User/trusted Project scope, adopting already-enabled installations and leaving custom resource filters alone. Unlike first-run setup, an explicit sync **enables** disabled requirements. It never removes packages or changes arbitrary Community packages. If you skipped setup, do not run sync unless you want the Core baseline installed. Failed multi-package operations stop on the first error, report how many succeeded, and leave successful native Pi changes in place; retry after fixing the cause. No unsafe automatic rollback.

In Updates, `U` fetches latest metadata and previews a sequential update-all plan for eligible unpinned npm packages (including disabled installations). Pi updates the same package identity in both scopes; LazyPi plans it once and preserves disabled filters. If npm checks fail, only known updates are proposed. Reopen Updates after partial failure to retry. A Core package present only in one trusted project counts as installed there but does not become user-global in other projects.

See [architecture and Pi API findings](docs/architecture.md).

## Local development

From the repository root, install dependencies and run the checks:

```bash
npm ci
npm run format:check
npm run typecheck
npm test
npm pack --dry-run
```

Tests use temporary Pi settings and injected package actions; they never install packages in your real Pi environment.

To try the popup without installing LazyPi as a Pi package, run `pi --extension ./extensions/lazypi.ts`, then enter `/lazypi extras` in Pi. Choose **Later** at first-run setup if you do not want to install Core packages. The extension is temporary, but accepting a package plan still changes your Pi environment.

To test the normal local-package installation, run `pi install ./` from the repository root, start `pi`, and enter `/lazypi extras`. Check the declaration with `pi list`; when finished, run `pi remove ./` from the same directory. This removes LazyPi's declaration, not any separately installed Core or Extra packages.
