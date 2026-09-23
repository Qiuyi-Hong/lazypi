import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DefaultPackageManager,
  getAgentDir,
  SettingsManager,
  type PackageSource,
} from "@earendil-works/pi-coding-agent";

export const resources = ["extensions", "skills", "prompts", "themes"] as const;
export type Scope = "user" | "project";
export type State = "enabled" | "disabled" | "custom" | "shadowed" | "missing";
export type PackageEntry = {
  source: string;
  scope: Scope;
  state: State;
  path?: string;
  name: string;
  description?: string;
  version?: string;
  repository?: string;
  author?: string;
  resources: string[];
  error?: string;
};
export type Manager = Pick<
  DefaultPackageManager,
  "listConfiguredPackages" | "installAndPersist" | "removeAndPersist" | "update"
>;

type Settings = Pick<
  SettingsManager,
  | "getGlobalSettings"
  | "getProjectSettings"
  | "setPackages"
  | "setProjectPackages"
  | "flush"
  | "drainErrors"
>;

export function readSettings(path: string): void {
  if (!existsSync(path)) return;
  const json: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!json || typeof json !== "object" || Array.isArray(json))
    throw new Error(`Invalid Pi settings: ${path}`);
  const packages = (json as { packages?: unknown }).packages;
  if (
    packages !== undefined &&
    (!Array.isArray(packages) ||
      packages.some(
        (entry) =>
          !(
            typeof entry === "string" ||
            (entry &&
              typeof entry === "object" &&
              !Array.isArray(entry) &&
              typeof entry.source === "string")
          ),
      ))
  )
    throw new Error(`Invalid packages in ${path}`);
}

export function stateOf(entry: PackageSource): State {
  if (typeof entry === "string") return "enabled";
  if (
    resources.every(
      (key) => Array.isArray(entry[key]) && entry[key]?.length === 0,
    ) &&
    entry.autoload !== false
  )
    return "disabled";
  if (
    entry.autoload !== false &&
    resources.every((key) => entry[key] === undefined)
  )
    return "enabled";
  return "custom"; // Pi's resource-level selections are not a package-level toggle.
}

function sourceOf(entry: PackageSource): string {
  return typeof entry === "string" ? entry : entry.source;
}

// Pi matches npm packages by name, independent of a pinned version.
export function identity(source: string): string {
  if (!source.startsWith("npm:")) return source;
  const spec = source.slice(4);
  const at = spec.lastIndexOf("@");
  return `npm:${at > 0 ? spec.slice(0, at) : spec}`;
}

export function manifest(path: string): Partial<PackageEntry> {
  try {
    const value: unknown = JSON.parse(
      readFileSync(join(path, "package.json"), "utf8"),
    );
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("package.json must be an object");
    const data = value as Record<string, unknown>;
    if (
      data.pi !== undefined &&
      (!data.pi || typeof data.pi !== "object" || Array.isArray(data.pi))
    )
      throw new Error("pi manifest must be an object");
    const pi = (data.pi ?? {}) as Record<string, unknown>;
    for (const key of resources)
      if (
        pi[key] !== undefined &&
        (!Array.isArray(pi[key]) ||
          (pi[key] as unknown[]).some((value) => typeof value !== "string"))
      )
        throw new Error(`pi.${key} must be an array of paths`);
    return {
      name: typeof data.name === "string" ? data.name : undefined,
      description:
        typeof data.description === "string" ? data.description : undefined,
      version: typeof data.version === "string" ? data.version : undefined,
      repository:
        typeof data.repository === "string"
          ? data.repository
          : typeof data.repository === "object" &&
              data.repository !== null &&
              "url" in data.repository
            ? String(data.repository.url)
            : undefined,
      author:
        typeof data.author === "string"
          ? data.author
          : typeof data.author === "object" &&
              data.author !== null &&
              "name" in data.author
            ? String(data.author.name)
            : undefined,
      resources: resources.filter((key) =>
        Array.isArray(pi[key])
          ? (pi[key] as unknown[]).length > 0
          : existsSync(join(path, key)),
      ),
    };
  } catch (error) {
    return { error: `Invalid package manifest: ${String(error)}` };
  }
}

