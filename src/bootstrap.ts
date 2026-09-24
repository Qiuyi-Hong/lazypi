import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { SettingsManager } from "@earendil-works/pi-coding-agent";
import { execute } from "./actions.ts";
import { core } from "./catalog.ts";
import {
  identity,
  type Manager,
  type PackageEntry,
  type Scope,
} from "./packages.ts";

type CoreInstall = { source: string; scope: Scope };

export function corePlan(items: PackageEntry[]): {
  missing: CoreInstall[];
  present: PackageEntry[];
} {
  const missing: CoreInstall[] = [];
  const present: PackageEntry[] = [];
  for (const spec of core) {
    const matches = items.filter(
      (item) => identity(item.source) === identity(spec.source),
    );
    // A project declaration shadows a user installation. Repair it in place if missing.
    const brokenProject = matches.find(
      (item) => item.scope === "project" && item.state === "missing",
    );
    if (brokenProject) {
      missing.push({ source: brokenProject.source, scope: "project" });
      continue;
    }
    const found = matches.find((item) => item.path);
    if (found) present.push(found);
    else {
      const configured = matches[0];
      missing.push({
        source: configured?.source ?? spec.source,
        scope: configured?.scope ?? "user",
      });
    }
  }
  return { missing, present };
}

type LazyPiState = {
  version: 1;
  bootstrapComplete?: boolean;
  enabledExtras?: string[];
};

export function readLazyPiState(dir: string): LazyPiState {
  const file = join(dir, "lazypi.json");
  if (!existsSync(file)) return { version: 1 };
  const data: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    (data as LazyPiState).version !== 1 ||
    ("bootstrapComplete" in data &&
      typeof data.bootstrapComplete !== "boolean") ||
    ("enabledExtras" in data &&
      (!Array.isArray(data.enabledExtras) ||
        data.enabledExtras.some((id: unknown) => typeof id !== "string")))
  )
    throw new Error(`Invalid LazyPi state: ${file}`);
  return data as LazyPiState;
}

export function writeLazyPiState(
  dir: string,
  patch: Partial<LazyPiState>,
): void {
  const state = { ...readLazyPiState(dir), ...patch, version: 1 };
  mkdirSync(dir, { recursive: true });
  const target = join(dir, "lazypi.json");
  const temp = join(dir, `.lazypi-${randomUUID()}.tmp`);
  try {
    writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`);
    renameSync(temp, target);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

export function isSetupComplete(agentDir: string): boolean {
  return readLazyPiState(agentDir).bootstrapComplete ?? false;
}

export function markSetupComplete(agentDir: string): void {
  writeLazyPiState(agentDir, { bootstrapComplete: true });
}

export async function installCore(
  missing: CoreInstall[],
  manager: Pick<Manager, "installAndPersist" | "removeAndPersist" | "update">,
  settings: Pick<
    SettingsManager,
    | "getGlobalSettings"
    | "getProjectSettings"
    | "setPackages"
    | "setProjectPackages"
    | "flush"
    | "drainErrors"
  >,
): Promise<{ installed: string[]; error?: string }> {
  const installed: string[] = [];
  for (const { source, scope } of missing) {
    try {
      await execute(
        "install",
        { source, scope, state: "missing", name: source },
        settings,
        manager,
      );
      installed.push(source);
    } catch (error) {
      return {
        installed,
        error: `${source} (${scope}): ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  return { installed };
}
