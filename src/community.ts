import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { core } from "./catalog.ts";
import { extraSources, extras } from "./extras.ts";
import { identity, resources, type PackageEntry } from "./packages.ts";

export type RemotePackage = {
  name: string;
  source: string;
  description: string;
  version: string;
  resources: string[];
  repository?: string;
  author?: string;
  published?: string;
  dependencies?: string[];
};
type Cached<T> = { timestamp: number; value: T };
type Cache = {
  searches: Record<string, Cached<RemotePackage[]>>;
  details: Record<string, Cached<RemotePackage>>;
};
const empty = (): Cache => ({
  searches: Object.create(null) as Cache["searches"],
  details: Object.create(null) as Cache["details"],
});
const ttl = 60 * 60 * 1000;
const npmName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const offline = () => /^(1|true|yes)$/i.test(process.env.PI_OFFLINE ?? "");
const text = (value: unknown) =>
  typeof value === "string"
    ? value.replace(/[\x00-\x1f\x7f-\x9f\x1b]/g, " ").slice(0, 500)
    : "";
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const named = (value: unknown): string =>
  text(typeof value === "string" ? value : record(value).name);
const repository = (value: unknown): string =>
  text(typeof value === "string" ? value : record(value).url);

function parsePackage(value: unknown): RemotePackage | undefined {
  const pkg = record(value);
  if (
    typeof pkg.name !== "string" ||
    !npmName.test(pkg.name) ||
    typeof pkg.version !== "string" ||
    !pkg.version
  )
    return;
  const pi = record(pkg.pi);
  return {
    name: pkg.name,
    source: `npm:${pkg.name}`,
    description: text(pkg.description),
    version: text(pkg.version),
    resources: resources.filter(
      (key) =>
        Array.isArray(pi[key]) &&
        (pi[key] as unknown[]).some((path) => typeof path === "string"),
    ),
    repository: repository(pkg.repository),
    author: named(pkg.author) || named(pkg.publisher),
    published: text(pkg.date),
    dependencies: Object.keys(record(pkg.dependencies)).slice(0, 30).map(text),
  };
}

// Registry search is discovery, not a trust assertion. Only the pi-package keyword is eligible.
export function parseSearch(value: unknown): RemotePackage[] {
  const objects = record(value).objects;
  if (!Array.isArray(objects)) throw new Error("Invalid npm search response");
  const result = new Map<string, RemotePackage>();
  for (const item of objects) {
    const pkg = record(record(item).package);
    if (!Array.isArray(pkg.keywords) || !pkg.keywords.includes("pi-package"))
      continue;
    const parsed = parsePackage(pkg);
    if (parsed) result.set(parsed.name, parsed);
  }
  return [...result.values()];
}

function parseCached(value: unknown): RemotePackage | undefined {
  const pkg = parsePackage(value);
  if (!pkg) return;
  const raw = record(value);
  return {
    ...pkg,
    resources: Array.isArray(raw.resources)
      ? raw.resources.filter(
          (key): key is string =>
            typeof key === "string" &&
            resources.includes(key as (typeof resources)[number]),
        )
      : [],
    published: text(raw.published),
    dependencies: Array.isArray(raw.dependencies)
      ? raw.dependencies
          .filter((key): key is string => typeof key === "string")
          .slice(0, 30)
          .map(text)
      : [],
  };
}

export function parseDetails(value: unknown): RemotePackage {
  const pkg = parsePackage(value);
  if (!pkg) throw new Error("Invalid npm package manifest");
  return pkg;
}

export const isCurated = (source: string): boolean =>
  core.some((spec) => identity(spec.source) === identity(source)) ||
  extras.some((extra) =>
    extraSources(extra).some((item) => identity(item) === identity(source)),
  );

// Pi's native updater skips exact pins. Restrict automatic checks to unversioned npm sources;
// version ranges need Pi's range-aware check, not a misleading registry latest tag.
export function updateFor(
  entry: PackageEntry,
  latest?: RemotePackage,
): boolean {
  if (
    !entry.path ||
    !entry.version ||
    !latest ||
    entry.source !== `npm:${latest.name}`
  )
    return false;
  const installed = entry.version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?$/);
  const remote = latest.version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!installed || !remote) return false;
  for (let i = 1; i <= 3; i++) {
    const diff = Number(remote[i]) - Number(installed[i]);
    if (diff !== 0) return diff > 0;
  }
  return !!installed[4];
}

