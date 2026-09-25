import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
import {
  markSetupComplete,
  readLazyPiState,
  writeLazyPiState,
} from "../src/bootstrap.ts";
import {
  health,
  runSequential,
  syncPlan,
  updateAllPlan,
} from "../src/polish.ts";
import type { PackageEntry } from "../src/packages.ts";
import { ManagerPopup } from "../src/ui.ts";

const item = (
  source: string,
  scope: "user" | "project" = "user",
  state: PackageEntry["state"] = "enabled",
  path: string | undefined = "/pkg",
): PackageEntry => ({
  source,
  scope,
  state,
  path,
  name: source,
  resources: [],
});
const remote = (name: string, version = "2.0.0") => ({
  name,
  source: `npm:${name}`,
  version,
  resources: [],
  description: "",
});

test("sync plans missing and disabled requirements in their scope, without removing adopted packages", () => {
  const plan = syncPlan(
    [
      item("npm:pi-mcp-adapter", "user", "disabled"),
      item("npm:pi-subagents", "project", "enabled"),
      item("npm:pi-web-access", "user", "custom"),
      item("npm:unrelated"),
    ],
    [
      { id: "pi-subagents", scope: "user" },
      { id: "pi-subagents", scope: "project" },
    ],
  );
  assert.deepEqual(
    plan.repairs.map(
      ({ action, entry }) => `${action}:${entry.source}:${entry.scope}`,
    ),
    ["enable:npm:pi-mcp-adapter:user", "install:npm:pi-subagents:user"],
  );
  assert.match(plan.warnings.join(" "), /pi-web-access.*custom/);
  assert.ok(
    plan.unchanged.some((source) => source.includes("pi-subagents (project)")),
  );
  assert.ok(!JSON.stringify(plan).includes("unrelated"));
  const broken = syncPlan(
    [
      item("npm:pi-mcp-adapter", "user"),
      item("npm:pi-mcp-adapter", "project", "missing", ""),
    ],
    [],
  );
  assert.equal(broken.repairs[0]?.entry.scope, "project");
});

test("update-all includes disabled unpinned npm once across scopes, skips pins and stale versions", () => {
  const items = [
    { ...item("npm:foo", "user", "disabled"), version: "1.0.0" },
    { ...item("npm:foo", "project"), version: "1.0.0" },
    { ...item("npm:bar@1.0.0"), version: "1.0.0" },
    { ...item("npm:baz"), version: "3.0.0" },
    { ...item("npm:missing", "user", "missing", ""), version: "1.0.0" },
  ];
  assert.deepEqual(
    updateAllPlan(
      items,
      new Map([
        ["npm:foo", remote("foo")],
        ["npm:bar", remote("bar")],
        ["npm:baz", remote("baz")],
        ["npm:missing", remote("missing")],
      ]),
    ).map((entry) => entry.source),
    ["npm:foo"],
  );
});

test("sequential native operations stop on failure and report only successful steps", async () => {
  const attempted: string[] = [];
  const result = await runSequential(
    ["first", "broken", "last"],
    async (step) => {
      attempted.push(step);
      if (step === "broken") throw new Error("registry unavailable");
    },
  );
  assert.deepEqual(attempted, ["first", "broken"]);
  assert.deepEqual(result.applied, ["first"]);
  assert.equal(result.failed?.step, "broken");
  assert.match(String(result.failed?.error), /registry unavailable/);
});

test("settings persist atomically and reject malformed values", () => {
  const dir = mkdtempSync(join(tmpdir(), "lazypi-preferences-"));
  writeLazyPiState(dir, { autoCheckUpdates: true });
  markSetupComplete(dir);
  assert.deepEqual(readLazyPiState(dir), {
    version: 1,
    autoCheckUpdates: true,
    bootstrapComplete: true,
  });
  writeFileSync(
    join(dir, "lazypi.json"),
    JSON.stringify({ version: 1, autoCheckUpdates: "yes" }),
  );
  assert.throws(() => readLazyPiState(dir), /Invalid LazyPi state/);
  assert.throws(
    () => writeLazyPiState(dir, { autoCheckUpdates: false }),
    /Invalid LazyPi state/,
  );
});

test("health reports malformed Pi settings, missing packages and manifests without changing them", () => {
  const root = mkdtempSync(join(tmpdir(), "lazypi-health-"));
  const agent = join(root, "agent");
  const pkg = join(root, "broken-pkg");
  mkdirSync(agent);
  mkdirSync(pkg);
  const settings = join(agent, "settings.json");
  writeFileSync(settings, "{");
  assert.match(health(root, agent, false).join("\n"), /User settings/);
  writeFileSync(
    settings,
    JSON.stringify({ packages: [pkg, "npm:not-installed"] }),
  );
  writeFileSync(join(pkg, "package.json"), "{");
  const result = health(root, agent, false).join("\n");
  assert.match(result, /invalid package manifest/);
  assert.match(result, /not-installed.*missing/);
  assert.equal(
    readFileSync(settings, "utf8"),
    JSON.stringify({ packages: [pkg, "npm:not-installed"] }),
  );
});

