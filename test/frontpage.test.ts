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
import {
  getKeybindings,
  setKeybindings,
  stripTerminalSequences,
  type KeybindingsManager,
  visibleWidth,
  type TUI,
} from "@earendil-works/pi-tui";
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
      "wide-路",
      "长长",
      "/lazypi",
      "/lazypi extras",
      "/lazypi community",
      "/lazypi updates",
    ])
      assert.ok(text.includes(fragment), fragment);
    assert.ok(
      lines.filter((line) => line.trim()).length < 15,
      "long paths must not fill the header",
    );
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

test("wide startup header renders a connected blue wordmark and a truthful two-column panel", () => {
  const root = mkdtempSync(join(tmpdir(), "lazypi-wide-header-"));
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
    let factory: NonNullable<
      Parameters<ExtensionContext["ui"]["setHeader"]>[0]
    >;
    const ctx = {
      mode: "tui",
      cwd: `${root}/` + "路".repeat(90),
      model: { provider: "provider", id: "model-" + "a".repeat(90) },
      sessionManager: {
        getSessionDir: () => `${root}/sessions/` + "长".repeat(80),
      },
      ui: {
        setHeader: (value: typeof factory) => {
          factory = value;
        },
      },
    } as unknown as ExtensionContext;
    start({}, ctx);
    assert.ok(factory!);
    for (const colored of [false, true]) {
      const activeTheme = {
        fg: (color: string, text: string) =>
          colored
            ? `\x1b[${color === "accent" ? 34 : 37}m${text}\x1b[0m`
            : text,
      } as Theme;
      const component = factory!(tui, activeTheme);
      for (const width of [88, 96, 120, 160]) {
        const lines = component.render(width);
        assert.ok(
          lines.every((line) => visibleWidth(line) <= width),
          `width ${width}`,
        );
        const raw = lines.map(stripTerminalSequences);
        const logo = raw.slice(
          0,
          raw.findIndex((line) => line.trimStart().startsWith("╭")),
        );
        assert.ok(logo.length >= 6, "large logo sits above the panel");
        assert.ok(
          logo.some((line) => /█/.test(line)),
          "block-letter wordmark",
        );
        assert.ok(
          logo.some((line) => /░/.test(line)),
          "offset outline/shadow",
        );
        const logoStart = logo.findIndex((line) => line.includes("█"));
        const letterColumns = logo.flatMap((line) =>
          Array.from(line.matchAll(/█/g), (match) => match.index!),
        );
        assert.equal(Math.min(...letterColumns), Math.floor((width - 60) / 2));
        assert.equal(
          Math.max(...letterColumns),
          Math.floor((width - 60) / 2) + 59,
        );
        assert.ok(
          logo[logoStart + 5]?.trimStart().startsWith("█".repeat(14)),
          "the L foot joins A",
        );
        const zs = logo
          .flatMap((line, row) =>
            Array.from(line.matchAll(/z/g), (match) => ({
              row,
              col: match.index!,
            })),
          )
          .sort((a, b) => b.row - a.row);
        assert.equal(zs.length, 4);
        assert.ok(zs.every((z, i) => i === 0 || z.row < zs[i - 1]!.row));
        const gaps = zs.slice(1).map((z, i) => z.col - zs[i]!.col);
        assert.ok(
          gaps.every((gap, i) => gap > 0 && (i === 0 || gap > gaps[i - 1]!)),
        );
        const panel = raw
          .slice(raw.findIndex((line) => line.trimStart().startsWith("╭")))
          .map((line) => line.trimStart());
        assert.match(panel[0]!, /^╭─+╮$/);
        assert.match(panel.at(-1)!, /^╰─+╯$/);
        assert.ok(panel.some((line) => /│.*SESSION.*│.*LAZYPI.*│/.test(line)));
        for (const [command, label] of [
          ["/lazypi", "Pi-configured packages"],
          ["/lazypi extras", "optional capabilities"],
          ["/lazypi community", "npm discovery"],
          ["/lazypi updates", "newer npm versions"],
        ])
          assert.ok(
            panel.some((line) => line.includes(`${command} · ${label}`)),
            command,
          );
        assert.match(panel.join("\n"), /Model.*provider\/model-/);
        assert.match(panel.join("\n"), /Working directory/);
        assert.match(panel.join("\n"), /Session directory/);
        assert.match(panel.join("\n"), /…路路/);
        assert.match(panel.join("\n"), /…长长/);
        assert.doesNotMatch(
          panel.join("\n"),
          /skills|extensions|Ctrl|Alt|Shift|⌘/i,
        );
      }
      if (colored) assert.match(component.render(120).join(""), /\x1b\[34m/);
    }
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  }
});

