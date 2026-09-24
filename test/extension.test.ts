import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type {
  ExtensionCommandContext,
  RegisteredCommand,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import extension from "../extensions/lazypi.ts";
import { markSetupComplete } from "../src/bootstrap.ts";
import {
  getExtrasByCategory,
  readSelections,
  saveSelection,
} from "../src/extras.ts";
import { ManagerPopup } from "../src/ui.ts";

test("npm extension entrypoint registers the /lazypi command without side effects", () => {
  const registered: string[] = [];
  extension({
    registerCommand: (name: string) => {
      registered.push(name);
    },
  } as unknown as Parameters<typeof extension>[0]);
  assert.deepEqual(registered, ["lazypi"]);
});

test("/lazypi extras plans project selections and deselection without uninstalling adopted packages", async () => {
  const root = mkdtempSync(join(tmpdir(), "lazypi-extras-command-"));
  const agent = join(root, "agent");
  for (const name of ["pi-subagents", "pi-web-access"]) {
    const path = join(agent, "npm", "node_modules", name);
    mkdirSync(path, { recursive: true });
    writeFileSync(
      join(path, "package.json"),
      JSON.stringify({ name, version: "1.0.0" }),
    );
  }
  writeFileSync(
    join(agent, "settings.json"),
    JSON.stringify({ packages: ["npm:pi-subagents", "npm:pi-web-access"] }),
  );
  markSetupComplete(agent);
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agent;
  try {
    let handler: RegisteredCommand["handler"] | undefined;
    extension({
      registerCommand: (
        _name: string,
        options: { handler: RegisteredCommand["handler"] },
      ) => {
        handler = options.handler;
      },
    } as unknown as Parameters<typeof extension>[0]);
    assert.ok(handler);
    let openings = 0;
    const confirmations: string[] = [];
    const ctx = {
      mode: "tui",
      cwd: root,
      isProjectTrusted: () => true,
      ui: {
        custom: async (
          factory: Parameters<ExtensionCommandContext["ui"]["custom"]>[0],
        ) => {
          const index = openings++;
          if (index === 1)
            assert.deepEqual(readSelections(agent, root, true), [
              { id: "research-workflow", scope: "project" },
            ]);
          return new Promise((done) => {
            const popup = factory(
              { requestRender: () => {}, terminal: { rows: 24 } } as TUI,
              { fg: (_color: string, text: string) => text } as Theme,
              {} as Parameters<typeof factory>[2],
              done,
            ) as ManagerPopup;
            assert.equal(popup.section, "Extras");
            if (index === 0) {
              for (let n = 0; n < 3; n++) popup.handleInput("j"); // Web & Research
              popup.handleInput("\r");
            }
            if (index < 2) {
              const index = getExtrasByCategory("web-research").findIndex(
                (extra) => extra.id === "research-workflow",
              );
              for (let n = 0; n < index; n++) popup.handleInput("j");
            }
            popup.handleInput(index === 0 ? "i" : index === 1 ? "x" : "\u001b");
            if (index === 2) popup.handleInput("\u001b"); // back from category, then close
          });
        },
        select: async () => "Project",
        confirm: async (_title: string, summary: string) => {
          confirmations.push(summary);
          return true;
        },
        notify: () => {},
      },
      reload: async () => {
        throw new Error("Adopted packages must not be reinstalled");
      },
    } as unknown as ExtensionCommandContext;
    await handler("extras", ctx);
    assert.deepEqual(readSelections(agent, root, true), []);
    assert.match(confirmations[0]!, /unchanged/);
    assert.match(confirmations[1]!, /kept/);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  }
});

test("a selected Extra with a missing package offers a repair plan without changing real Pi settings", async () => {
  const root = mkdtempSync(join(tmpdir(), "lazypi-extra-repair-"));
  const agent = join(root, "agent");
  mkdirSync(agent);
  writeFileSync(
    join(agent, "settings.json"),
    JSON.stringify({ packages: ["npm:pi-subagents"] }),
  );
  markSetupComplete(agent);
  saveSelection(agent, root, { id: "pi-subagents", scope: "user" }, true);
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agent;
  try {
    let handler: RegisteredCommand["handler"] | undefined;
    extension({
      registerCommand: (
        _name: string,
        options: { handler: RegisteredCommand["handler"] },
      ) => {
        handler = options.handler;
      },
    } as unknown as Parameters<typeof extension>[0]);
    assert.ok(handler);
    let openings = 0;
    const confirmations: string[] = [];
    await handler("extras", {
      mode: "tui",
      cwd: root,
      isProjectTrusted: () => false,
      ui: {
        custom: async (
          factory: Parameters<ExtensionCommandContext["ui"]["custom"]>[0],
        ) =>
          new Promise((done) => {
            const popup = factory(
              { requestRender: () => {}, terminal: { rows: 24 } } as TUI,
              { fg: (_color: string, text: string) => text } as Theme,
              {} as Parameters<typeof factory>[2],
              done,
            ) as ManagerPopup;
            if (openings++ === 0) {
              popup.handleInput("\r"); // AI & Agents
              assert.match(
                popup.render(76).join("\n"),
                /pi-subagents.*not installed/,
              );
              popup.handleInput("i");
            } else {
              popup.handleInput("\u001b");
              popup.handleInput("\u001b");
            }
          }),
        confirm: async (_title: string, summary: string) => {
          confirmations.push(summary);
          return false; // Never call Pi's installer.
        },
        notify: () => {},
      },
    } as unknown as ExtensionCommandContext);
    assert.match(confirmations[0]!, /Repair pi-subagents.*npm:pi-subagents/s);
    assert.deepEqual(readSelections(agent, root, false), [
      { id: "pi-subagents", scope: "user" },
    ]);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  }
});

test("/lazypi shows previously installed Pi packages after deferring first-run setup", async () => {
  const root = mkdtempSync(join(tmpdir(), "lazypi-command-"));
  const agent = join(root, "agent");
  const existing = join(root, "existing-package");
  mkdirSync(agent);
  mkdirSync(existing);
  writeFileSync(
    join(existing, "package.json"),
    JSON.stringify({ name: "my-package", version: "1.0.0" }),
  );
  writeFileSync(
    join(agent, "settings.json"),
    JSON.stringify({ packages: [existing] }),
  );
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agent;
  try {
    let handler: RegisteredCommand["handler"] | undefined;
    extension({
      registerCommand: (
        _name: string,
        options: { handler: RegisteredCommand["handler"] },
      ) => {
        handler = options.handler;
      },
    } as unknown as Parameters<typeof extension>[0]);
    assert.ok(handler);
    let prompts = 0;
    const ctx = {
      mode: "tui",
      cwd: root,
      isProjectTrusted: () => false,
      ui: {
        select: async () => {
          prompts++;
          return "Later";
        },
        custom: async (
          factory: Parameters<ExtensionCommandContext["ui"]["custom"]>[0],
        ) => {
          const popup = await factory(
            { requestRender: () => {}, terminal: { rows: 24 } } as TUI,
            { fg: (_color: string, text: string) => text } as Theme,
            {} as Parameters<typeof factory>[2],
            () => {},
          );
          assert.ok(
            popup.render(76).some((line) => line.includes("my-package")),
          );
          return { action: "close" };
        },
        notify: () => {},
      },
    } as unknown as ExtensionCommandContext;
    await handler("", ctx);
    assert.equal(prompts, 1);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  }
});
