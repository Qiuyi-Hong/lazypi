import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import {
  corePlan,
  isSetupComplete,
  markSetupComplete,
  installCore,
} from "../src/bootstrap.ts";
import { createNative, inventory, type PackageEntry } from "../src/packages.ts";
import { ManagerPopup } from "../src/ui.ts";

const installed = (
  source: string,
  scope: "user" | "project",
  state: PackageEntry["state"] = "enabled",
) =>
  ({
    source,
    scope,
    state,
    path: "/existing/package",
    name: source,
    resources: [],
  }) satisfies PackageEntry;

test("adopts previously installed Pi packages in either scope; installed disabled Core is not reinstalled", () => {
  const plan = corePlan([
    installed("npm:unrelated", "user"),
    installed("npm:pi-mcp-adapter", "project"),
    installed("npm:pi-subagents@1.0.0", "user", "disabled"),
  ]);
  assert.deepEqual(plan.missing, [
    { source: "npm:pi-web-access", scope: "user" },
  ]);
  assert.deepEqual(
    plan.present.map((item) => item.source),
    ["npm:pi-mcp-adapter", "npm:pi-subagents@1.0.0"],
  );
});

test("setup has nothing to install when all Core packages were already installed", () => {
  assert.deepEqual(
    corePlan([
      installed("npm:pi-mcp-adapter", "user"),
      installed("npm:pi-subagents", "project"),
      installed("npm:pi-web-access", "user", "disabled"),
    ]).missing,
    [],
  );
});

test("native Pi inventory adopts an existing npm Core installation and unrelated Pi packages", () => {
  const root = mkdtempSync(join(tmpdir(), "lazypi-adopt-"));
  const agent = join(root, "agent");
  const pkg = join(agent, "npm", "node_modules", "pi-mcp-adapter");
  const other = join(root, "previous-package");
  mkdirSync(pkg, { recursive: true });
  mkdirSync(other);
  writeFileSync(
    join(pkg, "package.json"),
    JSON.stringify({ name: "pi-mcp-adapter", version: "1.0.0" }),
  );
  writeFileSync(
    join(other, "package.json"),
    JSON.stringify({ name: "my-existing-package", version: "1.0.0" }),
  );
  writeFileSync(
    join(agent, "settings.json"),
    JSON.stringify({ packages: ["npm:pi-mcp-adapter", other] }),
  );
  const { settings, manager } = createNative(root, false, agent);
  const items = inventory(settings, manager);
  assert.deepEqual(
    items.map((item) => item.name),
    ["pi-mcp-adapter", "my-existing-package"],
  );
  assert.equal(items[0]?.state, "enabled");
  const ui = new ManagerPopup(
    { requestRender: () => {}, terminal: { rows: 24 } } as TUI,
    { fg: (_color: string, text: string) => text } as Theme,
    () => {},
    items,
    "Packages",
  );
  assert.ok(ui.render(76).some((line) => line.includes("my-existing-package")));
  assert.deepEqual(corePlan(items).missing, [
    { source: "npm:pi-subagents", scope: "user" },
    { source: "npm:pi-web-access", scope: "user" },
  ]);
});

test("project autoload delta over a user Core package is not treated as a missing install", () => {
  const root = mkdtempSync(join(tmpdir(), "lazypi-delta-"));
  const agent = join(root, "agent");
  const pkg = join(agent, "npm", "node_modules", "pi-mcp-adapter");
  mkdirSync(pkg, { recursive: true });
  mkdirSync(join(root, ".pi"));
  writeFileSync(
    join(pkg, "package.json"),
    JSON.stringify({ name: "pi-mcp-adapter", version: "1.0.0" }),
  );
  writeFileSync(
    join(agent, "settings.json"),
    JSON.stringify({ packages: ["npm:pi-mcp-adapter"] }),
  );
  writeFileSync(
    join(root, ".pi", "settings.json"),
    JSON.stringify({
      packages: [{ source: "npm:pi-mcp-adapter", autoload: false, skills: [] }],
    }),
  );
  const { settings, manager } = createNative(root, true, agent);
  const entries = inventory(settings, manager);
  assert.deepEqual(
    entries.map((item) => item.state),
    ["custom", "custom"],
  );
  assert.equal(entries[1]?.path, pkg);
  assert.deepEqual(corePlan(entries).missing, [
    { source: "npm:pi-subagents", scope: "user" },
    { source: "npm:pi-web-access", scope: "user" },
  ]);
});

test("broken configured Core is repaired at its existing source instead of losing pins or filters", () => {
  const plan = corePlan([
    {
      source: "npm:pi-subagents@1.0.0",
      scope: "user",
      state: "missing",
      name: "pi-subagents",
      resources: [],
    },
  ]);
  assert.deepEqual(plan.missing, [
    { source: "npm:pi-mcp-adapter", scope: "user" },
    { source: "npm:pi-subagents@1.0.0", scope: "user" },
    { source: "npm:pi-web-access", scope: "user" },
  ]);
});

test("Core setup uses native user-scope installation sequentially and stops on failure without rollback", async () => {
  const calls: string[] = [];
  const manager = {
    installAndPersist: async (source: string, options: { local?: boolean }) => {
      calls.push(`${source}:${options.local}`);
      if (source === "npm:pi-web-access")
        throw new Error("registry unavailable");
    },
  } as Parameters<typeof installCore>[1];
  const settings = {
    flush: async () => {},
    drainErrors: () => [],
  } as unknown as Parameters<typeof installCore>[2];
  const result = await installCore(
    [
      { source: "npm:pi-mcp-adapter", scope: "user" },
      { source: "npm:pi-web-access", scope: "user" },
      { source: "npm:pi-subagents", scope: "user" },
    ],
    manager,
    settings,
  );
  assert.deepEqual(calls, [
    "npm:pi-mcp-adapter:false",
    "npm:pi-web-access:false",
  ]);
  assert.deepEqual(result.installed, ["npm:pi-mcp-adapter"]);
  assert.match(result.error ?? "", /registry unavailable/);
});

test("repairs a missing project-scoped Core package in project scope rather than shadowing it with a user install", async () => {
  const plan = corePlan([
    installed("npm:pi-mcp-adapter", "user"),
    {
      source: "npm:pi-mcp-adapter@1.0.0",
      scope: "project",
      state: "missing",
      name: "MCP Adapter",
      resources: [],
    },
  ]);
  assert.deepEqual(plan.missing[0], {
    source: "npm:pi-mcp-adapter@1.0.0",
    scope: "project",
  });
  const calls: string[] = [];
  const manager = {
    installAndPersist: async (source: string, options: { local?: boolean }) => {
      calls.push(`${source}:${options.local}`);
    },
  } as Parameters<typeof installCore>[1];
  const settings = {
    flush: async () => {},
    drainErrors: () => [],
  } as unknown as Parameters<typeof installCore>[2];
  await installCore([plan.missing[0]!], manager, settings);
  assert.deepEqual(calls, ["npm:pi-mcp-adapter@1.0.0:true"]);
});

test("malformed setup metadata cannot be overwritten as a new setup", () => {
  const dir = mkdtempSync(join(tmpdir(), "lazypi-invalid-"));
  writeFileSync(join(dir, "lazypi.json"), "{");
  assert.throws(() => markSetupComplete(dir));
  assert.throws(() => isSetupComplete(dir));
});

test("setup completion is stored separately from Pi package state", () => {
  const dir = mkdtempSync(join(tmpdir(), "lazypi-setup-"));
  assert.equal(isSetupComplete(dir), false);
  markSetupComplete(dir);
  assert.equal(isSetupComplete(dir), true);
});
