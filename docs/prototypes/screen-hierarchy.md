# Throwaway terminal mockups: LazyPi screen hierarchy

Decision question: which default screen and detail hierarchy should LazyPi use, borrowing only visual patterns from the [published extension-manager reference](https://github.com/Qiuyi-Hong/lazypi/blob/research/pi-extension-manager-tui/docs/research/pi-extension-manager-tui.md)? These are static comparison sketches, **not production UI or a keyboard/workflow spec**. The reference's two-column inspector is useful; its narrow-width clipping and extension-only state semantics are not.

## A — Inventory + inspector (chosen)

Default: Pi-configured packages, including declarations whose install path is missing. Call the view **Packages**, not Installed. State and scope lead; descriptions and resource details recede into the inspector. Core, Extras, Community, Updates and Settings remain distinct views. Enabled/Disabled remain filters/views of Pi state, not new flags.

```text
┌─ LazyPi · Packages ────────────────────────────────────────────┐
│ Packages [All · Enabled · Disabled]  Core  Extras  Community   │
│ Search: /                               Updates  Settings      │
│ PACKAGES (12)              │ SELECTED PACKAGE                  │
│ › pi-subagents   enabled U │ pi-subagents                      │
│   pi-web-access  disabled U │ Pi state: enabled · user          │
│   my-tools       custom P  │ Source: npm:pi-subagents          │
│   other         missing P  │ Resources: extensions, skills    │
│                            │ Core · update available           │
│ 1/12                       │ Enter: more details               │
└────────────────────────────────────────────────────────────────┘
```

U/P are only scope shorthands in this sketch; spell out scope where width permits. State labels remain Pi-derived (`enabled`, `disabled`, `custom`, `shadowed`, `missing`) and cannot be inferred from Core or Extra membership. Missing in Packages means a configured declaration with no installed path. An absent Core entry appears as **not installed** in Core, not as a fabricated inventory row.

When two useful columns cannot fit, keep a full-width list; Enter opens a full-width detail view and Esc returns to the list. No horizontally clipped inspector. Short terminals follow the same fallback.

```text
┌─ LazyPi · Packages ────────────────┐
│ / search   All · Enabled · Disabled│
│ › pi-subagents      enabled · user │
│   pi-web-access    disabled · user │
│   my-tools         missing · proj. │
│ 1/12    Enter details              │
└─────────────────────────────────────┘
```

Extras must show **selection** (`selected`, `required`, `available`) separately from **installation** (`installed`, `partially installed`, `not installed`) on every list row, sacrificing descriptions before either status. The inspector/details can expand scope, package states, dependencies, and resource types. A selected Extra does not imply an enabled Pi package; deselecting does not uninstall it. A category chooser can remain a simple list until an Extra is selected.

```text
┌─ LazyPi · Extras / Web & Research ────────────────────────────┐
│ EXTRAS                     │ SELECTED EXTRA                    │
│ › Research Workflow        │ Research Workflow                │
│   selected · not installed  │ Selected: user                   │
│   ponytail                 │ Packages: Subagents, Web Access  │
│   available · installed     │ Install state: not installed     │
│   some-workflow            │ Selection ≠ Pi package state    │
│   required · partially inst.│                                  │
└────────────────────────────────────────────────────────────────┘
```

The Community list and inspector must mark registry-only results **unverified**; package state, if installed, still comes from Pi. Updates and Settings may use their own content density without adding a second status model. Search/filter and help stay subordinate to the list and inspector. Navigation labels here show hierarchy, not a new keybinding decision.

## B — Core + selected Extras overview (not chosen)

A curated dashboard would foreground the three independently installed Core packages and selected Extras, while the full package inventory becomes secondary. It obscures ordinary configured packages and lacks the immediate list/detail comparison that prompted this effort.

```text
┌─ LazyPi · Core ────────────────────────────────────────────────┐
│ CORE (3 independent packages)                                 │
│ › pi-mcp-adapter       enabled · user                          │
│   pi-subagents        disabled · user                         │
│   pi-web-access       not installed                           │
│ SELECTED EXTRAS (selection ≠ installation)                    │
│   Research Workflow   selected · not installed               │
│ Browse Extras · Packages · Community (unverified)             │
│ Enter replaces list with details                              │
└────────────────────────────────────────────────────────────────┘
```

## C — Catalog-first browser (not chosen)

A mixed Core/Extra/Community results screen would prioritize discovery over local truth and need labels for three different kinds of row; async registry results complicate the default screen. Not suitable as the primary package-management view.

```text
┌─ LazyPi · Browse ──────────────────────────────────────────────┐
│ Browse [Core · Extras · Community]       Packages  Updates   │
│ RESULTS                     │ DETAILS                         │
│ › pi-subagents   Core       │ Pi state: disabled · user       │
│   Research Flow Extra       │ Extra selection: independent   │
│   pi-widget     Community   │ Community result: unverified   │
└────────────────────────────────────────────────────────────────┘
```

Use Pi TUI's theme and visible-column width utilities when implementing later. Exact breakpoints, counts, color treatment, and final labels beyond **Packages** are implementation/spec questions, not findings from static mockups. No package settings or native operations change in this decision.
