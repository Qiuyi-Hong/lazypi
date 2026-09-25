import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type TUI,
} from "@earendil-works/pi-tui";
import { core } from "./catalog.ts";
import { isCurated, updateFor, type RemotePackage } from "./community.ts";
import {
  EXTRA_CATEGORIES,
  RESOURCE_TYPES,
  extraSources,
  extras,
  filterExtras,
  getExtraCategories,
  requiredBy,
  resolveExtras,
  type Extra,
  type ExtraCategory,
  type PiResourceType,
  type Selection,
} from "./extras.ts";
import { identity, type PackageEntry } from "./packages.ts";

export const sections = [
  "Packages",
  "Enabled",
  "Disabled",
  "Core",
  "Extras",
  "Community",
  "Updates",
  "Settings",
] as const;
export type Section = (typeof sections)[number];
const sectionShortcuts: Record<Section, string> = {
  Packages: "P",
  Enabled: "E",
  Disabled: "D",
  Core: "C",
  Extras: "X",
  Community: "M",
  Updates: "T",
  Settings: "S",
};
type Preference = "autoCheckUpdates";
export type Choice = {
  action:
    | "install"
    | "remove"
    | "update"
    | "enable"
    | "disable"
    | "search"
    | "refresh"
    | "extra"
    | "update-all"
    | "close";
  entry?: PackageEntry;
  source?: string;
  extra?: Extra;
  enabled?: boolean;
};
type Row = {
  name: string;
  description: string;
  state: string;
  entry?: PackageEntry;
  source?: string;
  extra?: Extra;
  category?: ExtraCategory;
  metadata?: string;
  remote?: RemotePackage;
};

export class ManagerPopup implements Component {
  private selected = 0;
  private details = false;
  private tui: TUI;
  private theme: Theme;
  private done: (value: Choice) => void;
  private items: PackageEntry[];
  private selections: Selection[];
  public section: Section;
  private query: string;
  public category?: ExtraCategory;
  public resourceType: PiResourceType | "all";
  private community: RemotePackage[];
  private versions: Map<string, RemotePackage>;
  private loadDetails?: (name: string) => Promise<RemotePackage>;
  private loading: boolean;
  private remoteError?: string;
  private detailsByName = new Map<string, RemotePackage>();
  private extraPackages = new Map<string, string[]>();
  private disposed = false;
  private preferences: { autoCheckUpdates: boolean };
  private onSettingChange: (setting: Preference, enabled: boolean) => boolean;
  constructor(
    tui: TUI,
    theme: Theme,
    done: (value: Choice) => void,
    items: PackageEntry[],
    section: Section,
    query = "",
    selections: Selection[] = [],
    category?: ExtraCategory,
    resourceType: PiResourceType | "all" = "all",
    remote: {
      community?: RemotePackage[];
      versions?: Map<string, RemotePackage>;
      loading?: boolean;
      error?: string;
      loadDetails?: (name: string) => Promise<RemotePackage>;
    } = {},
    preferences = { autoCheckUpdates: false },
    onSettingChange: (setting: Preference, enabled: boolean) => boolean = () =>
      true,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.done = done;
    this.items = items;
    this.selections = selections;
    this.section = section;
    this.query = query;
    this.category = category;
    this.resourceType = resourceType;
    this.community = remote.community ?? [];
    this.versions = remote.versions ?? new Map();
    this.loading = remote.loading ?? false;
    this.remoteError = remote.error;
    this.loadDetails = remote.loadDetails;
    this.preferences = preferences;
    this.onSettingChange = onSettingChange;
  }

  setRemote(
    community: RemotePackage[],
    versions: Map<string, RemotePackage>,
    loading = false,
    error?: string,
  ): void {
    if (this.disposed) return;
    const selected = this.rows()[this.selected]?.source;
    this.community = community;
    this.versions = versions;
    this.loading = loading;
    this.remoteError = error;
    const index = this.rows().findIndex((row) => row.source === selected);
    if (index >= 0) this.selected = index;
    this.tui.requestRender();
  }

