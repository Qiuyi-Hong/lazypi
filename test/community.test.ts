import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import {
  CommunityRegistry,
  isCurated,
  parseDetails,
  parseSearch,
  updateFor,
  type RemotePackage,
} from "../src/community.ts";
import type { PackageEntry } from "../src/packages.ts";
import { ManagerPopup, type Choice } from "../src/ui.ts";

const dir = () => mkdtempSync(join(tmpdir(), "lazypi-community-"));
const pkg = (name: string, version = "2.0.0") => ({
  name,
  version,
  description: "A Pi package",
  keywords: ["pi-package"],
  pi: { extensions: ["./ext.ts"], skills: ["./skills"] },
  repository: { url: "https://example.com" },
  author: { name: "Author" },
  dependencies: { safe: "^1" },
});
const entry = (
  source = "npm:example",
  version = "1.0.0",
  state: PackageEntry["state"] = "disabled",
): PackageEntry => ({
  source,
  version,
  state,
  name: source.slice(4),
  scope: "project",
  path: "/installed",
  resources: [],
});

test("npm search only accepts Pi packages and manifests supply all resource types", () => {
  assert.deepEqual(
    parseSearch({
      objects: [
        { package: pkg("example") },
        { package: { ...pkg("other"), keywords: [] } },
        { package: pkg("../evil") },
      ],
    }).map((item) => item.source),
    ["npm:example"],
  );
  assert.deepEqual(parseDetails(pkg("example")).resources, [
    "extensions",
    "skills",
  ]);
  assert.deepEqual(parseDetails(pkg("example")).dependencies, ["safe"]);
  assert.throws(() => parseSearch({ objects: {} }), /Invalid/);
  assert.throws(
    () => parseDetails({ name: "bad/name", version: "1" }),
    /Invalid/,
  );
  assert.equal(
    parseDetails({ ...pkg("example"), description: "hi\u001b[31m" })
      .description,
    "hi [31m",
  );
  assert.equal(isCurated("npm:pi-subagents"), true);
  assert.equal(isCurated("npm:example"), false);
});

test("cached search/details survive reopening, expire, refresh explicitly, and work offline", async () => {
  const path = dir();
  let time = 10000000;
  let requests = 0;
  const fetcher = (async (url: string) => {
    requests++;
    if (url.includes("/-/v1/search")) {
      assert.match(url, /keywords%3Api-package/);
      return new Response(
        JSON.stringify({ objects: [{ package: pkg("example") }] }),
        { status: 200 },
      );
    }
    assert.match(url, /\/example\/latest$/);
    return new Response(JSON.stringify(pkg("example")), { status: 200 });
  }) as typeof fetch;
  const registry = new CommunityRegistry(path, fetcher, () => time);
  assert.deepEqual(registry.cachedSearch(""), []);
  assert.equal((await registry.search(""))[0]?.name, "example");
  assert.deepEqual((await registry.details("example")).resources, [
    "extensions",
    "skills",
  ]);
  assert.equal(requests, 2);
  const reopened = new CommunityRegistry(path, fetcher, () => time);
  assert.deepEqual(reopened.cachedDetails("example")?.resources, [
    "extensions",
    "skills",
  ]);
  await reopened.search("");
  await reopened.details("example");
  assert.equal(requests, 2);
  await reopened.search("", true);
  assert.equal(requests, 3);
  time += 3600001;
  await reopened.details("example");
  assert.equal(requests, 4);
  const before = process.env.PI_OFFLINE;
  process.env.PI_OFFLINE = "1";
  try {
    await reopened.search("", true);
    await reopened.details("example", true);
    assert.equal(requests, 4);
    await assert.rejects(() => reopened.details("unknown"), /Offline/);
  } finally {
    if (before === undefined) delete process.env.PI_OFFLINE;
    else process.env.PI_OFFLINE = before;
  }
  assert.ok(
    JSON.parse(readFileSync(join(path, "lazypi-cache.json"), "utf8")).searches[
      ""
    ],
  );
});

