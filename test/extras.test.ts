import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isSetupComplete, markSetupComplete } from "../src/bootstrap.ts";
import {
  EXTRA_CATEGORIES,
  extras,
  extraSources,
  filterExtras,
  getExtraCategories,
  getExtrasByCategory,
  normalizeTag,
  planExtra,
  readSelections,
  requiredBy,
  resolveExtras,
  saveSelection,
  validateExtras,
  type Extra,
} from "../src/extras.ts";
import type { PackageEntry } from "../src/packages.ts";

const registry: Extra[] = [
  {
    id: "shared",
    name: "shared",
    category: "ai-agents",
    description: "base",
    source: "npm:shared",
    resourceTypes: ["extension"],
    tags: ["subagents"],
  },
  {
    id: "other",
    name: "other",
    category: "coding",
    description: "other",
    source: "npm:other",
    resourceTypes: ["skill"],
    tags: ["code-review"],
  },
  {
    id: "combo",
    name: "combo",
    category: "planning-workflow",
    description: "combo",
    resourceTypes: [],
    tags: ["workflow"],
    requires: ["shared", "other"],
  },
];
const installed = (
  source: string,
  scope: "user" | "project",
  state: PackageEntry["state"] = "enabled",
) =>
  ({
    source,
    scope,
    state,
    path: "/package",
    name: source,
    resources: [],
  }) satisfies PackageEntry;

test("dependency order, cycles, conflicts and malformed specs", () => {
  assert.deepEqual(
    resolveExtras(["combo"], registry).map((extra) => extra.id),
    ["shared", "other", "combo"],
  );
  assert.throws(() => resolveExtras(["missing"], registry), /Unknown/);
  assert.throws(
    () =>
      resolveExtras(["shared"], [{ ...registry[0]!, requires: ["shared"] }]),
    /cycle/,
  );
  assert.throws(
    () =>
      resolveExtras(
        ["shared", "other"],
        [{ ...registry[0]!, conflicts: ["other"] }, registry[1]!],
      ),
    /conflict/,
  );
  assert.throws(
    () => resolveExtras(["shared"], [{ ...registry[0]!, source: "invalid" }]),
    /Invalid/,
  );
  assert.throws(
    () => resolveExtras(["shared"], [registry[0]!, registry[0]!]),
    /Duplicate/,
  );
  assert.throws(
    () =>
      planExtra(
        { id: "combo", scope: "user" },
        true,
        [],
        [],
        [
          registry[0]!,
          { ...registry[1]!, packages: ["npm:shared@2"] },
          registry[2]!,
        ],
      ),
    /Duplicate Extra package source/,
  );
});

test("enabling a dependency bundle plans shared packages once and adopts installed scoped/pinned/disabled Pi packages", () => {
  const selection = { id: "combo", scope: "project" } as const;
  const plan = planExtra(
    selection,
    true,
    [],
    [installed("npm:shared@1.0.0", "user", "disabled")],
    registry,
  );
  assert.deepEqual(plan.install, [{ source: "npm:other", scope: "project" }]);
  assert.equal(plan.present[0]?.state, "disabled");
  assert.deepEqual(requiredBy("npm:shared", plan.selections, registry), [
    "combo (project)",
  ]);
  assert.deepEqual(
    planExtra(
      selection,
      true,
      [],
      [
        installed("npm:shared", "user"),
        {
          source: "npm:shared@1",
          scope: "project",
          name: "shared",
          state: "missing",
          resources: [],
        },
      ],
      registry,
    ).install,
    [
      { source: "npm:shared@1", scope: "project" },
      { source: "npm:other", scope: "project" },
    ],
  );
  assert.deepEqual(
    planExtra(
      { id: "shared", scope: "user" },
      true,
      [],
      [installed("npm:shared", "project")],
      registry,
    ).install,
    [{ source: "npm:shared", scope: "user" }],
  );
  assert.throws(
    () =>
      planExtra(
        { id: "shared", scope: "user" },
        true,
        [],
        [
          {
            source: "npm:shared",
            scope: "project",
            name: "shared",
            state: "missing",
            resources: [],
          },
        ],
        registry,
      ),
    /repair it/,
  );
});

test("disabling an Extra never uninstalls shared or unclaimed Pi packages", () => {
  const selected = [
    { id: "shared", scope: "user" },
    { id: "other", scope: "user" },
  ] as const;
  assert.deepEqual(requiredBy("npm:shared@1", selected, registry), [
    "shared (user)",
  ]);
  assert.deepEqual(requiredBy("npm:pi-subagents@1", []), ["LazyPi Core"]);
  const plan = planExtra(
    selected[0],
    false,
    selected,
    [installed("npm:shared", "user")],
    registry,
  );
  assert.deepEqual(plan.install, []);
  assert.deepEqual(plan.kept, [{ source: "npm:shared", requiredBy: [] }]);
  assert.deepEqual(
    planExtra(selected[1], false, [selected[1]], [], registry).kept,
    [{ source: "npm:other", requiredBy: [] }],
  );
});

