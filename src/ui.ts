import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
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
  "Core",
  "Extras",
  "Community",
  "Updates",
  "Settings",
] as const;
export type Section = (typeof sections)[number] | "Enabled" | "Disabled";
const sectionShortcuts: Record<(typeof sections)[number], string> = {
  Packages: "P",
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

const plain = (value: string) => value.replace(/[\x00-\x1f\x7f-\x9f]/g, " ");

function extraRow(
  name: string,
  state: string,
  marker: string,
  width: number,
): { lines: string[]; yieldRest: boolean } {
  const prefix = `${marker} `;
  const status = `  ${state}`;
  const room = width - visibleWidth(prefix) - visibleWidth(status);
  if (room >= 1)
    return {
      lines: [`${prefix}${truncateToWidth(plain(name), room)}${status}`],
      yieldRest: false,
    };
  const short = state.replace(/ \([^)]*\)/, "");
  const compact =
    visibleWidth(short) <= width
      ? short
      : short.replace("partially installed", "partial install");
  return {
    lines: [
      truncateToWidth(`${prefix}${plain(name)}`, width),
      truncateToWidth(compact, width),
    ],
    yieldRest: true,
  };
}

function preview(row: Row): string[] {
  const entry = row.entry;
  const lines = [
    plain(row.name),
    `Source: ${plain(entry?.source ?? row.source ?? "")}`,
    `Scope: ${plain(entry?.scope ?? "")}`,
    `State: ${plain(row.state)}`,
  ];
  if (entry?.version) lines.push(`Version: ${plain(entry.version)}`);
  if (entry?.resources.length)
    lines.push(`Resources: ${plain(entry.resources.join(", "))}`);
  if (entry?.description) lines.push(plain(entry.description));
  if (entry?.repository) lines.push(`Repository: ${plain(entry.repository)}`);
  if (entry?.author) lines.push(`Author: ${plain(entry.author)}`);
  if (entry?.error) lines.push(plain(entry.error));
  return lines;
}

export class ManagerPopup implements Component {
  private selected = 0;
  private details = false;
  private detailOffset = 0;
  private detailLimit = 0;
  private tui: TUI;
  private theme: Theme;
  private done: (value: Choice) => void;
  private items: PackageEntry[];
  private selections: Selection[];
  public section: Section;
  public query: string;
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