export function inventory(
  settings: Settings,
  manager: Manager,
): PackageEntry[] {
  const installed = manager.listConfiguredPackages();
  const entries: PackageEntry[] = installed.map(
    ({ source, scope, installedPath }) => {
      const configured =
        scope === "user"
          ? settings.getGlobalSettings().packages
          : settings.getProjectSettings().packages;
      const raw = configured?.find(
        (item) => identity(sourceOf(item)) === identity(source),
      );
      const metadata = installedPath ? manifest(installedPath) : {};
      return {
        source,
        scope,
        path: installedPath,
        state: !installedPath ? "missing" : stateOf(raw ?? source),
        name: metadata.name ?? identity(source).replace(/^npm:/, ""),
        description: metadata.description,
        version: metadata.version,
        repository: metadata.repository,
        author: metadata.author,
        resources: metadata.resources ?? [],
        error: metadata.error,
      };
    },
  );
  const projectEntries = settings.getProjectSettings().packages ?? [];
  const project = new Set(
    entries
      .filter((item) => item.scope === "project")
      .map((item) => identity(item.source)),
  );
  const deltas = new Set(
    projectEntries
      .filter((item) => typeof item !== "string" && item.autoload === false)
      .map((item) => identity(sourceOf(item))),
  );
  for (const item of entries) {
    if (
      item.scope !== "project" ||
      item.path ||
      !deltas.has(identity(item.source))
    )
      continue;
    const base = entries.find(
      (candidate) =>
        candidate.scope === "user" &&
        candidate.path &&
        identity(candidate.source) === identity(item.source),
    );
    if (base) {
      item.path = base.path; // Pi's project autoload delta filters the user package; it is not a missing install.
      item.state = "custom";
      item.name = base.name;
      item.version = base.version;
      item.resources = base.resources;
    }
  }
  for (const item of entries)
    if (
      item.scope === "user" &&
      project.has(identity(item.source)) &&
      item.state !== "missing"
    )
      item.state = deltas.has(identity(item.source)) ? "custom" : "shadowed";
  return entries;
}

export function createNative(
  cwd: string,
  trusted: boolean,
  agentDir = getAgentDir(),
) {
  readSettings(join(agentDir, "settings.json"));
  if (trusted) readSettings(join(cwd, ".pi", "settings.json"));
  const settings = SettingsManager.create(cwd, agentDir, {
    projectTrusted: trusted,
  });
  const manager = new DefaultPackageManager({
    cwd,
    agentDir,
    settingsManager: settings,
  });
  return { settings, manager };
}

export async function togglePackage(
  settings: Settings,
  entry: Pick<PackageEntry, "source" | "scope" | "state" | "name">,
  enabled: boolean,
): Promise<void> {
  if (entry.name === "@qiuyihong/lazypi" && !enabled)
    throw new Error("Use vanilla Pi to disable or remove LazyPi itself.");
  if (
    entry.state === "missing" ||
    entry.state === "shadowed" ||
    entry.state === "custom"
  )
    throw new Error(
      `Cannot toggle ${entry.state} package; use pi config to manage its resources.`,
    );
  const current =
    entry.scope === "user"
      ? settings.getGlobalSettings().packages
      : settings.getProjectSettings().packages;
  const index =
    current?.findIndex(
      (item) => identity(sourceOf(item)) === identity(entry.source),
    ) ?? -1;
  if (!current || index < 0 || stateOf(current[index]!) !== entry.state)
    throw new Error("Package changed; refresh before retrying.");
  if ((entry.state === "enabled") === enabled) return;
  const next = [...current];
  // Preserve unrelated Pi settings fields; only change the four package resource filters.
  const raw = current[index]!;
  if (enabled) {
    const restored = typeof raw === "string" ? { source: raw } : { ...raw };
    for (const key of resources) delete restored[key];
    next[index] =
      Object.keys(restored).length === 1 ? restored.source : restored;
  } else {
    next[index] = {
      ...(typeof raw === "string" ? { source: raw } : raw),
      extensions: [],
      skills: [],
      prompts: [],
      themes: [],
    };
  }
  if (entry.scope === "project") settings.setProjectPackages(next);
  else settings.setPackages(next);
  await settings.flush();
  const errors = settings.drainErrors();
  if (errors.length) throw errors[0]!.error;
}

export function plan(
  action: "install" | "remove" | "update" | "enable" | "disable",
  entry: Pick<PackageEntry, "source" | "scope" | "state">,
): string {
  const { source, scope, state } = entry;
  if (action === "install" && state !== "missing")
    return `${source} is already configured (${state}).`;
  return `${action} ${source}\nScope: ${scope}\nCurrent: ${state}\n${action === "remove" ? "Removes this Pi declaration and installation; other scopes are unaffected." : action === "disable" ? "Keeps the package installed and disables all four Pi resource types." : "Pi will apply this operation using its native package manager."}`;
}