test("malformed cache and registry responses fail safely; stale cache survives network failure", async () => {
  const path = dir();
  writeFileSync(join(path, "lazypi-cache.json"), "{");
  const bad = new CommunityRegistry(
    path,
    async () => new Response("{}", { status: 500 }),
  );
  assert.deepEqual(bad.cachedSearch(""), []);
  await assert.rejects(() => bad.search(""), /HTTP 500/);
  const ok = new CommunityRegistry(
    path,
    async () =>
      new Response(JSON.stringify({ objects: [{ package: pkg("example") }] })),
  );
  await ok.search("");
  const stale = new CommunityRegistry(
    path,
    async () => new Response("{}", { status: 500 }),
    () => Date.now() + 3600001,
  );
  await assert.rejects(() => stale.search(""), /HTTP 500/);
  assert.equal(stale.cachedSearch("")[0]?.name, "example");
  await assert.rejects(() => bad.details("../bad"), /Invalid npm/);
});

test("update check distinguishes newer versions and never advertises pins, missing or older", async () => {
  assert.equal(updateFor(entry(), parseDetails(pkg("example"))), true);
  assert.equal(
    updateFor(entry("npm:example", "2.0.0"), parseDetails(pkg("example"))),
    false,
  );
  assert.equal(
    updateFor(entry("npm:example@1.0.0"), parseDetails(pkg("example"))),
    false,
  );
  assert.equal(
    updateFor({ ...entry(), path: undefined }, parseDetails(pkg("example"))),
    false,
  );
  assert.equal(
    updateFor(entry("npm:example", "3.0.0"), parseDetails(pkg("example"))),
    false,
  );
  assert.equal(
    updateFor(entry("npm:example", "2.0.0-beta"), parseDetails(pkg("example"))),
    true,
  );
  const path = dir();
  const seen: string[] = [];
  const registry = new CommunityRegistry(path, async (url) => {
    seen.push(String(url));
    return new Response(JSON.stringify(pkg("example")));
  });
  await registry.checkUpdates([
    entry(),
    entry("npm:example", "1.1.0"),
    entry("npm:example@1.0.0"),
    entry("git:repo", "1.0.0"),
  ]);
  assert.equal(seen.length, 1);
  assert.equal(registry.cachedDetails("example")?.version, "2.0.0");
  assert.equal(
    await registry.checkUpdates([
      { ...entry(), scope: "user", state: "enabled" },
      entry(),
    ]),
    0,
  );
});

test("Community popup shows unverified state, fetches manifest on demand and offers native source", async () => {
  const choices: Choice[] = [];
  const tui = { requestRender: () => {}, terminal: { rows: 24 } } as TUI;
  const theme = { fg: (_color: string, content: string) => content } as Theme;
  const remote = parseDetails(pkg("example"));
  const popup = new ManagerPopup(
    tui,
    theme,
    (choice) => choices.push(choice),
    [entry()],
    "Community",
    "",
    [],
    undefined,
    "all",
    {
      community: [parseDetails(pkg("pi-subagents")), remote],
      loadDetails: async () => remote,
    },
  );
  assert.match(
    popup.render(76).join("\n"),
    /example[\s\S]*disabled[\s\S]*unverified/,
  );
  assert.doesNotMatch(
    popup.render(76).join("\n"),
    /pi-subagents[\s\S]*unverified/,
  );
  popup.handleInput("\r");
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(popup.render(76).join("\n"), /Author/);
  popup.handleInput("\r");
  popup.handleInput("u");
  assert.deepEqual(
    choices.map((choice) => choice.action),
    ["update"],
  );
  const available = new ManagerPopup(
    tui,
    theme,
    (choice) => choices.push(choice),
    [],
    "Community",
    "",
    [],
    undefined,
    "all",
    { community: [remote] },
  );
  available.handleInput("i");
  assert.equal(choices.at(-1)?.source, "npm:example");
  const updates = new ManagerPopup(
    tui,
    theme,
    (choice) => choices.push(choice),
    [entry()],
    "Updates",
    "",
    [],
    undefined,
    "all",
    { versions: new Map([["npm:example", remote]]) },
  );
  assert.match(updates.render(76).join("\n"), /1.0.0 → 2.0.0/);
  updates.handleInput("u");
  assert.equal(choices.at(-1)?.entry?.state, "disabled");
});

