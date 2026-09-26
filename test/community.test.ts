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
const detailText = (ui: ManagerPopup, width = 100) => {
  const frames: string[] = [];
  for (let i = 0; i < 100; i++) {
    frames.push(ui.render(width).join("\n"));
    ui.handleInput("j");
  }
  return frames.join("\n");
};
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
  assert.doesNotMatch(
    parseDetails({ ...pkg("example"), author: "name\u202eadmin" }).author ?? "",
    /\u202e/,
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
    (
      await registry.checkUpdates([
        { ...entry(), scope: "user", state: "enabled" },
        entry(),
      ])
    ).failed,
    0,
  );
});

test("update snapshots retain stale versions and report partial refresh failures", async () => {
  let failExample = false;
  let time = 10000000;
  const registry = new CommunityRegistry(
    dir(),
    async (url) => {
      const name = String(url).includes("/example/latest")
        ? "example"
        : "second";
      if (name === "example" && failExample)
        return new Response("{}", { status: 500 });
      return new Response(
        JSON.stringify(pkg(name, failExample ? "3.0.0" : "2.0.0")),
      );
    },
    () => time,
  );
  const items = [
    entry(),
    { ...entry(), scope: "user" as const },
    entry("npm:second"),
    entry("npm:example@1.0.0"),
    entry("git:example"),
  ];
  assert.equal(registry.cachedUpdates(items).size, 0);
  const first = await registry.checkUpdates(items);
  assert.equal(first.failed, 0);
  assert.deepEqual([...first.versions.keys()], ["npm:example", "npm:second"]);
  assert.equal(first.versions.get("npm:example")?.version, "2.0.0");

  failExample = true;
  time += 3600001;
  const checked = await registry.checkUpdates(items);
  assert.equal(checked.failed, 1);
  assert.equal(checked.versions.get("npm:example")?.version, "2.0.0");
  assert.equal(checked.versions.get("npm:second")?.version, "3.0.0");
  assert.deepEqual(registry.cachedUpdates(items), checked.versions);
  assert.equal(registry.cachedUpdates([entry("npm:second")]).size, 1);
});

test("new search versions retain cached details and their timestamp until a replacement arrives", async () => {
  const path = dir();
  let time = 1_000_000;
  let version = "1.0.0";
  const registry = new CommunityRegistry(
    path,
    async (url) =>
      new Response(
        JSON.stringify(
          String(url).includes("/search")
            ? { objects: [{ package: pkg("example", version) }] }
            : pkg("example", version),
        ),
      ),
    () => time,
  );
  await registry.search("");
  await registry.details("example");
  const saved = registry.cachedDetails("example");
  version = "2.0.0";
  time += 1000;
  await registry.search("", true);
  assert.deepEqual(registry.cachedDetails("example"), saved);
  assert.equal(registry.cachedDetail("example")?.timestamp, 1_000_000);
  assert.equal(registry.cachedSearchAt(""), time);
  assert.equal((await registry.details("example")).version, "2.0.0");
  assert.equal(registry.cachedDetail("example")?.timestamp, time);
});

test("Community details separate Pi facts from publisher metadata and cache states", async () => {
  const tui = { requestRender: () => {}, terminal: { rows: 24 } } as TUI;
  const theme = { fg: (_color: string, content: string) => content } as Theme;
  const remote = parseDetails({
    ...pkg("example"),
    description: "Publisher bio",
    pi: {},
    dependencies: {},
  });
  const local = {
    ...entry("npm:example@1.2.3"),
    error: "Invalid package manifest",
    description: undefined,
  };
  const registry = new CommunityRegistry(
    dir(),
    async () => new Response(JSON.stringify(pkg("example"))),
  );
  const ui = new ManagerPopup(
    tui,
    theme,
    () => {},
    [local],
    "Community",
    "",
    [],
    undefined,
    "all",
    {
      community: [remote],
      cachedDetails: (name) => registry.cachedDetail(name),
      searchTimestamp: 1_000_000,
      offline: true,
    },
  );
  ui.handleInput("\r");
  let text = detailText(ui);
  assert.match(text, /Pi state \(project\): disabled/);
  assert.match(text, /Pi description: unknown/);
  assert.match(text, /npm description \(publisher-supplied\): Publisher bio/);
  assert.match(text, /Details: offline—not cached/);
  assert.match(text, /npm declared resources: unknown/);
  assert.match(text, /Invalid package manifest/);
  assert.doesNotMatch(text, /Pi description: Publisher bio/);

  const online = new ManagerPopup(
    tui,
    theme,
    () => {},
    [],
    "Community",
    "",
    [],
    undefined,
    "all",
    {
      community: [remote],
      cachedDetails: (name) => registry.cachedDetail(name),
    },
  );
  online.handleInput("\r");
  assert.match(online.render(100).join("\n"), /Details: not loaded/);
  await registry.details("example");
  online.setRemote([remote], new Map(), false, "refresh failed");
  text = detailText(online);
  assert.match(text, /Details: cached at/);
  assert.match(text, /Registry: refresh failed/);
  assert.match(text, /npm dependencies: safe/);
});

test("Community detail arrival keeps the frame fixed, scrolls long fields and ignores disposal", async () => {
  let resolve!: (value: RemotePackage) => void;
  let renders = 0;
  const tui = {
    requestRender: () => {
      renders++;
    },
    terminal: { rows: 22 },
  } as TUI;
  const theme = { fg: (_color: string, content: string) => content } as Theme;
  const remote = parseDetails(pkg("example"));
  const ui = new ManagerPopup(
    tui,
    theme,
    () => {},
    [],
    "Community",
    "",
    [],
    undefined,
    "all",
    {
      community: [remote],
      loadDetails: () =>
        new Promise((done) => {
          resolve = done;
        }),
    },
  );
  ui.handleInput("\r");
  const before = ui.render(32);
  resolve({
    ...remote,
    description: "long ".repeat(70),
    dependencies: ["last-dependency"],
  });
  await new Promise((done) => setImmediate(done));
  const after = ui.render(32);
  assert.equal(after.length, before.length);
  for (const line of after) assert.equal(visibleWidth(line), 32);
  for (let i = 0; i < 150; i++) {
    ui.render(32);
    ui.handleInput("j");
  }
  assert.match(ui.render(32).join("\n"), /last-dependency/);
  assert.match(ui.render(32).at(-2)!, /Esc/);
  ui.handleInput("\u001b");
  assert.match(ui.render(32).join("\n"), /› example/);
  ui.dispose();
  const count = renders;
  ui.setRemote([], new Map(), false);
  assert.equal(renders, count);
  const pending = new ManagerPopup(
    tui,
    theme,
    () => {},
    [],
    "Community",
    "",
    [],
    undefined,
    "all",
    {
      community: [remote],
      loadDetails: () =>
        new Promise((done) => {
          resolve = done;
        }),
    },
  );
  pending.handleInput("\r");
  pending.dispose();
  const beforeLate = renders;
  resolve({ ...remote, author: "late" });
  await new Promise((done) => setImmediate(done));
  assert.equal(renders, beforeLate);
  assert.doesNotMatch(pending.render(80).join("\n"), /late/);
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
  assert.match(
    detailText(popup, 76),
    /npm author \(publisher-supplied\): Author/,
  );
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
