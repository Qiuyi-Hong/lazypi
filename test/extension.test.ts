import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type {
  ExtensionCommandContext,
  RegisteredCommand,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import extension from "../extensions/lazypi.ts";

test("npm extension entrypoint registers the /lazypi command without side effects", () => {
  const registered: string[] = [];
  extension({
    registerCommand: (name: string) => {
      registered.push(name);
    },
  } as unknown as Parameters<typeof extension>[0]);
  assert.deepEqual(registered, ["lazypi"]);
});

test("/lazypi shows previously installed Pi packages after deferring first-run setup", async () => {
  const root = mkdtempSync(join(tmpdir(), "lazypi-command-"));
  const agent = join(root, "agent");
  const existing = join(root, "existing-package");
  mkdirSync(agent);
  mkdirSync(existing);
  writeFileSync(
    join(existing, "package.json"),
    JSON.stringify({ name: "my-package", version: "1.0.0" }),
  );
  writeFileSync(
    join(agent, "settings.json"),
    JSON.stringify({ packages: [existing] }),
  );
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agent;
  try {
    let handler: RegisteredCommand["handler"] | undefined;
    extension({
      registerCommand: (
        _name: string,
        options: { handler: RegisteredCommand["handler"] },
      ) => {
        handler = options.handler;
      },
    } as unknown as Parameters<typeof extension>[0]);
    assert.ok(handler);
    let prompts = 0;
    const ctx = {
      mode: "tui",
      cwd: root,
      isProjectTrusted: () => false,
      ui: {
        select: async () => {
          prompts++;
          return "Later";
        },
        custom: async (
          factory: Parameters<ExtensionCommandContext["ui"]["custom"]>[0],
        ) => {
          const popup = await factory(
            { requestRender: () => {}, terminal: { rows: 24 } } as TUI,
            { fg: (_color: string, text: string) => text } as Theme,
            {} as Parameters<typeof factory>[2],
            () => {},
          );
          assert.ok(
            popup.render(76).some((line) => line.includes("my-package")),
          );
          return { action: "close" };
        },
        notify: () => {},
      },
    } as unknown as ExtensionCommandContext;
    await handler("", ctx);
    assert.equal(prompts, 1);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  }
});