  private extraFacts(extra: Extra): string[] {
    const direct = this.selections.filter((item) => item.id === extra.id);
    const sources = this.sourcesFor(extra);
    return [
      `Scope: ${direct.map((item) => item.scope).join(", ") || "not selected"}`,
      ...(sources.length
        ? sources.flatMap((source) => {
            const matches = this.items.filter(
              (item) => identity(item.source) === identity(source),
            );
            return matches.length
              ? matches.map(
                  (item) => `${item.state} · ${item.scope} · ${plain(source)}`,
                )
              : [`not installed · ${plain(source)}`];
          })
        : ["Packages: none"]),
    ];
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
                    state: entry?.state ?? "not installed",
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
    const w = Math.max(1, width);
    const height = Math.min(26, Math.max(1, this.tui.terminal.rows - 2));
    const inner = Math.max(1, w - 4);
    const line = (text: string) => truncateToWidth(text, inner);
    const rows = this.rows();
    this.selected = Math.min(this.selected, Math.max(0, rows.length - 1));
    const current = rows[this.selected];
    const active =
      this.section === "Enabled" || this.section === "Disabled"
        ? "Packages"
        : this.section;
    const header = sections.map((s) => {
      const label = `${s} (${sectionShortcuts[s]})`;
      return s === active
        ? this.theme.fg("accent", `[${label}]`)
        : this.theme.fg("muted", label);
    });
    if (w < 12 || height < 6) {
      const prompt = ["Esc · resize"];
      return this.frame(prompt, w, height);
    }
    const grouped = (labels: string[]) =>
      `${labels.slice(0, 3).join("  ")}  │  ${labels.slice(3, 5).join("  ")}  │  ${labels[5]}`;
    const wideNav = grouped(header);
    const smallNav = grouped(
      sections.map((s) =>
        s === active
          ? this.theme.fg("accent", `[${s}]`)
          : this.theme.fg("muted", s),
      ),
    );
    const navigation =
      height < 14
        ? `${active} · Tab sections`
        : visibleWidth(wideNav) <= inner
          ? wideNav
          : visibleWidth(smallNav) <= inner
            ? smallNav
            : `${active} · Tab sections`;
    const context =
      this.section === "Extras"
        ? `Extras${this.category ? ` / ${EXTRA_CATEGORIES[this.category]}` : ""} · Type: ${this.resourceType === "all" ? "All" : `${this.resourceType}s`} · Search: ${this.query || "(press /)"}`
        : this.section === "Enabled" || this.section === "Disabled"
          ? `Packages · ${this.section} · Search: ${this.query || "(press /)"}`
          : `Search: ${this.query || "(press /)"}`;
    const lines =
      height < 8
        ? [
            this.theme.fg(
              "accent",
              line(
                `${active}${active !== this.section ? `/${this.section}` : ""} · Tab`,
              ),
            ),
          ]
        : [
            this.theme.fg("accent", line("LazyPi · native Pi packages")),
            line(navigation),
            ...(height >= 10 ? [line(context)] : []),
            ...(height >= 16 ? [""] : []),
          ];
    const footerRows = height >= 16 ? 2 : 1;
    const bodySize = height - 2 - lines.length - footerRows;
    const body: string[] = [];
    if (this.details && current) {
      const detail: string[] = [];
      const e = current.entry;
      const remote =
        current.remote &&
        (this.detailsByName.get(current.remote.name) ?? current.remote);
      detail.push(plain(current.name));
      if (this.section === "Community") detail.push("unverified");
      if (!current.extra)
        detail.push(
          plain(`Source: ${e?.source ?? current.source ?? ""}`),
          ...(this.section === "Community"
            ? [
                plain(`Scope: ${e?.scope ?? "choose at install"}`),
                plain(`State: ${e?.state ?? "not installed"}`),
              ]
            : [
                plain(
                  `Scope: ${e?.scope ?? "choose at install"} · State: ${current.state}`,
                ),
              ]),
          plain(
            `Version: ${e?.version ?? "unknown"} · Resources: ${e?.resources.join(", ") || "unknown"}`,
          ),
          plain(
            `Repository: ${e?.repository ?? "unknown"} · Author: ${e?.author ?? "unknown"}`,
          ),
        );
      detail.push(plain(current.description));
      if (current.extra) {
        const extra = current.extra;
        detail.push(
          `Category: ${EXTRA_CATEGORIES[extra.category]} · ${current.state}`,
          `Resources: ${extra.resourceTypes.join(", ") || "workflow"}`,
          `Tags: ${extra.tags.join(", ")}`,
          `Requires: ${extra.requires?.join(", ") || "none"}`,
          ...this.extraFacts(extra),
          "Disabling a selection does not uninstall packages.",
        );
      } else if (e || current.source) {
        detail.push(
          `Required by: ${requiredBy(e?.source ?? current.source!, this.selections).join(", ") || "no LazyPi selection"}`,
        );
      }
      if (remote)
        detail.push(
          this.section === "Community"
            ? `Latest: ${plain(remote.version)}`
            : `Community · unverified · latest ${plain(remote.version)}`,
          `Provides: ${plain(remote.resources.join(", ")) || "unknown (manifest not loaded)"}`,
          `Repository: ${plain(remote.repository || "unknown")} · Author: ${plain(remote.author || "unknown")}`,
          `Published: ${plain(remote.published || "unknown")}`,
          `Dependencies: ${plain(remote.dependencies?.join(", ") || "unknown")}`,
        );
      if (e?.error) detail.push(plain(e.error));
      const wrapped = detail.flatMap((text) => wrapTextWithAnsi(text, inner));
      this.detailLimit = Math.max(0, wrapped.length - bodySize);
      this.detailOffset = Math.min(this.detailOffset, this.detailLimit);
      body.push(
        ...wrapped.slice(this.detailOffset, this.detailOffset + bodySize),
      );
    } else if (!rows.length)
      body.push(
        line(
          this.loading
            ? "Loading npm metadata…"
            : (this.remoteError ?? "No packages in this view."),
        ),
      );
    else {
      const packageRows =
        this.section === "Packages" ||
        this.section === "Enabled" ||
        this.section === "Disabled";
      const visible =
        packageRows || this.section === "Settings"
          ? Math.max(1, bodySize - 1)
          : Math.max(
              1,
              Math.floor((bodySize - 1) / (this.section === "Extras" ? 3 : 2)),
            );
      const gutter = " │ ";
      const listMin = 26;
      const paneMin = 22;
      const paneWidth = Math.max(
        paneMin,
        Math.min(40, Math.floor((inner - gutter.length) * 0.42)),
      );
      // ponytail: fit gate, not a tuned breakpoint. Raise if state and source no longer both fit.
      const roomy =
        (this.section === "Packages" || !!current?.extra) &&
        inner >= listMin + gutter.length + paneMin &&
        bodySize >= 10 &&
        (this.section === "Packages" || visible >= 4) &&
        rows.every(
          (item) =>
            !item.extra ||
            visibleWidth(`${plain(item.name)}  ${item.state}`) + 2 <=
              inner - gutter.length - paneWidth,
        );
      const pane = roomy ? paneWidth : 0;
      const listWidth = roomy ? inner - gutter.length - pane : 0;
      const start = Math.max(
        0,
        Math.min(
          this.selected - Math.floor(visible / 2),
          rows.length - visible,
        ),
      );
      const listLines: string[] = [];
      for (const [offset, item] of rows
        .slice(start, start + visible)
        .entries()) {
        const selected = start + offset === this.selected;
        if (
          this.section === "Extras" &&
          !this.category &&
          this.query &&
          bodySize >= 4 &&
          item.extra &&
          item.category &&
          (offset === 0 || rows[start + offset - 1]?.category !== item.category)
        )
          body.push(
            this.theme.fg("accent", line(EXTRA_CATEGORIES[item.category])),
          );
        if (packageRows) {
          const status = `  ${item.state} · ${item.entry!.scope}`;
          const name = truncateToWidth(
            plain(item.name),
            Math.max(1, (roomy ? listWidth : inner) - 2 - visibleWidth(status)),
          );
          const row = `${selected ? "›" : " "} ${name}${status}`;
          if (roomy) listLines.push(row);
          else body.push(this.focus(line(row), selected, item.state));
        } else if (item.extra) {
          const fitted = extraRow(
            item.name,
            item.state,
            selected ? "›" : " ",
            roomy ? listWidth : inner,
          );
          if (roomy) listLines.push(...fitted.lines);
          else {
            for (const text of fitted.lines)
              body.push(this.focus(line(text), selected, item.state));
            if (!fitted.yieldRest) {
              body.push(
                this.theme.fg("muted", line(`  ${plain(item.description)}`)),
              );
              if (item.metadata)
                body.push(
                  this.theme.fg("muted", line(`  ${plain(item.metadata)}`)),
                );
            }
          }
        } else if (this.section === "Community") {
          const status = `  ${item.state}${item.entry ? ` · ${item.entry.scope}` : ""}`;
          const name = truncateToWidth(
            plain(item.name),
            Math.max(1, inner - 2 - visibleWidth(status)),
          );
          body.push(
            this.focus(
              line(`${selected ? "›" : " "} ${name}${status}`),
              selected,
              item.state,
            ),
          );
          const latest = item.remote?.version
            ? ` · latest ${plain(item.remote.version)}`
            : "";
          body.push(
            this.theme.fg(
              "muted",
              line(`  unverified${latest}  ${plain(item.description)}`),
            ),
          );
        } else {
          const status = `  ${plain(item.state)}`;
          const name = truncateToWidth(
            plain(item.name),
            Math.max(1, inner - 2 - visibleWidth(status)),
          );
          body.push(
            this.focus(
              line(`${selected ? "›" : " "} ${name}${status}`),
              selected,
              item.state,
            ),
          );
          if (this.section !== "Settings")
            body.push(
              this.theme.fg("muted", line(`  ${plain(item.description)}`)),
            );
          if (item.metadata)
            body.push(
              this.theme.fg("muted", line(`  ${plain(item.metadata)}`)),
            );
        }
      }
      if (roomy && current) {
        const side = current.extra
          ? [
              plain(current.name),
              current.state,
              ...this.extraFacts(current.extra),
              "Disabling a selection does not uninstall packages.",
            ]
          : preview(current);
        const count = Math.min(
          bodySize - 1,
          Math.max(listLines.length, side.length),
        );
        for (let i = 0; i < count; i++)
          body.push(
            this.focus(
              truncateToWidth(listLines[i] ?? "", listWidth, "", true),
              start + i === this.selected,
              rows[start + i]?.state ?? "",
            ) +
              gutter +
              truncateToWidth(side[i] ?? "", pane, "", true),
          );
        if (side.length > count)
          body.push(this.theme.fg("muted", line("Enter details for more ↓")));
      }
      if (rows.length > visible)
        body.push(
          this.theme.fg(
            "muted",
            line(`${this.selected + 1}/${rows.length} · ↑↓ more`),
          ),
        );
    }
    const footer = this.details
      ? `Esc back · ↑↓ scroll ${this.detailOffset + 1}/${this.detailLimit + bodySize}`
      : rows.length > 1
        ? footerRows === 1
          ? `Esc close · ↑↓ ${this.selected + 1}/${rows.length}`
          : `Esc close · Tab sections · ↑↓ select · Enter details · ${this.selected + 1}/${rows.length}`
        : "Esc close · Tab sections · Enter details";
    const actions =
      this.section === "Settings"
        ? "Space/Enter toggle setting · Esc close"
        : this.section === "Extras"
          ? "Enter category/details · f filter type · Space toggle · i install/select · x deselect · Esc back"
          : this.section === "Community"
            ? "i install · Enter details · e/d toggle · x remove · r refresh registry · Esc close"
            : this.section === "Updates"
              ? "u update · U update all · r refresh registry · Esc close"
              : "i install · e enable · d disable · Space toggle · x remove · u update · r refresh · Esc close";
    lines.push(...body.slice(0, bodySize));
    while (lines.length < height - 2 - footerRows) lines.push("");
    const registry =
      rows.length && (this.remoteError || this.loading)
        ? this.remoteError
          ? this.theme.fg("error", `Registry: ${plain(this.remoteError)}`)
          : this.theme.fg("muted", "Refreshing npm metadata…")
        : undefined;
    if (footerRows === 2)
      lines.push(
        registry ? line(registry) : this.theme.fg("muted", line(actions)),
      );
    lines.push(
      this.theme.fg(
        "muted",
        line(
          registry && footerRows === 1
            ? rows.length > 1
              ? `Esc · ↑↓ ${this.selected + 1}/${rows.length} · Registry!`
              : `Esc · ${registry}`
            : footer,
        ),
      ),
    );
    return this.frame(lines, w, height);
  }