test("category, resource types, tags and dependency metadata fail clearly", () => {
  const base = registry[0]!;
  assert.deepEqual(getExtraCategories(), Object.keys(EXTRA_CATEGORIES));
  assert.equal(normalizeTag(" Code_Review "), "code-review");
  assert.throws(() => normalizeTag("bad/tag"), /Invalid Extra tag/);
  for (const [patch, message] of [
    [{ category: "unknown" }, /category/],
    [{ category: ["coding", "ai-agents"] }, /category/],
    [{ resourceTypes: ["package"] }, /resource type/],
    [{ resourceTypes: ["skill", "skill"] }, /resource type/],
    [{ tags: ["Code Review"] }, /tags/],
    [{ tags: ["bad/tag"] }, /tag/],
    [{ name: " " }, /name/],
    [{ source: "" }, /source/],
    [{ requires: ["missing"] }, /dependency/],
    [{ conflicts: ["missing"] }, /conflict/],
  ] as const) {
    assert.throws(
      () => validateExtras([{ ...base, ...patch } as Extra]),
      message,
    );
  }
  assert.throws(
    () =>
      validateExtras([
        base,
        { ...base, id: "shared@1", name: "shared@1", source: "npm:shared@1" },
      ]),
    /Duplicate Extra package source/,
  );
  assert.throws(
    () => validateExtras([{ ...base, requires: ["shared"] }]),
    /cycle/,
  );
});

test("category browsing, type filtering, search and deterministic recommendation ordering", () => {
  const ponytail = extras.find(
    (extra) => extra.id === "@dietrichgebert/ponytail",
  )!;
  assert.equal(ponytail.source, "npm:@dietrichgebert/ponytail");
  assert.deepEqual(
    planExtra({ id: "@dietrichgebert/ponytail", scope: "user" }, true, [], [])
      .install,
    [{ source: "npm:@dietrichgebert/ponytail", scope: "user" }],
  );
  assert.deepEqual(ponytail.resourceTypes, ["extension", "skill"]);
  assert.ok(getExtrasByCategory("coding").includes(ponytail));
  for (const category of getExtraCategories().filter((key) => key !== "coding"))
    assert.ok(!getExtrasByCategory(category).includes(ponytail));
  assert.ok(
    filterExtras(extras, "coding", "skill", "review").includes(ponytail),
  );
  assert.deepEqual(filterExtras(extras, "coding", "theme"), []);
  assert.deepEqual(
    filterExtras(extras, undefined, "all", "@dietrichgebert/ponytail"),
    [ponytail],
  );
  assert.ok(
    filterExtras(extras, undefined, "all", "Coding").includes(ponytail),
  );
  const shuffled = [
    { ...registry[1]!, id: "z", name: "Zed", priority: 1 },
    { ...registry[1]!, id: "a", name: "Alpha", default: true },
    registry[1]!,
  ];
  assert.deepEqual(
    getExtrasByCategory("coding", shuffled).map((e) => e.id),
    ["a", "z", "other"],
  );
  assert.deepEqual(
    getExtrasByCategory("coding", [...shuffled].reverse()).map((e) => e.id),
    ["a", "z", "other"],
  );
});

test("package-backed Extras derive identical id and name from npm source", () => {
  for (const extra of extras) {
    assert.equal(extra.id, extra.name);
    if (extra.source?.startsWith("npm:"))
      assert.equal(extra.id, extra.source.slice(4));
  }
  const ponytail = extras.find(
    (extra) => extra.source === "npm:@dietrichgebert/ponytail",
  )!;
  assert.equal(ponytail.id, "@dietrichgebert/ponytail");
  assert.throws(
    () => validateExtras([{ ...registry[0]!, id: "friendly" }]),
    /source/,
  );
});

test("every category has five distinct installable packages and each source occurs only once", () => {
  validateExtras(extras);
  const sources = extras.flatMap(extraSources);
  assert.equal(new Set(sources).size, sources.length);
  for (const category of getExtraCategories())
    assert.ok(
      getExtrasByCategory(category).filter(
        (extra) => extraSources(extra).length,
      ).length >= 5,
      `${EXTRA_CATEGORIES[category]} needs five packages`,
    );
});