  private sourcesFor(extra: Extra): string[] {
    let sources = this.extraPackages.get(extra.id);
    if (!sources) {
      sources = resolveExtras([extra.id]).flatMap(extraSources);
      this.extraPackages.set(extra.id, sources);
    }
    return sources;
  }

  private rows(): Row[] {
    const selectedExtras =
      this.section === "Extras"
        ? new Set(
            resolveExtras(this.selections.map((selection) => selection.id)).map(
              (extra) => extra.id,
            ),
          )
        : new Set<string>();
    const items: Row[] =
      this.section === "Settings"
        ? ([
            {
              name: "Auto-check updates at startup",
              description:
                "Check npm asynchronously; notify only when newer versions are found.",
              state: this.preferences.autoCheckUpdates ? "on" : "off",
              source: "autoCheckUpdates",
            },
          ] satisfies Row[])
        : this.section === "Extras"
          ? !this.category && !this.query
            ? getExtraCategories().map((category) => ({
                name: EXTRA_CATEGORIES[category],
                description: `${filterExtras(extras, category, this.resourceType).length} Extras`,
                state: "",
                category,
              }))
            : filterExtras(
                extras,
                this.category,
                this.resourceType,
                this.query,
              ).map((extra) => {
                const direct = this.selections.filter(
                  (item) => item.id === extra.id,
                );
                const sources = this.sourcesFor(extra);
                const installed = sources.filter((source) =>
                  this.items.some(
                    (item) =>
                      item.path && identity(item.source) === identity(source),
                  ),
                ).length;
                const installation =
                  installed === sources.length
                    ? "installed"
                    : installed
                      ? "partially installed"
                      : "not installed";
                const implied = selectedExtras.has(extra.id);
                return {
                  name: extra.name,
                  description: extra.description,
                  category: extra.category,
                  metadata: `${extra.resourceTypes.join(" · ") || "workflow"}  |  ${extra.tags.join(" · ")}`,
                  state: `${
                    direct.length
                      ? `selected (${direct.map((item) => item.scope).join(", ")})`
                      : implied
                        ? "required"
                        : "available"
                  } · ${installation}`,
                  extra,
                };
              })
          : this.section === "Community"
            ? this.community
                .filter((pkg) => !isCurated(pkg.source))
                .map((pkg) => {
                  const matches = this.items.filter(
                    (item) => identity(item.source) === pkg.source,
                  );
                  const entry =
                    matches.find(
                      (item) => item.scope === "project" && item.path,
                    ) ??
                    matches.find((item) => item.path) ??
                    matches[0];
                  return {
                    name: pkg.name,
                    description: pkg.description || pkg.source,
                    state: `${entry ? `${entry.state} (${entry.scope})` : "not installed"} · latest ${pkg.version} · unverified`,
                    source: pkg.source,
                    entry,
                    remote: pkg,
                  };
                })
            : this.section === "Updates"
              ? this.items
                  .filter((item) =>
                    updateFor(item, this.versions.get(identity(item.source))),
                  )
                  .map((entry) => ({
                    name: entry.name,
                    description: `${entry.source} · ${entry.scope} · ${entry.state}`,
                    state: `${entry.version} → ${this.versions.get(identity(entry.source))!.version}`,
                    entry,
                    source: entry.source,
                    remote: this.versions.get(identity(entry.source)),
                  }))
              : this.section === "Core"
                ? core.map((spec) => {
                    const entry = this.items.find(
                      (item) => identity(item.source) === identity(spec.source),
                    );
                    return {
                      name: spec.name,
                      description: `${spec.category} · ${spec.description}`,
                      state: entry?.state ?? "not installed",
                      entry,
                      source: spec.source,
                    };
                  })
                : this.items
                    .filter(
                      (item) =>
                        this.section === "Packages" ||
                        item.state === this.section.toLowerCase(),
                    )
                    .map((entry) => ({
                      name: entry.name,
                      description: `${entry.source} · ${entry.scope}`,
                      state: entry.state,
                      entry,
                      remote: this.versions.get(identity(entry.source)),
                    }));
    return this.section === "Extras" || this.section === "Community"
      ? items
      : rowsFilter(items, this.query);
  }

