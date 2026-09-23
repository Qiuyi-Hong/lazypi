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

export function isSetupComplete(agentDir: string): boolean {
  const file = join(agentDir, "lazypi.json");
  if (!existsSync(file)) return false;
  const data: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    (data as { version?: unknown }).version !== 1 ||
    typeof (data as { bootstrapComplete?: unknown }).bootstrapComplete !==
      "boolean"
  )
    throw new Error(`Invalid LazyPi setup state: ${file}`);
  return (data as { bootstrapComplete: boolean }).bootstrapComplete;
}

export function markSetupComplete(agentDir: string): void {
  // Revalidate existing metadata before replacing it; a broken file is not an empty one.
  isSetupComplete(agentDir);
  mkdirSync(agentDir, { recursive: true });
  const target = join(agentDir, "lazypi.json");
  const temp = join(agentDir, `.lazypi-${randomUUID()}.tmp`);
  try {
    writeFileSync(temp, '{"version":1,"bootstrapComplete":true}\n');
    renameSync(temp, target);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
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
