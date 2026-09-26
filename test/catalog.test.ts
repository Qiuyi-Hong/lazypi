import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { core } from "../src/catalog.ts";

test("Core is exactly three independent Pi packages, not lazypi npm dependencies", () => {
  assert.deepEqual(
    core.map((spec) => spec.source),
    ["npm:pi-mcp-adapter", "npm:pi-subagents", "npm:pi-web-access"],
  );
  for (const spec of core) {
    assert.equal(spec.id, spec.source.slice(4));
    assert.equal(spec.name, spec.id);
  }
  const { dependencies = {} } = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  for (const { source } of core)
    assert.equal(dependencies[source.slice(4)], undefined);
});
