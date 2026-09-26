# Changelog

## 0.2.3 (2026-09-26)

### Added

- Regression coverage for clearing search when switching sections while preserving Extras category navigation.

## 0.2.2 (2026-09-25)

### Added

- Settings tab with persisted startup update checks and Community tab visibility; asynchronous startup notifications for available updates.
- Read-only `/lazypi health` diagnostics and confirmed `/lazypi sync` repairs for Core/selected Extras, including disabled packages.
- `U` update-all plan for eligible unpinned npm packages across both scopes; sequential native updates, partial failure reporting and retry guidance.
- Community search for npm `pi-package` packages, on-demand published-manifest details, unverified install confirmation, offline-capable one-hour metadata cache and manual refresh.
- Updates tab with cached latest-version checks for installed unversioned npm packages in either scope; update actions remain native Pi operations and retain disabled filters.
- Direct section shortcuts shown beside each section name.

### Fixed

- Settings toggles update in place without closing and reopening the popup.
- Section tabs stay visible on one line in the popup.
- Search resets when switching sections, including after the popup reopens.

## 0.2.1 (2026-09-24)

### Fixed

- Record Pi TUI and its transitive dependencies as peers in the npm lockfile.

## 0.2.0 (2026-09-24)

### Added

- Extras popup with curated category selections, dependency/conflict validation, shared-package reference reasons, user/project scope and confirmation plans.
- Extra selections stored separately from Pi package state; first-run Core setup preserves existing selections.
- Purpose-based Extras categories with independent resource-type filtering, tag/source search, metadata validation, and Ponytail as a Coding Extra.
- Extras show native Pi install status independently of selection and offer a repair plan for missing packages.
- Curate `npm:@quintinshaw/pi-dynamic-workflows` under AI & Agents.
- Expand Extras to five unique packages per purpose category, selected against Pi gallery downloads and published resource manifests.
- Derive package-backed Extra IDs and displayed names from npm sources; recognize legacy selection IDs until their next write.

### Changed

- Deselecting an Extra leaves native Pi packages and resource filters untouched; interrupted installs report successful steps without unsafe rollback.

## 0.1.2 (2026-09-23)

### Fixed

- Link the npm package to its GitHub repository and README homepage.

## 0.1.1 (2026-09-23)

### Fixed

- Use the available `@qiuyihong/lazypi` npm package name instead of the unavailable unscoped name.

## 0.1.0 (2026-09-23)

### Added

- Native Pi package inventory with user/project scope, enabled/disabled/custom/shadowed/missing states.
- Terminal popup, the three predetermined Core packages, package details and confirmed native install/remove/update actions.
- Whole-package disable/enable using Pi's four supported resource filters, retaining the installed package.
- First-run migration recognizes existing user/project Pi packages and offers to install only missing Core packages via native Pi operations.
