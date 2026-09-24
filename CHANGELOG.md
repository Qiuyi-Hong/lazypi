# Changelog

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
