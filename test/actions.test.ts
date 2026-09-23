import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "../src/actions.ts";

test("native package actions use scoped Pi operations, not npm dependencies or shell commands", async () => {
  const calls: string[] = [];
  const settings = {
    getGlobalSettings: () => ({ packages: [] }),
    getProjectSettings: () => ({ packages: [] }),
    setPackages: () => {},
    setProjectPackages: () => {},
    flush: async () => {
      calls.push("flush");
    },
    drainErrors: () => [],
  } as unknown as Parameters<typeof execute>[2];
  const manager = {
    installAndPersist: async (source: string, opts: { local?: boolean }) => {
      calls.push(`install ${source} ${opts.local}`);
    },
    removeAndPersist: async (source: string, opts: { local?: boolean }) => {
      calls.push(`remove ${source} ${opts.local}`);
      return true;
    },
    update: async (source: string) => {
      calls.push(`update ${source}`);
    },
  } as Parameters<typeof execute>[3];
  const entry = {
    source: "npm:example",
    scope: "project" as const,
    state: "disabled" as const,
    name: "example",
  };
  await execute("install", entry, settings, manager);
  await execute("update", entry, settings, manager); // Must not silently enable a disabled package.
  await execute("remove", entry, settings, manager);
  assert.deepEqual(calls, [
    "install npm:example true",
    "flush",
    "update npm:example",
    "flush",
    "remove npm:example true",
    "flush",
  ]);
});

test("failed native action propagates and never attempts rollback of pre-existing state", async () => {
  let flushed = false;
  const settings = {
    flush: async () => {
      flushed = true;
    },
    drainErrors: () => [],
  } as unknown as Parameters<typeof execute>[2];
  const manager = {
    installAndPersist: async () => {
      throw new Error("package install failed");
    },
  } as unknown as Parameters<typeof execute>[3];
  await assert.rejects(
    () =>
      execute(
        "install",
        { source: "npm:bad", scope: "user", state: "missing", name: "bad" },
        settings,
        manager,
      ),
    /package install failed/,
  );
  assert.equal(flushed, false);
});