const theme = { fg: (_color: string, text: string) => text } as Theme;
const tui = { requestRender: () => {}, terminal: { rows: 24 } } as TUI;
test("Settings has only the update switch; Community remains in tab navigation", () => {
  const choices: string[] = [];
  const popup = new ManagerPopup(
    tui,
    theme,
    (choice) => choices.push(choice.action),
    [],
    "Settings",
    "",
    [],
    undefined,
    "all",
    {},
    { autoCheckUpdates: true },
    (setting, enabled) => {
      choices.push(`${setting}:${enabled}`);
      return true;
    },
  );
  assert.match(
    popup.render(76).join("\n"),
    /Auto-check updates at startup.*on/,
  );
  assert.doesNotMatch(popup.render(76).join("\n"), /Show Community tab/);
  assert.match(popup.render(76).join("\n"), /Community \(M\)/);
  popup.handleInput(" ");
  popup.handleInput("\t");
  assert.equal(popup.section, "Installed");
  assert.deepEqual(choices, ["autoCheckUpdates:false"]);
  const updates = new ManagerPopup(
    tui,
    theme,
    (choice) => choices.push(choice.action),
    [],
    "Updates",
  );
  updates.handleInput("U");
  assert.equal(choices.at(-1), "update-all");
});

test("Settings switch persists without remounting; old Community preference is ignored", async () => {
  const root = mkdtempSync(join(tmpdir(), "lazypi-settings-toggle-"));
  const agent = join(root, "agent");
  markSetupComplete(agent);
  writeFileSync(
    join(agent, "lazypi.json"),
    JSON.stringify({ ...readLazyPiState(agent), showCommunityPackages: false }),
  );
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agent;
  try {
    let handler!: RegisteredCommand["handler"];
    extension({
      on: () => {},
      registerCommand: (
        _name: string,
        command: { handler: RegisteredCommand["handler"] },
      ) => {
        handler = command.handler;
      },
    } as unknown as Parameters<typeof extension>[0]);
    let openings = 0;
    const frames: string[] = [];
    await handler("settings", {
      mode: "tui",
      cwd: root,
      isProjectTrusted: () => false,
      ui: {
        custom: async (
          factory: Parameters<ExtensionCommandContext["ui"]["custom"]>[0],
        ) =>
          new Promise((done) => {
            const popup = factory(
              tui,
              theme,
              {} as Parameters<typeof factory>[2],
              done,
            ) as ManagerPopup;
            openings++;
            if (openings > 1) return popup.handleInput("\u001b");
            frames.push(popup.render(76).join("\n"));
            popup.handleInput(" ");
            frames.push(popup.render(76).join("\n"));
            popup.handleInput(" ");
            frames.push(popup.render(76).join("\n"));
            popup.handleInput("\u001b");
          }),
        notify: () => {},
      },
    } as unknown as ExtensionCommandContext);
    assert.equal(openings, 1, "a toggle must not remount the overlay");
    assert.match(frames[0]!, /Community \(M\)/);
    assert.doesNotMatch(frames[0]!, /Show Community tab/);
    assert.match(frames[1]!, /Auto-check updates at startup.*on/);
    assert.match(frames[2]!, /Auto-check updates at startup.*off/);
    assert.equal(readLazyPiState(agent).autoCheckUpdates, false);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  }
});

test("/lazypi settings writes only LazyPi preferences; /lazypi sync confirms before touching Pi", async () => {
  const root = mkdtempSync(join(tmpdir(), "lazypi-polish-command-"));
  const agent = join(root, "agent");
  markSetupComplete(agent);
  const prev = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agent;
  try {
    let handler!: RegisteredCommand["handler"];
    extension({
      on: () => {},
      registerCommand: (
        _name: string,
        command: { handler: RegisteredCommand["handler"] },
      ) => {
        handler = command.handler;
      },
    } as unknown as Parameters<typeof extension>[0]);
    const notifications: string[] = [];
    const ctx = {
      mode: "tui",
      cwd: root,
      isProjectTrusted: () => false,
      ui: {
        custom: async (
          factory: Parameters<ExtensionCommandContext["ui"]["custom"]>[0],
        ) =>
          new Promise((done) => {
            const popup = factory(
              tui,
              theme,
              {} as Parameters<typeof factory>[2],
              done,
            ) as ManagerPopup;
            popup.handleInput(" ");
            popup.handleInput("\u001b");
          }),
        confirm: async (_title: string, message: string) => {
          assert.match(message, /pi-mcp-adapter/);
          return false;
        },
        notify: (message: string) => notifications.push(message),
      },
    } as unknown as ExtensionCommandContext;
    await handler("settings", ctx);
    assert.equal(readLazyPiState(agent).autoCheckUpdates, true);
    await handler("sync", ctx);
    assert.ok(!notifications.length);
  } finally {
    if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prev;
  }
});

