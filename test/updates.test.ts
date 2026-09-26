import assert from "node:assert/strict";
import { test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import type { RemotePackage } from "../src/community.ts";
import type { PackageEntry } from "../src/packages.ts";
import { ManagerPopup, type Choice } from "../src/ui.ts";

const theme = { fg: (_color: string, text: string) => text } as Theme;
const item: PackageEntry = {
  name: "example",
  source: "npm:example",
  scope: "project",
  state: "disabled",
  path: "/pi/example",
  version: "1.0.0",
  resources: ["skills"],
  description: "Local description ".repeat(20),
};
const latest: RemotePackage = {
  name: "example",
  source: "npm:example",
  version: "2.0.0",
  description: "Publisher description ".repeat(20),
  resources: [],
};
const versions = new Map([[item.source, latest]]);
const tui = (rows: number) =>
  ({ requestRender: () => {}, terminal: { rows } }) as TUI;

function popup(
  choices: Choice[],
  remote: NonNullable<ConstructorParameters<typeof ManagerPopup>[9]>,
  rows = 24,
) {
  return new ManagerPopup(
    tui(rows),
    theme,
    (choice) => choices.push(choice),
    [item],
    "Updates",
    "",
    [],
    undefined,
    "all",
    { ...remote, versions: remote.versions && new Map(remote.versions) },
  );
}

test("Updates separates installed Pi state from npm latest in list and scrollable details", () => {
  const choices: Choice[] = [];
  const ui = popup(
    choices,
    {
      versions,
      cachedDetails: () => ({ value: latest, timestamp: 1_000_000 }),
      error: "refresh failed",
    },
    12,
  );
  const list = ui.render(100).join("\n");
  assert.match(list, /Pi installed 1\.0\.0.*project.*disabled/);
  assert.match(list, /npm latest 2\.0\.0.*cached at/);
  assert.doesNotMatch(list, /1\.0\.0 → 2\.0\.0/);
  const narrow = ui.render(32).join("\n");
  assert.match(narrow, /› exa.*Pi installed 1\.0\.0/);
  assert.match(narrow, /npm latest 2\.0\.0/);
  ui.handleInput("\r");
  let details = "";
  for (let i = 0; i < 45; i++) {
    const frame = ui.render(42);
    assert.equal(frame.length, 10);
    for (const line of frame) assert.equal(visibleWidth(line), 42);
    assert.match(frame.at(-2)!, /Esc/);
    details += frame.join("\n");
    ui.handleInput("j");
  }
  assert.match(details, /Pi installed version: 1\.0\.0/);
  assert.match(details, /Pi scope: project.*Pi state: disabled/);
  assert.match(details, /npm latest: 2\.0\.0/);
  assert.match(details, /cached at[\s\S]*stale; refresh failed/);
  assert.match(details, /publisher-supplied/);
  assert.doesNotMatch(details, /Pi installed version: 2\.0\.0/);
  ui.handleInput("\u001b");
  ui.handleInput("u");
  assert.deepEqual(choices.at(-1), { action: "update", entry: item });
  ui.handleInput("U");
  assert.equal(choices.at(-1)?.action, "update-all");
  ui.handleInput("r");
  assert.equal(choices.at(-1)?.action, "refresh");
});

test("Updates empty, loading and offline states retain a bounded frame and exit", () => {
  for (const [remote, cue] of [
    [{ loading: true }, /Loading npm metadata/],
    [{ offline: true }, /offline—not cached/],
    [
      { error: "refresh failed" },
      /refresh failed.*unknown|unknown.*refresh failed/,
    ],
    [{}, /not loaded/],
    [
      { versions: new Map([[item.source, { ...latest, version: "1.0.0" }]]) },
      /No newer npm versions/,
    ],
  ] as const) {
    const ui = popup([], remote, 8);
    const frame = ui.render(76);
    assert.equal(frame.length, 6);
    for (const line of frame) assert.equal(visibleWidth(line), 76);
    assert.match(frame.at(-2)!, /Esc/);
    assert.match(frame.join("\n"), cue);
  }
  const choices: Choice[] = [];
  const ui = popup(choices, { versions, offline: true }, 8);
  assert.match(ui.render(76).join("\n"), /Pi installed 1\.0\.0/);
  ui.handleInput("\r");
  let detail = "";
  for (let i = 0; i < 55; i++) {
    detail += ui.render(76).join("\n");
    ui.handleInput("j");
  }
  assert.match(detail, /offline—not cached/);
  ui.handleInput("\u001b");
  ui.handleInput("\u001b");
  assert.equal(choices.at(-1)?.action, "close");
});

test("Updates distinguishes absent publisher metadata from an unfetched hint", () => {
  const withoutDescription = { ...latest, description: "" };
  const cached = popup([], {
    versions: new Map([[item.source, withoutDescription]]),
    cachedDetails: () => ({ value: withoutDescription, timestamp: 1_000_000 }),
  });
  cached.handleInput("\r");
  assert.match(
    cached.render(120).join("\n"),
    /npm description \(publisher-supplied\): not provided/,
  );
  const unknown = popup([], {
    versions: new Map([[item.source, withoutDescription]]),
  });
  unknown.handleInput("\r");
  assert.match(
    unknown.render(120).join("\n"),
    /npm description \(publisher-supplied\): unknown/,
  );
});

test("Updates keeps empty query results distinct from missing registry metadata", () => {
  const ui = new ManagerPopup(
    tui(8),
    theme,
    () => {},
    [item],
    "Updates",
    "other",
    [],
    undefined,
    "all",
    { versions },
  );
  assert.match(ui.render(76).join("\n"), /No matching updates/);
});

test("Updates shows fetched detail without altering Pi facts or redrawing a disposed popup", async () => {
  let resolve!: (pkg: RemotePackage) => void;
  let renders = 0;
  const ui = new ManagerPopup(
    {
      requestRender: () => {
        renders++;
      },
      terminal: { rows: 12 },
    } as TUI,
    theme,
    () => {},
    [item],
    "Updates",
    "",
    [],
    undefined,
    "all",
    {
      versions: new Map(versions),
      loadDetails: () =>
        new Promise((done) => {
          resolve = done;
        }),
    },
  );
  ui.handleInput("\r");
  const before = ui.render(76);
  resolve({ ...latest, version: "3.0.0", description: "Fetched description" });
  await new Promise((done) => setImmediate(done));
  assert.equal(ui.render(76).length, before.length);
  let detail = "";
  for (let i = 0; i < 45; i++) {
    detail += ui.render(76).join("\n");
    ui.handleInput("j");
  }
  assert.match(detail, /npm latest: 3\.0\.0/);
  assert.match(detail, /Pi installed version: 1\.0\.0/);
  ui.handleInput("\u001b");
  assert.match(ui.render(76).join("\n"), /npm latest 3\.0\.0/);
  ui.dispose();
  const count = renders;
  ui.setRemote([], new Map(), false);
  assert.equal(renders, count);

  let finish!: (pkg: RemotePackage) => void;
  const pending = new ManagerPopup(
    {
      requestRender: () => {
        renders++;
      },
      terminal: { rows: 12 },
    } as TUI,
    theme,
    () => {},
    [item],
    "Updates",
    "",
    [],
    undefined,
    "all",
    {
      versions: new Map(versions),
      loadDetails: () =>
        new Promise((done) => {
          finish = done;
        }),
    },
  );
  pending.handleInput("\r");
  pending.dispose();
  const beforeLate = renders;
  finish({ ...latest, version: "4.0.0" });
  await new Promise((done) => setImmediate(done));
  assert.equal(renders, beforeLate);
  assert.doesNotMatch(pending.render(76).join("\n"), /4\.0\.0/);
});

test("Updates drops an outdated hint when fetched npm latest is no longer newer", async () => {
  let finish!: (pkg: RemotePackage) => void;
  const ui = popup([], {
    versions,
    loadDetails: () =>
      new Promise((done) => {
        finish = done;
      }),
  });
  ui.handleInput("\r");
  finish({ ...latest, version: "1.0.0" });
  await new Promise((done) => setImmediate(done));
  assert.match(ui.render(76).join("\n"), /No newer npm versions/);
  assert.doesNotMatch(ui.render(76).join("\n"), /› example/);
});