test("header factory reflows on resize and uses active theme roles without a background", () => {
  const root = mkdtempSync(join(tmpdir(), "lazypi-responsive-"));
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
    let factory: NonNullable<
      Parameters<ExtensionContext["ui"]["setHeader"]>[0]
    >;
    const ctx = {
      mode: "tui",
      cwd: `${root}/project/` + "路".repeat(100) + "/actual.ts",
      model: { provider: "provider", id: "路".repeat(100) },
      sessionManager: {
        getSessionDir: () =>
          `${root}/sessions/` + "长".repeat(100) + "/current.jsonl",
      },
      ui: { setHeader: (value: typeof factory) => (factory = value) },
    } as unknown as ExtensionContext;
    start({}, ctx);
    assert.ok(factory!);
    for (const [name, code] of [
      ["dark", 34],
      ["light", 94],
      ["monochrome", 1],
    ] as const) {
      const activeTheme = {
        fg: (role: string, text: string) =>
          `\x1b[${role === "accent" ? code : 37}m${text}\x1b[0m`,
      } as Theme;
      const component = factory!(tui, activeTheme);
      for (const width of [1, 16, 24, 28, 31, 32, 40, 60, 87, 88, 120]) {
        const lines = component.render(width);
        const raw = lines.map(stripTerminalSequences);
        assert.ok(
          lines.every((line) => visibleWidth(line) <= width),
          `${name} at ${width}`,
        );
        assert.doesNotMatch(
          lines.join(""),
          /\x1b\[(?:4[0-9]|10[0-7]|48;)[^m]*m/,
          "no forced background",
        );
        if (width >= 24) {
          for (const command of [
            "/lazypi",
            "/lazypi extras",
            "/lazypi community",
            "/lazypi updates",
          ])
            assert.ok(
              raw.some((line) => line.includes(command)),
              `${name} ${width}: ${command}`,
            );
          assert.ok(
            raw.some((line) => line.includes("actual.ts")),
            "real cwd tail",
          );
          assert.ok(
            raw.some((line) => line.includes("current.jsonl")),
            "real session tail",
          );
        }
        if (width >= 32 && width < 88) {
          assert.ok(
            raw.some((line) => line.trim() === "SESSION") &&
              raw.some((line) => line.trim() === "LAZYPI"),
            "stacked groups",
          );
          assert.ok(
            raw.some((line) => line.includes("LazyPi")),
            "compact wordmark",
          );
          assert.ok(
            !raw.some((line) => /[█░╭│]/.test(line)),
            "no wide ornament",
          );
          assert.ok(
            raw.filter((line) => line.trim()).length <= 15,
            "bounded header content",
          );
        }
        if (width < 32) {
          assert.ok(
            !raw.some((line) => /[█░╭│]/.test(line)),
            "ornament omitted first",
          );
          assert.ok(
            raw.filter((line) => line.trim()).length <= 9,
            "essential rows only",
          );
        }
        if (width >= 88)
          assert.ok(
            raw.some((line) => line.trimStart().startsWith("╭")),
            "wide panel restored",
          );
      }
      assert.match(
        component.render(40).join(""),
        new RegExp(`\\x1b\\[${code}m`),
      );
    }
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  }
});