test("Community list and details keep Pi state and unverified ahead of registry metadata", () => {
  const choices: Choice[] = [];
  const tui = { requestRender: () => {}, terminal: { rows: 24 } } as TUI;
  const ansi = {
    fg: (_color: string, text: string) => `\x1b[31m${text}\x1b[0m`,
  } as Theme;
  const latest = "9".repeat(24);
  const registryOnly: RemotePackage = {
    name: `\u5305${"r".repeat(70)}`,
    source: "npm:registry-only",
    version: latest,
    description: `d\u001b[2J${"d".repeat(160)}`,
    resources: ["extensions"],
    repository: `https://example.com/${"p".repeat(60)}`,
    author: "Registry Author",
  };
  const localRemote: RemotePackage = {
    name: "example",
    source: "npm:example",
    version: latest,
    description: `local-match ${"d".repeat(80)}`,
    resources: ["skills"],
    author: "Local Author",
  };
  const missing: PackageEntry = {
    source: "npm:example@1.2.3",
    name: "\u5305example",
    scope: "user",
    state: "missing",
    resources: [],
    version: "1.0.0",
  };
  const ui = new ManagerPopup(
    tui,
    ansi,
    (choice) => choices.push(choice),
    [missing],
    "Community",
    "",
    [],
    undefined,
    "all",
    { community: [registryOnly, localRemote] },
  );
  const fits = (lines: string[], width: number) => {
    for (const line of lines) assert.ok(visibleWidth(line) <= width);
  };
  const row = (lines: string[]) =>
    lines.find((line) => line.includes("\u203a"));

  for (const width of [76, 32]) {
    const lines = ui.render(width);
    fits(lines, width);
    const selected = row(lines);
    assert.ok(selected);
    assert.match(selected, /\u5305/);
    assert.match(selected, /not installed/);
    assert.doesNotMatch(selected, /9{6}/);
    const text = lines.join("\n");
    assert.match(text, /unverified/);
    assert.doesNotMatch(text, /\u001b\[2J/);
  }
  ui.handleInput("i");
  assert.equal(choices.at(-1)?.source, "npm:registry-only");
  assert.equal(choices.at(-1)?.entry, undefined);
  ui.handleInput("\r");
  for (const width of [120, 32]) {
    const lines = ui.render(width);
    fits(lines, width);
    const text = lines.join("\n");
    assert.match(text, /unverified/);
    assert.match(text, /State: not installed/);
    assert.match(text, /Version: unknown/);
    assert.doesNotMatch(text, /State:.*9{6}/);
    assert.doesNotMatch(text, /Version: 9{6}/);
    assert.doesNotMatch(text, /\u203a/);
  }
  ui.handleInput("\u001b");
  ui.handleInput("j");
  for (const width of [76, 32]) {
    const lines = ui.render(width);
    fits(lines, width);
    const selected = row(lines);
    assert.ok(selected);
    assert.match(selected, /example/);
    assert.match(selected, /missing/);
    assert.match(selected, /user/);
    assert.doesNotMatch(selected, /not installed/);
    assert.doesNotMatch(selected, /9{6}/);
    assert.match(lines.join("\n"), /unverified/);
  }
  ui.handleInput("x");
  assert.equal(choices.at(-1)?.entry?.state, "missing");
  ui.handleInput("\r");
  for (const width of [120, 32]) {
    const lines = ui.render(width);
    fits(lines, width);
    const text = lines.join("\n");
    assert.match(text, /unverified/);
    assert.match(text, /State: missing/);
    assert.match(text, /Scope: user/);
    assert.match(text, /Version: 1\.0\.0/);
    assert.match(text, /Source: npm:example@1\.2\.3/);
    assert.doesNotMatch(text, /State:.*9{6}/);
    assert.doesNotMatch(text, /Version: 9{6}/);
    assert.doesNotMatch(text, /\u203a/);
  }
  ui.handleInput("\u001b");
  assert.match(ui.render(76).join("\n"), /\u203a/);
  assert.doesNotMatch(ui.render(76).join("\n"), /State:/);
  ui.handleInput("/");
  assert.equal(choices.at(-1)?.action, "search");
  ui.handleInput("r");
  assert.equal(choices.at(-1)?.action, "refresh");
  ui.handleInput("S");
  assert.match(ui.render(76).join("\n"), /Space\/Enter toggle setting/);
  ui.handleInput("T");
  assert.match(ui.render(76).join("\n"), /U update all/);
});