test("sync enables an installed disabled Core package through Pi filters and reloads", async () => {
  const root = mkdtempSync(join(tmpdir(), "lazypi-sync-native-"));
  const agent = join(root, "agent");
  const names = ["pi-mcp-adapter", "pi-subagents", "pi-web-access"];
  for (const name of names) {
    const pkg = join(agent, "npm", "node_modules", name);
    mkdirSync(pkg, { recursive: true });
    writeFileSync(
      join(pkg, "package.json"),
      JSON.stringify({ name, version: "1.0.0" }),
    );
  }
  writeFileSync(
    join(agent, "settings.json"),
    JSON.stringify({
      packages: [
        {
          source: "npm:pi-mcp-adapter",
          extensions: [],
          skills: [],
          prompts: [],
          themes: [],
        },
        ...names.slice(1).map((name) => `npm:${name}`),
      ],
    }),
  );
  const prev = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agent;
  try {
    let handler!: RegisteredCommand["handler"];
    extension({
      on: () => {},
      registerCommand: (
        _name: string,
        command: { handler: RegisteredCommand["handler"] },
      ) => {
        handler = command.handler;
      },
    } as unknown as Parameters<typeof extension>[0]);
    let reloaded = 0;
    await handler("sync", {
      mode: "tui",
      cwd: root,
      isProjectTrusted: () => false,
      ui: {
        confirm: async (_title: string, summary: string) => {
          assert.match(summary, /↑ npm:pi-mcp-adapter.*enable/);
          assert.doesNotMatch(summary, /\+ npm:/);
          return true;
        },
        notify: () => {},
      },
      reload: async () => {
        reloaded++;
      },
    } as unknown as ExtensionCommandContext);
    assert.equal(reloaded, 1);
    assert.deepEqual(
      JSON.parse(readFileSync(join(agent, "settings.json"), "utf8"))
        .packages[0],
      "npm:pi-mcp-adapter",
    );
  } finally {
    if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prev;
  }
});

test("startup update checks use cached metadata, and update-all previews without updating", async () => {
  const root = mkdtempSync(join(tmpdir(), "lazypi-startup-"));
  const agent = join(root, "agent");
  const pkg = join(agent, "npm", "node_modules", "foo");
  mkdirSync(pkg, { recursive: true });
  writeFileSync(
    join(pkg, "package.json"),
    JSON.stringify({ name: "foo", version: "1.0.0" }),
  );
  writeFileSync(
    join(agent, "settings.json"),
    JSON.stringify({
      packages: [
        {
          source: "npm:foo",
          extensions: [],
          skills: [],
          prompts: [],
          themes: [],
        },
      ],
    }),
  );
  writeLazyPiState(agent, { bootstrapComplete: true, autoCheckUpdates: true });
  writeFileSync(
    join(agent, "lazypi-cache.json"),
    JSON.stringify({
      searches: {},
      details: { foo: { timestamp: Date.now(), value: remote("foo") } },
    }),
  );
  const prev = process.env.PI_CODING_AGENT_DIR;
  const prevOffline = process.env.PI_OFFLINE;
  process.env.PI_CODING_AGENT_DIR = agent;
  process.env.PI_OFFLINE = "1";
  try {
    let handler!: RegisteredCommand["handler"];
    let start!: (event: unknown, ctx: ExtensionCommandContext) => void;
    extension({
      on: (_event: string, callback: typeof start) => {
        start = callback;
        return () => {};
      },
      registerCommand: (
        _name: string,
        command: { handler: RegisteredCommand["handler"] },
      ) => {
        handler = command.handler;
      },
    } as unknown as Parameters<typeof extension>[0]);
    const notices: string[] = [];
    let confirmation = "";
    let openings = 0;
    const ctx = {
      mode: "tui",
      cwd: root,
      isProjectTrusted: () => false,
      ui: {
        custom: async (
          factory: Parameters<ExtensionCommandContext["ui"]["custom"]>[0],
        ) =>
          new Promise((done) => {
            const popup = factory(
              tui,
              theme,
              {} as Parameters<typeof factory>[2],
              done,
            ) as ManagerPopup;
            popup.handleInput(openings++ === 0 ? "U" : "\u001b");
          }),
        confirm: async (_title: string, summary: string) => {
          confirmation = summary;
          return false;
        },
        notify: (message: string) => notices.push(message),
      },
    } as unknown as ExtensionCommandContext;
    start({}, ctx);
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(notices.join(" "), /1 Pi package update available/);
    await handler("updates", ctx);
    assert.match(confirmation, /npm:foo.*disabled.*1\.0\.0 → 2\.0\.0/);
    assert.match(
      readFileSync(join(agent, "settings.json"), "utf8"),
      /"extensions":\[\]/,
    );
  } finally {
    if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prev;
    if (prevOffline === undefined) delete process.env.PI_OFFLINE;
    else process.env.PI_OFFLINE = prevOffline;
  }
});
