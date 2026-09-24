import { join } from "node:path";
import { readLazyPiState, writeLazyPiState } from "./bootstrap.ts";
import { core, type ResourceType } from "./catalog.ts";
import { extras } from "./extra-catalog.ts";
export { extras } from "./extra-catalog.ts";
import { identity, type PackageEntry, type Scope } from "./packages.ts";

export const EXTRA_CATEGORIES = {
  "ai-agents": "AI & Agents",
  coding: "Coding",
  "planning-workflow": "Planning & Workflow",
  "web-research": "Web & Research",
  "context-memory": "Context & Memory",
  "models-providers": "Models & Providers",
  integrations: "Integrations",
  "safety-permissions": "Safety & Permissions",
  "ui-experience": "UI & Experience",
  "observability-usage": "Observability & Usage",
  "tools-utilities": "Tools & Utilities",
} as const;
export type ExtraCategory = keyof typeof EXTRA_CATEGORIES;
export const RESOURCE_TYPES = [
  "extension",
  "skill",
  "prompt",
  "theme",
] as const satisfies readonly ResourceType[];
export type PiResourceType = ResourceType;

export type Extra = {
  id: string;
  name: string;
  description: string;
  category: ExtraCategory;
  resourceTypes: readonly PiResourceType[];
  tags: readonly string[];
  source?: string; // Package-free workflows have only dependencies.
  packages?: readonly string[]; // Only for an Extra that installs multiple packages.
  requires?: readonly string[];
  conflicts?: readonly string[];
  default?: boolean;
  priority?: number;
};

export const getExtraCategories = (): ExtraCategory[] =>
  Object.keys(EXTRA_CATEGORIES) as ExtraCategory[];

export const extraSources = (extra: Extra): readonly string[] =>
  extra.source
    ? [extra.source, ...(extra.packages ?? [])]
    : (extra.packages ?? []);

export function normalizeTag(tag: string): string {
  const slug = tag
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    throw new Error(`Invalid Extra tag: ${tag}`);
  return slug;
}

