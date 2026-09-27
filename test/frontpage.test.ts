import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type {
  ExtensionCommandContext,
  ExtensionContext,
  RegisteredCommand,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import extension from "../extensions/lazypi.ts";
import {
  markSetupComplete,
  readLazyPiState,
  writeLazyPiState,
} from "../src/bootstrap.ts";
import { ManagerPopup } from "../src/ui.ts";

const theme = { fg: (_color: string, text: string) => text } as Theme;
const tui = { requestRender: () => {}, terminal: { rows: 24 } } as TUI;

test("interactive startup, resume and reload install a readable frontpage using session data", () => {
  const root = mkdtempSync(join(tmpdir(), "lazypi-frontpage-"));
  const agent = join(root, "agent");
  writeLazyPiState(agent, { autoCheckUpdates: false, bootstrapComplete: true });
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agent;
  try {
    const handlers: Record<
      string,
      (event: unknown, ctx: ExtensionContext) => void
    > = {};
    extension({
      on: (
        name: string,
        handler: (event: unknown, ctx: ExtensionContext) => void,
      ) => {
        handlers[name] = handler;
        return () => {};
      },
      registerCommand: () => {},
    } as unknown as Parameters<typeof extension>[0]);
    const installed: NonNullable<
      Parameters<ExtensionContext["ui"]["setHeader"]>[0]
    >[] = [];
    const ctx = {
      mode: "tui",
      cwd: `${root}/project/` + "wide-路".repeat(12),
      model: { provider: "provider", id: "model-42" },
      sessionManager: {
        getSessionDir: () => `${agent}/sessions/` + "长".repeat(40),
      },
      ui: {
        setHeader: (factory: (typeof installed)[number]) =>
          installed.push(factory),
      },
    } as unknown as ExtensionContext;
    handlers.session_start!({ reason: "startup" }, ctx);
    handlers.session_start!({ reason: "resume" }, ctx);
    handlers.session_start!({ reason: "reload" }, ctx);
    assert.equal(installed.length, 3);
    const component = installed[2]!(tui, theme);
    const lines = component.render(28);
    assert.ok(lines.every((line) => visibleWidth(line) <= 28));
    const text = lines.join("");
    for (const fragment of [
      "LazyPi",
      "provider/model-42",
      ctx.cwd,
      ctx.sessionManager.getSessionDir(),
      "/lazypi",
      "/lazypi extras",
      "/lazypi community",
      "/lazypi updates",
    ])
      assert.ok(text.includes(fragment), fragment);
    assert.equal("handleInput" in component, false);
    assert.ok(component.render(1).every((line) => visibleWidth(line) <= 1));
    (ctx as { model?: { provider: string; id: string } }).model = {
      provider: "new",
      id: "selected",
    };
    assert.match(component.render(80).join("\n"), /new\/selected/);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  }
});

test("no model or session directory is invented; non-interactive modes never set a header", () => {
  const root = mkdtempSync(join(tmpdir(), "lazypi-no-model-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  try {
    let start!: (event: unknown, ctx: ExtensionContext) => void;
    extension({
      on: (_: string, handler: typeof start) => {
        start = handler;
        return () => {};
      },
      registerCommand: () => {},
    } as unknown as Parameters<typeof extension>[0]);
    const headers: Parameters<ExtensionContext["ui"]["setHeader"]>[0][] = [];
    const ctx = {
      mode: "tui",
      cwd: root,
      model: undefined,
      sessionManager: { getSessionDir: () => "" },
      ui: {
        setHeader: (value: (typeof headers)[number]) => {
          headers.push(value);
        },
      },
    } as unknown as ExtensionContext;
    for (const mode of ["print", "json", "rpc"] as const)
      start({}, { ...ctx, mode });
    assert.equal(headers.length, 0);
    start({}, ctx);
    assert.equal(headers.length, 1);
    const text = headers[0]!(tui, theme).render(80).join("\n");
    assert.match(text, /Model.*No model selected/);
    assert.doesNotMatch(text, /Sessions/);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  }
});

test("Settings toggles the frontpage without losing other preferences or update checking", async () => {
  const root = mkdtempSync(join(tmpdir(), "lazypi-frontpage-settings-"));
  const agent = join(root, "agent");
  markSetupComplete(agent);
  writeLazyPiState(agent, { autoCheckUpdates: true });
  const previous = process.env.PI_CODING_AGENT_DIR;
  const previousOffline = process.env.PI_OFFLINE;
  process.env.PI_CODING_AGENT_DIR = agent;
  process.env.PI_OFFLINE = "1";
  try {
    let start!: (event: unknown, ctx: ExtensionContext) => void;
    let command!: RegisteredCommand["handler"];
    extension({
      on: (_: string, handler: typeof start) => {
        start = handler;
        return () => {};
      },
      registerCommand: (_: string, value: { handler: typeof command }) => {
        command = value.handler;
      },
    } as unknown as Parameters<typeof extension>[0]);
    const headers: Parameters<ExtensionContext["ui"]["setHeader"]>[0][] = [];
    const ctx = {
      mode: "tui",
      cwd: root,
      model: undefined,
      isProjectTrusted: () => false,
      sessionManager: { getSessionDir: () => agent },
      ui: {
        setHeader: (factory: (typeof headers)[number]) => headers.push(factory),
        notify: () => {},
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
            popup.handleInput("j"); // select Show LazyPi frontpage
            popup.handleInput(" ");
            popup.handleInput("\u001b");
          }),
      },
    } as unknown as ExtensionCommandContext;
    start({}, ctx);
    assert.equal(headers.length, 1);
    await command("settings", ctx);
    assert.equal(readLazyPiState(agent).showFrontpage, false);
    assert.equal(readLazyPiState(agent).autoCheckUpdates, true);
    assert.equal(headers.at(-1), undefined);
    assert.equal(headers.length, 2);
    start({}, ctx);
    assert.equal(headers.length, 2);
    await command("settings", ctx);
    assert.equal(readLazyPiState(agent).showFrontpage, true);
    assert.ok(headers.at(-1));
    const reloaded: Parameters<ExtensionContext["ui"]["setHeader"]>[0][] = [];
    start({ reason: "resume" }, {
      ...ctx,
      ui: {
        ...ctx.ui,
        setHeader: (factory: (typeof reloaded)[number]) =>
          reloaded.push(factory),
      },
    } as ExtensionContext);
    assert.equal(reloaded.length, 1);
    const fresh: Parameters<ExtensionContext["ui"]["setHeader"]>[0][] = [];
    const startFresh = (() => {
      let handler!: (event: unknown, ctx: ExtensionContext) => void;
      extension({
        on: (_: string, callback: typeof handler) => {
          handler = callback;
          return () => {};
        },
        registerCommand: () => {},
      } as unknown as Parameters<typeof extension>[0]);
      return handler;
    })();
    writeLazyPiState(agent, { showFrontpage: false });
    startFresh({}, {
      ...ctx,
      ui: {
        ...ctx.ui,
        setHeader: (factory: (typeof fresh)[number]) => fresh.push(factory),
      },
    } as ExtensionContext);
    assert.deepEqual(
      fresh,
      [],
      "opt-out must not replace another extension's header",
    );
    writeLazyPiState(agent, { showFrontpage: true });
    // Pi disposes the previous component when another extension takes the header.
    headers.at(-1)!(tui, theme).dispose?.();
    const before = headers.length;
    await command("settings", ctx);
    assert.equal(readLazyPiState(agent).showFrontpage, false);
    assert.equal(
      headers.length,
      before,
      "turning off LazyPi must not clear the replacement header",
    );
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    if (previousOffline === undefined) delete process.env.PI_OFFLINE;
    else process.env.PI_OFFLINE = previousOffline;
  }
});

