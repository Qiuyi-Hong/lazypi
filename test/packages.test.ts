import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import {
  identity,
  inventory,
  manifest,
  plan,
  readSettings,
  stateOf,
  togglePackage,
  type Manager,
} from "../src/packages.ts";
import { rowsFilter } from "../src/ui.ts";

const disabled = (source: string) => ({
  source,
  extensions: [],
  skills: [],
  prompts: [],
  themes: [],
});

function fixture(user: unknown[] = [], project: unknown[] = []) {
  const cwd = mkdtempSync(join(tmpdir(), "lazypi-"));
  const agent = join(cwd, "agent");
  mkdirSync(join(cwd, ".pi"));
  mkdirSync(agent);
  writeFileSync(
    join(agent, "settings.json"),
    JSON.stringify({ packages: user }),
  );
  writeFileSync(
    join(cwd, ".pi", "settings.json"),
    JSON.stringify({ packages: project }),
  );
  const settings = SettingsManager.create(cwd, agent, { projectTrusted: true });
  const installedPath = join(cwd, "fixture-package");
  mkdirSync(installedPath);
  writeFileSync(
    join(installedPath, "package.json"),
    JSON.stringify({
      name: "example",
      version: "1.2.3",
      description: "A package",
      pi: { extensions: ["./a.ts"], skills: ["./skills"] },
    }),
  );
  const manager = {
    listConfiguredPackages: () => [
      ...user.map((raw) => ({
        source:
          typeof raw === "string" ? raw : (raw as { source: string }).source,
        scope: "user" as const,
        filtered: typeof raw !== "string",
        installedPath,
      })),
      ...project.map((raw) => ({
        source:
          typeof raw === "string" ? raw : (raw as { source: string }).source,
        scope: "project" as const,
        filtered: typeof raw !== "string",
        installedPath,
      })),
    ],
  } as Manager;
  return { cwd, agent, installedPath, settings, manager };
}

test("Pi manifests may provide multiple resources and malformed manifests are reported", () => {
  const { installedPath } = fixture();
  assert.deepEqual(manifest(installedPath).resources, ["extensions", "skills"]);
  assert.equal(manifest(installedPath).version, "1.2.3");
  writeFileSync(
    join(installedPath, "package.json"),
    JSON.stringify({ pi: { extensions: "oops" } }),
  );
  assert.match(
    manifest(installedPath).error!,
    /pi.extensions must be an array/,
  );
  writeFileSync(join(installedPath, "package.json"), "{");
  assert.match(manifest(installedPath).error!, /Invalid package manifest/);
});

test("inventory uses user and project Pi declarations; project shadows user", () => {
  const { settings, manager } = fixture(
    ["npm:example@1.0.0"],
    [disabled("npm:example")],
  );
  const items = inventory(settings, manager);
  assert.equal(identity(items[0]!.source), identity(items[1]!.source));
  assert.deepEqual(
    items.map((item) => [item.scope, item.state]),
    [
      ["user", "shadowed"],
      ["project", "disabled"],
    ],
  );
  assert.deepEqual(items[1]!.resources, ["extensions", "skills"]);
});

test("a project autoload delta does not shadow the user package", () => {
  const { settings, manager } = fixture(
    ["npm:example"],
    [
      {
        source: "npm:example",
        autoload: false,
        skills: ["+skills/a/SKILL.md"],
      },
    ],
  );
  assert.deepEqual(
    inventory(settings, manager).map((item) => item.state),
    ["custom", "custom"],
  );
});

test("all four empty Pi filters disable the entire package; partial filters stay custom", () => {
  assert.equal(stateOf(disabled("npm:x")), "disabled");
  assert.equal(stateOf("npm:x"), "enabled");
  assert.equal(stateOf({ source: "npm:x" }), "enabled");
  assert.equal(stateOf({ source: "npm:x", extensions: [] }), "custom");
  assert.equal(stateOf({ source: "npm:x", autoload: false }), "custom");
});

test("toggle disables without uninstall and re-enables without reinstall in each scope", async () => {
  const f = fixture(["npm:example"], ["npm:other"]);
  const user = inventory(f.settings, f.manager)[0]!;
  await togglePackage(f.settings, user, false);
  assert.deepEqual(
    JSON.parse(readFileSync(join(f.agent, "settings.json"), "utf8")).packages,
    [disabled("npm:example")],
  );
  await togglePackage(f.settings, { ...user, state: "disabled" }, true);
  assert.deepEqual(
    JSON.parse(readFileSync(join(f.agent, "settings.json"), "utf8")).packages,
    ["npm:example"],
  );
  const project = inventory(f.settings, f.manager)[1]!;
  await togglePackage(f.settings, project, false);
  assert.deepEqual(
    JSON.parse(readFileSync(join(f.cwd, ".pi", "settings.json"), "utf8"))
      .packages,
    [disabled("npm:other")],
  );
});

test("whole-package toggle preserves other Pi package fields", async () => {
  const f = fixture([{ source: "npm:example", autoload: true }]);
  const item = inventory(f.settings, f.manager)[0]!;
  await togglePackage(f.settings, item, false);
  await togglePackage(f.settings, { ...item, state: "disabled" }, true);
  assert.deepEqual(
    JSON.parse(readFileSync(join(f.agent, "settings.json"), "utf8")).packages,
    [{ source: "npm:example", autoload: true }],
  );
});

test("custom Pi filters and LazyPi itself cannot be silently disabled", async () => {
  const f = fixture([{ source: "npm:example", skills: [] }]);
  await assert.rejects(
    () =>
      togglePackage(f.settings, inventory(f.settings, f.manager)[0]!, false),
    /custom/,
  );
  await assert.rejects(
    () =>
      togglePackage(
        f.settings,
        { ...inventory(f.settings, f.manager)[0]!, name: "lazypi" },
        false,
      ),
    /vanilla Pi/,
  );
});

test("invalid settings fail closed instead of being overwritten", () => {
  const f = fixture();
  writeFileSync(join(f.agent, "settings.json"), "{");
  assert.throws(() => readSettings(join(f.agent, "settings.json")));
  writeFileSync(
    join(f.agent, "settings.json"),
    JSON.stringify({ packages: 42 }),
  );
  assert.throws(
    () => readSettings(join(f.agent, "settings.json")),
    /Invalid packages/,
  );
});

test("operation plans and case-insensitive search", () => {
  assert.match(
    plan("disable", {
      source: "npm:example",
      scope: "project",
      state: "enabled",
    }),
    /Keeps the package installed/,
  );
  assert.match(
    plan("install", { source: "npm:example", scope: "user", state: "enabled" }),
    /already configured/,
  );
  assert.equal(
    rowsFilter([{ name: "Git", description: "source" }], "git").length,
    1,
  );
});