test("startup header keeps the wordmark and details near the top without hiding the prompt on short terminals", () => {
  const root = mkdtempSync(join(tmpdir(), "lazypi-centered-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  try {
    let start!: (event: unknown, ctx: ExtensionContext) => void;
    let effort = "high";
    extension({
      on: (_: string, handler: typeof start) => {
        start = handler;
        return () => {};
      },
      getThinkingLevel: () => effort,
      registerCommand: () => {},
    } as unknown as Parameters<typeof extension>[0]);
    let factory!: NonNullable<
      Parameters<ExtensionContext["ui"]["setHeader"]>[0]
    >;
    start({}, {
      mode: "tui",
      cwd: root,
      model: { provider: "provider", id: "model-42" },
      sessionManager: { getSessionDir: () => "" },
      ui: { setHeader: (value: typeof factory) => (factory = value) },
    } as unknown as ExtensionContext);
    const tall = { ...tui, terminal: { rows: 48 } } as TUI;
    const component = factory(tall, theme);
    const originalKeys = getKeybindings();
    const bindings = new Map([
      ["app.interrupt", "escape"],
      ["app.clear", "ctrl+shift+c"],
      ["app.exit", "ctrl+d"],
      ["app.suspend", "ctrl+z"],
      ["tui.editor.deleteToLineEnd", "ctrl+k"],
      ["app.thinking.cycle", "shift+tab"],
      ["app.model.cycleForward", "ctrl+p"],
      ["app.model.cycleBackward", "shift+ctrl+p"],
      ["app.model.select", "ctrl+l"],
      ["app.tools.expand", "ctrl+o"],
      ["app.thinking.toggle", "ctrl+t"],
      ["app.editor.external", "ctrl+g"],
      ["app.message.followUp", "alt+enter"],
      ["app.message.dequeue", "alt+up"],
      ["app.clipboard.pasteImage", "ctrl+v"],
    ]);
    setKeybindings({
      getKeys: (action: string) =>
        bindings.has(action) ? [bindings.get(action)!] : [],
    } as KeybindingsManager);
    let wide: string[];
    try {
      wide = component.render(160).map(stripTerminalSequences);
      const stacked = component.render(40).map(stripTerminalSequences);
      assert.ok(stacked.every((line) => visibleWidth(line) <= 40));
      assert.match(
        stacked.join("\n"),
        /SESSION[\s\S]*KEYBOARD SHORTCUTS[\s\S]*LAZYPI/,
      );
      assert.ok(stacked.some((line) => line.includes("ctrl+shift+c")));
    } finally {
      setKeybindings(originalKeys);
    }
    const fullText = wide.join("\n");
    assert.match(fullText, /SESSION[\s\S]*KEYBOARD SHORTCUTS/);
    for (const action of [
      "app.interrupt",
      "app.clear",
      "app.exit",
      "app.suspend",
      "tui.editor.deleteToLineEnd",
      "app.thinking.cycle",
      "app.model.cycleForward",
      "app.model.cycleBackward",
      "app.model.select",
      "app.tools.expand",
      "app.thinking.toggle",
      "app.editor.external",
      "app.message.followUp",
      "app.message.dequeue",
      "app.clipboard.pasteImage",
    ] as const)
      assert.ok(fullText.includes(bindings.get(action)!), action);
    for (const hint of [
      "escape · to interrupt",
      "ctrl+shift+c · to clear",
      "ctrl+shift+c twice · exit",
      "ctrl+d · to exit (empty)",
      "ctrl+z · to suspend",
      "ctrl+k · to delete to end",
      "shift+tab · to cycle thinking level",
      "ctrl+p/shift+ctrl+p · to cycle models",
      "ctrl+l · to select model",
      "ctrl+o · to expand tools",
      "ctrl+t · to expand thinking",
      "ctrl+g · for external editor",
      "/ · for commands",
      "! · to run bash",
      "!! · to run bash (no context)",
      "alt+enter · to queue follow-up",
      "alt+up · to edit all queued messages",
      "ctrl+v · to paste image (with text fallback)",
      "drop files · to attach",
    ])
      assert.ok(fullText.includes(hint), hint);
    const first = wide.findIndex((line) => line.includes("█"));
    const border = wide.findIndex((line) => line.includes("╭"));
    assert.equal(wide[first]!.indexOf("█"), Math.floor((160 - 60) / 2));
    assert.equal(wide[border]!.indexOf("╭"), (160 - 112) / 2);
    assert.equal(first, 2, "logo starts after two lines of top padding");
    assert.match(
      wide.join("\n"),
      /Model.*provider\/model-42[^\n]*\n.*Thinking effort.*high/,
    );

    const narrow = component.render(40).map(stripTerminalSequences);
    assert.ok(narrow.every((line) => visibleWidth(line) <= 40));
    assert.equal(
      narrow.findIndex((line) => line.includes("LazyPi")),
      2,
    );
    assert.equal(
      narrow.find((line) => line.includes("LazyPi"))!.indexOf("LazyPi"),
      17,
    );
    assert.match(narrow.join("\n"), /Thinking effort.*high/);
    effort = "off";
    assert.match(component.render(120).join("\n"), /Thinking effort.*off/);

    const short = factory(tui, theme).render(120);
    assert.ok(short.length <= 18, "leave room for Pi's editor and footer");
    assert.match(short.join("\n"), /KEYBOARD SHORTCUTS[\s\S]*\/hotkeys/);
    assert.ok(short.every((line) => visibleWidth(line) <= 120));
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
    const wide = headers[0]!(tui, theme).render(120).join("\n");
    assert.match(wide, /No model selected/);
    assert.doesNotMatch(wide, /Session directory/);
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