test("an invalid frontpage preference does not suppress enabled startup update notifications", async () => {
  const root = mkdtempSync(join(tmpdir(), "lazypi-frontpage-update-"));
  const agent = join(root, "agent");
  const pkg = join(agent, "npm", "node_modules", "foo");
  mkdirSync(pkg, { recursive: true });
  writeFileSync(
    join(pkg, "package.json"),
    JSON.stringify({ name: "foo", version: "1.0.0" }),
  );
  writeFileSync(
    join(agent, "settings.json"),
    JSON.stringify({ packages: ["npm:foo"] }),
  );
  writeFileSync(
    join(agent, "lazypi.json"),
    JSON.stringify({ version: 1, showFrontpage: "no", autoCheckUpdates: true }),
  );
  writeFileSync(
    join(agent, "lazypi-cache.json"),
    JSON.stringify({
      searches: {},
      details: {
        foo: {
          timestamp: Date.now(),
          value: {
            name: "foo",
            source: "npm:foo",
            version: "2.0.0",
            resources: [],
            description: "",
          },
        },
      },
    }),
  );
  const previous = process.env.PI_CODING_AGENT_DIR;
  const previousOffline = process.env.PI_OFFLINE;
  process.env.PI_CODING_AGENT_DIR = agent;
  process.env.PI_OFFLINE = "1";
  try {
    let start!: (event: unknown, ctx: ExtensionContext) => void;
    extension({
      on: (_: string, handler: typeof start) => {
        start = handler;
        return () => {};
      },
      registerCommand: () => {},
    } as unknown as Parameters<typeof extension>[0]);
    const notices: string[] = [];
    start({}, {
      mode: "tui",
      cwd: root,
      model: undefined,
      sessionManager: { getSessionDir: () => agent },
      isProjectTrusted: () => false,
      ui: {
        setHeader: () => {},
        notify: (message: string) => notices.push(message),
      },
    } as unknown as ExtensionContext);
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(notices.join(" "), /1 Pi package update available/);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    if (previousOffline === undefined) delete process.env.PI_OFFLINE;
    else process.env.PI_OFFLINE = previousOffline;
  }
});

test("malformed optional state and header failures cannot block startup", () => {
  const root = mkdtempSync(join(tmpdir(), "lazypi-frontpage-failure-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  try {
    writeFileSync(join(root, "lazypi.json"), "{");
    let start!: (event: unknown, ctx: ExtensionContext) => void;
    extension({
      on: (_: string, handler: typeof start) => {
        start = handler;
        return () => {};
      },
      registerCommand: () => {},
    } as unknown as Parameters<typeof extension>[0]);
    const ctx = {
      mode: "tui",
      cwd: root,
      model: undefined,
      sessionManager: { getSessionDir: () => root },
      ui: {
        setHeader: () => {
          throw new Error("broken header");
        },
      },
    } as unknown as ExtensionContext;
    assert.doesNotThrow(() => start({}, ctx));
    let installed = 0;
    start({}, {
      ...ctx,
      ui: {
        ...ctx.ui,
        setHeader: () => {
          installed++;
        },
      },
    } as ExtensionContext);
    assert.equal(
      installed,
      1,
      "malformed settings retain the default-on header",
    );
    let header: Parameters<ExtensionContext["ui"]["setHeader"]>[0];
    start({}, {
      ...ctx,
      get model() {
        throw new Error("model unavailable");
      },
      ui: {
        ...ctx.ui,
        setHeader: (factory) => {
          header = factory;
        },
      },
    } as ExtensionContext);
    assert.ok(header!);
    assert.doesNotThrow(() => header!(tui, theme).render(80));
    assert.equal(readFileSync(join(root, "lazypi.json"), "utf8"), "{");
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  }
});