test("Dynamic Workflows is one AI & Agents Extra with its published Pi resources", () => {
  const workflow = extras.find(
    (extra) => extra.id === "@quintinshaw/pi-dynamic-workflows",
  )!;
  assert.equal(workflow.source, "npm:@quintinshaw/pi-dynamic-workflows");
  assert.equal(workflow.category, "ai-agents");
  assert.deepEqual(workflow.resourceTypes, ["extension", "skill"]);
  assert.deepEqual(
    filterExtras(extras, "ai-agents", "skill", "orchestration"),
    [workflow],
  );
  assert.ok(
    getExtraCategories()
      .filter((category) => category !== "ai-agents")
      .every((category) => !getExtrasByCategory(category).includes(workflow)),
  );
  assert.deepEqual(
    planExtra({ id: workflow.id, scope: "user" }, true, [], []).install,
    [{ source: workflow.source, scope: "user" }],
  );
});

test("Ponytail's current installed manifest declares exactly the curated Pi resource types", () => {
  // Snapshot of the published v4.10.0 manifest; no real Pi installation is touched.
  const data = JSON.parse(
    readFileSync(
      new URL("./fixtures/ponytail.package.json", import.meta.url),
      "utf8",
    ),
  ) as { pi: Record<string, string[]> };
  const declared = Object.entries({
    extensions: "extension",
    skills: "skill",
    prompts: "prompt",
    themes: "theme",
  })
    .filter(([key]) => data.pi[key]?.length)
    .map(([, type]) => type);
  assert.deepEqual(
    declared,
    extras.find((extra) => extra.id === "@dietrichgebert/ponytail")!
      .resourceTypes,
  );
});

test("legacy persisted Extra IDs remain selected and migrate on the next write", () => {
  const root = mkdtempSync(join(tmpdir(), "lazypi-legacy-extras-"));
  const agent = join(root, "agent");
  mkdirSync(agent);
  writeFileSync(
    join(agent, "lazypi.json"),
    JSON.stringify({
      version: 1,
      enabledExtras: ["ponytail", "ai.research", "ai.subagents"],
    }),
  );
  assert.deepEqual(
    readSelections(agent, root, false).map((item) => item.id),
    ["@dietrichgebert/ponytail", "research-workflow", "pi-subagents"],
  );
  assert.deepEqual(
    JSON.parse(readFileSync(join(agent, "lazypi.json"), "utf8")).enabledExtras,
    ["ponytail", "ai.research", "ai.subagents"],
  ); // Reads do not rewrite real configuration.
  saveSelection(
    agent,
    root,
    { id: "@dietrichgebert/ponytail", scope: "user" },
    false,
  );
  assert.deepEqual(
    JSON.parse(readFileSync(join(agent, "lazypi.json"), "utf8")).enabledExtras,
    ["research-workflow", "pi-subagents"],
  );
  const project = join(root, ".pi");
  mkdirSync(project);
  writeFileSync(
    join(project, "lazypi.json"),
    JSON.stringify({ version: 1, enabledExtras: ["research.web"] }),
  );
  assert.deepEqual(readSelections(agent, root, true).at(-1), {
    id: "pi-web-access",
    scope: "project",
  });
  saveSelection(agent, root, { id: "pi-web-access", scope: "project" }, false);
  assert.deepEqual(
    JSON.parse(readFileSync(join(project, "lazypi.json"), "utf8"))
      .enabledExtras,
    [],
  );
});

test("selections are per scope and bootstrap preserves them; malformed state fails closed", () => {
  const dir = mkdtempSync(join(tmpdir(), "lazypi-extras-"));
  const agent = join(dir, "agent");
  mkdirSync(agent);
  saveSelection(agent, dir, { id: "pi-subagents", scope: "user" }, true);
  saveSelection(agent, dir, { id: "pi-web-access", scope: "project" }, true);
  assert.deepEqual(readSelections(agent, dir, false), [
    { id: "pi-subagents", scope: "user" },
  ]);
  assert.equal(isSetupComplete(agent), false);
  markSetupComplete(agent);
  assert.equal(isSetupComplete(agent), true);
  assert.deepEqual(readSelections(agent, dir, true), [
    { id: "pi-subagents", scope: "user" },
    { id: "pi-web-access", scope: "project" },
  ]);
  saveSelection(agent, dir, { id: "pi-subagents", scope: "user" }, false);
  assert.deepEqual(readSelections(agent, dir, true), [
    { id: "pi-web-access", scope: "project" },
  ]);
  writeFileSync(
    join(agent, "lazypi.json"),
    JSON.stringify({ version: 1, enabledExtras: [42] }),
  );
  assert.throws(() => readSelections(agent, dir, true), /Invalid LazyPi state/);
  assert.throws(() => markSetupComplete(agent), /Invalid LazyPi state/);
  assert.deepEqual(
    JSON.parse(readFileSync(join(agent, "lazypi.json"), "utf8")).enabledExtras,
    [42],
  );
});