  private focus(text: string, selected: boolean, state: string): string {
    const role =
      state === "enabled"
        ? "success"
        : state === "missing"
          ? "error"
          : state === "custom" || state === "shadowed"
            ? "warning"
            : state === "disabled" || state === "not installed"
              ? "muted"
              : "text";
    const styled = this.theme.fg(role, text);
    return selected
      ? (this.theme.bg?.("selectedBg", styled) ?? styled)
      : styled;
  }

  private frame(lines: string[], width: number, height: number): string[] {
    if (width < 4 || height < 3)
      return Array.from({ length: height }, (_, i) =>
        truncateToWidth(lines[i] ?? "Esc", width, "", true),
      );
    const border = this.theme.fg("border", "─".repeat(width - 2));
    const content = lines.slice(0, height - 2);
    while (content.length < height - 2) content.push("");
    return [
      `${this.theme.fg("border", "╭")}${border}${this.theme.fg("border", "╮")}`,
      ...content.map((text) => {
        const fitted = truncateToWidth(text, width - 4, "", true);
        return `${this.theme.fg("border", "│")} ${fitted} ${this.theme.fg("border", "│")}`;
      }),
      `${this.theme.fg("border", "╰")}${border}${this.theme.fg("border", "╯")}`,
    ];
  }

  handleInput(data: string): void {
    const rows = this.rows();
    const shortcut: Section | undefined =
      data === "I"
        ? "Packages"
        : data === "E"
          ? "Enabled"
          : data === "D"
            ? "Disabled"
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
      const index = sections.indexOf(
        this.section === "Enabled" || this.section === "Disabled"
          ? "Packages"
          : this.section,
      );
      const next =
        shortcut ??
        sections[(index + delta + sections.length) % sections.length]!;
      if (next !== this.section) this.query = "";
      this.section = next;
      this.selected = 0;
      this.details = false;
      this.detailOffset = 0;
      if (this.section === "Community" || this.section === "Updates")
        this.done({ action: "refresh" });
      else this.tui.requestRender();
    } else if (matchesKey(data, Key.down) || data === "j") {
      if (this.details)
        this.detailOffset = Math.min(this.detailLimit, this.detailOffset + 1);
      else
        this.selected = Math.min(
          Math.max(0, rows.length - 1),
          this.selected + 1,
        );
      this.tui.requestRender();
    } else if (matchesKey(data, Key.up) || data === "k") {
      if (this.details) this.detailOffset = Math.max(0, this.detailOffset - 1);
      else this.selected = Math.max(0, this.selected - 1);
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
        this.detailOffset = 0;
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
