import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { execute } from "../src/actions.ts";
import {
  corePlan,
  installCore,
  isSetupComplete,
  markSetupComplete,
  readLazyPiState,
  readStartupPreferences,
  writeLazyPiState,
} from "../src/bootstrap.ts";
import { core } from "../src/catalog.ts";
import { frontpage } from "../src/frontpage.ts";
import { CommunityRegistry } from "../src/community.ts";
import {
  health,
  runSequential,
  syncPlan,
  updateAllPlan,
} from "../src/polish.ts";
import {
  planExtra,
  readSelections,
  requiredBy,
  saveSelection,
  type Selection,
} from "../src/extras.ts";
import {
  createNative,
  identity,
  inventory,
  plan,
  type PackageEntry,
  type Scope,
} from "../src/packages.ts";
import {
  ManagerPopup,
  sections,
  type Choice,
  type Section,
} from "../src/ui.ts";
import type { ExtraCategory, PiResourceType } from "../src/extras.ts";

export default function (pi: ExtensionAPI) {
  let ownsHeader = false;
  const installFrontpage = (ctx: ExtensionContext) => {
    ctx.ui.setHeader((_tui, theme) => ({
      render(width) {
        try {
          return frontpage(ctx, theme, width);
        } catch {
          return []; // A failed header must never break Pi's terminal render.
        }
      },
      invalidate() {},
    }));
    ownsHeader = true;
  };
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    const agentDir = getAgentDir();
    const config = readStartupPreferences(agentDir);
    if (config.showFrontpage) {
      try {
        installFrontpage(ctx);
      } catch {
        /* A broken header must not prevent Pi or update checks from starting. */
      }
    }
    if (!config.autoCheckUpdates) return;
    try {
      const { settings, manager } = createNative(
        ctx.cwd,
        ctx.isProjectTrusted(),
      );
      const items = inventory(settings, manager);
      const registry = new CommunityRegistry(agentDir);
      void registry
        .checkUpdates(items)
        .then(({ versions, failed }) => {
          if (failed) return; // A partial registry result is not a trustworthy notification.
          const count = updateAllPlan(items, versions).length;
          if (count)
            ctx.ui.notify(
              `${count} Pi package update${count === 1 ? "" : "s"} available. /lazypi updates`,
              "info",
            );
        })
        .catch(() => {
          /* Startup is never blocked by registry failures. */
        });
    } catch {
      /* A broken optional setting must not prevent Pi from starting. */
    }
  });
  pi.registerCommand("lazypi", {
    description: "Manage native Pi packages in a terminal popup",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/lazypi needs the interactive terminal UI.", "warning");
        return;
      }
      const requested = args.trim().toLowerCase();
      const agentDir = getAgentDir();
      if (requested === "health") {
        const issues = health(ctx.cwd, agentDir, ctx.isProjectTrusted());
        ctx.ui.notify(
          issues.length
            ? `LazyPi health:\n${issues.join("\n")}`
            : "LazyPi health: no issues found.",
          issues.length ? "warning" : "info",
        );
        return;
      }
      if (requested === "sync") {
        try {
          const { settings, manager } = createNative(
            ctx.cwd,
            ctx.isProjectTrusted(),
          );
          const selections = readSelections(
            agentDir,
            ctx.cwd,
            ctx.isProjectTrusted(),
          );
          const proposed = syncPlan(inventory(settings, manager), selections);
          const summary = [
            ...proposed.repairs.map(
              ({ action, entry }) =>
                `${action === "install" ? "+" : "↑"} ${entry.source} (${entry.scope}; ${action})`,
            ),
            ...proposed.unchanged.map((source) => `✓ ${source}`),
            ...proposed.warnings.map((warning) => `! ${warning}`),
            "No package will be removed. Continue?",
          ];
          if (!proposed.repairs.length) {
            ctx.ui.notify(
              `LazyPi sync: nothing to change.${proposed.warnings.length ? ` ${proposed.warnings.join(" ")}` : ""}`,
              "info",
            );
            return;
          }
          if (!(await ctx.ui.confirm("LazyPi sync plan", summary.join("\n"))))
            return;
          const live = createNative(ctx.cwd, ctx.isProjectTrusted());
          if (
            JSON.stringify(
              syncPlan(
                inventory(live.settings, live.manager),
                readSelections(agentDir, ctx.cwd, ctx.isProjectTrusted()),
              ).repairs,
            ) !== JSON.stringify(proposed.repairs)
          )
            throw new Error("Inventory changed; run /lazypi sync again.");
          const { applied, failed } = await runSequential(
            proposed.repairs,
            ({ action, entry }) =>
              execute(action, entry, live.settings, live.manager),
          );
          const failure =
            failed &&
            `${failed.step.action} ${failed.step.entry.source}: ${String(failed.error)}`;
          ctx.ui.notify(
            `LazyPi sync: ${applied.length} applied${failure ? `; stopped at ${failure}. Kept successful changes; retry /lazypi sync.` : "."}`,
            failure ? "error" : "info",
          );
          if (applied.length || failure) await ctx.reload();
        } catch (error) {
          ctx.ui.notify(`LazyPi sync: ${String(error)}`, "error");
        }
        return;
      }
      const section: Section =
        requested === "enabled"
          ? "Enabled"
          : requested === "disabled"
            ? "Disabled"
            : requested === "core" || requested === "catalog"
              ? "Core"
              : requested === "extras"
                ? "Extras"
                : requested === "community"
                  ? "Community"
                  : requested === "updates"
                    ? "Updates"
                    : requested === "settings"
                      ? "Settings"
                      : "Packages";
      if (
        requested &&
        ![
          "installed",
          "packages",
          "enabled",
          "disabled",
          "core",
          "catalog",
          "extras",
          "community",
          "updates",
          "settings",
        ].includes(requested)
      ) {
        ctx.ui.notify(
          `Unknown section: ${args.trim()}. Available: ${sections.join(", ")}.`,
          "warning",
        );
        return;
      }
      let active = section;
      let query = "";
      let category: ExtraCategory | undefined;
      let resourceType: PiResourceType | "all" = "all";
      let deferredSetup = false;
      const registry = new CommunityRegistry(agentDir);
      for (;;) {
        try {
          const { settings, manager } = createNative(
            ctx.cwd,
            ctx.isProjectTrusted(),
          );
          const items = inventory(settings, manager);
          let preferences: ReturnType<typeof readLazyPiState> = {
            version: 1,
            autoCheckUpdates: false,
          };
          try {
            preferences = { ...preferences, ...readLazyPiState(agentDir) };
          } catch (error) {
            ctx.ui.notify(
              `LazyPi preferences need repair: ${String(error)}. Run /lazypi health.`,
              "warning",
            );
          }
          const selections = readSelections(
            agentDir,
            ctx.cwd,
            ctx.isProjectTrusted(),
          );
          let setupPending = false;
          if (!deferredSetup) {
            try {
              setupPending = !isSetupComplete(agentDir);
            } catch (error) {
              ctx.ui.notify(
                `LazyPi setup state needs repair: ${error instanceof Error ? error.message : String(error)}`,
                "warning",
              );
              deferredSetup = true; // An optional setup marker must not hide the existing Pi inventory.
            }
          }
          if (setupPending && active !== "Settings") {
            const { missing, present } = corePlan(items);
            if (!missing.length) {
              try {
                markSetupComplete(agentDir);
              } catch (error) {
                ctx.ui.notify(
                  `Could not save LazyPi setup completion: ${String(error)}`,
                  "warning",
                );
                deferredSetup = true;
              }
            } else {
              const choice = await ctx.ui.select("LazyPi first-run setup", [
                "Install missing Core",
                "Later",
                "Skip setup",
              ]);
              if (choice === "Skip setup") {
                try {
                  markSetupComplete(agentDir);
                } catch (error) {
                  ctx.ui.notify(
                    `Could not save LazyPi setup completion: ${String(error)}`,
                    "warning",
                  );
                  deferredSetup = true;
                }
              } else if (choice === "Install missing Core") {
                const summary = [
                  `${items.filter((item) => item.path).length} existing Pi installations will be left alone.`,
                  ...present.map(
                    (item) =>
                      `✓ ${item.source} (${item.scope}, ${item.state}; unchanged)`,
                  ),
                  ...missing.map(
                    ({ source, scope }) => `+ ${source} (${scope})`,
                  ),
                  "New packages use User scope; missing declarations are repaired in their existing scope. Install sequentially through Pi?",
                ].join("\n");
                if (await ctx.ui.confirm("Core install plan", summary)) {
                  const current = createNative(ctx.cwd, ctx.isProjectTrusted());
                  const latest = corePlan(
                    inventory(current.settings, current.manager),
                  );
                  if (
                    JSON.stringify(latest.missing) !== JSON.stringify(missing)
                  )
                    throw new Error(
                      "Core inventory changed; reopen LazyPi to review the new plan.",
                    );
                  const result = await installCore(
                    latest.missing,
                    current.manager,
                    current.settings,
                  );
                  if (result.error) {
                    ctx.ui.notify(
                      `Core setup stopped: ${result.error}. Installed this time: ${result.installed.join(", ") || "none"}. Nothing was rolled back.`,
                      "error",
                    );
                    deferredSetup = true;
                    if (result.installed.length) {
                      await ctx.reload();
                      return;
                    }
                  } else {
                    try {
                      markSetupComplete(agentDir);
                    } catch (error) {
                      ctx.ui.notify(
                        `Core installed, but setup completion could not be saved: ${error instanceof Error ? error.message : String(error)}`,
                        "warning",
                      );
                    }
                    ctx.ui.notify(
                      "Core installed via Pi. Reopen /lazypi to browse all packages.",
                      "info",
                    );
                    await ctx.reload();
                    return;
                  }
                } else deferredSetup = true;
              } else deferredSetup = true;
            }
          }
          let popup!: ManagerPopup;
          const remoteSection = active === "Community" || active === "Updates";
          const offline = /^(1|true|yes)$/i.test(process.env.PI_OFFLINE ?? "");
          let open = true;
          let remoteRequest = 0;
          const loadRemote = (tab: "Community" | "Updates", force: boolean) => {
            const request = ++remoteRequest;
            const community = registry.cachedSearch(popup.query);
            const versions = registry.cachedUpdates(items);
            popup.setRemote(
              community,
              versions,
              !offline,
              offline ? "Offline: showing cached metadata only." : undefined,
              registry.cachedSearchAt(popup.query),
            );
            void (async () => {
              try {
                if (tab === "Community") {
                  const result = await registry.search(popup.query, force);
                  if (
                    open &&
                    request === remoteRequest &&
                    popup.section === tab
                  )
                    popup.setRemote(
                      result,
                      versions,
                      false,
                      offline
                        ? "Offline: showing cached metadata only."
                        : undefined,
                      registry.cachedSearchAt(popup.query),
                    );
                } else {
                  const snapshot = await registry.checkUpdates(items, force);
                  if (
                    open &&
                    request === remoteRequest &&
                    popup.section === tab
                  )
                    popup.setRemote(
                      community,
                      snapshot.versions,
                      false,
                      offline
                        ? "Offline: showing cached metadata only."
                        : snapshot.failed
                          ? `${snapshot.failed} package update checks failed; showing cached versions.`
                          : undefined,
                    );
                }
              } catch (error) {
                if (open && request === remoteRequest && popup.section === tab)
                  popup.setRemote(
                    community,
                    versions,
                    false,
                    error instanceof Error ? error.message : String(error),
                  );
              }
            })();
          };
          const choice = await ctx.ui.custom<Choice>(
            (tui, theme, _keys, done) => {
              popup = new ManagerPopup(
                tui,
                theme,
                done,
                items,
                active,
                query,
                selections,
                category,
                resourceType,
                {
                  community: registry.cachedSearch(query),
                  versions: registry.cachedUpdates(items),
                  loading: remoteSection && !offline,
                  error:
                    remoteSection && offline
                      ? "Offline: showing cached metadata only."
                      : undefined,
                  loadDetails: (name) => registry.details(name),
                  cachedDetails: (name) => registry.cachedDetail(name),
                  searchTimestamp: registry.cachedSearchAt(query),
                  offline,
                },
                {
                  autoCheckUpdates: preferences.autoCheckUpdates ?? false,
                  showFrontpage: preferences.showFrontpage ?? true,
                },
                (setting, enabled) => {
                  try {
                    writeLazyPiState(agentDir, { [setting]: enabled });
                    if (setting === "showFrontpage") {
                      try {
                        if (enabled) installFrontpage(ctx);
                        else if (ownsHeader) {
                          ctx.ui.setHeader(undefined);
                          ownsHeader = false;
                        }
                      } catch {
                        /* Preference is saved; rendering remains optional. */
                      }
                    }
                    return true;
                  } catch (error) {
                    ctx.ui.notify(
                      `Could not save LazyPi preference: ${String(error)}`,
                      "error",
                    );
                    return false;
                  }
                },
                loadRemote,
              );
              // The first frame renders local/cached data; registry I/O runs afterward.
              if (active === "Community" || active === "Updates")
                loadRemote(active, false);
              return popup;
            },
            {
              overlay: true,
              overlayOptions: {
                anchor: "center",
                width: 120,
                maxHeight: 26,
                margin: 1,
              },
            },
          );
          open = false;
          active = popup.section;
          query = popup.query;
          category = popup.category;
          resourceType = popup.resourceType;
          if (choice.action === "close") return;
          if (choice.action === "update-all") {
            const { versions, failed: failures } =
              await registry.checkUpdates(items);
            const updates = updateAllPlan(items, versions);
            if (!updates.length) {
              ctx.ui.notify(
                "No eligible npm updates found. Pinned, git and local sources are not in this list.",
                "info",
              );
              continue;
            }
            if (
              !(await ctx.ui.confirm(
                "Update all plan",
                [
                  ...updates.map(
                    (item) =>
                      `${item.source} (${item.scope}, ${item.state}) ${item.version} → ${versions.get(identity(item.source))!.version}`,
                  ),
                  ...(failures
                    ? [
                        `${failures} registry checks failed; only known updates are listed.`,
                      ]
                    : []),
                  "Pi updates each package identity sequentially in both scopes; disabled filters stay disabled. Continue?",
                ].join("\n"),
              ))
            )
              continue;
            const current = createNative(ctx.cwd, ctx.isProjectTrusted());
            if (
              JSON.stringify(inventory(current.settings, current.manager)) !==
              JSON.stringify(items)
            )
              throw new Error(
                "Inventory changed; reopen Updates before retrying.",
              );
            const { applied, failed } = await runSequential(updates, (entry) =>
              execute("update", entry, current.settings, current.manager),
            );
            const failure =
              failed && `${failed.step.source}: ${String(failed.error)}`;
            ctx.ui.notify(
              `Updated ${applied.length}/${updates.length} packages${failure ? `; failed: ${failure}. Successful updates kept; retry from Updates.` : "."}`,
              failure ? "error" : "info",
            );
            if (applied.length || failure) {
              await ctx.reload();
              return;
            }
            continue;
          }
          if (choice.action === "search") {
            query = (await ctx.ui.input("Search packages", query)) ?? query;
            continue;
          }
          if (choice.action === "refresh") continue;
          if (
            choice.action === "extra" &&
            choice.extra &&
            choice.enabled !== undefined
          ) {
            const extra = choice.extra;
            const existing = selections.filter((item) => item.id === extra.id);
            let scope: Scope;
            if (choice.enabled) {
              const selected = ctx.isProjectTrusted()
                ? await ctx.ui.select("Select Extra scope", ["User", "Project"])
                : "User";
              if (!selected) continue;
              scope = selected === "Project" ? "project" : "user";
            } else {
              if (!existing.length) {
                ctx.ui.notify(
                  `${extra.name} is required by another Extra or is not selected directly.`,
                  "warning",
                );
                continue;
              }
              const selected =
                existing.length > 1
                  ? await ctx.ui.select(
                      "Deselect from scope",
                      existing.map((item) =>
                        item.scope === "user" ? "User" : "Project",
                      ),
                    )
                  : existing[0]!.scope === "user"
                    ? "User"
                    : "Project";
              if (!selected) continue;
              scope = selected === "Project" ? "project" : "user";
            }
            const selection: Selection = { id: extra.id, scope };
            const alreadySelected = existing.some(
              (item) => item.scope === scope,
            );
            const operation = planExtra(
              selection,
              choice.enabled,
              selections,
              items,
            );
            if (
              alreadySelected === choice.enabled &&
              (!choice.enabled || !operation.install.length)
            )
              continue;
            const summary = choice.enabled
              ? [
                  `${alreadySelected ? "Repair" : "Select"} ${extra.name} (${scope}). Required Extras: ${extra.requires?.join(", ") || "none"}.`,
                  ...operation.install.map(
                    ({ source, scope }) => `+ ${source} (${scope})`,
                  ),
                  ...operation.present.map(
                    (item) =>
                      `✓ ${item.source} (${item.scope}, ${item.state}; unchanged)`,
                  ),
                  "Existing disabled/custom resource filters remain unchanged.",
                ]
              : [
                  `Deselect ${extra.name} (${scope}).`,
                  ...operation.kept.map(
                    ({ source, requiredBy }) =>
                      `= ${source} kept${requiredBy.length ? `; required by ${requiredBy.join(", ")}` : "; ownership outside LazyPi unknown"}`,
                  ),
                  "No Pi packages will be removed or disabled. Remove them explicitly if no longer needed.",
                ];
            if (
              !(await ctx.ui.confirm(
                "Extra operation plan",
                summary.join("\n"),
              ))
            )
              continue;
            const current = createNative(ctx.cwd, ctx.isProjectTrusted());
            const liveSelections = readSelections(
              agentDir,
              ctx.cwd,
              ctx.isProjectTrusted(),
            );
            if (
              JSON.stringify(liveSelections) !== JSON.stringify(selections) ||
              JSON.stringify(
                planExtra(
                  selection,
                  choice.enabled,
                  liveSelections,
                  inventory(current.settings, current.manager),
                ).install,
              ) !== JSON.stringify(operation.install)
            )
              throw new Error(
                "Extra inventory changed; reopen LazyPi to review the new plan.",
              );
            const result = await installCore(
              operation.install,
              current.manager,
              current.settings,
            );
            if (result.error) {
              ctx.ui.notify(
                `Extra install stopped: ${result.error}. Installed this time: ${result.installed.join(", ") || "none"}. Selection unchanged; nothing rolled back.`,
                "error",
              );
              if (result.installed.length) {
                await ctx.reload();
                return;
              }
              continue;
            }
            try {
              if (!alreadySelected || !choice.enabled)
                saveSelection(agentDir, ctx.cwd, selection, choice.enabled);
            } catch (error) {
              if (!result.installed.length) throw error;
              ctx.ui.notify(
                `Packages installed, but Extra selection could not be saved: ${String(error)}. No packages were removed.`,
                "error",
              );
              await ctx.reload();
              return;
            }
            if (result.installed.length) {
              await ctx.reload();
              return;
            }
            continue;
          }

          const apply = async (
            action: "install" | "remove" | "update" | "enable" | "disable",
            target: Pick<PackageEntry, "source" | "scope" | "state" | "name">,
          ) => {
            const current = createNative(ctx.cwd, ctx.isProjectTrusted());
            const live = inventory(current.settings, current.manager).find(
              (item) =>
                item.scope === target.scope &&
                identity(item.source) === identity(target.source),
            );
            if (
              action === "install" ? live : !live || live.state !== target.state
            )
              throw new Error("Package changed; reopen LazyPi and retry.");
            await execute(action, target, current.settings, current.manager);
          };
          let entry: PackageEntry | undefined = choice.entry;
          if (choice.action === "install") {
            if (choice.entry) {
              ctx.ui.notify(
                `${choice.entry.source} is already configured; use e to enable it.`,
                "warning",
              );
              continue;
            }
            const source =
              choice.source ??
              (await ctx.ui.input("Install a Pi package", "npm:package-name"));
            if (!source) continue;
            if (!/^(npm:[^\s]+|git:[^\s]+|https:\/\/[^\s]+)$/.test(source)) {
              ctx.ui.notify("Use a Pi npm:, git: or https:// source.", "error");
              continue;
            }
            let scope: Scope = "user";
            if (ctx.isProjectTrusted()) {
              const selected = await ctx.ui.select("Install scope", [
                "User",
                "Project",
              ]);
              if (!selected) continue;
              scope = selected === "Project" ? "project" : "user";
            }
            if (
              items.some(
                (item) =>
                  item.scope === scope &&
                  identity(item.source) === identity(source),
              )
            ) {
              ctx.ui.notify(
                `${source} is already configured in ${scope} scope. Enable it instead of reinstalling.`,
                "warning",
              );
              continue;
            }
            const classification = core.some(
              (spec) => identity(spec.source) === identity(source),
            )
              ? "LazyPi Core"
              : "Uncurated: third-party code runs with your permissions";
            if (
              !(await ctx.ui.confirm(
                "Install plan",
                `${classification}\n${plan("install", { source, scope, state: "missing" })}`,
              ))
            )
              continue;
            await apply("install", {
              source,
              scope,
              state: "missing",
              name: source,
            });
          } else {
            if (!entry) continue;
            if (choice.action === "enable" || choice.action === "disable") {
              if (
                entry.state ===
                (choice.action === "enable" ? "enabled" : "disabled")
              )
                continue;
              if (
                !(await ctx.ui.confirm(
                  "Package plan",
                  plan(choice.action, entry),
                ))
              )
                continue;
              await apply(choice.action, entry);
            } else if (choice.action === "remove") {
              if (entry.name === "@qiuyihong/lazypi")
                throw new Error(
                  "Remove LazyPi using vanilla Pi outside this popup.",
                );
              if (
                !(await ctx.ui.confirm(
                  "Remove package?",
                  `${plan("remove", entry)}\nRequired by: ${requiredBy(entry.source, selections).join(", ") || "no LazyPi selection"}. Selections are not changed.`,
                ))
              )
                continue;
              await apply("remove", entry);
            } else if (choice.action === "update") {
              const also = items.filter(
                (item) =>
                  identity(item.source) === identity(entry!.source) &&
                  item.scope !== entry!.scope,
              );
              if (
                !(await ctx.ui.confirm(
                  "Update package?",
                  `${plan("update", entry)}${also.length ? "\nPi will also update the same package in the other scope." : ""}\nPinned sources stay pinned.`,
                ))
              )
                continue;
              await apply("update", entry);
            }
          }
          ctx.ui.notify(
            "Pi package state updated. Reloading resources…",
            "info",
          );
          await ctx.reload();
          return; // The old extension runtime is invalid after reload.
        } catch (error) {
          ctx.ui.notify(
            `LazyPi: ${error instanceof Error ? error.message : String(error)}`,
            "error",
          );
          return;
        }
      }
    },
  });
}