  render(width: number): string[] {
    const w = Math.max(1, Math.min(width, 76));
    const line = (text: string) => truncateToWidth(text, w);
    const rows = this.rows();
    this.selected = Math.min(this.selected, Math.max(0, rows.length - 1));
    const current = rows[this.selected];
    const header = sections.map((s) => {
      const label = `${s} (${sectionShortcuts[s]})`;
      return s === this.section ? this.theme.fg("accent", `[${label}]`) : label;
    });
    const lines = [
      this.theme.fg("accent", line("LazyPi · native Pi packages")),
      line(header.slice(0, 4).join(" ")),
      line(header.slice(4).join(" ")),
      line(
        this.section === "Extras"
          ? `Extras${this.category ? ` / ${EXTRA_CATEGORIES[this.category]}` : ""} · Type: ${this.resourceType === "all" ? "All" : `${this.resourceType}s`}`
          : `Search: ${this.query || "(press /)"}`,
      ),
      ...(this.section === "Extras"
        ? [line(`Search: ${this.query || "(press /)"}`)]
        : []),
      "",
    ];
    if (this.details && current) {
      const e = current.entry;
      const remote =
        current.remote &&
        (this.detailsByName.get(current.remote.name) ?? current.remote);
      lines.push(line(current.name), line(current.description));
      if (!current.extra)
        lines.push(
          line(`Source: ${e?.source ?? current.source}`),
          line(
            `Scope: ${e?.scope ?? "choose at install"} · State: ${current.state}`,
          ),
          line(
            `Version: ${e?.version ?? "unknown"} · Resources: ${e?.resources.join(", ") || "unknown"}`,
          ),
          line(
            `Repository: ${e?.repository ?? "unknown"} · Author: ${e?.author ?? "unknown"}`,
          ),
        );
      if (current.extra) {
        const extra = current.extra;
        lines.push(
          line(
            `Category: ${EXTRA_CATEGORIES[extra.category]} · ${current.state}`,
          ),
          line(`Resources: ${extra.resourceTypes.join(", ") || "workflow"}`),
          line(`Tags: ${extra.tags.join(", ")}`),
          line(`Requires: ${extra.requires?.join(", ") || "none"}`),
          line(`Packages: ${this.sourcesFor(extra).join(", ") || "none"}`),
          line("Disabling a selection does not uninstall packages."),
        );
      } else if (e || current.source) {
        lines.push(
          line(
            `Required by: ${requiredBy(e?.source ?? current.source!, this.selections).join(", ") || "no LazyPi selection"}`,
          ),
        );
      }
      if (remote)
        lines.push(
          line(`Community · unverified · latest ${remote.version}`),
          line(
            `Provides: ${remote.resources.join(", ") || "unknown (manifest not loaded)"}`,
          ),
          line(
            `Repository: ${remote.repository || "unknown"} · Author: ${remote.author || "unknown"}`,
          ),
          line(`Published: ${remote.published || "unknown"}`),
          line(`Dependencies: ${remote.dependencies?.join(", ") || "unknown"}`),
        );
      if (e?.error) lines.push(line(e.error));
    } else if (!rows.length)
      lines.push(
        line(
          this.loading
            ? "Loading npm metadata…"
            : (this.remoteError ?? "No packages in this view."),
        ),
      );
    else {
      const visible =
        this.section === "Packages" ||
        this.section === "Enabled" ||
        this.section === "Disabled"
          ? Math.max(1, Math.min(12, Math.min(this.tui.terminal.rows, 26) - 12))
          : Math.max(
              1,
              Math.min(
                7,
                Math.floor(
                  (this.tui.terminal.rows - 12) /
                    (this.section === "Extras" && (this.category || this.query)
                      ? 4
                      : 2),
                ),
              ),
            );
      const start = Math.max(
        0,
        Math.min(
          this.selected - Math.floor(visible / 2),
          rows.length - visible,
        ),
      );
      for (const [offset, item] of rows
        .slice(start, start + visible)
        .entries()) {
        const selected = start + offset === this.selected;
        if (
          this.section === "Extras" &&
          !this.category &&
          this.query &&
          item.extra &&
          item.category &&
          (offset === 0 || rows[start + offset - 1]?.category !== item.category)
        )
          lines.push(
            this.theme.fg("accent", line(EXTRA_CATEGORIES[item.category])),
          );
        if (
          this.section === "Packages" ||
          this.section === "Enabled" ||
          this.section === "Disabled"
        ) {
          const status = `  ${item.state} · ${item.entry!.scope}`;
          const name = truncateToWidth(
            item.name,
            Math.max(1, w - 4 - visibleWidth(status)),
          );
          lines.push(line(`${selected ? "›" : " "} ${name}${status}`));
        } else {
          lines.push(
            line(`${selected ? "›" : " "} ${item.name}  ${item.state}`),
          );
          lines.push(this.theme.fg("muted", line(`  ${item.description}`)));
        }
        if (item.metadata)
          lines.push(this.theme.fg("muted", line(`  ${item.metadata}`)));
      }
      if (rows.length > visible)
        lines.push(line(`${this.selected + 1}/${rows.length}`));
    }
    if (this.remoteError && rows.length)
      lines.push(line(`Registry: ${this.remoteError}`));
    else if (this.loading && rows.length)
      lines.push(line("Refreshing npm metadata…"));
    lines.push(
      "",
      this.theme.fg(
        "muted",
        line("Tab sections · ↑↓ select · Enter details · / search"),
      ),
      this.theme.fg(
        "muted",
        line(
          this.section === "Settings"
            ? "Space/Enter toggle setting · Esc close"
            : this.section === "Extras"
              ? "Enter category/details · f filter type · Space toggle · i install/select · x deselect · Esc back"
              : this.section === "Community"
                ? "i install · Enter details · e/d toggle · x remove · r refresh registry · Esc close"
                : this.section === "Updates"
                  ? "u update · U update all · r refresh registry · Esc close"
                  : "i install · e enable · d disable · Space toggle · x remove · u update · r refresh · Esc close",
        ),
      ),
    );
    if (w < 4) return lines.map((s) => truncateToWidth(s, w));
    const inner = w - 2;
    const border = this.theme.fg("border", "─".repeat(inner));
    return [
      `${this.theme.fg("border", "╭")}${border}${this.theme.fg("border", "╮")}`,
      ...lines.map((text) => {
        const content = truncateToWidth(text, inner);
        return `${this.theme.fg("border", "│")}${content}${" ".repeat(Math.max(0, inner - visibleWidth(content)))}${this.theme.fg("border", "│")}`;
      }),
      `${this.theme.fg("border", "╰")}${border}${this.theme.fg("border", "╯")}`,
    ];
  }

