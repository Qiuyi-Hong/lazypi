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
  "Installed",
  "Enabled",
  "Disabled",
  "Core",
  "Extras",
] as const;
export type Section = (typeof sections)[number];
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
  }

  private rows(): Row[] {
    const items: Row[] =
      this.section === "Extras"
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
              const sources = resolveExtras([extra.id]).flatMap(extraSources);
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
              const implied = this.selections.some((item) =>
                resolveExtras([item.id]).some(
                  (required) => required.id === extra.id,
                ),
              );
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
                  this.section === "Installed" ||
                  item.state === this.section.toLowerCase(),
              )
              .map((entry) => ({
                name: entry.name,
                description: `${entry.source} · ${entry.scope}`,
                state: entry.state,
                entry,
              }));
    return this.section === "Extras" ? items : rowsFilter(items, this.query);
  }

  render(width: number): string[] {
    const w = Math.max(1, Math.min(width, 76));
    const line = (text: string) => truncateToWidth(text, w);
    const rows = this.rows();
    this.selected = Math.min(this.selected, Math.max(0, rows.length - 1));
    const current = rows[this.selected];
    const header = sections
      .map((s) => (s === this.section ? this.theme.fg("accent", `[${s}]`) : s))
      .join("  ");
    const lines = [
      this.theme.fg("accent", line("LazyPi · native Pi packages")),
      line(header),
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
          line(
            `Packages: ${
              resolveExtras([extra.id]).flatMap(extraSources).join(", ") ||
              "none"
            }`,
          ),
          line("Disabling a selection does not uninstall packages."),
        );
      } else if (e || current.source) {
        lines.push(
          line(
            `Required by: ${requiredBy(e?.source ?? current.source!, this.selections).join(", ") || "no LazyPi selection"}`,
          ),
        );
      }
      if (e?.error) lines.push(line(e.error));
    } else if (!rows.length) lines.push(line("No packages in this view."));
    else {
      const visible = Math.max(
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
        lines.push(line(`${selected ? "›" : " "} ${item.name}  ${item.state}`));
        lines.push(this.theme.fg("muted", line(`  ${item.description}`)));
        if (item.metadata)
          lines.push(this.theme.fg("muted", line(`  ${item.metadata}`)));
      }
      if (rows.length > visible)
        lines.push(line(`${this.selected + 1}/${rows.length}`));
    }
    lines.push(
      "",
      this.theme.fg(
        "muted",
        line("Tab sections · ↑↓ select · Enter details · / search"),
      ),
      this.theme.fg(
        "muted",
        line(
          this.section === "Extras"
            ? "Enter category/details · f filter type · Space toggle · i install/select · x deselect · Esc back"
            : "i install · e enable · d disable · Space toggle · x remove · u update · r reload · Esc close",
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
      matchesKey(data, Key.tab) ||
      matchesKey(data, Key.shift("tab"))
    ) {
      const delta = matchesKey(data, Key.tab) ? 1 : -1;
      this.section =
        sections[
          (sections.indexOf(this.section) + delta + sections.length) %
            sections.length
        ]!;
      this.selected = 0;
      this.details = false;
      this.tui.requestRender();
    } else if (matchesKey(data, Key.down) || data === "j") {
      this.selected = Math.min(rows.length - 1, this.selected + 1);
      this.tui.requestRender();
    } else if (matchesKey(data, Key.up) || data === "k") {
      this.selected = Math.max(0, this.selected - 1);
      this.tui.requestRender();
    } else if (data === "/") this.done({ action: "search" });
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
    } else if (data === "i")
      this.done({ action: "install", source: rows[this.selected]?.source });
    else if (matchesKey(data, Key.enter)) {
      const row = rows[this.selected];
      if (this.section === "Extras" && row?.category && !row.extra) {
        this.category = row.category;
        this.selected = 0;
      } else this.details = !this.details;
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
