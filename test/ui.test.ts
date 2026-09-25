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
    "Installed",
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
    "Installed",
  );
  const header = ui.render(76).slice(2, 4).join("\n");
  for (const [name, key] of [
    ["Installed", "I"],
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
    ["I", "Installed"],
  ] as const) {
    ui.handleInput(key);
    assert.equal(ui.section, section);
  }
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