export class CommunityRegistry {
  private cache: Cache;
  private dir: string;
  private request: typeof fetch;
  private now: () => number;
  constructor(
    dir: string,
    request: typeof fetch = fetch,
    now: () => number = Date.now,
  ) {
    this.dir = dir;
    this.request = request;
    this.now = now;
    try {
      const value = record(JSON.parse(readFileSync(this.file(), "utf8")));
      const searches = record(value.searches);
      const details = record(value.details);
      this.cache = empty();
      for (const [key, raw] of Object.entries(searches)) {
        const item = record(raw);
        if (!Array.isArray(item.value) || !Number.isFinite(item.timestamp))
          continue;
        this.cache.searches[key] = {
          timestamp: item.timestamp as number,
          value: item.value
            .map(parseCached)
            .filter((pkg): pkg is RemotePackage => !!pkg),
        };
      }
      for (const [key, raw] of Object.entries(details)) {
        const item = record(raw);
        const pkg = parseCached(item.value);
        if (pkg && Number.isFinite(item.timestamp) && key === pkg.name)
          this.cache.details[key] = {
            timestamp: item.timestamp as number,
            value: pkg,
          };
      }
    } catch {
      this.cache = empty();
    }
  }
  private file() {
    return join(this.dir, "lazypi-cache.json");
  }
  private save() {
    mkdirSync(this.dir, { recursive: true });
    const file = this.file();
    const temp = join(this.dir, `.lazypi-cache-${randomUUID()}.tmp`);
    try {
      writeFileSync(temp, `${JSON.stringify(this.cache)}\n`);
      renameSync(temp, file);
    } catch (error) {
      rmSync(temp, { force: true });
      throw error;
    }
  }
  private fresh<T>(entry?: Cached<T>): boolean {
    return (
      !!entry &&
      entry.timestamp <= this.now() &&
      this.now() - entry.timestamp < ttl
    );
  }
  private async json(url: string): Promise<unknown> {
    const response = await this.request(url, {
      signal: AbortSignal.timeout(8000),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`npm registry: HTTP ${response.status}`);
    return response.json();
  }
  cachedSearch(query: string): RemotePackage[] {
    return (
      this.cache.searches[query.trim().toLowerCase().slice(0, 80)]?.value ?? []
    );
  }
  cachedDetails(name: string): RemotePackage | undefined {
    return this.cache.details[name]?.value;
  }
  async search(query: string, force = false): Promise<RemotePackage[]> {
    const key = query.trim().toLowerCase().slice(0, 80);
    const cached = this.cache.searches[key];
    if (offline() || (!force && this.fresh(cached))) return cached?.value ?? [];
    const url = new URL("https://registry.npmjs.org/-/v1/search");
    url.searchParams.set("text", `keywords:pi-package${key ? ` ${key}` : ""}`);
    url.searchParams.set("size", "30");
    const result = parseSearch(await this.json(url.toString()));
    for (const pkg of result)
      if (this.cache.details[pkg.name]?.value.version !== pkg.version)
        delete this.cache.details[pkg.name];
    this.cache.searches[key] = { timestamp: this.now(), value: result };
    this.save();
    return result;
  }
  async details(name: string, force = false): Promise<RemotePackage> {
    if (!npmName.test(name)) throw new Error("Invalid npm package name");
    const cached = this.cache.details[name];
    if (offline()) {
      if (cached) return cached.value;
      throw new Error("Offline: package details not cached");
    }
    if (!force && this.fresh(cached)) return cached!.value;
    const pkg = parseDetails(
      await this.json(
        `https://registry.npmjs.org/${encodeURIComponent(name)}/latest`,
      ),
    );
    if (pkg.name !== name) throw new Error("npm package name mismatch");
    this.cache.details[name] = { timestamp: this.now(), value: pkg };
    this.save();
    return pkg;
  }
  // Local inventory remains authoritative. Network failures leave previously cached versions intact.
  async checkUpdates(
    items: readonly PackageEntry[],
    force = false,
  ): Promise<number> {
    if (offline()) return 0;
    const names = [
      ...new Set(
        items
          .filter(
            (item) =>
              item.path &&
              item.version &&
              item.source.startsWith("npm:") &&
              npmName.test(item.source.slice(4)),
          )
          .map((item) => item.source.slice(4)),
      ),
    ];
    let next = 0;
    let failed = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, names.length) }, async () => {
        while (next < names.length) {
          const name = names[next++]!;
          try {
            await this.details(name, force);
          } catch {
            failed++; // Keep cached versions on registry failure.
          }
        }
      }),
    );
    return failed;
  }
}
