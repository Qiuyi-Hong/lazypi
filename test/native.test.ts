import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createNative, inventory, togglePackage } from "../src/packages.ts";

test("native Pi resolves all resource types as disabled without uninstalling", async () => {
  const root = mkdtempSync(join(tmpdir(), "lazypi-native-"));
  const agentDir = join(root, "agent");
  const pkg = join(root, "package");
  mkdirSync(agentDir);
  mkdirSync(pkg);
  for (const name of ["extensions", "skills", "prompts", "themes"])
    mkdirSync(join(pkg, name));
  writeFileSync(
    join(pkg, "package.json"),
    JSON.stringify({
      name: "native-test",
      pi: {
        extensions: ["./extensions/a.ts"],
        skills: ["./skills/a"],
        prompts: ["./prompts/a.md"],
        themes: ["./themes/a.json"],
      },
    }),
  );
  writeFileSync(join(pkg, "extensions", "a.ts"), "export default () => {};");
  mkdirSync(join(pkg, "skills", "a"));
  writeFileSync(
    join(pkg, "skills", "a", "SKILL.md"),
    "---\nname: a\ndescription: a\n---\na",
  );
  writeFileSync(join(pkg, "prompts", "a.md"), "Hello");
  writeFileSync(join(pkg, "themes", "a.json"), "{}");
  writeFileSync(
    join(agentDir, "settings.json"),
    JSON.stringify({ packages: [pkg] }),
  );
  const { manager, settings } = createNative(root, false, agentDir);
  assert.equal(inventory(settings, manager)[0]?.state, "enabled");
  await togglePackage(settings, inventory(settings, manager)[0]!, false);
  assert.equal(inventory(settings, manager)[0]?.state, "disabled");
  const resolved = await manager.resolve();
  for (const name of ["extensions", "skills", "prompts", "themes"] as const) {
    const packageResources = resolved[name].filter(
      (item) => item.metadata.source === pkg,
    );
    assert.ok(packageResources.length > 0, `${name} discovered`);
    assert.ok(
      packageResources.every((item) => !item.enabled),
      `${name} disabled by native Pi`,
    );
  }
  assert.equal(manager.listConfiguredPackages().length, 1);
});
