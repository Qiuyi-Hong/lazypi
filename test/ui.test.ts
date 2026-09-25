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
  const header = ui.render(76).slice(2, 4).join("\n");
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
  assert.match(tabs.render(76).join("\n"), /Community \(M\)/);
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
