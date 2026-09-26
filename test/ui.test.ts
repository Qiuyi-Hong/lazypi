import assert from "node:assert/strict";
import { test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { getExtrasByCategory } from "../src/extras.ts";
import { ManagerPopup, type Choice } from "../src/ui.ts";

const theme = { fg: (_color: string, text: string) => text } as Theme;
const tui = { requestRender: () => {}, terminal: { rows: 24 } } as TUI;

test("popup renders within narrow terminal widths and supports section navigation", () => {
  const choices: Choice[] = [];
  const ui = new ManagerPopup(
    tui,
    theme,
    (choice) => choices.push(choice),
    [
      {
        source: "npm:example",
        scope: "user",
        state: "disabled",
        name: "Example",
        resources: ["skills"],
      },
    ],
    "Packages",
  );
  for (const line of ui.render(32)) assert.ok(visibleWidth(line) <= 32);
  ui.handleInput("\t");
  assert.equal(ui.section, "Enabled");
  ui.handleInput("\t");
  assert.equal(ui.section, "Disabled");
  ui.handleInput(" ");
  ui.handleInput("\t");
  assert.equal(ui.section, "Core");
  assert.ok(ui.render(76).some((line) => line.includes("MCP Adapter")));
  ui.handleInput("\t");
  assert.equal(ui.section, "Extras");
  assert.ok(ui.render(76).some((line) => line.includes("AI & Agents")));
  ui.handleInput("\r");
  assert.ok(ui.render(76).some((line) => line.includes("pi-subagents")));
  ui.handleInput("i");
  assert.deepEqual(
    choices.map((choice) => choice.action),
    ["enable", "extra"],
  );
});

test("uppercase keys jump to every section without replacing existing actions", () => {
  const choices: Choice[] = [];
  const ui = new ManagerPopup(
    tui,
    theme,
    (choice) => choices.push(choice),
    [],
    "Packages",
  );
  const header = ui.render(120).find((line) => line.includes("Packages (P)"));
  assert.ok(header);
  assert.equal(
    ui.render(120).filter((line) => /Settings \(S\)/.test(line)).length,
    1,
  );
  for (const [name, key] of [
    ["Packages", "P"],
    ["Enabled", "E"],
    ["Disabled", "D"],
    ["Core", "C"],
    ["Extras", "X"],
    ["Community", "M"],
    ["Updates", "T"],
    ["Settings", "S"],
  ] as const)
    assert.match(header, new RegExp(`${name} \\(${key}\\)`));
  assert.doesNotMatch(ui.render(76).join("\n"), /Tab or I E D C X M T S/);
  for (const [key, section] of [
    ["E", "Enabled"],
    ["D", "Disabled"],
    ["C", "Core"],
    ["X", "Extras"],
    ["M", "Community"],
    ["T", "Updates"],
    ["S", "Settings"],
    ["P", "Packages"],
  ] as const) {
    ui.handleInput(key);
    assert.equal(ui.section, section);
  }
  ui.handleInput("I"); // Legacy section shortcut.
  assert.equal(ui.section, "Packages");
  assert.deepEqual(
    choices.map((choice) => choice.action),
    ["refresh", "refresh"],
  );
  ui.handleInput("T");
  ui.handleInput("U");
  assert.equal(choices.at(-1)?.action, "update-all");

  const tabs = new ManagerPopup(
    tui,
    theme,
    (choice) => choices.push(choice),
    [],
    "Extras",
  );
  assert.match(tabs.render(120).join("\n"), /Community \(M\)/);
  tabs.handleInput("\t");
  assert.equal(tabs.section, "Community");
  assert.equal(choices.at(-1)?.action, "refresh");
});

test("Packages keeps Pi scope and state visible across long inventories and emits selected actions", () => {
  const choices: Choice[] = [];
  const entries = [
    {
      source: "npm:pi-subagents",
      name: "pi-subagents",
      scope: "user" as const,
      state: "shadowed" as const,
      resources: [],
    },
    {
      source: "npm:pi-subagents",
      name: "pi-subagents",
      scope: "project" as const,
      state: "custom" as const,
      resources: [],
    },
    {
      source: "./missing",
      name: "missing",
      scope: "project" as const,
      state: "missing" as const,
      resources: [],
    },
    ...Array.from({ length: 15 }, (_, n) => ({
      source: `npm:ordinary-${n}`,
      name: `ordinary-${n}`,
      scope: "user" as const,
      state: "enabled" as const,
      description: "Should only appear in details",
      resources: [],
    })),
    {
      source: "npm:last",
      name: "last",
      scope: "project" as const,
      state: "disabled" as const,
      resources: [],
    },
  ];
  const ui = new ManagerPopup(
    tui,
    theme,
    (choice) => choices.push(choice),
    entries,
    "Packages",
  );
  let frame = ui.render(76).join("\n");
  assert.match(frame, /pi-subagents\s+shadowed · user/);
  assert.match(frame, /pi-subagents\s+custom · project/);
  assert.match(frame, /missing\s+missing · project/);
  assert.doesNotMatch(
    frame,
    /Should only appear in details|pi-mcp-adapter.*not installed/,
  );
  ui.handleInput("x");
  assert.deepEqual(choices.at(-1), { action: "remove", entry: entries[0] });
  ui.handleInput("j");
  ui.handleInput("u");
  assert.deepEqual(choices.at(-1), { action: "update", entry: entries[1] });
  ui.handleInput("j");
  ui.handleInput("i");
  assert.deepEqual(choices.at(-1), {
    action: "install",
    entry: entries[2],
    source: undefined,
  });
  for (let n = 2; n < entries.length - 1; n++) ui.handleInput("j");
  frame = ui.render(76).join("\n");
  assert.match(frame, /› last\s+disabled · project/);
  assert.match(frame, new RegExp(`${entries.length}/${entries.length}`));
  assert.ok(ui.render(76).length <= 26);
  assert.match(ui.render(32).join("\n"), /› last\s+disabled · project/);
  ui.handleInput(" ");
  assert.deepEqual(choices.at(-1), { action: "enable", entry: entries.at(-1) });
  ui.handleInput("\r");
  assert.match(ui.render(76).join("\n"), /Scope: project · State: disabled/);
  ui.handleInput("D");
  assert.equal(ui.section, "Disabled");
  assert.match(ui.render(76).join("\n"), /last\s+disabled · project/);
  ui.handleInput("E");
  assert.equal(ui.section, "Enabled");
  assert.doesNotMatch(
    ui.render(76).join("\n"),
    /shadowed · user|custom · project|missing · project/,
  );

  const short = new ManagerPopup(
    { requestRender: () => {}, terminal: { rows: 16 } } as TUI,
    theme,
    () => {},
    entries,
    "Packages",
  );
  for (let n = 0; n < entries.length - 1; n++) short.handleInput("j");
  assert.ok(short.render(76).length <= 16);
  assert.match(short.render(76).join("\n"), /› last\s+disabled · project/);
});

test("Extras show Pi installation independently of selection, including incomplete workflows", () => {
  const installed = {
    source: "npm:pi-subagents@1",
    scope: "user" as const,
    state: "disabled" as const,
    name: "Subagents",
    path: "/installed",
    resources: ["extensions"],
  };
  const missing = {
    ...installed,
    source: "npm:pi-web-access",
    path: undefined,
    state: "missing" as const,
  };
  const ui = new ManagerPopup(
    tui,
    theme,
    () => {},
    [installed, missing],
    "Extras",
    "",
    [{ id: "research-workflow", scope: "user" }],
    "web-research",
  );
  const lines = ui.render(76).join("\n");
  assert.match(lines, /pi-web-access.*not installed/);
  const workflow = new ManagerPopup(
    tui,
    theme,
    () => {},
    [installed, missing],
    "Extras",
    "research-workflow",
    [{ id: "research-workflow", scope: "user" }],
    "web-research",
  );
  assert.match(
    workflow.render(76).join("\n"),
    /research-workflow.*partially installed/,
  );
  const ready = new ManagerPopup(
    tui,
    theme,
    () => {},
    [installed],
    "Extras",
    "",
    [],
    "ai-agents",
  );
  assert.match(ready.render(76).join("\n"), /pi-subagents.*installed/);
  assert.doesNotMatch(
    ready.render(76).join("\n"),
    /^│› pi-subagents.*not installed/m,
  );
});

test("Extra rows keep selection and Pi state legible at wide and narrow widths", () => {
  const fits = (lines: string[], width: number) => {
    for (const line of lines) assert.ok(visibleWidth(line) <= width, line);
  };
  const items = [
    {
      source: "npm:pi-subagents@1",
      scope: "user" as const,
      state: "disabled" as const,
      name: "Subagents",
      path: "/installed",
      resources: ["extensions"],
    },
    {
      source: "npm:pi-web-access",
      scope: "project" as const,
      state: "missing" as const,
      name: "Web Access",
      resources: ["extensions"],
    },
    {
      source: "npm:pi-web-search",
      scope: "user" as const,
      state: "custom" as const,
      name: "Web Search",
      path: "/custom",
      resources: ["extensions"],
    },
  ];
  const choices: Choice[] = [];
  const tall = { requestRender: () => {}, terminal: { rows: 40 } } as TUI;
  const web = getExtrasByCategory("web-research");
  const at = (id: string) => web.findIndex((extra) => extra.id === id);
  const ui = new ManagerPopup(
    tall,
    theme,
    (choice) => choices.push(choice),
    items,
    "Extras",
    "",
    [{ id: "research-workflow", scope: "user" }],
    "web-research",
  );

  const required = ui.render(48);
  fits(required, 48);
  assert.match(required.join("\n"), /pi-web-access[^\n]*required/);
  assert.match(required.join("\n"), /pi-web-access[^\n]*not installed/);
  assert.doesNotMatch(required.join("\n"), /Source:/);

  for (let n = 0; n < at("research-workflow"); n++) ui.handleInput("j");
  const narrow = ui.render(48);
  fits(narrow, 48);
  const marked = narrow.find((line) => line.includes("\u203a"));
  assert.match(marked ?? "", /selected \(user\)/);
  assert.match(marked ?? "", /partially installed/);

  const wide = ui.render(120);
  fits(wide, 120);
  const wideText = wide.join("\n");
  assert.match(wideText, /Scope: user/);
  assert.match(wideText, /disabled \u00b7 user/);
  assert.match(wideText, /missing \u00b7 project/);
  assert.doesNotMatch(wideText, /enabled|active/);
  ui.handleInput("\r");
  const details = ui.render(120);
  fits(details, 120);
  const detailText = details.join("\n");
  assert.match(detailText, /Scope: user/);
  assert.match(detailText, /disabled \u00b7 user/);
  assert.match(detailText, /missing \u00b7 project/);
  assert.match(detailText, /does not uninstall/);
  assert.doesNotMatch(detailText, /enabled|active/);
  assert.doesNotMatch(detailText, /\u203a/);
  ui.handleInput("\u001b");
  ui.handleInput("x");
  assert.deepEqual(choices.at(-1)?.action, "extra");
  assert.equal(choices.at(-1)?.enabled, false);
  assert.equal(choices.at(-1)?.extra?.id, "research-workflow");

  const direct = new ManagerPopup(
    tall,
    theme,
    (choice) => choices.push(choice),
    items,
    "Extras",
    "",
    [
      { id: "research-workflow", scope: "user" },
      { id: "pi-web-access", scope: "project" },
    ],
    "web-research",
  );
  for (let n = 0; n < at("pi-web-access"); n++) direct.handleInput("j");
  const access = direct.render(48).find((line) => line.includes("\u203a"));
  assert.match(access ?? "", /selected \(project\)/);
  assert.match(access ?? "", /not installed/);
  assert.doesNotMatch(access ?? "", /required/);
  direct.handleInput(" ");
  assert.equal(choices.at(-1)?.action, "extra");
  assert.equal(choices.at(-1)?.enabled, false);
  direct.handleInput("i");
  assert.equal(choices.at(-1)?.action, "extra");
  assert.equal(choices.at(-1)?.enabled, true);

  const search = new ManagerPopup(
    tall,
    theme,
    () => {},
    items,
    "Extras",
    "",
    [{ id: "pi-web-search", scope: "user" }],
    "web-research",
  );
  for (let n = 0; n < at("pi-web-search"); n++) search.handleInput("j");
  const customWide = search.render(120);
  fits(customWide, 120);
  assert.match(customWide.join("\n"), /custom \u00b7 user/);
  assert.doesNotMatch(customWide.join("\n"), /enabled|active/);
  search.handleInput("\r");
  assert.match(search.render(48).join("\n"), /custom \u00b7 user/);
  search.handleInput("\u001b");
  search.handleInput("f");
  assert.equal(search.resourceType, "extension");
  assert.match(search.render(120).join("\n"), /x deselect/);
  assert.doesNotMatch(search.render(48).join("\n"), /uninstall|\bremove\b/);
});

test("Extras categories, type filters and tag search remain independent", () => {
  const choices: Choice[] = [];
  const ui = new ManagerPopup(
    tui,
    theme,
    (choice) => choices.push(choice),
    [],
    "Extras",
  );
  ui.handleInput("j"); // Coding
  ui.handleInput("\r");
  assert.equal(ui.category, "coding");
  const index = getExtrasByCategory("coding").findIndex(
    (extra) => extra.id === "@dietrichgebert/ponytail",
  );
  for (let n = 0; n < index; n++) ui.handleInput("j");
  assert.match(
    ui.render(76).join("\n"),
    /@dietrichgebert\/ponytail.*not installed/,
  );
  assert.ok(ui.render(76).some((line) => line.includes("extension · skill")));
  assert.ok(ui.render(76).some((line) => line.includes("code-review")));
  ui.handleInput("f"); // Extensions
  ui.handleInput("f"); // Skills
  assert.equal(ui.resourceType, "skill");
  assert.ok(
    ui.render(76).some((line) => line.includes("@dietrichgebert/ponytail")),
  );
  ui.handleInput("f"); // Prompts
  assert.ok(ui.render(76).some((line) => line.includes("No packages")));
  ui.handleInput("f"); // Themes
  ui.handleInput("f"); // All
  for (let n = 0; n < index; n++) ui.handleInput("j");
  ui.handleInput("i");
  assert.equal(choices[0]?.extra?.id, "@dietrichgebert/ponytail");
  assert.equal(choices[0]?.enabled, true);
  ui.handleInput("\u001b");
  assert.equal(ui.category, undefined);
  assert.ok(ui.render(76).some((line) => line.includes("AI & Agents")));
  const search = new ManagerPopup(tui, theme, () => {}, [], "Extras", "yagni");
  assert.ok(
    search.render(76).some((line) => line.includes("@dietrichgebert/ponytail")),
  );
});

test("Packages inspector follows selection only when the frame can hold it", () => {
  const choices: Choice[] = [];
  const noisy = "\u001b[2J";
  const entries = [
    {
      source: `npm:pi-subagents${noisy}`,
      name: `\u5305${noisy}tools`,
      scope: "user" as const,
      state: "enabled" as const,
      description: "x".repeat(180),
      version: "1.2.3",
      repository: "https://example.com/pkg",
      author: "Ada",
      resources: ["skills"],
    },
    {
      source: "npm:second",
      name: "second",
      scope: "project" as const,
      state: "missing" as const,
      resources: [],
    },
  ];
  const ansi = {
    fg: (_color: string, text: string) => `\x1b[31m${text}\x1b[0m`,
  } as Theme;
  const tall = { requestRender: () => {}, terminal: { rows: 24 } } as TUI;
  const ui = new ManagerPopup(
    tall,
    ansi,
    (choice) => choices.push(choice),
    entries,
    "Packages",
  );
  const fits = (lines: string[], width: number) => {
    for (const line of lines) assert.ok(visibleWidth(line) <= width);
  };

  const wide = ui.render(120);
  fits(wide, 120);
  const wideText = wide.join("\n");
  assert.match(wideText, /\u203a \u5305/);
  assert.match(wideText, /Source: npm:pi-subagents/);
  assert.match(wideText, /Scope: user/);
  assert.match(wideText, /State: enabled/);
  assert.match(wideText, /Version: 1\.2\.3/);
  assert.match(wideText, /Repository: https:\/\/example.com\/pkg/);
  assert.match(wideText, /Search:/);
  assert.match(wideText, /Enter details/);
  assert.doesNotMatch(wideText, /\u001b\[2J/);
  ui.handleInput("\r");
  const details = ui.render(120);
  fits(details, 120);
  assert.match(details.join("\n"), /Repository: https:\/\/example.com\/pkg/);
  assert.match(details.join("\n"), /Author: Ada/);
  assert.doesNotMatch(details.join("\n"), /\u203a/);
  ui.handleInput("\u001b");
  assert.match(ui.render(120).join("\n"), /\u203a/);
  assert.match(ui.render(120).join("\n"), /Source: npm:pi-subagents/);
  ui.handleInput("j");
  assert.match(ui.render(120).join("\n"), /Source: npm:second/);
  assert.match(ui.render(120).join("\n"), /Scope: project/);
  assert.match(ui.render(120).join("\n"), /State: missing/);
  ui.handleInput("x");
  assert.deepEqual(choices.at(-1), { action: "remove", entry: entries[1] });
  ui.handleInput("/");
  assert.equal(choices.at(-1)?.action, "search");
  ui.handleInput("\r");
  const selectedDetails = ui.render(120).join("\n");
  assert.match(selectedDetails, /Source: npm:second/);
  assert.doesNotMatch(selectedDetails, /\u203a/);
  ui.handleInput("\u001b");
  assert.match(ui.render(120).join("\n"), /Source: npm:second/);

  const narrow = new ManagerPopup(tall, ansi, () => {}, entries, "Packages");
  const narrowLines = narrow.render(32);
  fits(narrowLines, 32);
  assert.match(narrowLines.join("\n"), /\u203a \u5305/);
  assert.match(narrowLines.join("\n"), /enabled · user/);
  assert.doesNotMatch(narrowLines.join("\n"), /Source:/);
  narrow.handleInput("\r");
  const narrowDetails = narrow.render(32);
  fits(narrowDetails, 32);
  assert.match(narrowDetails.join("\n"), /Source:/);
  assert.doesNotMatch(narrowDetails.join("\n"), /\u203a/);
  narrow.handleInput("\u001b");
  assert.doesNotMatch(narrow.render(32).join("\n"), /Source:/);

  const short = new ManagerPopup(
    { requestRender: () => {}, terminal: { rows: 16 } } as TUI,
    ansi,
    () => {},
    entries,
    "Packages",
  );
  const shortLines = short.render(120);
  fits(shortLines, 120);
  assert.ok(shortLines.length <= 16);
  assert.match(shortLines.join("\n"), /\u203a \u5305/);
  assert.doesNotMatch(shortLines.join("\n"), /Source:/);
  short.handleInput("\r");
  assert.match(short.render(120).join("\n"), /Repository:/);
  short.handleInput("\u001b");
  assert.doesNotMatch(short.render(120).join("\n"), /Source:/);

  ui.handleInput("S");
  assert.match(ui.render(120).join("\n"), /Space\/Enter toggle setting/);
  assert.doesNotMatch(ui.render(120).join("\n"), /Source:/);
  ui.handleInput("T");
  assert.match(ui.render(120).join("\n"), /U update all/);
  const extras = new ManagerPopup(tall, ansi, () => {}, entries, "Extras");
  assert.match(extras.render(120).join("\n"), /AI & Agents/);
  assert.doesNotMatch(extras.render(120).join("\n"), /Source:/);
  extras.handleInput("f");
  assert.equal(extras.resourceType, "extension");
});
