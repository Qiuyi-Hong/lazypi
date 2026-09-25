import { accessSync } from "node:fs";
import { join } from "node:path";
import { readLazyPiState } from "./bootstrap.ts";
import { core } from "./catalog.ts";
import {
  extraSources,
  readSelections,
  resolveExtras,
  type Selection,
} from "./extras.ts";
import {
  createNative,
  identity,
  inventory,
  manifest,
  readSettings,
  type PackageEntry,
  type Scope,
} from "./packages.ts";
import { updateFor, type RemotePackage } from "./community.ts";

export type Repair = { action: "install" | "enable"; entry: PackageEntry };

export async function runSequential<T>(
  steps: readonly T[],
  apply: (step: T) => Promise<void>,
): Promise<{ applied: T[]; failed?: { step: T; error: unknown } }> {
  const applied: T[] = [];
  for (const step of steps) {
    try {
      await apply(step);
      applied.push(step);
    } catch (error) {
      return { applied, failed: { step, error } }; // Never undo adopted or pre-existing Pi packages.
    }
  }
  return { applied };
}
export type SyncPlan = {
  repairs: Repair[];
  unchanged: string[];
  warnings: string[];
};

// A declaration is not ownership: sync only adds/enables requirements, never removes packages.
export function syncPlan(
  items: readonly PackageEntry[],
  selections: readonly Selection[],
): SyncPlan {
  const repairs: Repair[] = [];
  const unchanged: string[] = [];
  const warnings: string[] = [];
  const wanted = new Map<
    string,
    { source: string; scope: Scope; allowOtherScope: boolean }
  >();
  const sources = new Map<string, string>();
  const add = (source: string, scope: Scope, allowOtherScope: boolean) => {
    const key = identity(source);
    const previous = sources.get(key);
    if (previous && previous !== source)
      throw new Error(
        `Conflicting sources for ${key}: ${previous} and ${source}`,
      );
    sources.set(key, source);
    const planKey = `${scope}:${key}`;
    const existing = wanted.get(planKey);
    wanted.set(planKey, {
      source,
      scope,
      allowOtherScope: existing
        ? existing.allowOtherScope && allowOtherScope
        : allowOtherScope,
    });
  };
  for (const spec of core) add(spec.source, "user", true);
  for (const selection of selections)
    for (const extra of resolveExtras([selection.id]))
      for (const source of extraSources(extra))
        add(source, selection.scope, selection.scope === "project");
  const seen = new Set<string>();
  for (const requested of wanted.values()) {
    const key = identity(requested.source);
    const matches = items.filter((item) => identity(item.source) === key);
    const project = matches.find((item) => item.scope === "project");
    const user = matches.find((item) => item.scope === "user");
    // An absent project declaration shadows a working user install; repair in place.
    const target =
      project?.state === "missing" &&
      (requested.scope === "project" || requested.allowOtherScope)
        ? project
        : requested.scope === "user"
          ? user?.state === "shadowed" && requested.allowOtherScope
            ? (project ?? user)
            : (user ?? (requested.allowOtherScope ? project : undefined))
          : (project ?? (requested.allowOtherScope ? user : undefined));
    const operationKey = `${target?.scope ?? requested.scope}:${key}`;
    if (seen.has(operationKey)) continue;
    seen.add(operationKey);
    if (!target || target.state === "missing") {
      const source = target?.source ?? requested.source;
      const scope = target?.scope ?? requested.scope;
      repairs.push({
        action: "install",
        entry: { source, scope, state: "missing", name: source, resources: [] },
      });
    } else if (target.state === "disabled") {
      repairs.push({ action: "enable", entry: target });
    } else if (target.state === "enabled") {
      unchanged.push(`${target.source} (${target.scope})`);
    } else {
      warnings.push(
        `${target.source} (${target.scope}) is ${target.state}; use pi config to inspect its filters.`,
      );
    }
  }
  return { repairs, unchanged, warnings };
}

// Pi updates an identity in both scopes. Never ask it to update the same npm package twice.
export function updateAllPlan(
  items: readonly PackageEntry[],
  versions: Map<string, RemotePackage>,
): PackageEntry[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = identity(item.source);
    if (seen.has(key) || !updateFor(item, versions.get(key))) return false;
    seen.add(key);
    return true;
  });
}

export function health(
  cwd: string,
  agentDir: string,
  trusted: boolean,
): string[] {
  const issues: string[] = [];
  for (const [label, dir] of [
    ["User", agentDir],
    ...(trusted ? [["Project", join(cwd, ".pi")]] : []),
  ]) {
    try {
      accessSync(dir);
    } catch {
      issues.push(`${label} directory ${dir} is not accessible.`);
    }
    try {
      readSettings(join(dir, "settings.json"));
    } catch (error) {
      issues.push(
        `${label} settings: ${String(error)}. Repair the JSON before managing packages.`,
      );
    }
  }
  try {
    readLazyPiState(agentDir);
    if (trusted) readLazyPiState(join(cwd, ".pi"));
  } catch (error) {
    issues.push(
      `LazyPi state: ${String(error)}. Repair lazypi.json before syncing.`,
    );
  }
  try {
    const { settings, manager } = createNative(cwd, trusted, agentDir);
    const items = manager.listConfiguredPackages();
    const declarations = new Map<string, number>();
    for (const item of items) {
      const key = `${item.scope}:${identity(item.source)}`;
      declarations.set(key, (declarations.get(key) ?? 0) + 1);
      if (!item.installedPath)
        issues.push(
          `${item.source} (${item.scope}) is declared but missing; use /lazypi sync to repair required packages or pi install to repair others.`,
        );
      else {
        const error = manifest(item.installedPath).error;
        if (error)
          issues.push(
            `${item.source} (${item.scope}) has an invalid package manifest: ${error}.`,
          );
      }
    }
    for (const [key, count] of declarations)
      if (count > 1)
        issues.push(`Duplicate declaration ${key}; inspect Pi settings.`);
    // SettingsManager reads both scopes; malformed selections and conflicts fail closed.
    const selections = readSelections(agentDir, cwd, trusted);
    const { warnings } = syncPlan(
      // Reuse the authoritative inventory classifier for filters and project deltas.
      inventory(settings, manager),
      selections,
    );
    issues.push(...warnings);
  } catch (error) {
    issues.push(
      `Inventory or selections: ${String(error)}. Repair settings or lazypi.json before syncing.`,
    );
  }
  return issues;
}