  handleInput(data: string): void {
    const rows = this.rows();
    const shortcut =
      data === "I"
        ? "Packages"
        : sections.find((section) => sectionShortcuts[section] === data);
    if (matchesKey(data, Key.escape)) {
      if (this.details) this.details = false;
      else if (this.section === "Extras" && this.category) {
        this.category = undefined;
        this.selected = 0;
      } else {
        this.done({ action: "close" });
        return;
      }
      this.tui.requestRender();
    } else if (
      shortcut ||
      matchesKey(data, Key.tab) ||
      matchesKey(data, Key.shift("tab"))
    ) {
      const delta = matchesKey(data, Key.tab) ? 1 : -1;
      const tabs: readonly Section[] = sections;
      this.section =
        shortcut ??
        tabs[
          (tabs.indexOf(this.section) + delta + tabs.length) % tabs.length
        ] ??
        tabs[0]!;
      this.selected = 0;
      this.details = false;
      if (this.section === "Community" || this.section === "Updates")
        this.done({ action: "refresh" });
      else this.tui.requestRender();
    } else if (matchesKey(data, Key.down) || data === "j") {
      this.selected = Math.min(rows.length - 1, this.selected + 1);
      this.tui.requestRender();
    } else if (matchesKey(data, Key.up) || data === "k") {
      this.selected = Math.max(0, this.selected - 1);
      this.tui.requestRender();
    } else if (
      this.section === "Settings" &&
      (data === " " || matchesKey(data, Key.enter))
    ) {
      const setting = rows[this.selected]?.source;
      if (setting === "autoCheckUpdates") {
        const enabled = !this.preferences[setting];
        if (this.onSettingChange(setting, enabled)) {
          this.preferences[setting] = enabled;
          this.tui.requestRender();
        }
      }
    } else if (this.section === "Updates" && data === "U")
      this.done({ action: "update-all" });
    else if (data === "/" && this.section !== "Settings")
      this.done({ action: "search" });
    else if (this.section === "Extras" && data === "f") {
      const filters: (PiResourceType | "all")[] = ["all", ...RESOURCE_TYPES];
      this.resourceType =
        filters[(filters.indexOf(this.resourceType) + 1) % filters.length]!;
      this.selected = 0;
      this.details = false;
      this.tui.requestRender();
    } else if (data === "r") this.done({ action: "refresh" });
    else if (
      this.section === "Extras" &&
      (data === " " || data === "i" || data === "x")
    ) {
      const row = rows[this.selected];
      if (row?.extra)
        this.done({
          action: "extra",
          extra: row.extra,
          enabled:
            data === " " ? !row.state.startsWith("selected") : data === "i",
        });
    } else if (data === "i") {
      const row = rows[this.selected];
      this.done({
        action: "install",
        source: row?.entry ? undefined : row?.source,
        entry: row?.entry,
      });
    } else if (matchesKey(data, Key.enter)) {
      const row = rows[this.selected];
      if (this.section === "Extras" && row?.category && !row.extra) {
        this.category = row.category;
        this.selected = 0;
      } else {
        this.details = !this.details;
        if (this.details && row?.remote && this.loadDetails) {
          void this.loadDetails(row.remote.name)
            .then((pkg) => {
              if (this.disposed) return;
              this.detailsByName.set(pkg.name, {
                ...pkg,
                published: pkg.published || row.remote!.published,
              });
              this.tui.requestRender();
            })
            .catch((error: unknown) => {
              if (this.disposed) return;
              this.remoteError =
                error instanceof Error ? error.message : String(error);
              this.tui.requestRender();
            });
        }
      }
      this.tui.requestRender();
    } else {
      const entry = rows[this.selected]?.entry;
      if (!entry) return;
      const action =
        data === " "
          ? entry.state === "disabled"
            ? "enable"
            : entry.state === "enabled"
              ? "disable"
              : undefined
          : data === "e"
            ? "enable"
            : data === "d"
              ? "disable"
              : data === "x"
                ? "remove"
                : data === "u"
                  ? "update"
                  : undefined;
      if (action) this.done({ action, entry });
    }
  }
  invalidate(): void {}
  dispose(): void {
    this.disposed = true;
  }
}

export function rowsFilter<T extends { name: string; description: string }>(
  rows: T[],
  query: string,
): T[] {
  const needle = query.toLowerCase();
  return rows.filter((item) =>
    `${item.name} ${item.description}`.toLowerCase().includes(needle),
  );
}