export function validateExtras(registry: readonly Extra[]): void {
  const byId = new Map<string, Extra>();
  const sources = new Set<string>();
  for (const extra of registry) {
    if (typeof extra.id !== "string" || !extra.id.trim())
      throw new Error("Invalid Extra id");
    if (byId.has(extra.id)) throw new Error(`Duplicate Extra id: ${extra.id}`);
    byId.set(extra.id, extra);
    if (typeof extra.name !== "string" || !extra.name.trim())
      throw new Error(`Empty Extra name: ${extra.id}`);
    if (typeof extra.description !== "string" || !extra.description.trim())
      throw new Error(`Invalid Extra description: ${extra.id}`);
    if (!Object.hasOwn(EXTRA_CATEGORIES, extra.category))
      throw new Error(`Unknown Extra category: ${extra.id}`);
    if (
      !Array.isArray(extra.resourceTypes) ||
      extra.resourceTypes.some((type) => !RESOURCE_TYPES.includes(type)) ||
      new Set(extra.resourceTypes).size !== extra.resourceTypes.length
    )
      throw new Error(`Invalid Extra resource type: ${extra.id}`);
    if (
      !Array.isArray(extra.tags) ||
      extra.tags.some(
        (tag) => typeof tag !== "string" || normalizeTag(tag) !== tag,
      ) ||
      new Set(extra.tags).size !== extra.tags.length
    )
      throw new Error(`Malformed Extra tags: ${extra.id}`);
    if (
      extra.source !== undefined &&
      (typeof extra.source !== "string" || !extra.source.trim())
    )
      throw new Error(`Empty Extra source: ${extra.id}`);
    if (
      extra.id !== extra.name ||
      (extra.source?.startsWith("npm:") && extra.id !== extra.source.slice(4))
    )
      throw new Error(
        `Extra id and name must match the package source: ${extra.id}`,
      );
    if (extra.packages !== undefined && !Array.isArray(extra.packages))
      throw new Error(`Invalid Extra packages: ${extra.id}`);
    if (extra.requires !== undefined && !Array.isArray(extra.requires))
      throw new Error(`Invalid Extra dependencies: ${extra.id}`);
    if (extra.conflicts !== undefined && !Array.isArray(extra.conflicts))
      throw new Error(`Invalid Extra conflicts: ${extra.id}`);
    if (extra.default !== undefined && typeof extra.default !== "boolean")
      throw new Error(`Invalid Extra default: ${extra.id}`);
    if (
      extra.priority !== undefined &&
      (!Number.isFinite(extra.priority) || typeof extra.priority !== "number")
    )
      throw new Error(`Invalid Extra priority: ${extra.id}`);
    const declared = extraSources(extra);
    if (!declared.length && !extra.requires?.length)
      throw new Error(`Missing Extra source: ${extra.id}`);
    if (declared.length && !extra.resourceTypes.length)
      throw new Error(`Missing Extra resource types: ${extra.id}`);
    for (const source of declared) {
      if (
        typeof source !== "string" ||
        !/^(npm:|git:|https:\/\/)[^\s]+$/.test(source)
      )
        throw new Error(`Invalid Extra source: ${extra.id}`);
      const key = identity(source);
      if (sources.has(key))
        throw new Error(`Duplicate Extra package source: ${source}`);
      sources.add(key);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function check(id: string): void {
    if (visiting.has(id)) throw new Error(`Extra dependency cycle: ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const required of byId.get(id)!.requires ?? []) {
      if (!byId.has(required))
        throw new Error(`Missing Extra dependency: ${required}`);
      check(required);
    }
    for (const conflict of byId.get(id)!.conflicts ?? [])
      if (!byId.has(conflict))
        throw new Error(`Missing Extra conflict: ${conflict}`);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of byId.keys()) check(id);
}

validateExtras(extras);

export function getExtrasByCategory(
  category: ExtraCategory,
  registry: readonly Extra[] = extras,
): Extra[] {
  const recommended = (extra: Extra) =>
    Number(
      extra.default ||
        core.some((spec) =>
          extraSources(extra).some(
            (source) => identity(source) === identity(spec.source),
          ),
        ),
    );
  return registry
    .filter((extra) => extra.category === category)
    .sort(
      (a, b) =>
        recommended(b) - recommended(a) ||
        (b.priority ?? 0) - (a.priority ?? 0) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    );
}

export function filterExtras(
  registry: readonly Extra[],
  category?: ExtraCategory,
  resourceType: PiResourceType | "all" = "all",
  query = "",
): Extra[] {
  const needle = query.trim().toLowerCase();
  return getExtraCategories()
    .filter((key) => !category || category === key)
    .flatMap((key) => getExtrasByCategory(key, registry))
    .filter(
      (extra) =>
        (resourceType === "all" ||
          extra.resourceTypes.includes(resourceType)) &&
        (!needle ||
          [
            extra.name,
            extra.description,
            EXTRA_CATEGORIES[extra.category],
            ...extra.tags,
            ...extraSources(extra),
          ]
            .join(" ")
            .toLowerCase()
            .includes(needle)),
    );
}

export type Selection = { id: string; scope: Scope };

// Old IDs were persisted in lazypi.json; translate on read, rewrite only on the next selection change.
const legacyIds: Record<string, string> = {
  "ai.subagents": "pi-subagents",
  "dynamic-workflows": "@quintinshaw/pi-dynamic-workflows",
  "tintinweb-subagents": "@tintinweb/pi-subagents",
  "henryqw-subagent": "@henryqw/pi-subagent",
  "gotgenes-subagents": "@gotgenes/pi-subagents",
  ponytail: "@dietrichgebert/ponytail",
  "pi-fff": "@ff-labs/pi-fff",
  "rpiv-todo": "@juicesharp/rpiv-todo",
  plannotator: "@plannotator/pi-extension",
  "pi-plan-mode": "@narumitw/pi-plan-mode",
  "pi-task": "@mjasnikovs/pi-task",
  "research.web": "pi-web-access",
  "ai.research": "research-workflow",
  "ollama-web-search": "@ollama/pi-web-search",
  "pi-firecrawl": "@narumitw/pi-firecrawl",
  "pi-memory-mem0": "@amaster.ai/pi-memory-mem0",
  "doc-bridge": "@agentskit/doc-bridge",
  "pi-linear": "@alasano/pi-linear",
  "pi-pr": "@henryqw/pi-pr",
  "pi-permission-system": "@gotgenes/pi-permission-system",
  "pi-guardrails": "@aliou/pi-guardrails",
  "pi-langfuse": "@langfuse/pi-observability-plugin",
  "pi-usage": "@narumitw/pi-usage",
  "pi-langsmith": "@langchain/langsmith-pi-extension",
  "pi-raindrop": "@raindrop-ai/pi-agent",
  "pi-braintrust": "@braintrust/pi-extension",
  "rpiv-ask-user-question": "@juicesharp/rpiv-ask-user-question",
  "pi-extension-settings": "@juanibiapina/pi-extension-settings",
  "pi-plugins": "@nklisch/pi-plugins",
};
const canonicalExtraId = (id: string): string =>
  Object.hasOwn(legacyIds, id) ? legacyIds[id]! : id;

export function resolveExtras(
  ids: readonly string[],
  registry: readonly Extra[] = extras,
): Extra[] {
  validateExtras(registry);
  const byId = new Map(registry.map((extra) => [extra.id, extra]));
  const visiting = new Set<string>();
  const resolved = new Map<string, Extra>();
  function visit(id: string): void {
    const extra = byId.get(id);
    if (!extra) throw new Error(`Unknown Extra: ${id}`);
    if (visiting.has(id)) throw new Error(`Extra dependency cycle: ${id}`);
    if (resolved.has(id)) return;
    visiting.add(id);
    for (const required of extra.requires ?? []) visit(required);
    visiting.delete(id);
    resolved.set(id, extra);
  }
  for (const id of ids) visit(id);
  for (const extra of resolved.values())
    for (const conflict of extra.conflicts ?? [])
      if (resolved.has(conflict))
        throw new Error(`Extra conflict: ${extra.id} and ${conflict}`);
  return [...resolved.values()];
}

// Only desired selections live in LazyPi files. Pi settings/inventory own actual installations.
export function readSelections(
  agentDir: string,
  cwd: string,
  trusted: boolean,
): Selection[] {
  const user = readLazyPiState(agentDir).enabledExtras ?? [];
  const project = trusted
    ? (readLazyPiState(join(cwd, ".pi")).enabledExtras ?? [])
    : [];
  const result = [
    ...user.map((id) => ({ id: canonicalExtraId(id), scope: "user" as const })),
    ...project.map((id) => ({
      id: canonicalExtraId(id),
      scope: "project" as const,
    })),
  ];
  resolveExtras(result.map((item) => item.id));
  if (
    new Set(result.map((item) => `${item.scope}:${item.id}`)).size !==
    result.length
  )
    throw new Error("Duplicate Extra selection");
  return result;
}

export function saveSelection(
  agentDir: string,
  cwd: string,
  selection: Selection,
  enabled: boolean,
): void {
  const dir = selection.scope === "user" ? agentDir : join(cwd, ".pi");
  const ids = (readLazyPiState(dir).enabledExtras ?? []).map(canonicalExtraId);
  const id = canonicalExtraId(selection.id);
  const next = enabled
    ? [...new Set([...ids, id])]
    : ids.filter((saved) => saved !== id);
  resolveExtras(next);
  writeLazyPiState(dir, { enabledExtras: next });
}

export function requiredBy(
  source: string,
  selections: readonly Selection[],
  registry: readonly Extra[] = extras,
): string[] {
  const owners = core.some((spec) => identity(spec.source) === identity(source))
    ? ["LazyPi Core"]
    : [];
  for (const selection of selections) {
    const closure = resolveExtras([selection.id], registry);
    if (
      closure.some((extra) =>
        extraSources(extra).some((pkg) => identity(pkg) === identity(source)),
      )
    )
      owners.push(`${selection.id} (${selection.scope})`);
  }
  return owners;
}

export type ExtraPlan = {
  selections: Selection[];
  install: { source: string; scope: Scope }[];
  present: PackageEntry[];
  kept: { source: string; requiredBy: string[] }[];
};

export function planExtra(
  selection: Selection,
  enabled: boolean,
  current: readonly Selection[],
  items: readonly PackageEntry[],
  registry: readonly Extra[] = extras,
): ExtraPlan {
  validateExtras(registry); // Conflicting alternatives may coexist in the catalog.
  const selections = current.filter(
    (item) => item.id !== selection.id || item.scope !== selection.scope,
  );
  if (enabled) selections.push(selection);
  resolveExtras(
    selections.map((item) => item.id),
    registry,
  );
  const install: ExtraPlan["install"] = [];
  const present: PackageEntry[] = [];
  const kept: ExtraPlan["kept"] = [];
  const affected = resolveExtras([selection.id], registry);
  const sources = affected.flatMap(extraSources);
  const bySource = new Map<string, string>();
  for (const source of sources) {
    const key = identity(source);
    const previous = bySource.get(key);
    if (previous && previous !== source)
      throw new Error(
        `Conflicting sources for ${key}: ${previous} and ${source}`,
      );
    bySource.set(key, source);
  }
  const packages = [...bySource.values()];
  for (const source of packages) {
    const matches = items.filter(
      (item) => identity(item.source) === identity(source),
    );
    if (!enabled) {
      kept.push({
        source,
        requiredBy: requiredBy(source, selections, registry),
      });
      continue;
    }
    const brokenProject = matches.find(
      (item) => item.scope === "project" && !item.path,
    );
    if (brokenProject && selection.scope === "user")
      throw new Error(
        `Missing project declaration ${brokenProject.source}; repair it before selecting a user-wide Extra.`,
      );
    const relevant = matches.filter(
      (item) => selection.scope === "project" || item.scope === "user",
    );
    const found =
      relevant.find((item) => item.scope === selection.scope && item.path) ??
      relevant.find((item) => item.path);
    if (brokenProject)
      install.push({ source: brokenProject.source, scope: "project" });
    else if (found) present.push(found);
    else {
      const configured = relevant[0];
      install.push({
        source: configured?.source ?? source,
        scope: configured?.scope ?? selection.scope,
      });
    }
  }
  return { selections, install, present, kept };
}
